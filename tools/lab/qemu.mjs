// The guest's machine: QEMU's argument list, built pure so a test can read
// it, and the QMP socket, spoken to from Node so a run needs no socat.
//
// What the argument list guarantees, and tests/unit/lab.test.mjs holds it
// to: the base disk is the overlay's backing file, opened by QEMU read-only
// because the overlay is what is written; the firmware variables are the
// run's own copy, never the base's template (docs/history/2026-09-18-lab-
// inventory.md P15: the template's mtime moved with every run); no display,
// no host directory, no host socket and no host device reaches the guest;
// the one network device is user-mode with SSH forwarded on 127.0.0.1 and
// nothing else forwarded.

import { spawn } from "node:child_process"
import { connect } from "node:net"
import { OVMF_CODE } from "./host.mjs"

/**
 * @param {{ overlay: string, vars: string, memoryMiB: number, cpus: number, sshPort: number, qmpSocket: string, serialLog: string, pidFile: string, ovmfCode?: string }} options
 */
export function qemuArgs({ overlay, vars, memoryMiB, cpus, sshPort, qmpSocket, serialLog, pidFile, ovmfCode = OVMF_CODE }) {
  if (!Number.isInteger(sshPort) || sshPort < 1024 || sshPort > 65535) throw new Error(`lab: the SSH port must be an unprivileged port, not ${sshPort}`)
  return [
    "-cpu", "host", "-enable-kvm", "-machine", "q35,accel=kvm",
    "-smp", String(cpus),
    "-m", String(memoryMiB),
    "-drive", `if=pflash,format=raw,readonly=on,file=${ovmfCode}`,
    "-drive", `if=pflash,format=raw,file=${vars}`,
    "-drive", `file=${overlay},format=qcow2,if=none,id=drive0`,
    "-device", "virtio-blk-pci,drive=drive0,bootindex=1",
    "-device", "virtio-vga",
    "-display", "none",
    "-usb", "-device", "usb-tablet",
    "-netdev", `user,id=net0,hostfwd=tcp:127.0.0.1:${sshPort}-:22`,
    "-device", "virtio-net-pci,netdev=net0",
    "-qmp", `unix:${qmpSocket},server,nowait`,
    "-serial", `file:${serialLog}`,
    "-pidfile", pidFile,
  ]
}

/**
 * Start QEMU as a child of this process, not daemonised: the lifetime is
 * the run's, and the exit handlers in run.mjs end it on every path. The
 * child's stdio goes to the run's log so a QEMU that refuses to start
 * says why.
 */
export function startQemu(args, { log, binary = "qemu-system-x86_64" } = {}) {
  const child = spawn(binary, args, { stdio: ["ignore", log, log] })
  return child
}

/**
 * One QMP session: the capabilities handshake, then `execute` per
 * command. A command's answer is the first `return` or `error` object
 * after it, events in between are dropped. The socket is opened per
 * command, as the toolchain's socat did; QMP allows one client and a
 * held-open socket would block a diagnostic connection.
 */
export function qmpExecute(socket, command, args = undefined, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = connect(socket)
    let buffer = ""
    let stage = 0
    let settled = false
    const timer = setTimeout(() => finish(new Error(`QMP ${command} did not answer within ${timeoutMs} ms`)), timeoutMs)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    client.on("error", (error) => finish(Object.assign(new Error(`QMP socket ${socket}: ${error.code || error.message}`), { code: "qmp-unavailable" })))
    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      let index
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (stage === 0 && message.QMP) {
          stage = 1
          client.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\n`)
        } else if (stage === 1 && "return" in message) {
          stage = 2
          client.write(`${JSON.stringify({ execute: command, ...(args ? { arguments: args } : {}) })}\n`)
        } else if (stage === 2 && "return" in message) {
          finish(null, message.return)
        } else if (stage === 2 && message.error) {
          finish(Object.assign(new Error(`QMP ${command}: ${message.error.desc || message.error.class}`), { code: "qmp-error" }))
        }
      }
    })
  })
}

/** Whether a QEMU answers on this socket: the cross-namespace liveness question prune and the lock ask. */
export async function qmpAlive(socket) {
  try {
    const status = await qmpExecute(socket, "query-status", undefined, { timeoutMs: 2000 })
    return { alive: true, status: status?.status || null }
  } catch {
    return { alive: false, status: null }
  }
}

/**
 * The qcode for one character, as the toolchain's `type_text` mapped it.
 * Only what a login needs is typed by the lab (the guest password), but
 * the table is the toolchain's whole one so a suite that asks for more
 * gets the same keys.
 */
const SHIFTED = {
  "_": "minus", ":": "semicolon", "@": "2", "|": "backslash", '"': "apostrophe", "+": "equal", "%": "5", "&": "7", "*": "8",
  "(": "9", ")": "0", "<": "comma", ">": "dot", "!": "1", "#": "3", "$": "4", "?": "slash", "~": "grave_accent", "{": "bracket_left", "}": "bracket_right",
}
const PLAIN = { " ": "spc", ".": "dot", ",": "comma", "-": "minus", "/": "slash", ";": "semicolon", "'": "apostrophe", "=": "equal", "\\": "backslash", "[": "bracket_left", "]": "bracket_right" }

export function qcodesFor(text) {
  const chords = []
  for (const ch of String(text)) {
    if (/^[a-z0-9]$/.test(ch)) chords.push([ch])
    else if (/^[A-Z]$/.test(ch)) chords.push(["shift", ch.toLowerCase()])
    else if (ch in PLAIN) chords.push([PLAIN[ch]])
    else if (ch in SHIFTED) chords.push(["shift", SHIFTED[ch]])
    else throw new Error(`lab: no qcode for ${JSON.stringify(ch)}`)
  }
  return chords
}

/** Press one chord: `["ctrl","alt","f3"]`, or `["ret"]`. */
export async function press(socket, chord) {
  await qmpExecute(socket, "send-key", { keys: chord.map((key) => ({ type: "qcode", data: key })) })
}

/** Type text one chord at a time, 50 ms apart as the toolchain did. */
export async function typeText(socket, text) {
  for (const chord of qcodesFor(text)) {
    await press(socket, chord)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** A screendump to a PPM file; the caller converts it if it has `magick`. */
export async function screendump(socket, file) {
  await qmpExecute(socket, "screendump", { filename: file })
}
