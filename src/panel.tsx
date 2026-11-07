// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Code,
  EmptyState,
  plugin,
  read,
  RelativeTime,
  Row,
  set,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { OpResult, RepoView } from './protocol'

const repos = atom<RepoView[] | null>(null)
/** Root path of the operation in flight; its buttons are disabled meanwhile. */
const busy = atom<string | null>(null)
/** Last refusal or note per root, shown until the next operation there. */
const notes = atom<Record<string, OpResult>>({})

const FORCEABLE = new Set(['root-diverged', 'untracked-collision'])
const LONG = { timeoutMs: 120000 }

async function refresh(): Promise<void> {
  const state = await plugin.request('spotlight.state')
  set(repos, state.repos)
}

async function run(rootPath: string, op: () => Promise<OpResult>): Promise<void> {
  set(busy, rootPath)
  try {
    const result = await op()
    set(notes, { ...read(notes), [rootPath]: result })
  } finally {
    set(busy, null)
    await refresh()
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('spotlight.changed', () => void refresh()))
  void refresh()
}

/** The last operation's refusal for this root, or null. */
function noteError(rootPath: string) {
  const note = read(notes)[rootPath]
  return note && !note.ok ? note.error : null
}

/** The last operation's informational message for this root, if any. */
function noteMessage(rootPath: string): string | undefined {
  const note = read(notes)[rootPath]
  return note && note.ok ? note.message : undefined
}

function Holder({ repo }: { repo: RepoView }) {
  const holder = repo.holder
  if (!holder) return null
  const disabled = read(busy) === repo.rootPath
  const error = holder.error ?? noteError(repo.rootPath)
  const root = repo.rootPath
  return (
    <Stack gap="sm">
      <Callout tone={error ? 'danger' : 'accent'} icon="zap" title={`Mirroring ${holder.name}`}>
        <Stack gap="xs">
          <Text muted size="xs">
            Last sync:{' '}
            {holder.lastSyncAt ? <RelativeTime at={holder.lastSyncAt} /> : 'not yet'}
          </Text>
          {error ? <Text tone="danger" size="xs">{error.message}</Text> : null}
          <Row gap="xs" wrap>
            <Button
              size="sm"
              icon="stop"
              disabled={disabled}
              onPress={() => run(root, () => plugin.request('spotlight.deactivate', { rootPath: root }, LONG))}
            >
              Turn off
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              disabled={disabled}
              onPress={() => run(root, () => plugin.request('spotlight.sync', { rootPath: root }, LONG))}
            >
              Sync now
            </Button>
          </Row>
          {error && FORCEABLE.has(error.code) ? (
            <Row gap="xs" wrap>
              <Button
                size="sm"
                tone="danger"
                variant="outline"
                disabled={disabled}
                tooltip="Overwrites changes made directly in the repo root"
                onPress={() =>
                  run(root, () => plugin.request('spotlight.sync', { rootPath: root, force: true }, LONG))
                }
              >
                Force sync
              </Button>
              <Button
                size="sm"
                tone="danger"
                variant="outline"
                disabled={disabled}
                tooltip="Discards changes made directly in the repo root, then restores it"
                onPress={() =>
                  run(root, () =>
                    plugin.request('spotlight.deactivate', { rootPath: root, force: true }, LONG)
                  )
                }
              >
                Force turn off
              </Button>
            </Row>
          ) : null}
        </Stack>
      </Callout>
      {holder.migrationFiles.length > 0 ? (
        <Callout tone="warning" icon="database" title="Database migrations changed">
          <Stack gap="xs">
            <Text size="xs">
              The shared database may not match this code. Changed:
            </Text>
            {holder.migrationFiles.map((file) => (
              <Code>{file}</Code>
            ))}
            <Row>
              <Button
                size="sm"
                variant="ghost"
                onPress={() =>
                  run(root, () => plugin.request('spotlight.dismissMigrations', { rootPath: root }))
                }
              >
                Dismiss
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
    </Stack>
  )
}

function Repo({ repo }: { repo: RepoView }) {
  const disabled = read(busy) === repo.rootPath
  const activateError = repo.holder ? null : noteError(repo.rootPath)
  const message = noteMessage(repo.rootPath)
  const name = repo.rootPath.split('/').pop() ?? repo.rootPath
  return (
    <Card title={name} description={`${repo.rootPath} · ${repo.rootBranch ?? 'detached'}`}>
      <Stack gap="sm">
        <Holder repo={repo} />
        {message ? <Callout tone="warning">{message}</Callout> : null}
        {activateError ? <Callout tone="danger">{activateError.message}</Callout> : null}
        {repo.worktrees.map((worktree) => {
          const current = repo.holder?.worktreePath === worktree.path
          return (
            <Row justify="between" align="center" gap="sm">
              <Stack gap="none">
                <Text weight="medium" truncate>
                  {worktree.name}
                </Text>
                <Text muted size="xs" truncate>
                  {worktree.branch ?? 'detached'}
                </Text>
              </Stack>
              {current ? (
                <Badge tone="accent">live</Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  icon="zap"
                  disabled={disabled}
                  onPress={() =>
                    run(repo.rootPath, () =>
                      plugin.request(
                        'spotlight.activate',
                        { rootPath: repo.rootPath, worktreePath: worktree.path },
                        LONG
                      )
                    )
                  }
                >
                  Spotlight
                </Button>
              )}
            </Row>
          )
        })}
      </Stack>
    </Card>
  )
}

export default function Panel() {
  const list = read(repos)
  if (list === null) {
    return <Text muted>Loading…</Text>
  }
  if (list.length === 0) {
    return (
      <EmptyState
        icon="zap"
        title="No worktrees"
        description="Spotlight mirrors a worktree onto its repo root. Create a worktree first."
      />
    )
  }
  return (
    <Stack gap="md">
      {list.map((repo) => (
        <Repo repo={repo} />
      ))}
    </Stack>
  )
}
