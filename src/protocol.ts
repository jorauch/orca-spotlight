// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export type SpotlightErrorView = { code: string; message: string }

export type WorktreeView = { name: string; path: string; branch: string | null }

export type HolderView = {
  worktreePath: string
  name: string
  lastSyncAt: number | null
  error: SpotlightErrorView | null
}

export type RepoView = {
  rootPath: string
  /** Orca's project name for the root, else its folder name. */
  projectName: string
  worktrees: WorktreeView[]
  holder: HolderView | null
}

export type OpResult = { ok: true; message?: string } | { ok: false; error: SpotlightErrorView }

declare module 'orca' {
  interface PluginRequests {
    /** Every local repo with linked worktrees, and which worktree holds the Spotlight. */
    'spotlight.state': { output: { repos: RepoView[] } }
    'spotlight.activate': {
      input: { rootPath: string; worktreePath: string; force?: boolean }
      output: OpResult
    }
    'spotlight.deactivate': { input: { rootPath: string; force?: boolean }; output: OpResult }
    'spotlight.sync': { input: { rootPath: string; force?: boolean }; output: OpResult }
  }
  interface PluginPanelEvents {
    /** Something changed; open panels re-read `spotlight.state`. */
    'spotlight.changed': Record<string, never>
  }
}
