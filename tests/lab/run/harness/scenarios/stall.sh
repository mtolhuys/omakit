#!/usr/bin/bash
# A program that stops its supervisor: no result can come, the backstop
# has to end the run, and a start() queued behind it must still follow.
kill -STOP "$PPID"
sleep 300
