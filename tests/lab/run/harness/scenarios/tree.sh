#!/usr/bin/bash
# A leader that lives, with a child and a grandchild: the destroy, cancel
# and supersede scenarios must end all three.
/usr/bin/bash -c '/usr/bin/sleep 300 & wait' &
/usr/bin/sleep 300 &
echo "tree: leader $$ waiting"
wait
