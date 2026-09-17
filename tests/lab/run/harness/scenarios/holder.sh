#!/usr/bin/bash
# The leader exits at once; a descendant keeps stdout open for 300 s.
/usr/bin/sleep 300 &
echo "holder: leader exiting, descendant $! holds the pipe"
exit 0
