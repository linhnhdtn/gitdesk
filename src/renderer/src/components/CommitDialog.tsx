import { useEffect, useMemo, useState } from 'react'
import { api, must } from '../api.ts'
import { Icon, FileIcon } from './Icons.tsx'
import { isStaged, category } from '../../../shared/filestate.ts'
import type { FileStatus } from '../../../main/git.ts'

type Source = 'staged' | 'local'
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

/** "+1 ~2 -1" — added / modified / deleted, the way SmartGit summarises a commit. */
function tally(files: FileStatus[], source: Source) {
  let add = 0
  let mod = 0
  let del = 0
  for (const f of files) {
    const c = source === 'staged' ? f.x : f.kind === 'untracked' ? 'A' : f.y
    if (c === 'A' || f.kind === 'untracked') add++
    else if (c === 'D') del++
    else mod++
  }
  return [add && `+${add}`, mod && `~${mod}`, del && `-${del}`].filter(Boolean).join(' ')
}

export function CommitDialog({
  cwd,
  files,
  onClose,
  onDone
}: {
  cwd: string
  files: FileStatus[]
  onClose: () => void
  onDone: () => void
}) {
  const [source, setSource] = useState<Source>(() =>
    files.some(isStaged) ? 'staged' : 'local'
  )
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState('')
  const [amend, setAmend] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const [noVerify, setNoVerify] = useState(false)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const list = useMemo(
    () =>
      source === 'staged'
        ? files.filter(isStaged)
        : files.filter((f) => f.y !== '.' || f.kind === 'untracked'),
    [files, source]
  )

  // Switching source shows a different set of files, so start from all selected.
  useEffect(() => setChecked(new Set(list.map((f) => f.path))), [source, files])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Amending replaces HEAD's message; pre-fill it so it cannot be lost by accident.
  useEffect(() => {
    if (!amend) return
    must(api.lastMessage(cwd))
      .then((m) => setMsg((cur) => (cur.trim() ? cur : m)))
      .catch(() => {})
  }, [amend, cwd])

  const all = list.length > 0 && checked.size === list.length
  const picked = list.filter((f) => checked.has(f.path))

  /**
   * All of a staged commit is just the index. Anything else has to name paths,
   * and git then takes their worktree content — which only differs for a file
   * that is staged AND changed again since.
   */
  const paths = source === 'staged' && all ? [] : picked.map((f) => f.path)
  const willTakeWorktree = paths.length > 0 && picked.filter((f) => f.x !== '.' && f.y !== '.')

  const go = (push: boolean) => {
    setBusy(true)
    setErr('')
    ;(async () => {
      try {
        await must(api.commit(cwd, msg, { amend, signoff, noVerify, paths }))
        if (push) await must(api.push(cwd, amend))
        onDone()
      } catch (e: any) {
        setErr(String(e.message ?? e))
      } finally {
        setBusy(false)
      }
    })()
  }

  const can = !!msg.trim() && !!picked.length && !busy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-[640px] max-w-full flex-col rounded border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center border-b border-line px-3 py-1.5">
          <span className="flex-1 text-center font-semibold">Commit</span>
          <button onClick={onClose} className="rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Commit local or staged changes</div>
            <div className="text-muted">Select the files you want to commit and provide a commit message.</div>
          </div>
          <Icon name="commit" size={26} />
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-line px-4 py-1.5">
          <Radio on={source === 'staged'} onClick={() => setSource('staged')}>
            Staged Changes
          </Radio>
          <Radio on={source === 'local'} onClick={() => setSource('local')}>
            Local Changes
          </Radio>
          <span className="ml-auto text-muted">
            {picked.length} of {list.length} file{list.length === 1 ? '' : 's'}
            {!!picked.length && ` (${tally(picked, source)})`}
          </span>
        </div>

        <div className="mx-4 min-h-[120px] flex-1 overflow-auto rounded border border-line bg-bg">
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-panel text-left text-muted">
                <th className="w-[46%] border-b border-line px-2 py-1 font-medium">Name</th>
                <th className="border-b border-line px-2 py-1 font-medium">Directory</th>
              </tr>
            </thead>
            <tbody>
              {!list.length && (
                <tr>
                  <td colSpan={2} className="px-2 py-2 text-muted">
                    Nothing {source === 'staged' ? 'staged' : 'changed locally'}.
                  </td>
                </tr>
              )}
              {list.map((f) => (
                <tr
                  key={f.path}
                  onClick={() =>
                    setChecked((s) => {
                      const n = new Set(s)
                      n.has(f.path) ? n.delete(f.path) : n.add(f.path)
                      return n
                    })
                  }
                  className="cursor-default hover:bg-panel"
                >
                  <td className="truncate px-2 py-[2px]">
                    <span className="flex items-center gap-1.5">
                      <input type="checkbox" readOnly checked={checked.has(f.path)} className="shrink-0" />
                      <FileIcon category={category(f)} staged={isStaged(f)} />
                      <span className="truncate">{base(f.path)}</span>
                    </span>
                  </td>
                  <td className="truncate px-2 py-[2px] text-muted">{dir(f.path)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!!willTakeWorktree && !!willTakeWorktree.length && (
          <p className="mx-4 mt-2 shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-800">
            Naming files makes git commit their <b>working-tree</b> content, not what is staged.{' '}
            {willTakeWorktree.map((f) => base(f.path)).join(', ')} differ — select every file to
            commit the index exactly.
          </p>
        )}

        <label className="mx-4 mt-3 shrink-0 text-muted">Commit Message:</label>
        <textarea
          autoFocus
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={5}
          onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && can && go(false)}
          className="mx-4 mt-1 shrink-0 resize-none rounded border border-line bg-bg p-2 outline-none focus:border-accent"
        />

        <label className="mx-4 mt-2 flex shrink-0 items-center gap-2">
          <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
          Amend last commit
        </label>

        <div className="mx-4 mt-1 shrink-0">
          <button onClick={() => setMore((m) => !m)} className="text-muted hover:text-fg">
            {more ? '▾' : '▸'} More Options
          </button>
          {more && (
            <div className="mt-1 border-t border-line pt-1 pl-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />
                Add 'Signed-off-by' signature
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} />
                Bypass commit hook
              </label>
            </div>
          )}
        </div>

        {err && (
          <pre className="mx-4 mt-2 shrink-0 max-h-24 overflow-auto rounded border border-rose-300 bg-rose-50 px-2 py-1 font-mono text-[12px] whitespace-pre-wrap text-rose-700">
            {err}
          </pre>
        )}

        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn disabled={!can} onClick={() => go(false)} title="Ctrl+Enter">
            Commit
          </Btn>
          <Btn disabled={!can} onClick={() => go(true)}>
            Commit &amp; Push
          </Btn>
        </div>
      </div>
    </div>
  )
}

function Radio({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5">
      <span
        className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${
          on ? 'border-accent' : 'border-line'
        }`}
      >
        {on && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      {children}
    </button>
  )
}

function Btn({ className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...p}
      className={`rounded border border-line bg-bg px-4 py-1 hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg ${className}`}
    />
  )
}
