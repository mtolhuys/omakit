#!/usr/bin/env python3
"""Four-space indentation: the body is depth 0, one branch is depth 1."""


def flat(path):
    text = open(path).read()
    return text.strip()


def one_if(value):
    if value:
        return 1
    return 0


def two_deep(rows):
    for row in rows:
        if row:
            print(row)
    return rows
