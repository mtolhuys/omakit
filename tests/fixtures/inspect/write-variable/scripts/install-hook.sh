#!/usr/bin/env bash
# Put the hook at the destination the caller passes, keep a copy under the
# plugin's own directory, stamp the time at a path the caller passes, and
# replace the destination's record through a staging file on one line.
set -eu
src=${1:-}
dest=${2:-}
stamp=${3:-}
dir=$(/usr/bin/dirname "$dest")
/usr/bin/mkdir -p -m 0700 "$dir"
/usr/bin/cp "$src" "$dest"
/usr/bin/cp "$src" "$HOME/.config/omarchy/plugins/fixture.write-variable/hook"
/usr/bin/date +%s > "$stamp"
/usr/bin/date +%s > "$dest.tmp" && /usr/bin/mv "$dest.tmp" "$dest"
