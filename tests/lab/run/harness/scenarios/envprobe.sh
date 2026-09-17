#!/usr/bin/bash
# Reports what a helper sees. env, sort, sed and wc are called by bare name
# on purpose: with shadow copies first in the session's PATH, a hit means the
# closed environment did not reach this line.
echo "PATH=$PATH"
echo "BASH_ENV=${BASH_ENV-unset}"
echo "PYTHONPATH=${PYTHONPATH-unset}"
echo "envcount=$(env | wc -l)"
env | sort | sed 's/^/env: /'
exit 0
