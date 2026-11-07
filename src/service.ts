// Holds the Spotlight per repo root: which worktree mirrors onto it, its watcher, and the
// last outcome. The git refs (refs/spotlight-plugin/*) stay the source of truth; storage
// only remembers WHICH worktree held the root, so a restarted worker can resume watching.
import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, sep } from 'node:path'
import {
  activateSpotlightCore,
  deactivateSpotlightCore,
  inspectSpotlightRefsCore,
  syncSpotlightCore,
  SpotlightCoreError,
  type SpotlightGitContext
} from './engine/core'
import { gitTry } from './engine/git-exec'
import type { HolderView, OpResult, RepoView, SpotlightErrorView, WorktreeView } from './protocol'

export type ListedWorkspace = { kind: string; name: string; path: string; branch: string | null }

export type ServiceDeps = {
  git: SpotlightGitContext
  listWorkspaces: () => Promise<ListedWorkspace[]>
  /** Orca project display names by repo root path; may be empty. */
  projectNames: () => Promise<Map<string, string>>
  load: () => Promise<unknown>
  save: (value: PersistedHolder[]) => Promise<void>
  /** Called after every state change (panel refresh, status bar). */
  changed: (holders: HolderView[]) => void
  log: (message: string) => void
  debounceMs?: number
}

export type PersistedHolder = {
  rootPath: string
  worktreePath: string
  name: string
}

type Holder = PersistedHolder & {
  lastSyncAt: number | null
  error: SpotlightErrorView | null
  reuseIndexForHead: string | null
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
}

/** Directories whose churn never changes the mirrored (tracked, non-ignored) tree. */
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', 'bin', 'obj', '.nuxt', '.output'])

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function toErrorView(error: unknown): SpotlightErrorView {
  if (error instanceof SpotlightCoreError) {
    return { code: error.code, message: error.message }
  }
  return { code: 'git-failed', message: error instanceof Error ? error.message : String(error) }
}

export class SpotlightService {
  private readonly holders = new Map<string, Holder>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly commonDirs = new Map<string, string | null>()

  constructor(private readonly deps: ServiceDeps) {}

  /** Re-attach to holders a previous worker run left active. */
  async restore(): Promise<void> {
    const saved = await this.deps.load()
    if (!Array.isArray(saved)) {
      return
    }
    for (const entry of saved as PersistedHolder[]) {
      const refs = await inspectSpotlightRefsCore(this.deps.git, entry.rootPath).catch(() => null)
      if (!refs?.snapshotSha || !refs.originalHeadSha || !existsSync(entry.worktreePath)) {
        this.deps.log(`restore: dropping ${entry.worktreePath} (no longer active)`)
        continue
      }
      const holder = this.newHolder(entry)
      this.holders.set(entry.rootPath, holder)
      this.startWatcher(holder)
      void this.sync(entry.rootPath)
    }
    await this.persist()
    this.publish()
  }

  async state(): Promise<{ repos: RepoView[] }> {
    const byRoot = new Map<string, WorktreeView[]>()
    for (const workspace of await this.deps.listWorkspaces()) {
      if (workspace.kind !== 'worktree' || !existsSync(workspace.path)) {
        continue
      }
      const rootPath = await this.rootOf(workspace.path)
      if (!rootPath || rootPath === canonical(workspace.path)) {
        continue
      }
      const list = byRoot.get(rootPath) ?? []
      list.push({ name: workspace.name, path: workspace.path, branch: workspace.branch })
      byRoot.set(rootPath, list)
    }
    for (const rootPath of this.holders.keys()) {
      if (!byRoot.has(rootPath)) {
        byRoot.set(rootPath, [])
      }
    }
    const names = await this.deps.projectNames().catch(() => new Map<string, string>())
    const repos: RepoView[] = []
    for (const [rootPath, worktrees] of byRoot) {
      const holder = this.holders.get(rootPath)
      repos.push({
        rootPath,
        projectName: names.get(rootPath) ?? basename(rootPath),
        worktrees: worktrees.sort((a, b) => a.name.localeCompare(b.name)),
        holder: holder ? this.view(holder) : null
      })
    }
    return { repos: repos.sort((a, b) => a.projectName.localeCompare(b.projectName)) }
  }

  activate(rootPath: string, worktreePath: string, force = false): Promise<OpResult> {
    return this.exclusive(rootPath, async () => {
      const name = basename(worktreePath)
      try {
        const outcome = await activateSpotlightCore(this.deps.git, rootPath, worktreePath, {
          force,
          requireOnBranch: true
        })
        const previous = this.holders.get(rootPath)
        if (previous) {
          this.stopWatcher(previous)
        }
        const holder = this.newHolder({ rootPath, worktreePath, name })
        holder.reuseIndexForHead = outcome.checkpointHeadSha
        holder.lastSyncAt = Date.now()
        this.holders.set(rootPath, holder)
        this.startWatcher(holder)
        await this.persist()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: toErrorView(error) }
      } finally {
        this.publish()
      }
    })
  }

  sync(rootPath: string, force = false): Promise<OpResult> {
    return this.exclusive(rootPath, async () => {
      const holder = this.holders.get(rootPath)
      if (!holder) {
        return { ok: false, error: { code: 'not-active', message: 'Spotlight is not active.' } }
      }
      try {
        const outcome = await syncSpotlightCore(this.deps.git, rootPath, holder.worktreePath, {
          force,
          reuseIndexForHead: holder.reuseIndexForHead
        })
        holder.reuseIndexForHead = outcome.checkpointHeadSha
        // Also on a skipped sync: the root was just confirmed to match the worktree.
        holder.lastSyncAt = Date.now()
        holder.error = null
        return { ok: true }
      } catch (error) {
        holder.error = toErrorView(error)
        return { ok: false, error: holder.error }
      } finally {
        this.publish()
      }
    })
  }

  deactivate(rootPath: string, force = false): Promise<OpResult> {
    return this.exclusive(rootPath, async () => {
      const holder = this.holders.get(rootPath)
      try {
        const outcome = await deactivateSpotlightCore(this.deps.git, rootPath, { force })
        if (holder) {
          this.stopWatcher(holder)
        }
        this.holders.delete(rootPath)
        await this.persist()
        if (outcome.branchMissing) {
          return {
            ok: true,
            message: outcome.branchInUse
              ? `Root restored but left detached: branch ${outcome.originalBranch} is checked out in another worktree.`
              : `Root restored but left detached: branch ${outcome.originalBranch} no longer exists.`
          }
        }
        return { ok: true }
      } catch (error) {
        const view = toErrorView(error)
        if (holder) {
          holder.error = view
        }
        return { ok: false, error: view }
      } finally {
        this.publish()
      }
    })
  }

  /** A removed worktree can no longer feed the root: give the root back. */
  async onWorktreeRemoved(path: string): Promise<void> {
    for (const holder of this.holders.values()) {
      if (canonical(holder.worktreePath) === canonical(path) || holder.worktreePath === path) {
        this.stopWatcher(holder)
        const result = await this.deactivate(holder.rootPath)
        this.deps.log(`worktree removed, deactivate: ${JSON.stringify(result)}`)
      }
    }
  }

  dispose(): void {
    for (const holder of this.holders.values()) {
      this.stopWatcher(holder)
    }
  }

  private newHolder(entry: PersistedHolder): Holder {
    return {
      rootPath: entry.rootPath,
      worktreePath: entry.worktreePath,
      name: entry.name,
      lastSyncAt: null,
      error: null,
      reuseIndexForHead: null,
      watcher: null,
      timer: null
    }
  }

  private view(holder: Holder): HolderView {
    return {
      worktreePath: holder.worktreePath,
      name: holder.name,
      lastSyncAt: holder.lastSyncAt,
      error: holder.error
    }
  }

  private publish(): void {
    this.deps.changed([...this.holders.values()].map((holder) => this.view(holder)))
  }

  private async persist(): Promise<void> {
    await this.deps.save(
      [...this.holders.values()].map(({ rootPath, worktreePath, name }) => ({
        rootPath,
        worktreePath,
        name
      }))
    )
  }

  /** Serializes all git work on one root: watcher syncs never interleave with a toggle. */
  private exclusive<T>(rootPath: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(rootPath) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.queues.set(rootPath, tail)
    void tail.then(() => {
      if (this.queues.get(rootPath) === tail) {
        this.queues.delete(rootPath)
      }
    })
    return next
  }

  private startWatcher(holder: Holder): void {
    try {
      holder.watcher = watch(holder.worktreePath, { recursive: true }, (_event, file) => {
        if (file && String(file).split(sep).some((segment) => IGNORED_SEGMENTS.has(segment))) {
          return
        }
        if (holder.timer) {
          clearTimeout(holder.timer)
        }
        holder.timer = setTimeout(() => {
          holder.timer = null
          void this.sync(holder.rootPath)
        }, this.deps.debounceMs ?? 750)
      })
      holder.watcher.on('error', (error) => {
        holder.error = { code: 'watch-failed', message: String(error) }
        this.publish()
      })
    } catch (error) {
      holder.error = { code: 'watch-failed', message: String(error) }
    }
  }

  private stopWatcher(holder: Holder): void {
    holder.watcher?.close()
    holder.watcher = null
    if (holder.timer) {
      clearTimeout(holder.timer)
      holder.timer = null
    }
  }

  private async rootOf(worktreePath: string): Promise<string | null> {
    if (!this.commonDirs.has(worktreePath)) {
      const commonDir = await gitTry(this.deps.git, worktreePath, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir'
      ])
      this.commonDirs.set(worktreePath, commonDir)
    }
    const commonDir = this.commonDirs.get(worktreePath)
    // A bare common dir has no working root to mirror onto.
    return commonDir && basename(commonDir) === '.git' ? canonical(dirname(commonDir)) : null
  }
}
