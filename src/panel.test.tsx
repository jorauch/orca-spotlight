// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { RepoView } from './protocol'
import * as panel from './panel'

function repo(holder: RepoView['holder'] = null): RepoView {
  return {
    rootPath: '/dev/tessa-next',
    rootBranch: 'develop',
    worktrees: [
      { name: 'fix-a', path: '/ws/fix-a', branch: 'fix/1-a' },
      { name: 'feat-b', path: '/ws/feat-b', branch: 'feat/2-b' }
    ],
    holder
  }
}

test('activates a worktree and shows it as live', async () => {
  let state = repo()
  const activations: unknown[] = []
  const host = mockHost({
    requests: {
      'spotlight.state': () => ({ repos: [state] }),
      'spotlight.activate': (input) => {
        activations.push(input)
        state = repo({ worktreePath: '/ws/fix-a', name: 'fix-a', lastSyncAt: 1, error: null, migrationFiles: [] })
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.equal(view.findAll({ text: 'Spotlight' }).length, 2)

  await view.press({ text: 'Spotlight' })
  assert.deepEqual(activations, [{ rootPath: '/dev/tessa-next', worktreePath: '/ws/fix-a' }])
  assert.match(JSON.stringify(view.summary()), /Mirroring fix-a/)
  assert.ok(view.find({ text: 'live' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('offers force actions only for a diverged root, and shows migrations', async () => {
  const host = mockHost({
    requests: {
      'spotlight.state': () => ({
        repos: [
          repo({
            worktreePath: '/ws/fix-a',
            name: 'fix-a',
            lastSyncAt: 1,
            error: { code: 'root-diverged', message: 'The repository root moved.' },
            migrationFiles: ['src/Migrations/20261107_Add.cs']
          })
        ]
      })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'Force sync' }))
  assert.ok(view.find({ text: 'Force turn off' }))
  assert.ok(view.find({ text: 'src/Migrations/20261107_Add.cs' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('shows an empty state without worktrees', async () => {
  const host = mockHost({ requests: { 'spotlight.state': () => ({ repos: [] }) } })
  const view = await mount(panel, { host })
  assert.match(JSON.stringify(view.summary()), /No worktrees/)
  await view.unmount()
})
