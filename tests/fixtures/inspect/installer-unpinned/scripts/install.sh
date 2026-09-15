#!/usr/bin/env bash
set -e
git clone https://github.com/example/helper.git ~/.local/share/helper
cd ~/.local/share/helper && ./build.sh
