export type CheckRun = { status: string; conclusion: string | null }
export type Rollup = { icon: string; cls: string; label: string } | null

/**
 * Collapse GitHub check-runs into one badge.
 * Order matters: anything still running wins over a failure, because the
 * failure may yet be retried; a failure wins over success.
 */
export function rollup(checks: CheckRun[]): Rollup {
  if (!checks.length) return null
  if (checks.some((c) => c.status !== 'completed'))
    return { icon: '●', cls: 'text-amber-600', label: 'running' }
  if (checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'cancelled'))
    return { icon: '✕', cls: 'text-rose-600', label: 'failed' }
  if (checks.every((c) => ['success', 'skipped', 'neutral'].includes(c.conclusion ?? '')))
    return { icon: '✓', cls: 'text-emerald-700', label: 'passed' }
  return { icon: '!', cls: 'text-amber-600', label: 'mixed' }
}
