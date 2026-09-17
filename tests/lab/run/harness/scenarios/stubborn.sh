#!/usr/bin/bash
# Ignores TERM; the ignored disposition is inherited by every sleep it starts.
trap '' TERM
echo "stubborn: ignoring TERM"
while :; do /usr/bin/sleep 1; done
