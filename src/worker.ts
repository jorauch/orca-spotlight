// The plugin's worker: wires the Spotlight service to Orca. The status bar item keeps this
// worker running while the plugin is enabled, so the file watcher survives idle periods.
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { promisify } from 'node:util'
import type { OrcaWorkerApi } from 'orca/worker'
import { createLocalGitContext } from './engine/local-git'
import type { HolderView } from './protocol'
import { SpotlightService, type ListedWorkspace, type PersistedHolder } from './service'

const HOLDERS_KEY = 'holders'
const ORCA_CLI = ['orca', '/Applications/Orca.app/Contents/Resources/bin/orca']
const execFileAsync = promisify(execFile)

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Project names as Orca's sidebar shows them; the host API has no project list yet. */
async function projectNames(): Promise<Map<string, string>> {
  for (const cli of ORCA_CLI) {
    try {
      const { stdout } = await execFileAsync(cli, ['repo', 'list', '--json'], { timeout: 5000 })
      const repos = JSON.parse(stdout).result.repos as { path: string; displayName: string }[]
      return new Map(repos.map((repo) => [canonical(repo.path), repo.displayName]))
    } catch {
      // Try the next location; callers fall back to folder names.
    }
  }
  return new Map()
}

function statusBar(holders: HolderView[]) {
  if (holders.length === 0) {
    return {
      id: 'spotlight',
      text: 'Spotlight off',
      tone: 'neutral',
      tooltip: 'Spotlight: no worktree mirrored onto the repo root'
    }
  }
  const failing = holders.some((holder) => holder.error)
  return {
    id: 'spotlight',
    text: holders.length === 1 ? `Spotlight: ${holders[0].name}` : `Spotlight: ${holders.length}`,
    tone: failing ? 'danger' : 'accent',
    tooltip: holders
      .map((holder) => `${holder.name}${holder.error ? ` — ${holder.error.message}` : ''}`)
      .join('\n')
  }
}

let service: SpotlightService | null = null

export default function activate(orca: OrcaWorkerApi): void {
  service = new SpotlightService({
    git: createLocalGitContext(),
    listWorkspaces: async () => {
      const result = (await orca.host.call('workspace.list', {})) as {
        workspaces: ListedWorkspace[]
      }
      return result.workspaces
    },
    projectNames,
    load: () => orca.storage.get(HOLDERS_KEY),
    save: (value: PersistedHolder[]) => orca.storage.set(HOLDERS_KEY, value),
    changed: (holders) => {
      orca.panels.post('spotlight.changed', {})
      void orca.host.call('statusBar.update', statusBar(holders)).catch(() => undefined)
    },
    log: (message) => orca.log(message)
  })
  const spotlight = service

  orca.panels.handle('spotlight.state', () => spotlight.state())
  orca.panels.handle('spotlight.activate', ({ rootPath, worktreePath, force }) =>
    spotlight.activate(rootPath, worktreePath, force)
  )
  orca.panels.handle('spotlight.deactivate', ({ rootPath, force }) =>
    spotlight.deactivate(rootPath, force)
  )
  orca.panels.handle('spotlight.sync', ({ rootPath, force }) => spotlight.sync(rootPath, force))
  orca.events.on('workspace.removed', ({ path }) => spotlight.onWorktreeRemoved(path))

  void spotlight.restore().catch((error) => orca.log(`restore failed: ${String(error)}`))
}

export function deactivate(): void {
  service?.dispose()
  service = null
}
