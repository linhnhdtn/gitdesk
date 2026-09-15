import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, must } from './api.ts'
import { Diff, Empty } from './components/Diff.tsx'
import { PrList, PrDetail, type Repo } from './components/Prs.tsx'
import { Settings, CreatePr } from './components/Settings.tsx'
import { Split, Pane } from './components/Split.tsx'
import { Toolbar, type Item } from './components/Toolbar.tsx'
import { Repositories, type Brief } from './components/Repositories.tsx'
import { Branches } from './components/Branches.tsx'
import { Files } from './components/Files.tsx'
import { FileFilters } from './components/FileFilters.tsx'
import { isStaged, category, counts as tally, type Category } from '../../shared/filestate.ts'
import { Journal } from './components/Journal.tsx'
import { Console } from './components/Console.tsx'
import { Tabs } from './components/Tabs.tsx'
import { FileCompare } from './components/FileCompare.tsx'
import { CommitDialog } from './components/CommitDialog.tsx'
import type { RepoStatus, Commit, Ref, Stash, GitCmd, FileStatus } from '../../main/git.ts'
import type { PR } from '../../main/github.ts'

const STORE_KEY = 'gitdesk.repo'
const LIST_KEY = 'gitdesk.repos'
const LAYOUT_KEY = 'gitdesk.layout'
const TABS_KEY = 'gitdesk.tabs'
const HIDE_KEY = 'gitdesk.hidden'
type BottomTab = 'journal' | 'diff' | 'prs' | 'console'
const TABS: BottomTab[] = ['journal', 'diff', 'prs', 'console']
type Layout = { left: number; repos: number; files: number }

const DEFAULT_LAYOUT: Layout = { left: 260, repos: 240, files: 240 }

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
  const [hidden, setHidden] = useState<Set<Category>>(() => new Set(read<Category[]>(HIDE_KEY, [])))
  const [bottom, setBottom] = useState<BottomTab>('journal')
  const [tabOrder, setTabOrder] = useState<BottomTab[]>(() => {
    // A saved order from an older build can name a tab that is gone or miss a
    // new one, so reconcile against TABS rather than trusting it outright.
    const saved = read<BottomTab[]>(TABS_KEY, [])
    return [...saved.filter((t) => TABS.includes(t)), ...TABS.filter((t) => !saved.includes(t))]
  })

  const [pr, setPr] = useState<PR | null>(null)
  const [prKey, setPrKey] = useState(0)
  const [diff, setDiff] = useState('')
  const [modal, setModal] = useState<'settings' | 'createPr' | 'commit' | null>(null)
  const [compare, setCompare] = useState<{ file: FileStatus; staged: boolean } | null>(null)
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
  useEffect(() => localStorage.setItem(TABS_KEY, JSON.stringify(tabOrder)), [tabOrder])
  useEffect(() => localStorage.setItem(HIDE_KEY, JSON.stringify([...hidden])), [hidden])

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
    setCompare(null)
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
        setBottom((b) => (b === 'console' ? 'journal' : 'console'))
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const files = useMemo(
    () =>
      (st?.files ?? []).filter(
        (f) =>
          !hidden.has(category(f)) &&
          (!filter || f.path.toLowerCase().includes(filter.toLowerCase()))
      ),
    [st, filter, hidden]
  )
  const catCounts = useMemo(() => tally(st?.files ?? []), [st])
  const nHidden = (st?.files.length ?? 0) - files.length
  // Only what is on screen can be staged or discarded — a hidden or filtered-out
  // file must never be acted on from a selection the user can no longer see.
  const picked = useMemo(() => files.filter((f) => sel.has(f.path)), [files, sel])
  const staged = useMemo(() => (st?.files ?? []).filter(isStaged), [st])

  // Diff follows the single-file selection; a commit selection wins the tab.
  useEffect(() => {
    if (!cwd) return
    const one = picked.length === 1 ? picked[0] : null
    if (!one) return setDiff('')
    run(async () =>
      setDiff(
        one.kind === 'untracked'
          ? await must(api.diffNew(cwd, one.path))
          : await must(api.diff(cwd, one.path, one.y === '.'))
      )
    )
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
      { label: 'Fetch', icon: 'fetch', onClick: at((c) => must(api.fetch(c))), disabled: busy },
      { label: 'Pull', icon: 'pull', onClick: at((c) => must(api.pull(c))), disabled: busy },
      {
        label: 'Push',
        icon: 'push',
        onClick: at((c) => must(api.push(c))),
        disabled: busy,
        badge: st?.ahead
      },
      {
        label: 'Commit',
        icon: 'commit',
        onClick: () => setModal('commit'),
        disabled: busy || !st?.files.length,
        badge: staged.length,
        title: 'Commit staged or local changes…'
      }
    ],
    [
      {
        label: 'Stage',
        icon: 'stage',
        disabled: busy || !picked.length,
        onClick: at((c) => must(api.stage(c, picked.map((f) => f.path))))
      },
      {
        label: 'Unstage',
        icon: 'unstage',
        disabled: busy || !picked.length,
        onClick: at((c) => must(api.unstage(c, picked.map((f) => f.path))))
      },
      {
        label: 'Discard',
        icon: 'discard',
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
        icon: 'stash',
        disabled: busy || !st?.files.length,
        onClick: at((c) => must(api.stashSave(c)))
      },
      {
        label: 'Apply',
        icon: 'apply',
        disabled: busy || !stashes.length,
        onClick: at((c) => must(api.stashApply(c, stashes[0].ref))),
        title: stashes[0] ? `Apply ${stashes[0].ref}` : 'No stashes'
      }
    ],
    [
      {
        label: 'Console',
        icon: 'console',
        active: bottom === 'console',
        badge: cmds.length,
        onClick: () => setBottom((b) => (b === 'console' ? 'journal' : 'console')),
        title: 'Command console (Ctrl+`)'
      },
      { label: 'Settings', icon: 'settings', onClick: () => setModal('settings') }
    ]
  ]

  return (
    <div className="flex h-full flex-col">
      <Toolbar groups={groups} />

      {err && (
        // git errors are multi-line (its `hint:` lines usually carry the fix), and
        // a plain div collapses them into one run-on line. pre keeps them; the cap
        // stops a long one from eating the panes.
        <pre className="max-h-32 shrink-0 overflow-auto border-b border-rose-300 bg-rose-50 px-3 py-1.5 font-mono text-[12px] whitespace-pre-wrap text-rose-700">
          {err}
        </pre>
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
                <>
                  {!!nHidden && <span className="text-muted">{nHidden} hidden</span>}
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="🔍 File Filter"
                    className="w-40 rounded border border-line bg-bg px-1.5 py-0.5 outline-none focus:border-accent"
                  />
                  <FileFilters
                    hidden={hidden}
                    counts={catCounts}
                    onToggle={(c) =>
                      setHidden((h) => {
                        const n = new Set(h)
                        n.has(c) ? n.delete(c) : n.add(c)
                        return n
                      })
                    }
                  />
                </>
              }
              className="min-h-0 flex-1"
            >
              <Files
                files={files}
                sel={sel}
                // Only the worktree half has something to compare when both are dirty;
                // a purely staged file compares HEAD against the index instead.
                onCompare={(f) => setCompare({ file: f, staged: f.y === '.' && f.kind !== 'untracked' })}
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
          </div>

          <Split dir="y" value={layout.files} min={100} max={800} onChange={(n) => setLayout((l) => ({ ...l, files: n }))} />

          <Pane
            title={
              <Tabs
                tabs={tabOrder}
                active={bottom}
                onSelect={setBottom}
                onReorder={setTabOrder}
                label={(t) => (
                  <>
                    {t === 'prs' ? 'Pull Requests' : t}
                    {t === 'console' && !!cmds.length && (
                      <span className="ml-1 font-normal text-muted">{cmds.length}</span>
                    )}
                  </>
                )}
              />
            }
            right={
              bottom === 'console' ? (
                <button
                  onClick={() => setCmds([])}
                  className="rounded px-1.5 text-muted hover:bg-line hover:text-fg"
                  title="Clear the command log"
                >
                  clear
                </button>
              ) : (
                <button
                  onClick={() => (run(refresh), setPrKey((k) => k + 1))}
                  className="rounded px-1.5 hover:bg-line"
                  title="Refresh"
                >
                  ↻
                </button>
              )
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
            {bottom === 'console' && <Console cmds={cmds} />}
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

      {compare && cwd && (
        <FileCompare
          cwd={cwd}
          file={compare.file}
          staged={compare.staged}
          onClose={() => setCompare(null)}
        />
      )}

      {modal === 'commit' && cwd && st && (
        <CommitDialog
          cwd={cwd}
          files={st.files}
          onClose={() => setModal(null)}
          onDone={() => (setModal(null), setSel(new Set()), act(async () => {}))}
        />
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
