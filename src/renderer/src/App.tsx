import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, must } from './api.ts'
import { Diff, Empty } from './components/Diff.tsx'
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
import { CommitDetail } from './components/CommitDetail.tsx'
import { ErrorDialog } from './components/ErrorDialog.tsx'
import { DiscardDialog } from './components/DiscardDialog.tsx'
import { StashDialog } from './components/StashDialog.tsx'
import { ContextMenu, Prompt, type MenuItem } from './components/ContextMenu.tsx'
import type { RepoStatus, Commit, Ref, Stash, GitCmd, FileStatus } from '../../main/git.ts'

const STORE_KEY = 'gitdesk.repo'
const LIST_KEY = 'gitdesk.repos'
const LAYOUT_KEY = 'gitdesk.layout'
const TABS_KEY = 'gitdesk.tabs'
const HIDE_KEY = 'gitdesk.hidden'
type BottomTab = 'journal' | 'diff' | 'console'
const TABS: BottomTab[] = ['journal', 'diff', 'console']
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

  const [diff, setDiff] = useState('')
  const [modal, setModal] = useState<'commit' | 'discard' | 'stash' | null>(null)
  const [compare, setCompare] = useState<{ file: FileStatus; staged: boolean } | null>(null)
  const [cmds, setCmds] = useState<GitCmd[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [prompt, setPrompt] = useState<{
    title: string
    label?: string
    initial?: string
    confirmLabel?: string
    onOk: (v: string) => void
  } | null>(null)
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
  }, [cwd])

  useEffect(() => {
    if (cwd) localStorage.setItem(STORE_KEY, cwd)
    setSel(new Set())
    setCommitSel(null)
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

  // Ctrl+A selects every file the list is currently showing, so Stage / Discard
  // and the commit dialog can act on the lot.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return
      // inside a text field Ctrl+A still has to mean "select this text"
      if ((e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]')) return
      if (modal || compare || prompt) return // a dialog owns the keyboard
      e.preventDefault()
      setSel(new Set(files.map((f) => f.path)))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [files, modal, compare, prompt])

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

  const copy = (t: string) => run(() => must(api.copy(t)))


  /** Create a branch and switch to it. `start` omitted means "from HEAD". */
  const newBranch = (start?: string) =>
    setPrompt({
      title: 'New Branch',
      label: start ? `Name for the branch starting at ${start}` : `Name for the branch starting at ${st?.branch ?? 'HEAD'}`,
      // origin/feature -> feature: the obvious local name for a remote branch
      initial: start?.includes('/') ? start.slice(start.indexOf('/') + 1) : '',
      confirmLabel: 'Create',
      onOk: (v) => act(() => must(api.createBranch(cwd!, v, start)))
    })

  /** Right-click on a file row. Acts on the whole selection when it has one. */
  function fileMenu(f: FileStatus, x: number, y: number) {
    const target = picked.length > 1 && sel.has(f.path) ? picked : [f]
    const paths = target.map((t) => t.path)
    const n = paths.length
    const many = n > 1 ? ` ${n} files` : ''
    const untracked = target.filter((t) => t.kind === 'untracked').map((t) => t.path)
    const tracked = paths.filter((p) => !untracked.includes(p))
    const copies: MenuItem[] = [
      { label: 'Copy Name', onClick: () => copy(target.map((t) => t.path.split('/').pop()).join('\n')) },
      { label: 'Copy Relative Path', onClick: () => copy(paths.join('\n')) },
      { label: 'Copy Full Path', onClick: () => copy(paths.map((p) => `${cwd}/${p}`).join('\n')) }
    ]

    setMenu({
      x,
      y,
      items: [
        { label: 'Show Changes', onClick: () => setCompare({ file: f, staged: f.y === '.' && f.kind !== 'untracked' }), disabled: n > 1 },
        'sep',
        { label: `Stage${many}`, onClick: () => act(() => must(api.stage(cwd!, paths))) },
        { label: `Unstage${many}`, onClick: () => act(() => must(api.unstage(cwd!, paths))), disabled: !target.some(isStaged) },
        { label: 'Commit…', onClick: () => setModal('commit') },
        'sep',
        {
          label: 'Ignore…',
          onClick: () =>
            setPrompt({
              title: 'Ignore',
              label: 'Pattern to append to .gitignore',
              initial: f.path,
              confirmLabel: 'Ignore',
              onOk: (v) => act(() => must(api.ignore(cwd!, [v])))
            })
        },
        {
          label: `Discard…${many}`,
          danger: true,
          onClick: () => {
            setSel(new Set(paths))
            setModal('discard')
          }
        },
        {
          label: `Delete…${many}`,
          danger: true,
          onClick: () => {
            if (!window.confirm(`Delete ${n} file(s) from disk?\n\n${paths.join('\n')}`)) return
            act(() => must(api.remove(cwd!, tracked, untracked)).then(() => setSel(new Set())))
          }
        },
        'sep',
        { label: 'Open File', onClick: () => run(() => must(api.openPath(cwd!, f.path))), disabled: n > 1 },
        { label: 'Reveal in File Manager', onClick: () => run(() => must(api.reveal(cwd!, f.path))), disabled: n > 1 },
        'sep',
        ...copies
      ]
    })
  }

  /** Right-click on a branch, remote branch or tag. */
  function refMenu(r: Ref, x: number, y: number) {
    const local = r.kind === 'local'
    // checking out origin/feat means checking out the local branch it tracks
    const checkoutAs = r.kind === 'remote' ? r.name.slice(r.name.indexOf('/') + 1) : r.name

    setMenu({
      x,
      y,
      items: [
        { label: 'Check Out…', onClick: () => act(() => must(api.checkout(cwd!, checkoutAs))), disabled: r.current },
        { label: 'New Branch from here…', onClick: () => newBranch(r.name) },
        'sep',
        { label: `Merge into ${st?.branch ?? 'HEAD'}`, onClick: () => act(() => must(api.merge(cwd!, r.name))), disabled: r.current },
        { label: 'Fast-Forward Merge', onClick: () => act(() => must(api.merge(cwd!, r.name, true))), disabled: r.current },
        { label: `Rebase ${st?.branch ?? 'HEAD'} onto`, onClick: () => act(() => must(api.rebase(cwd!, r.name))), disabled: r.current },
        'sep',
        {
          label: 'Push',
          onClick: () => act(() => must(api.pushBranch(cwd!, r.name, !r.upstream))),
          disabled: !local
        },
        {
          label: 'Rename…',
          disabled: !local,
          onClick: () =>
            setPrompt({
              title: 'Rename Branch',
              label: `New name for ${r.name}`,
              initial: r.name,
              confirmLabel: 'Rename',
              onOk: (v) => act(() => must(api.renameBranch(cwd!, r.name, v)))
            })
        },
        {
          label: 'Delete…',
          danger: true,
          disabled: !local || r.current,
          onClick: () => {
            if (!window.confirm(`Delete local branch ${r.name}?`)) return
            act(async () => {
              try {
                await must(api.deleteBranch(cwd!, r.name))
              } catch (e: any) {
                // git refuses -d for unmerged work; only force after saying so
                if (!/not fully merged/i.test(String(e.message ?? e))) throw e
                if (!window.confirm(`${r.name} is not fully merged. Delete anyway and lose its commits?`)) return
                await must(api.deleteBranch(cwd!, r.name, true))
              }
            })
          }
        },
        'sep',
        { label: 'Copy Name', onClick: () => copy(r.name) }
      ]
    })
  }

  /** Right-click on a stash. Nothing here fires from a plain click any more. */
  function stashMenu(st: Stash, x: number, y: number) {
    setMenu({
      x,
      y,
      items: [
        { label: 'Apply Stash…', onClick: () => act(() => must(api.stashApply(cwd!, st.ref))) },
        { label: 'Show Content…', onClick: () => setCommitSel(st.ref) },
        'sep',
        {
          label: 'Rename Stash…',
          onClick: () =>
            setPrompt({
              title: 'Rename Stash',
              label: `New title for ${st.ref}`,
              initial: st.message,
              confirmLabel: 'Rename',
              // git has no rename, so the entry is re-stored and moves to the top
              onOk: (v) => act(() => must(api.renameStash(cwd!, st.ref, v)))
            })
        },
        {
          label: 'Drop Stash…',
          danger: true,
          onClick: () => {
            if (!window.confirm(`Drop ${st.ref}?\n\n${st.message}\n\nThis cannot be undone.`)) return
            act(() => must(api.stashDrop(cwd!, st.ref)))
          }
        },
        'sep',
        { label: 'Copy Message', onClick: () => copy(st.message) }
      ]
    })
  }

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
        title: 'Throw away changes in the selected files…',
        onClick: () => setModal('discard')
      }
    ],
    [
      {
        label: 'Stash',
        icon: 'stash',
        disabled: busy || !st?.files.length,
        title: 'Set changes aside…',
        onClick: () => setModal('stash')
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
      }
    ]
  ]

  return (
    <div className="flex h-full flex-col">
      <Toolbar groups={groups} />


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
          <Pane
            title="Branches"
            right={
              <button
                onClick={() => newBranch()}
                className="rounded px-1.5 hover:bg-line"
                title="New branch from the current HEAD"
              >
                ＋
              </button>
            }
            className="flex-1"
          >
            <Branches
              refs={refs}
              stashes={stashes}
              onMenu={refMenu}
              onStashMenu={stashMenu}
              onCheckout={(r) => act(() => must(api.checkout(cwd!, r)))}
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
                  {!!sel.size && (
                    <span className="text-accent">
                      {sel.size} selected
                    </span>
                  )}
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
                onMenu={fileMenu}
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
                    {t}
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
                  onClick={() => run(refresh)}
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
                onSelect={setCommitSel}
              />
            )}
            {bottom === 'diff' &&
              (diff ? <Diff text={diff} /> : <Empty>Select a file or a commit</Empty>)}
            {bottom === 'console' && <Console cmds={cmds} />}
          </Pane>
        </div>
      </div>

      {commitSel && cwd && (
        <CommitDetail cwd={cwd} refName={commitSel} onClose={() => setCommitSel(null)} />
      )}

      {compare && cwd && (
        <FileCompare
          cwd={cwd}
          file={compare.file}
          staged={compare.staged}
          onChanged={() => act(async () => {})}
          onClose={() => setCompare(null)}
        />
      )}

      {err && (
        <ErrorDialog
          message={err}
          // the console records every call, so the last failure is the culprit
          cmd={cmds.at(-1)?.ok === false ? cmds.at(-1) : undefined}
          onCopy={copy}
          onClose={() => setErr('')}
        />
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {prompt && (
        <Prompt
          {...prompt}
          onCancel={() => setPrompt(null)}
          onOk={(v) => (setPrompt(null), prompt.onOk(v))}
        />
      )}

      {modal === 'stash' && cwd && st && !!st.files.length && (
        <StashDialog
          cwd={cwd}
          files={st.files}
          branch={st.branch}
          onClose={() => setModal(null)}
          onDone={() => (setModal(null), setSel(new Set()), act(async () => {}))}
        />
      )}

      {modal === 'discard' && cwd && !!picked.length && (
        <DiscardDialog
          cwd={cwd}
          files={picked}
          onClose={() => setModal(null)}
          onDone={() => (setModal(null), setSel(new Set()), act(async () => {}))}
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

    </div>
  )
}
