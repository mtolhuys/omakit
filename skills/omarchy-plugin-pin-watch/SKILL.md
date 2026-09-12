---
name: omarchy-plugin-pin-watch
description: Diagnose an Omarchy marketplace plugin submission that has gone quiet or is stuck waiting. Use when a submission issue has had no progress, when a reviewer asked for a fresh validation, or when fixes were pushed but nothing happened. Checks whether the review pin has gone stale and names the one action that refreshes it.
---

# A submission that has gone quiet

## The mechanism, first

When a submission is validated, the marketplace pins its review to **one exact
commit**. The only action that moves that pin is **editing the issue body**.

- The only workflow with a direct `issues` trigger fires on
  `opened, edited, reopened, labeled, unlabeled`.
- There is no `issue_comment` trigger anywhere in the marketplace.
- The daily HEAD comparison covers plugins that are already listed, not open
  submissions.

So pushing a fix does nothing, and commenting "fixed in `abc123`" does nothing.
Both feel like progress. Neither is. This is the single most common reason a
submission sits still: of the 464 submissions parked in their author's court, 73%
have a default-branch HEAD the marketplace never saw, and 82% of the authors whose
push came after a review comment had also commented: engaged, and stuck.

## Check it

```bash
omakit watch https://github.com/omacom/omarchy-plugin-marketplace/issues/<number>
```

Read-only. It does not comment, label, or edit anything, and it cannot. Set
`GITHUB_TOKEN` for a cleaner read of the default branch; without it the command
falls back to the public commit feed.

## Acting on each verdict

**`stale`.** The pin is behind. Tell the owner plainly: the marketplace has not
seen the newer commit, and the fix is to **edit the issue body** (any edit
re-triggers validation and the baseline against the new commit). Do not advise
them to push again, and do not advise them to comment. If you are asked to do it,
that is an edit to their issue: get their explicit approval and do it yourself,
outside this tool.

**`current`.** The pin is the current HEAD. The submission is genuinely waiting
on a person, or on a fix the reviewer asked for that has not been made. Read the
review comments and address the substance. Do not edit the issue to "bump" it: a
fresh validation clears the reviewer's human decision and costs him a complete
re-read of the plugin.

**`unknown`.** There is no validated commit to compare, the last baseline did not
complete, or the repository's HEAD could not be read. The output says which. Never
report this as `current`.

## Before you conclude that the reviewer is behind

Check the assumption. The maintainer's own queue is a median half a day old, and
his median time from submission to publication is hours. If a submission has been
still for five days, the overwhelmingly likely reason is that it is waiting on its
author, not on him.
