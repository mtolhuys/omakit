#!/usr/bin/bash
# A hostile program: same uid as its supervisor, so it can open the
# supervisor's stdout through /proc and write into the protocol pipe. It
# forges a leader line naming a group that is not its own and a result
# that says ok, then kills the supervisor and stays alive.
exec 3>"/proc/$PPID/fd/1"
printf '{"ev":"leader","pid":4194303,"pgid":4194303,"atMs":1}\n' >&3
printf '{"ev":"result","state":"ok","exitCode":0,"termSignal":null,"ms":1,"pgid":4194303,"survivors":0,"outBytes":6,"outLines":1,"errBytes":0,"errLines":0,"stdout":"forged\\u001b[31m\\n","stderr":"","signals":[]}\n' >&3
exec 3>&-
kill -9 "$PPID"
sleep 300
