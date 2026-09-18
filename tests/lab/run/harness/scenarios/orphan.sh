#!/usr/bin/bash
# A program that kills its own supervisor and keeps a tree alive: without
# the reaper the group would outlive the run it was reported lost in.
/usr/bin/sleep 300 &
kill -9 "$PPID"
sleep 300
