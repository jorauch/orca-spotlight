// Runs src/worker.ts against real temp git repos over a mock Orca host.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

let base: string
let root: string
let wtA: string
let wtB: string

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim()
}

function write(dir: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

function read(dir: string, rel: string): string {
  return readFileSync(path.join(dir, rel), 'utf-8')
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

function host(storage: Record<string, unknown> = {}) {
  return mockHost({
    capabilities: ['storage:own', 'workspace:read'],
    storage: storage as never,
    results: {
      'workspace.list': {
        truncated: false,
        workspaces: [
          { id: 'a', kind: 'worktree', name: 'wt-a', path: wtA, branch: 'feature-a', hostId: null },
          { id: 'b', kind: 'worktree', name: 'wt-b', path: wtB, branch: 'feature-b', hostId: null },
          { id: 'r', kind: 'worktree', name: 'root', path: root, branch: 'main', hostId: null }
        ]
      },
      'statusBar.update': {}
    }
  })
}

beforeEach(() => {
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spotlight-worker-')))
  root = path.join(base, 'root')
  wtA = path.join(base, 'wt-a')
  wtB = path.join(base, 'wt-b')
  mkdirSync(root)
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.name', 'Test')
  git(root, 'config', 'user.email', 'test@example.com')
  write(root, '.gitignore', 'node_modules/\n')
  write(root, 'app.txt', 'root\n')
  git(root, 'add', '-A')
  git(root, 'commit', '-m', 'initial')
  git(root, 'worktree', 'add', wtA, '-b', 'feature-a')
  git(root, 'worktree', 'add', wtB, '-b', 'feature-b')
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

test('lists worktrees per root, without the root itself', async () => {
  const worker = await mountWorker(main, { host: host(), events: ['workspace.removed'] })
  const { repos } = await worker.request('spotlight.state')
  assert.equal(repos.length, 1)
  assert.equal(repos[0].rootPath, root)
  assert.equal(repos[0].rootBranch, 'main')
  assert.deepEqual(
    repos[0].worktrees.map((w) => w.name),
    ['wt-a', 'wt-b']
  )
  assert.equal(repos[0].holder, null)
  await worker.deactivate()
})

test('activate mirrors, the watcher syncs, takeover switches, deactivate restores', async () => {
  const h = host()
  const worker = await mountWorker(main, { host: h, events: ['workspace.removed'] })
  write(root, 'local-only.txt', 'untracked root file\n')
  write(root, 'app.txt', 'root dirty\n')

  write(wtA, 'app.txt', 'from a\n')
  // A dirty root is fine: its changes are backed up and come back on deactivate.
  assert.deepEqual(
    await worker.request('spotlight.activate', { rootPath: root, worktreePath: wtA }),
    { ok: true }
  )
  assert.equal(read(root, 'app.txt'), 'from a\n')
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'HEAD')

  write(wtA, 'app.txt', 'from a, edited\n')
  await until(() => read(root, 'app.txt') === 'from a, edited\n')

  write(wtB, 'app.txt', 'from b\n')
  assert.deepEqual(
    await worker.request('spotlight.activate', { rootPath: root, worktreePath: wtB }),
    { ok: true }
  )
  assert.equal(read(root, 'app.txt'), 'from b\n')
  const { repos } = await worker.request('spotlight.state')
  assert.equal(repos[0].holder?.name, 'wt-b')

  assert.deepEqual(await worker.request('spotlight.deactivate', { rootPath: root }), { ok: true })
  assert.equal(read(root, 'app.txt'), 'root dirty\n')
  assert.equal(read(root, 'local-only.txt'), 'untracked root file\n')
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  assert.deepEqual(h.data().storage, { holders: [] })
  await worker.deactivate()
})

test('warns about migration files the mirrored code changes', async () => {
  const worker = await mountWorker(main, { host: host(), events: ['workspace.removed'] })
  write(wtA, 'src/Db/Migrations/20261107_Add.cs', 'migration\n')
  await worker.request('spotlight.activate', { rootPath: root, worktreePath: wtA })
  let { repos } = await worker.request('spotlight.state')
  assert.deepEqual(repos[0].holder?.migrationFiles, ['src/Db/Migrations/20261107_Add.cs'])

  await worker.request('spotlight.dismissMigrations', { rootPath: root })
  ;({ repos } = await worker.request('spotlight.state'))
  assert.deepEqual(repos[0].holder?.migrationFiles, [])

  // Switching to a worktree WITHOUT that migration is the risky direction: the DB is ahead.
  await worker.request('spotlight.activate', { rootPath: root, worktreePath: wtB })
  ;({ repos } = await worker.request('spotlight.state'))
  assert.deepEqual(repos[0].holder?.migrationFiles, ['src/Db/Migrations/20261107_Add.cs'])
  await worker.request('spotlight.deactivate', { rootPath: root })
  await worker.deactivate()
})

test('a sync blocked by edits made directly in the root reports root-diverged', async () => {
  const worker = await mountWorker(main, { host: host(), events: ['workspace.removed'] })
  await worker.request('spotlight.activate', { rootPath: root, worktreePath: wtA })
  write(root, 'app.txt', 'edited in root\n')
  write(wtA, 'app.txt', 'from a\n')
  const result = await worker.request('spotlight.sync', { rootPath: root })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.error.code, 'root-diverged')
  assert.equal(read(root, 'app.txt'), 'edited in root\n')

  assert.deepEqual(await worker.request('spotlight.sync', { rootPath: root, force: true }), { ok: true })
  assert.equal(read(root, 'app.txt'), 'from a\n')
  await worker.request('spotlight.deactivate', { rootPath: root })
  await worker.deactivate()
})

test('a restarted worker resumes the holder from storage', async () => {
  const h = host()
  const first = await mountWorker(main, { host: h, events: ['workspace.removed'] })
  await first.request('spotlight.activate', { rootPath: root, worktreePath: wtA })
  await first.deactivate()

  const second = await mountWorker(main, {
    host: host(h.data().storage as Record<string, unknown>),
    events: ['workspace.removed']
  })
  await until(() => true)
  const { repos } = await second.request('spotlight.state')
  assert.equal(repos[0].holder?.name, 'wt-a')
  write(wtA, 'app.txt', 'after restart\n')
  await until(() => read(root, 'app.txt') === 'after restart\n')
  await second.request('spotlight.deactivate', { rootPath: root })
  await second.deactivate()
})

test('removing the holder worktree gives the root back', async () => {
  const worker = await mountWorker(main, { host: host(), events: ['workspace.removed'] })
  write(wtA, 'app.txt', 'from a\n')
  await worker.request('spotlight.activate', { rootPath: root, worktreePath: wtA })
  await worker.emit('workspace.removed', { workspaceId: 'a', kind: 'worktree', path: wtA })
  assert.equal(read(root, 'app.txt'), 'root\n')
  assert.equal(git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
  await worker.deactivate()
})
