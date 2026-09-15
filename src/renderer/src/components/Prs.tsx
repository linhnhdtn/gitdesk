import { useCallback, useEffect, useState } from 'react'
import { api, must } from '../api.ts'
import type { PR, Check } from '../../../main/github.ts'
import { Empty } from './Diff.tsx'
import { rollup } from '../../../shared/checks.ts'

export type Repo = { owner: string; repo: string; provider: string }

export function PrList({
  repo,
  sel,
  onSelect,
  onCreate,
  refreshKey
}: {
  repo: Repo | null
  sel: PR | null
  onSelect: (p: PR) => void
  onCreate: () => void
  refreshKey: number
}) {
  const [prs, setPrs] = useState<PR[]>([])
  const [checks, setChecks] = useState<Record<number, Check[]>>({})
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!repo) return
    let dead = false
    setLoading(true)
    setErr('')
    must(api.prs(repo.owner, repo.repo))
      .then(async (list) => {
        if (dead) return
        setPrs(list)
        // ponytail: N calls for N PRs. Fine under ~50; batch via GraphQL if it ever drags.
        const pairs = await Promise.all(
          list.map(async (p) => [p.number, await must(api.checks(repo.owner, repo.repo, p.head.sha)).catch(() => [])] as const)
        )
        if (!dead) setChecks(Object.fromEntries(pairs))
      })
      .catch((e) => !dead && setErr(String(e.message ?? e)))
      .finally(() => !dead && setLoading(false))
    return () => {
      dead = true
    }
  }, [repo, refreshKey])

  if (!repo) return <Empty>No origin remote</Empty>
  if (repo.provider !== 'github') return <Empty>origin is not GitHub</Empty>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-2">
        <button
          onClick={onCreate}
          className="w-full rounded border border-line bg-bg py-1.5 hover:border-accent hover:text-accent"
        >
          + New Pull Request
        </button>
      </div>
      {err && <div className="px-3 py-2 text-[12px] text-rose-300">{err}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !prs.length && <div className="p-3 text-muted">Loading…</div>}
        {!loading && !prs.length && !err && <div className="p-3 text-muted">No open pull requests</div>}
        {prs.map((p) => {
          const r = rollup(checks[p.number] ?? [])
          return (
            <div
              key={p.number}
              onClick={() => onSelect(p)}
              className={`cursor-default border-b border-line/50 px-3 py-2 ${sel?.number === p.number ? 'bg-accent/15' : 'hover:bg-bg'}`}
            >
              <div className="flex items-start gap-2">
                {r && <span className={`shrink-0 ${r.cls}`} title={r.label}>{r.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                {p.draft && <span className="shrink-0 rounded bg-line px-1 text-[10px] text-muted">DRAFT</span>}
              </div>
              <div className="truncate text-[11px] text-muted">
                #{p.number} · {p.user.login} · {p.head.ref} → {p.base.ref}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PrDetail({ pr, repo, onDone }: { pr: PR; repo: Repo; onDone: () => void }) {
  const [checks, setChecks] = useState<Check[]>([])
  const [revs, setRevs] = useState<{ state: string; user: { login: string } }[]>([])
  const [method, setMethod] = useState<'squash' | 'merge' | 'rebase'>('squash')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    must(api.checks(repo.owner, repo.repo, pr.head.sha)).then(setChecks).catch(() => setChecks([]))
    must(api.reviews(repo.owner, repo.repo, pr.number)).then(setRevs).catch(() => setRevs([]))
  }, [pr, repo])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true)
      setErr('')
      try {
        await fn()
        onDone()
      } catch (e: any) {
        setErr(String(e.message ?? e))
      } finally {
        setBusy(false)
      }
    },
    [onDone]
  )

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-line p-4">
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-lg font-semibold">
            {pr.title} <span className="font-normal text-muted">#{pr.number}</span>
          </h2>
          <button
            onClick={() => api.openExternal(pr.html_url)}
            className="shrink-0 rounded border border-line px-2 py-1 text-muted hover:border-accent hover:text-accent"
          >
            Open in browser ↗
          </button>
        </div>
        <p className="mt-1 text-muted">
          {pr.user.login} wants to merge <code className="text-accent">{pr.head.ref}</code> into{' '}
          <code className="text-accent">{pr.base.ref}</code>
        </p>
      </div>

      {err && <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-rose-300">{err}</div>}

      {pr.body && (
        <div className="border-b border-line p-4 whitespace-pre-wrap text-fg/85">{pr.body}</div>
      )}

      <Section title={`Checks (${checks.length})`}>
        {!checks.length && <div className="text-muted">No checks</div>}
        {checks.map((c) => (
          <button
            key={c.name + c.html_url}
            onClick={() => api.openExternal(c.html_url)}
            className="flex w-full items-center gap-2 py-0.5 text-left hover:text-accent"
          >
            <span
              className={
                c.status !== 'completed'
                  ? 'text-amber-400'
                  : c.conclusion === 'success'
                    ? 'text-emerald-400'
                    : c.conclusion === 'failure'
                      ? 'text-rose-400'
                      : 'text-muted'
              }
            >
              {c.status !== 'completed' ? '●' : c.conclusion === 'success' ? '✓' : c.conclusion === 'failure' ? '✕' : '–'}
            </span>
            <span className="flex-1 truncate">{c.name}</span>
            <span className="text-muted">{c.conclusion ?? c.status}</span>
          </button>
        ))}
      </Section>

      <Section title={`Reviews (${revs.length})`}>
        {!revs.length && <div className="text-muted">No reviews yet</div>}
        {revs.map((r, i) => (
          <div key={i}>
            <span className={r.state === 'APPROVED' ? 'text-emerald-400' : 'text-amber-400'}>
              {r.state === 'APPROVED' ? '✓' : '•'}
            </span>{' '}
            {r.user.login} <span className="text-muted">{r.state.toLowerCase().replace('_', ' ')}</span>
          </div>
        ))}
      </Section>

      <div className="mt-auto flex shrink-0 items-center gap-2 border-t border-line p-4">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          className="rounded border border-line bg-bg px-2 py-1.5 outline-none"
        >
          <option value="squash">Squash and merge</option>
          <option value="merge">Create merge commit</option>
          <option value="rebase">Rebase and merge</option>
        </select>
        <button
          disabled={busy}
          onClick={() => act(() => must(api.mergePR(repo.owner, repo.repo, pr.number, method)))}
          className="rounded bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          Merge
        </button>
        <button
          disabled={busy}
          onClick={() => act(() => must(api.closePR(repo.owner, repo.repo, pr.number)))}
          className="ml-auto rounded border border-line px-3 py-1.5 text-muted hover:border-rose-400 hover:text-rose-400 disabled:opacity-40"
        >
          Close
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line p-4">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </div>
  )
}
