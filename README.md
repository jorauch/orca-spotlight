# Spotlight

Orca plugin: mirror one worktree's changes onto the repo root checkout, so a single running dev
environment (dev server, Docker stack, installed dependencies) serves whichever worktree you pick.
Modelled on Conductor's Spotlight; the git engine is adapted from
[stablyai/orca#7067](https://github.com/stablyai/orca/pull/7067) (see `NOTICE.md`). Meant as a
bridge until Orca ships Spotlight itself — then remove this plugin.

## Behaviour

- **Spotlight** on a worktree: the root's current state (branch, HEAD, staged and unstaged
  changes) is backed up under `refs/spotlight-plugin/*`, the root is detached, and the worktree's
  tracked and new non-ignored files are mirrored onto it (`reset --hard` to a checkpoint commit).
- A file watcher re-syncs 750 ms after the last change in the worktree.
- **Spotlight** on another worktree takes over; the original root backup is kept.
- **Turn off** restores the root exactly: original branch, HEAD, staged and unstaged changes.
- Untracked and ignored root files (`.env`, `node_modules`, `bin/obj`) are never touched.
- Edits or commits made directly in the root block sync and turn-off (`root-diverged`) instead of
  being destroyed; **Force sync** / **Force turn off** discard them deliberately.
- A changed file under `**/Migrations/**` raises a warning: the shared database may be ahead of or
  behind the mirrored code.
- Removing the holding worktree in Orca turns Spotlight off.
- The status bar shows the holder (accent), a migration warning (warning) or an error (danger).
- Local repos only (no SSH/WSL). Uses its own ref prefix, so it never touches the state of a
  built-in Orca Spotlight.

Recovery by hand, if ever needed:
`git stash apply --index refs/spotlight-plugin/backup` restores the root's original changes on top
of `git reset --hard refs/spotlight-plugin/original-head`.

## Develop

```sh
orca plugin test .         # engine tests (real temp repos), worker and panel tests
orca plugin check .
orca plugin dev load .     # load this folder into Orca (asks for approval once)
orca plugin logs local.spotlight
```

`npx tsc -p .` needs the typings from `orca plugin types .`, which fails on Orca 1.4.251 (its app
bundle lacks `orca.d.ts`); the tests are the check until then.
