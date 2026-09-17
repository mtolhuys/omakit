#!/usr/bin/bash
# Output with C0, DEL, C1 and bidi controls between plain words; the result
# must carry the words and none of the controls.
printf 'a\033[31mb\177c\302\205d\342\200\256e\tf\ng\r\n'
printf 'stderr\033]0;title\007line\n' >&2
exit 0
