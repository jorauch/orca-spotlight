# Spotlight for Orca

An [Orca](https://www.onorca.dev) plugin that mirrors one worktree's changes onto the repo root
checkout, so a single running dev environment (dev server, Docker stack, installed dependencies)
serves whichever worktree you pick. Useful when a project is too heavy to run once per worktree.

Modelled on Conductor's Spotlight; the git engine is adapted from
[stablyai/orca#7067](https://github.com/stablyai/orca/pull/7067) (see `NOTICE.md`). Meant as a
bridge until Orca ships Spotlight itself — then remove this plugin.

## Requirements

- Orca **1.4.248** or newer, with plugins turned on (Settings → Plugins → **Turn on plugins**)
- `git` reachable from Orca (on macOS the Xcode Command Line Tools or Homebrew git); 2.31 or newer
  recommended
- The repository added to Orca, and its worktrees known to Orca as workspaces — the panel lists
  only those
- A regular (non-bare) root checkout, on a branch when you first turn Spotlight on, with no merge,
  rebase or cherry-pick in progress
- A dev server in the root that picks up file changes (hot reload or watch mode); otherwise the
  mirrored code only takes effect after a restart

No Node.js install, npm packages or external file watcher are needed: the plugin runs in Orca's
own Node and watches files with its built-in `fs.watch`.

### Platforms

| Platform | Status |
| -------- | ------ |
| macOS | Tested |
| Linux | Untested; should work. Large repos can exceed `fs.inotify.max_user_watches` — raise it with `sysctl` if the watcher fails |
| Windows (native) | Untested; paths are compared case-insensitively with `\` and `/` folded. Dev servers that lock files can make a sync fail; it retries once |
| Windows with repos in WSL | Not supported |
| SSH workspaces | Not supported |

## Install

### From a clone (works on every supported Orca)

1. Clone the repository somewhere it can stay:

   ```sh
   git clone https://github.com/jorauch/orca-spotlight.git ~/dev/orca-spotlight
   ```

2. In Orca, open Settings → Plugins → **Development folders…** and add `~/dev/orca-spotlight`.
3. Review the requested access and enable the plugin. It runs its own Node worker with your
   user account's rights (to run `git` and watch files), so Orca asks for your approval once.

Or from a terminal:

```sh
orca plugin dev load ~/dev/orca-spotlight
# prints the requested access and a fingerprint; after reviewing it:
orca plugin dev load ~/dev/orca-spotlight --approve <fingerprint>
```

Update with `git -C ~/dev/orca-spotlight pull`; Orca reloads the plugin by itself.

### With `orca plugin install` (newer Orca)

Orca versions that ship `orca plugin install` can install a tagged release straight from GitHub:

```sh
orca plugin install jorauch/orca-spotlight@v0.1.0
orca plugin update            # later, to move to a newer release
```

## Use

1. Open the **Spotlight** panel (bolt icon) in Orca's right sidebar. It lists your worktrees,
   grouped by project.
2. Click the **bolt** next to a worktree. Its code is mirrored onto the repo root, and every
   further change in the worktree follows within about a second. The dot before the title turns
   green, the status bar shows the worktree.
3. Click the bolt of **another** worktree to switch: only one worktree per project holds the
   Spotlight.
4. Click the **lit bolt** to turn Spotlight off. The root returns exactly to where it was.

While a switch runs, a spinner replaces the bolt. A red dot and an arrow mean an error; click the
arrow for details and, where it applies, **Force sync** / **Force turn off**.

## Behaviour

- Turning Spotlight on backs up the root's state (branch, HEAD, staged and unstaged changes) under
  `refs/spotlight-plugin/*`, detaches the root, and resets it to a checkpoint commit of the
  worktree's tracked and new non-ignored files.
- A file watcher re-syncs 750 ms after the last change in the worktree.
- Switching keeps the original root backup; turning off restores branch, HEAD, staged and
  unstaged changes.
- Untracked and ignored root files (`.env`, `node_modules`, `bin/obj`) are never touched.
- Edits or commits made directly in the root block sync and turn-off (`root-diverged`) instead of
  being destroyed; **Force sync** / **Force turn off** discard them deliberately.
- Removing the holding worktree in Orca turns Spotlight off.
- The plugin does not look at databases: if worktrees carry different migrations, migrate or roll
  back yourself after switching.

Recovery by hand, if ever needed:
`git reset --hard refs/spotlight-plugin/original-head`, then
`git stash apply --index refs/spotlight-plugin/backup` restores the root's original changes.

## Uninstall

Turn Spotlight off first (so the root is restored), then remove the folder under Settings →
Plugins → Development folders, or run `orca plugin dev unload ~/dev/orca-spotlight`.

## Develop

```sh
orca plugin test .         # engine tests (real temp repos), worker and panel tests
orca plugin check .
orca plugin dev load .     # load this folder into Orca (asks for approval once)
orca plugin logs local.spotlight
```

`npx tsc -p .` needs the typings from `orca plugin types .`, which fails on Orca 1.4.251 (its app
bundle lacks `orca.d.ts`); the tests are the check until then.

## License

MIT, see `LICENSE`. Third-party notices in `NOTICE.md`.
