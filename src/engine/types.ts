// Adapted from stablyai/orca PR #7067 (MIT, see NOTICE.md).
// Shared engine types. The ref prefix differs from the PR on purpose
// (refs/spotlight-plugin/*), so this plugin and a future built-in Orca
// Spotlight never read or overwrite each other's state.

export type GitConflictOperation = 'merge' | 'rebase' | 'cherry-pick' | 'unknown'

export type SpotlightErrorCode =
  /** Rebase/merge/cherry-pick in progress in the root or holder worktree. */
  | 'operation-in-progress'
  /** Root HEAD moved off the snapshot or picked up changes while active. */
  | 'root-diverged'
  /** Untracked root files would be overwritten by newly tracked snapshot paths. */
  | 'untracked-collision'
  /** The repo has not opted into Spotlight testing (settings toggle off). */
  | 'not-enabled'
  /** Restoring the root's uncommitted changes conflicted on deactivate. */
  | 'restore-conflict'
  /** The root's original branch was deleted while Spotlight was active. */
  | 'branch-missing'
  | 'unborn-head'
  | 'bare-root'
  /** The main worktree cannot hold the Spotlight (it IS the sync target). */
  | 'root-is-holder'
  /** The repo root isn't on its primary branch, so there's no clean branch to
   *  return it to — the user must check the primary branch out first. */
  | 'not-on-primary-branch'
  | 'repo-not-found'
  | 'worktree-not-found'
  | 'not-active'
  | 'unsupported-host'
  | 'git-failed'

export type SpotlightRefsSnapshot = {
  snapshotSha: string | null
  backupSha: string | null
  originalHeadSha: string | null
  originalBranch: string | null
  /** Current root HEAD, for detecting divergence from the snapshot. */
  rootHeadSha: string | null
}

export const SPOTLIGHT_REFS = {
  snapshot: 'refs/spotlight-plugin/snapshot',
  backup: 'refs/spotlight-plugin/backup',
  originalHead: 'refs/spotlight-plugin/original-head',
  originalBranch: 'refs/spotlight-plugin/original-branch'
} as const
