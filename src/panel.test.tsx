// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { RepoView } from './protocol'
import * as panel from './panel'

function repo(holder: RepoView['holder'] = null): RepoView {
  return {
    rootPath: '/dev/my-app',
    projectName: 'my-app',
    worktrees: [
      { name: 'fix-a', path: '/ws/fix-a', branch: 'fix/1-a' },
      { name: 'feat-b', path: '/ws/feat-b', branch: 'feat/2-b' }
    ],
    holder
  }
}

test('one switch per worktree: on activates, another takes over, off deactivates', async () => {
  let state = repo()
  const calls: unknown[] = []
  const holder = (name: string) => ({
    worktreePath: `/ws/${name}`,
    name,
    lastSyncAt: 1,
    error: null
  })
  const host = mockHost({
    requests: {
      'spotlight.state': () => ({ repos: [state] }),
      'spotlight.activate': (input) => {
        calls.push(['activate', input.worktreePath])
        state = repo(holder(input.worktreePath.split('/').pop()!))
        return { ok: true }
      },
      'spotlight.deactivate': () => {
        calls.push(['deactivate'])
        state = repo()
        return { ok: true }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ text: 'my-app' }))
  const on = (id: string) => view.find({ testId: id })?.props?.variant === 'solid'
  assert.equal(on('/ws/fix-a'), false)
  assert.equal(on('/ws/feat-b'), false)

  await view.press({ testId: '/ws/fix-a' })
  assert.equal(on('/ws/fix-a'), true)

  await view.press({ testId: '/ws/feat-b' })
  assert.equal(on('/ws/fix-a'), false)
  assert.equal(on('/ws/feat-b'), true)

  await view.press({ testId: '/ws/feat-b' })
  assert.equal(on('/ws/feat-b'), false)
  assert.equal(view.find({ type: 'Collapsible' }), null)
  assert.deepEqual(calls, [['activate', '/ws/fix-a'], ['activate', '/ws/feat-b'], ['deactivate']])
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  await view.unmount()
})

test('error details are folded by default and unfold on click', async () => {
  const host = mockHost({
    requests: {
      'spotlight.state': () => ({
        repos: [
          repo({
            worktreePath: '/ws/fix-a',
            name: 'fix-a',
            lastSyncAt: 1,
            error: { code: 'root-diverged', message: 'The repository root moved.' }
          })
        ]
      })
    }
  })
  const view = await mount(panel, { host })
  assert.equal(view.find({ text: 'Force sync' }), null)
  // The error still shows, folded, as a red status dot.
  assert.ok(view.findAll({ type: 'Image' }).some((n) => n.props?.alt === 'Spotlight error'))

  await view.press({ label: 'Show details' })
  assert.ok(view.find({ text: 'The repository root moved.' }))
  assert.ok(view.find({ text: 'Force sync' }))
  assert.ok(view.find({ text: 'Force turn off' }))

  await view.press({ label: 'Hide details' })
  assert.equal(view.find({ text: 'Force sync' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('shows a spinner instead of the bolt while switching', async () => {
  let release: (value: { ok: true }) => void = () => {}
  const host = mockHost({
    requests: {
      'spotlight.state': () => ({ repos: [repo()] }),
      'spotlight.activate': () => new Promise((resolve) => (release = resolve))
    }
  })
  const view = await mount(panel, { host })
  const pressing = view.press({ testId: '/ws/feat-b' })
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(view.find({ type: 'Spinner' }))
  assert.equal(view.find({ testId: '/ws/feat-b' }), null)
  release({ ok: true })
  await pressing
  assert.equal(view.find({ type: 'Spinner' }), null)
  await view.unmount()
})

test('shows an empty state without worktrees', async () => {
  const host = mockHost({ requests: { 'spotlight.state': () => ({ repos: [] }) } })
  const view = await mount(panel, { host })
  assert.match(JSON.stringify(view.summary()), /No worktrees/)
  await view.unmount()
})
