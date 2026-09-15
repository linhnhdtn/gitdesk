import { useCallback, useEffect, useState } from 'react'
import { api, must } from './api.ts'
import { Diff, Empty } from './components/Diff.tsx'
import { PrList, PrDetail, type Repo } from './components/Prs.tsx'
import { Settings, CreatePr } from './components/Settings.tsx'
import type { RepoStatus, FileStatus, Commit } from '../../main/git.ts'
import type { PR } from '../../main/github.ts'

const STORE_KEY = 'gitdesk.repo'
type Tab = 'changes' | 'log' | 'prs'

export default function App() {
  const [cwd, setCwd] = useState<string | null>(() => localStorage.getItem(STORE_KEY))
  const [tab, setTab] = useState<Tab>('changes')
  const [st, setSt] = useState<RepoStatus | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [repo, setRepo] = useState<Repo | null>(null)
  const [sel, setSel] = useState<{ path: string; staged: boolean } | null>(null)
  const [pr, setPr] = useState<PR | null>(null)
  const [prKey, setPrKey] = useState(0)
  const [diff, setDiff] = useState('')
  const [msg, setMsg] = useState('')
  const [modal, setModal] = useState<'settings' | 'createPr' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
    } catch (e: any) {
      setErr(String(e.message ?? e))
    } finally {
      setBusy(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!cwd) return
    const [s, c] = await Promise.all([must(api.status(cwd)), must(api.log(cwd, 200))])
    setSt(s)
    setCommits(c)
    const r = await must(api.remote(cwd)).catch(() => null)
    setRepo(r && r.owner ? { owner: r.owner, repo: r.repo, provider: r.provider } : null)
  }, [cwd])

  useEffect(() => {
    if (cwd) localStorage.setItem(STORE_KEY, cwd)
    setSel(null)
    setPr(null)
    run(refresh)
  }, [cwd, refresh, run])

  // Refresh on window focus — cheap substitute for a filesystem watcher.
  // ponytail: poll-on-focus, swap for chokidar in main if it feels stale
  useEffect(() => {
    const h = () => run(refresh)
    window.addEventListener('focus', h)
    return () => window.removeEventListener('focus', h)
  }, [refresh, run])

  useEffect(() => {
    if (!cwd || !sel) return setDiff('')
    run(async () => setDiff(await must(api.diff(cwd, sel.path, sel.staged))))
  }, [cwd, sel, run])

  if (!cwd)
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <h1 className="mb-1 text-2xl font-semibold">GitDesk</h1>
          <p className="mb-6 text-muted">Open a Git repository to start</p>
          <Btn className="px-5 py-2" onClick={() => run(async () => setCwd(await must(api.pickRepo())))}>
            Open Repository…
          </Btn>
          {err && <p className="mt-4 text-rose-300">{err}</p>}
        </div>
      </div>
    )

  const staged = st?.files.filter((f) => f.x !== '.' && f.x !== '?' && f.x !== '!') ?? []
  const unstaged = st?.files.filter((f) => f.y !== '.' || f.kind === 'untracked') ?? []
  const act = (fn: () => Promise<unknown>) => run(async () => (await fn(), await refresh()))

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button
          className="max-w-56 truncate text-left text-muted hover:text-fg"
          title={cwd}
          onClick={() => run(async () => setCwd(await must(api.pickRepo())))}
        >
          {cwd.split('/').pop()}
        </button>
        <span className="rounded bg-accent/15 px-2 py-0.5 font-medium text-accent">{st?.branch ?? '…'}</span>
        {!!st?.ahead && <span className="text-emerald-400">↑{st.ahead}</span>}
        {!!st?.behind && <span className="text-amber-400">↓{st.behind}</span>}
        {repo && (
          <span className="truncate text-[11px] text-muted">
            {repo.owner}/{repo.repo}
          </span>
        )}

        <div className="ml-auto flex gap-1">
          <Btn onClick={() => act(() => must(api.fetch(cwd)))}>Fetch</Btn>
          <Btn onClick={() => act(() => must(api.pull(cwd)))}>Pull</Btn>
          <Btn onClick={() => act(() => must(api.push(cwd)))}>Push</Btn>
          <Btn onClick={() => (run(refresh), setPrKey((k) => k + 1))}>↻</Btn>
          <Btn onClick={() => setModal('settings')} title="Settings">
            ⚙
          </Btn>
        </div>
      </header>

      {err && (
        <div className="shrink-0 border-b border-rose-500/30 bg-rose-500/10 px-3 py-1.5 font-mono text-[12px] text-rose-300">
          {err}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex shrink-0 border-b border-line">
            {(['changes', 'log', 'prs'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 ${t === 'prs' ? 'uppercase' : 'capitalize'} ${
                  tab === t ? 'border-b-2 border-accent text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                {t}
                {t === 'changes' && !!st?.files.length && (
                  <span className="ml-1 rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">
                    {st.files.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'changes' && (
            <>
              <div className="min-h-0 flex-1 overflow-auto">
                <Group
                  title={`Staged (${staged.length})`}
                  files={staged}
                  sel={sel}
                  staged
                  onPick={(p) => setSel({ path: p, staged: true })}
                  onToggle={(p) => act(() => must(api.unstage(cwd, [p])))}
                />
                <Group
                  title={`Changes (${unstaged.length})`}
                  files={unstaged}
                  sel={sel}
                  staged={false}
                  onPick={(p) => setSel({ path: p, staged: false })}
                  onToggle={(p) => act(() => must(api.stage(cwd, [p])))}
                />
                {!st?.files.length && <div className="p-3 text-muted">Working tree clean</div>}
              </div>
              <div className="shrink-0 border-t border-line p-2">
                <textarea
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  placeholder="Commit message"
                  rows={3}
                  className="w-full resize-none rounded border border-line bg-bg p-2 outline-none focus:border-accent"
                />
                <Btn
                  className="mt-2 w-full justify-center py-1.5"
                  disabled={!msg.trim() || !staged.length || busy}
                  onClick={() => act(async () => (await must(api.commit(cwd, msg)), setMsg(''), setSel(null)))}
                >
                  Commit {staged.length} file{staged.length === 1 ? '' : 's'}
                </Btn>
              </div>
            </>
          )}

          {tab === 'log' && (
            <div className="min-h-0 flex-1 overflow-auto">
              {commits.map((c) => (
                <div key={c.hash} className="cursor-default border-b border-line/50 px-3 py-1.5 hover:bg-bg">
                  <div className="truncate">{c.subject}</div>
                  <div className="truncate text-[11px] text-muted">
                    <span className="font-mono">{c.hash.slice(0, 7)}</span> · {c.author} · {c.date.slice(0, 10)}
                    {c.refs && <span className="ml-1 text-accent">{c.refs}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'prs' && (
            <PrList
              repo={repo}
              sel={pr}
              refreshKey={prKey}
              onSelect={setPr}
              onCreate={() => setModal('createPr')}
            />
          )}
        </aside>

        <main className="min-w-0 flex-1">
          {tab === 'prs' ? (
            pr && repo ? (
              <PrDetail
                pr={pr}
                repo={repo}
                onDone={() => (setPr(null), setPrKey((k) => k + 1))}
              />
            ) : (
              <Empty>Select a pull request</Empty>
            )
          ) : sel ? (
            <Diff text={diff} />
          ) : (
            <Empty>Select a file to see its diff</Empty>
          )}
        </main>
      </div>

      {modal === 'settings' && <Settings onClose={() => (setModal(null), setPrKey((k) => k + 1))} />}
      {modal === 'createPr' && repo && st && (
        <CreatePr
          repo={repo}
          head={st.branch}
          onClose={() => setModal(null)}
          onCreated={() => (setModal(null), setPrKey((k) => k + 1))}
        />
      )}
    </div>
  )
}

function Group({
  title,
  files,
  sel,
  staged,
  onPick,
  onToggle
}: {
  title: string
  files: FileStatus[]
  sel: { path: string; staged: boolean } | null
  staged: boolean
  onPick: (p: string) => void
  onToggle: (p: string) => void
}) {
  if (!files.length) return null
  return (
    <div>
      <div className="sticky top-0 bg-panel px-3 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
        {title}
      </div>
      {files.map((f) => {
        const code = staged ? f.x : f.y
        const active = sel?.path === f.path && sel.staged === staged
        return (
          <div
            key={`${staged}-${f.path}`}
            onClick={() => onPick(f.path)}
            className={`flex cursor-default items-center gap-2 px-3 py-1 ${active ? 'bg-accent/15' : 'hover:bg-bg'}`}
          >
            <span
              className={`w-4 shrink-0 text-center font-mono font-bold ${
                code === 'U' ? 'text-rose-400' : code === '?' ? 'text-muted' : 'text-amber-400'
              }`}
            >
              {code}
            </span>
            <span className="min-w-0 flex-1 truncate" title={f.path} dir="rtl">
              {f.path}
            </span>
            <button
              onClick={(e) => (e.stopPropagation(), onToggle(f.path))}
              className="shrink-0 rounded px-1.5 text-muted hover:bg-accent hover:text-white"
              title={staged ? 'Unstage' : 'Stage'}
            >
              {staged ? '−' : '+'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Btn({ className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`rounded border border-line bg-bg px-2.5 py-1 hover:border-accent hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg ${className}`}
    />
  )
}
