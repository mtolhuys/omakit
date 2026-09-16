#!/usr/bin/env python3
"""A continuation line is not a nesting level."""
import os


def link_unused_name(backgrounds_fd, temporary_name, base):
    for candidate in candidate_names(base):
        try:
            os.link(
                temporary_name,
                candidate,
                src_dir_fd=backgrounds_fd,
                dst_dir_fd=backgrounds_fd,
            )
            return candidate
        except FileExistsError:
            continue
    raise SystemExit("no free name")


def deep(rows):
    for row in rows:
        if row:
            for cell in row:
                print(cell)
