// Local binding for the engine: runs the system `git` (argv only, no shell).
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { SpotlightGitContext, SpotlightGitExecutor } from './git-exec'
import type { GitConflictOperation } from './types'

const execFileAsync = promisify(execFile)

export const localGitExecutor: SpotlightGitExecutor = async (args, cwd, opts) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    // `status -uall` on a large repo with many untracked files exceeds the 1 MiB default.
    maxBuffer: 64 * 1024 * 1024,
    env: opts?.env ? { ...process.env, ...opts.env } : process.env
  })
  return { stdout, stderr }
}

/** The same markers git itself uses to report a merge, rebase or cherry-pick in progress. */
async function detectConflictOperation(path: string): Promise<GitConflictOperation> {
  const markers: Array<[string, GitConflictOperation]> = [
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick']
  ]
  for (const [marker, operation] of markers) {
    const { stdout } = await localGitExecutor(['rev-parse', '--git-path', marker], path)
    if (existsSync(resolve(path, stdout.trim()))) {
      return operation
    }
  }
  return 'unknown'
}

export function createLocalGitContext(): SpotlightGitContext {
  return { git: localGitExecutor, detectConflict: detectConflictOperation }
}
