// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh
// host. Without real worktrees the worker lists none, so check shows the empty state.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  empty: {
    capabilities: ['storage:own', 'workspace:read'],
    results: { 'workspace.list': { truncated: false, workspaces: [] }, 'statusBar.update': {} }
  }
})
