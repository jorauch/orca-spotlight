// No build step: Orca strips the types and compiles the JSX when the panel loads.
import {
  atom,
  Box,
  Button,
  Callout,
  EmptyState,
  IconButton,
  Image,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { HolderView, OpResult, RepoView } from './protocol'

const repos = atom<RepoView[] | null>(null)
/** The operation in flight: its root's controls are disabled, its worktree shows a spinner. */
const busy = atom<{ rootPath: string; worktreePath: string } | null>(null)
/** Last refusal or note per root, shown until the next operation there. */
const notes = atom<Record<string, OpResult>>({})
/** Roots whose active worktree has its details unfolded; folded by default. */
const unfolded = atom<Record<string, boolean>>({})

const FORCEABLE = new Set(['root-diverged', 'untracked-collision'])
const LONG = { timeoutMs: 120000 }

async function refresh(): Promise<void> {
  const state = await plugin.request('spotlight.state')
  set(repos, state.repos)
}

async function run(
  rootPath: string,
  worktreePath: string,
  op: () => Promise<OpResult>
): Promise<void> {
  set(busy, { rootPath, worktreePath })
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

function holderError(repo: RepoView) {
  return repo.holder ? (repo.holder.error ?? noteError(repo.rootPath)) : null
}

/** Status dot: grey off, green live, red failing. */
const STATUS_TEXT: Record<string, string> = {
  neutral: 'Spotlight off',
  success: 'Spotlight live',
  danger: 'Spotlight error'
}

function Dot({ repo, current }: { repo: RepoView; current: boolean }) {
  const tone = !current ? 'neutral' : holderError(repo) ? 'danger' : 'success'
  // Panels draw no SVG and tone fills are faint tints, so the dot is a shipped PNG.
  return (
    <Box width={8} height={8} minWidth={8}>
      <Image src={`assets/dot-${tone}.png`} alt={STATUS_TEXT[tone]} size="full" fit="contain" />
    </Box>
  )
}

/** The active worktree's error and its force actions; only rendered while unfolded. */
function Details({ repo }: { repo: RepoView }) {
  const holder = repo.holder as HolderView
  const error = holderError(repo)
  const root = repo.rootPath
  const disabled = read(busy)?.rootPath === root
  const runHere = (op: () => Promise<OpResult>) => run(root, holder.worktreePath, op)
  return (
    <Box direction="column" gap="sm" padding="sm" radius="md" background="muted">
      {error ? (
        <Text tone="danger" size="xs">
          {error.message}
        </Text>
      ) : null}
      {error && FORCEABLE.has(error.code) ? (
        <Row gap="xs" wrap>
          <Button
            size="sm"
            tone="danger"
            variant="outline"
            disabled={disabled}
            tooltip="Overwrites changes made directly in the repo root"
            onPress={() =>
              runHere(() => plugin.request('spotlight.sync', { rootPath: root, force: true }, LONG))
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
              runHere(() =>
                plugin.request('spotlight.deactivate', { rootPath: root, force: true }, LONG)
              )
            }
          >
            Force turn off
          </Button>
        </Row>
      ) : null}
    </Box>
  )
}

function Repo({ repo }: { repo: RepoView }) {
  const inFlight = read(busy)
  const disabled = inFlight?.rootPath === repo.rootPath
  const activateError = repo.holder ? null : noteError(repo.rootPath)
  const message = noteMessage(repo.rootPath)
  const open = Boolean(read(unfolded)[repo.rootPath])
  return (
    <Stack gap="sm">
      <Text muted size="xs" weight="semibold">
        {repo.projectName}
      </Text>
      {message ? <Callout tone="warning">{message}</Callout> : null}
      {activateError ? <Callout tone="danger">{activateError.message}</Callout> : null}
      {repo.worktrees.map((worktree) => {
        const current = repo.holder?.worktreePath === worktree.path
        const details = current && Boolean(holderError(repo))
        return (
          <Stack gap="xs">
            <Row justify="between" align="center" gap="sm">
              <Box direction="column" grow shrink>
                <Row align="center" gap="xs">
                  <Dot repo={repo} current={current} />
                  <Text weight="medium" truncate>
                    {worktree.name}
                  </Text>
                </Row>
                <Row align="center" gap="xs">
                  {/* Same width as the dot, so the branch lines up under the title. */}
                  <Box width={8} minWidth={8} />
                  <Text muted size="xs" truncate>
                    {worktree.branch ?? 'detached'}
                  </Text>
                </Row>
              </Box>
              {details ? (
                <IconButton
                  key={`details:${worktree.path}`}
                  icon={open ? 'collapse' : 'expand'}
                  label={open ? 'Hide details' : 'Show details'}
                  variant="ghost"
                  size="sm"
                  onPress={() => set(unfolded, { ...read(unfolded), [repo.rootPath]: !open })}
                />
              ) : null}
              {/* Fixed slot: the spinner takes the bolt's place without shifting the row. */}
              <Box width={32} height={32} minWidth={32} align="center" justify="center">
                {inFlight?.worktreePath === worktree.path ? (
                  <Spinner
                    key={`spinner:${worktree.path}`}
                    label="Switching Spotlight"
                    labelHidden
                  />
                ) : (
                  /* One holder per root: turning another worktree on takes the Spotlight over. */
                  <IconButton
                    key={worktree.path}
                    icon="zap"
                    label={current ? 'Turn Spotlight off' : 'Turn Spotlight on'}
                    tooltip={
                      current
                        ? 'Spotlight on — click to turn off'
                        : 'Spotlight off — click to mirror this worktree'
                    }
                    variant={current ? 'solid' : 'outline'}
                    tone={current ? 'accent' : 'neutral'}
                    disabled={disabled}
                    onPress={() =>
                      run(repo.rootPath, worktree.path, () =>
                        current
                          ? plugin.request(
                              'spotlight.deactivate',
                              { rootPath: repo.rootPath },
                              LONG
                            )
                          : plugin.request(
                              'spotlight.activate',
                              { rootPath: repo.rootPath, worktreePath: worktree.path },
                              LONG
                            )
                      )
                    }
                  />
                )}
              </Box>
            </Row>
            {details && open ? <Details repo={repo} /> : null}
          </Stack>
        )
      })}
    </Stack>
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
