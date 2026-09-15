# Auditing installed plugins

`omakit audit` compares every installed third-party plugin's running commit
with the exact commits the marketplace records as validated. It reads the
installed shell, the marketplace catalog and local Git checkouts. It changes
nothing.

## Facts, verified 2026-09-15

The pinned checkout is clean and is the documented commit:

```text
$ git -C "$XDG_CACHE_HOME/omakit/marketplace" status --short
[no output]
$ git -C "$XDG_CACHE_HOME/omakit/marketplace" rev-parse HEAD
38060f89d2a10b1f9b6b5afe8e226451e8a5b3f6
```

The catalog is an object with a `plugins` array. These are the values of every
catalog field used by `audit`, for two installed listings:

```json
[
  {
    "id": "io.github.pablo-merino.altswitch",
    "repo": "https://github.com/Pablo-Merino/omarchy-altswitch",
    "sourceType": "community",
    "verificationStatus": "unverified",
    "listingValidatedCommit": "b99a58ca94e7ffcb6785d009a2e88f9e68599642",
    "listingValidatedAt": "2026-08-28T22:57:15.992Z",
    "listingValidatedBranch": "main",
    "upstreamObservedCommit": "8f54d684c89d66ecf51e6e5a9c5c574758de79be",
    "upstreamObservedBranch": "main",
    "upstreamCheckedAt": "2026-09-11T09:43:23.063Z",
    "upstreamCheckStatus": "passed",
    "upstreamValidatedCommit": "8f54d684c89d66ecf51e6e5a9c5c574758de79be",
    "upstreamValidatedAt": "2026-08-30T09:56:21.339Z"
  },
  {
    "id": "akshar.radio-atlas",
    "repo": "https://github.com/AksharP5/omarchy-radio-atlas",
    "sourceType": "community",
    "verificationStatus": "unverified",
    "listingValidatedCommit": "4e88a70f79cef462f84a56f19fb3a3971d958e21",
    "listingValidatedAt": "2026-09-04T09:29:27.750Z",
    "listingValidatedBranch": "main",
    "upstreamObservedCommit": "655bf29517a9329b3ba78955feecf6ded20c1414",
    "upstreamObservedBranch": "main",
    "upstreamCheckedAt": "2026-09-11T09:43:23.063Z",
    "upstreamCheckStatus": "passed",
    "upstreamValidatedCommit": "655bf29517a9329b3ba78955feecf6ded20c1414",
    "upstreamValidatedAt": "2026-09-10T08:57:03.312Z"
  }
]
```

The installed-plugin command did not answer on this machine because the shell
was not running. That failure is authoritative, so `audit` must stop as
`NOT AUDITED` rather than substitute another list:

```text
$ omarchy plugin list --json | jq '.[0]'
omarchy-shell is not running
```

The catalog command did answer. Its first row shows that it carries the source
directory:

```json
$ omarchy-plugin-catalog | jq '.[0]'
{
  "id": "akshar.radio-atlas",
  "name": "Radio Atlas",
  "description": "Explore live radio on a rotatable globe and play stations through Omarchy's media controls.",
  "kinds": [
    "panel",
    "bar-widget"
  ],
  "firstParty": false,
  "manifestPath": "/home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas/manifest.json",
  "sourceDir": "/home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas",
  "entryPoints": {
    "panel": "RadioAtlas.qml",
    "barWidget": "BarWidget.qml"
  },
  "barWidget": {
    "displayName": "Radio Atlas",
    "description": "Open the world radio globe",
    "category": "Media",
    "allowMultiple": false,
    "defaultSection": "left"
  },
  "bar": null,
  "barWidgetPath": "/home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas/BarWidget.qml",
  "barPath": null
}
```

`tools/weigh/list.mjs:51-90` already joins `omarchy plugin list --json` to
`omarchy-plugin-catalog` by `id`, taking `sourceDir` from the latter. `audit`
reuses that join.

`submit` passes the manifest id and the clone's origin to `checkIdentity` at
`tools/marketplace/submit.mjs:242-245`. `checkIdentity` compares the id and
repository at `tools/marketplace/registry.mjs:432-467`, using
`sameRepository` at lines 133-136. That comparison reduces a repository to
owner and name, ignores case and a trailing `.git`. `audit` reuses those
functions.

The verification route is read from the pin by `newerCommitChoice` at
`tools/marketplace/form.mjs:152-167`. It returned:

```json
{
  "formPath": ".github/ISSUE_TEMPLATE/verify-plugin.yml",
  "name": "Verify or update a listed plugin",
  "choice": "Verify and publish a newer upstream commit"
}
```

`watch` imports the marketplace's verification parser from the pin at
`tools/marketplace/watch.mjs:57-95`. It uses that parser for verification-form
issues instead of restating their shape.

`liveRegistry` at `tools/marketplace/registry.mjs:213-265` is the existing
loader for both `registry.json` and `site/catalog.json`. It reads both at one
resolved marketplace HEAD commit, caches the pair, and falls back to the pin.
At `--offline`, line 233 returns the pin directly. `audit` reuses this loader
unchanged.

Two installed third-party Git checkouts gave these facts. The ancestor tested
for each is its `upstreamValidatedCommit` from the catalog above.

```text
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas rev-parse HEAD
b290c29c1a9bfd1a0296f05fe995e1cd4e6e6ccd
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas status --porcelain
[no output]
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas remote get-url origin
https://github.com/AksharP5/omarchy-radio-atlas.git
$ git -C /home/mtolhuijs/.config/omarchy/plugins/akshar.radio-atlas merge-base --is-ancestor 655bf29517a9329b3ba78955feecf6ded20c1414 HEAD; echo $?
0

$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch rev-parse HEAD
8f54d684c89d66ecf51e6e5a9c5c574758de79be
$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch status --porcelain
 M altswitch.lua
$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch remote get-url origin
https://github.com/Pablo-Merino/omarchy-altswitch.git
$ git -C /home/mtolhuijs/.config/omarchy/plugins/io.github.pablo-merino.altswitch merge-base --is-ancestor 8f54d684c89d66ecf51e6e5a9c5c574758de79be HEAD; echo $?
0
```
