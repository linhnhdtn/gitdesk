import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, must } from './api.ts'
import { Diff, Empty } from './components/Diff.tsx'
import { PrList, PrDetail, type Repo } from './components/Prs.tsx'
import { Settings, CreatePr } from './components/Settings.tsx'
import { Split, Pane } from './components/Split.tsx'
import { Toolbar, type Item } from './components/Toolbar.tsx'
import { Repositories, type Brief } from './components/Repositories.tsx'
import { Branches } from './components/Branches.tsx'
import { Files, isStaged } from './components/Files.tsx'
import { Journal } from './components/Journal.tsx'
import { Console } from './components/Console.tsx'
import type { RepoStatus, Commit, Ref, Stash, GitCmd } from '../../main/git.ts'
import type { PR } from '../../main/github.ts'

const STORE_KEY = 'gitdesk.repo'
const LIST_KEY = 'gitdesk.repos'
const LAYOUT_KEY = 'gitdesk.layout'
type BottomTab = 'journal' | 'diff' | 'prs'
type Layout = { left: number; repos: number; files: number; console: number }

const DEFAULT_LAYOUT: Layout = { left: 260, repos: 240, files: 240, console: 0 }

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export default function App() {
  const [repos, setRepos] = useState<string[]>(() => read<string[]>(LIST_KEY, []))
  const [cwd, setCwd] = useState<string | null>(() => localStorage.getItem(STORE_KEY))
  const [briefs, setBriefs] = useState<Record<string, Brief>>({})
  const [layout, setLayout] = useState<Layout>(() => read(LAYOUT_KEY, DEFAULT_LAYOUT))

  const [st, setSt] = useState<RepoStatus | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [refs, setRefs] = useState<Ref[]>([])
  const [stashes, setStashes] = useState<Stash[]>([])
  const [repo, setRepo] = useState<Repo | null>(null)

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [commitSel, setCommitSel] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [bottom, setBottom] = useState<BottomTab>('journal')

  const [pr, setPr] = useState<PR | null>(null)
  const [prKey, setPrKey] = useState(0)
  const [diff, setDiff] = useState('')
  const [msg, setMsg] = useState('')
  const [modal, setModal] = useState<'settings' | 'createPr' | null>(null)
  const [cmds, setCmds] = useState<GitCmd[]>([])
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

  // Console feed. The only main->renderer push in the app.
  useEffect(() => api.onGitCmd((e) => setCmds((c) => [...c.slice(-199), e])), [])

  useEffect(() => localStorage.setItem(LIST_KEY, JSON.stringify(repos)), [repos])
  useEffect(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)), [layout])

  const refreshBriefs = useCallback(async () => {
    const list = await Promise.all(
      repos.map((p) =>
        must(api.repoBrief(p)).catch(
          (): Brief => ({ cwd: p, name: p.split('/').pop() ?? p, branch: '?', dirty: false })
        )
      )
    )
    setBriefs(Object.fromEntries(list.map((b) => [b.cwd, b])))
  }, [repos])

  const refresh = useCallback(async () => {
    if (!cwd) return
    const [s, c, r, sl] = await Promise.all([
      must(api.status(cwd)),
      must(api.log(cwd, 300)),
      must(api.refs(cwd)),
      must(api.stashList(cwd))
    ])
    setSt(s)
    setCommits(c)
    setRefs(r)
    setStashes(sl)
    const rm = await must(api.remote(cwd)).catch(() => null)
    setRepo(rm && rm.owner ? { owner: rm.owner, repo: rm.repo, provider: rm.provider } : null)
  }, [cwd])

  useEffect(() => {
    if (cwd) localStorage.setItem(STORE_KEY, cwd)
    setSel(new Set())
    setCommitSel(null)
    setPr(null)
    run(refresh)
  }, [cwd, refresh, run])

  // Refresh on window focus — cheap substitute for a filesystem watcher.
  // ponytail: poll-on-focus, swap for chokidar in main if it feels stale
  useEffect(() => {
    const h = () => (run(refresh), run(refreshBriefs))
    h()
    window.addEventListener('focus', h)
    return () => window.removeEventListener('focus', h)
  }, [refresh, refreshBriefs, run])

  // Ctrl+` toggles the console, like a terminal panel anywhere else.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        setLayout((l) => ({ ...l, console: l.console ? 0 : 180 }))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const files = useMemo(
    () => (st?.files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())),
    [st, filter]
  )
  const picked = useMemo(() => (st?.files ?? []).filter((f) => sel.has(f.path)), [st, sel])
  const staged = useMemo(() => (st?.files ?? []).filter(isStaged), [st])

  // Diff follows the single-file selection; a commit selection wins the tab.
  useEffect(() => {
    if (!cwd) return
    const one = picked.length === 1 ? picked[0] : null
    if (!one) return setDiff('')
    run(async () => setDiff(await must(api.diff(cwd, one.path, one.y === '.'))))
  }, [cwd, picked, run])

  if (!cwd && !repos.length)
    return (
      <div className="grid h-full place-items-center bg-bg">
        <div className="text-center">
          <h1 className="mb-1 text-2xl font-semibold">GitDesk</h1>
          <p className="mb-6 text-muted">Open a Git repository to start</p>
          <button
            className="rounded border border-line bg-panel px-5 py-2 hover:border-accent hover:text-accent"
            onClick={() => run(addRepo)}
          >
            Open Repository…
          </button>
          {err && <p className="mt-4 text-rose-700">{err}</p>}
        </div>
      </div>
    )

  async function addRepo() {
    const p = await must(api.pickRepo())
    if (!p) return
    setRepos((r) => (r.includes(p) ? r : [...r, p].sort()))
    setCwd(p)
  }

  const act = (fn: () => Promise<unknown>) =>
    run(async () => (await fn(), await refresh(), await refreshBriefs()))
  const at = (fn: (c: string) => Promise<unknown>) => () => cwd && act(() => fn(cwd))

  const groups: Item[][] = [
    [
      { label: 'Fetch', icon: '⟳', onClick: at((c) => must(api.fetch(c))), disabled: busy },
      { label: 'Pull', icon: '⭳', onClick: at((c) => must(api.pull(c))), disabled: busy },
      {
        label: 'Push',
        icon: '⭱',
        onClick: at((c) => must(api.push(c))),
        disabled: busy,
        badge: st?.ahead
      },
      {
        label: 'Commit',
        icon: '✓',
        onClick: () => setBottom('diff'),
        disabled: !staged.length,
        badge: staged.length,
        title: 'Staged files are committed from the box below the file list'
      }
    ],
    [
      {
        label: 'Stage',
        icon: '＋',
        disabled: busy || !picked.length,
        onClick: at((c) => must(api.stage(c, picked.map((f) => f.path))))
      },
      {
        label: 'Unstage',
        icon: '－',
        disabled: busy || !picked.length,
        onClick: at((c) => must(api.unstage(c, picked.map((f) => f.path))))
      },
      {
        label: 'Discard',
        icon: '⌫',
        disabled: busy || !picked.length,
        title: 'Throw away worktree changes in the selected files',
        onClick: () => {
          const names = picked.map((f) => f.path)
          // Destructive and unrecoverable — always confirm, however lazy the rest is.
          if (!window.confirm(`Discard local changes in ${names.length} file(s)?\n\n${names.join('\n')}`))
            return
          const untracked = picked.filter((f) => f.kind === 'untracked').map((f) => f.path)
          const tracked = names.filter((p) => !untracked.includes(p))
          act(() => must(api.discard(cwd!, tracked, untracked)).then(() => setSel(new Set())))
        }
      }
    ],
    [
      {
        label: 'Stash',
        icon: '🗃',
        disabled: busy || !st?.files.length,
        onClick: at((c) => must(api.stashSave(c, msg)))
      },
      {
        label: 'Apply',
        icon: '🗂',
        disabled: busy || !stashes.length,
        onClick: at((c) => must(api.stashApply(c, stashes[0].ref))),
        title: stashes[0] ? `Apply ${stashes[0].ref}` : 'No stashes'
      }
    ],
    [
      {
        label: 'Console',
        icon: '▣',
        active: layout.console > 0,
        onClick: () => setLayout((l) => ({ ...l, console: l.console ? 0 : 180 })),
        title: 'Toggle command console (Ctrl+`)'
      },
      { label: 'Settings', icon: '⚙', onClick: () => setModal('settings') }
    ]
  ]

  return (
    <div className="flex h-full flex-col">
      <Toolbar groups={groups} />

      {err && (
        <div className="shrink-0 border-b border-rose-300 bg-rose-50 px-3 py-1.5 font-mono text-[12px] text-rose-700">
          {err}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── left column ───────────────────────────── */}
        <div className="flex min-h-0 flex-col" style={{ width: layout.left }}>
          <Pane
            title="Repositories"
            right={
              <button onClick={() => run(addRepo)} className="rounded px-1.5 hover:bg-line" title="Add repository">
                ＋
              </button>
            }
            className="shrink-0"
          >
            <div style={{ height: layout.repos }} className="overflow-auto">
              <Repositories
                repos={repos}
                briefs={briefs}
                cwd={cwd}
                onPick={setCwd}
                onRemove={(p) => setRepos((r) => r.filter((x) => x !== p))}
              />
            </div>
          </Pane>
          <Split dir="y" value={layout.repos} min={80} max={600} onChange={(n) => setLayout((l) => ({ ...l, repos: n }))} />
          <Pane title="Branches" className="flex-1">
            <Branches
              refs={refs}
              stashes={stashes}
              onCheckout={(r) => act(() => must(api.checkout(cwd!, r)))}
              onStashApply={(r) => act(() => must(api.stashApply(cwd!, r)))}
              onStashDrop={(r) => act(() => must(api.stashDrop(cwd!, r)))}
            />
          </Pane>
        </div>

        <Split dir="x" value={layout.left} min={160} max={600} onChange={(n) => setLayout((l) => ({ ...l, left: n }))} />

        {/* ── right column ──────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col" style={{ height: layout.files }}>
            <Pane
              title={
                <>
                  Files{' '}
                  <span className="font-normal text-muted">
                    {cwd?.split('/').pop()} · {st?.branch ?? '…'}
                    {!!st?.ahead && <span className="text-ref"> ↑{st.ahead}</span>}
                    {!!st?.behind && <span className="text-amber-700"> ↓{st.behind}</span>}
                  </span>
                </>
              }
              right={
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="🔍 File Filter"
                  className="w-48 rounded border border-line bg-bg px-1.5 py-0.5 outline-none focus:border-accent"
                />
              }
              className="min-h-0 flex-1"
            >
              <Files
                files={files}
                sel={sel}
                onSelect={(p, extend) =>
                  setSel((s) => {
                    if (!extend) return new Set([p])
                    const n = new Set(s)
                    n.has(p) ? n.delete(p) : n.add(p)
                    return n
                  })
                }
              />
            </Pane>
            <div className="flex shrink-0 gap-2 border-t border-line bg-panel p-1.5">
              <input
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="Commit message"
                className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
              />
              <button
                disabled={!msg.trim() || !staged.length || busy}
                onClick={() =>
                  act(async () => (await must(api.commit(cwd!, msg)), setMsg(''), setSel(new Set())))
                }
                className="shrink-0 rounded border border-line bg-bg px-3 hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg"
              >
                Commit {staged.length || ''}
              </button>
            </div>
          </div>

          <Split dir="y" value={layout.files} min={100} max={800} onChange={(n) => setLayout((l) => ({ ...l, files: n }))} />

          <Pane
            title={
              <div className="-mx-2 flex">
                {(['journal', 'diff', 'prs'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setBottom(t)}
                    className={`px-3 capitalize ${
                      bottom === t ? 'border-b-2 border-accent font-semibold' : 'text-muted hover:text-fg'
                    }`}
                  >
                    {t === 'prs' ? 'Pull Requests' : t}
                  </button>
                ))}
              </div>
            }
            right={
              <button
                onClick={() => (run(refresh), setPrKey((k) => k + 1))}
                className="rounded px-1.5 hover:bg-line"
                title="Refresh"
              >
                ↻
              </button>
            }
            className="min-h-0 flex-1"
          >
            {bottom === 'journal' && (
              <Journal
                commits={commits}
                sel={commitSel}
                onSelect={(sha) =>
                  run(async () => {
                    setCommitSel(sha)
                    setDiff(await must(api.showCommit(cwd!, sha)))
                    setBottom('diff')
                  })
                }
              />
            )}
            {bottom === 'diff' &&
              (diff ? <Diff text={diff} /> : <Empty>Select a file or a commit</Empty>)}
            {bottom === 'prs' &&
              (pr && repo ? (
                <PrDetail pr={pr} repo={repo} onDone={() => (setPr(null), setPrKey((k) => k + 1))} />
              ) : (
                <PrList
                  repo={repo}
                  sel={pr}
                  refreshKey={prKey}
                  onSelect={setPr}
                  onCreate={() => setModal('createPr')}
                />
              ))}
          </Pane>
        </div>
      </div>

      {layout.console > 0 && (
        <>
          <Split
            dir="y"
            sign={-1}
            value={layout.console}
            min={60}
            max={600}
            onChange={(n) => setLayout((l) => ({ ...l, console: n }))}
          />
          <div style={{ height: layout.console }} className="flex shrink-0 flex-col">
            <Console
              cmds={cmds}
              onClear={() => setCmds([])}
              onClose={() => setLayout((l) => ({ ...l, console: 0 }))}
            />
          </div>
        </>
      )}

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
