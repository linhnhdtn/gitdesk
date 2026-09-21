import { useEffect, useMemo, useState } from 'react'
import { api, must } from '../api.ts'
import { FileIcon, Icon } from './Icons.tsx'
import { category, isStaged } from '../../../shared/filestate.ts'
import type { FileStatus } from '../../../main/git.ts'

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function DiscardDialog({
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
  const [toHead, setToHead] = useState(true)
  const [checked, setChecked] = useState<Set<string>>(() => new Set(files.map((f) => f.path)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const picked = useMemo(() => files.filter((f) => checked.has(f.path)), [files, checked])
  const untracked = picked.filter((f) => f.kind === 'untracked')
  const tracked = picked.filter((f) => f.kind !== 'untracked')
  // staged as NEW: not in HEAD, so reverting to HEAD takes them off disk entirely
  const vanishing = toHead ? picked.filter((f) => f.x === 'A') : []
  const anyStaged = files.some(isStaged)

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    fn()
      .then(onDone)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false))
  }

  const run = () =>
    act(() =>
      must(
        api.discard(
          cwd,
          tracked.map((f) => f.path),
          untracked.map((f) => f.path),
          toHead
        )
      )
    )

  const toStash = () =>
    act(() =>
      must(api.stashSave(cwd, `Discarded from BeoGit`, picked.map((f) => f.path)))
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-[620px] max-w-full flex-col rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center rounded-t-xl border-b border-line px-3 py-1.5">
          <span className="flex-1 text-center font-semibold">Discard</span>
          <button onClick={onClose} className="rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Discard local or staged changes</div>
            <div className="text-muted">
              Select the files for which changes should be discarded and whether to set them back to
              Index or HEAD state.
            </div>
          </div>
          <Icon name="discard" size={26} />
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-line px-4 py-1.5">
          <span className="text-muted">Revert to:</span>
          <Radio on={toHead} onClick={() => setToHead(true)}>
            HEAD
          </Radio>
          <Radio on={!toHead} onClick={() => setToHead(false)} disabled={!anyStaged}>
            Index
          </Radio>
          <span className="ml-auto text-muted">
            {picked.length} of {files.length} file{files.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mx-4 min-h-[110px] flex-1 overflow-auto rounded-md border border-line bg-bg">
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0">
              <tr className="bg-panel text-left text-muted">
                <th className="w-[48%] border-b border-line px-2 py-1 font-medium">Name</th>
                <th className="border-b border-line px-2 py-1 font-medium">Directory</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
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
                  <td className="truncate px-2 py-[3px]">
                    <span className="flex items-center gap-1.5">
                      <input type="checkbox" readOnly checked={checked.has(f.path)} className="shrink-0" />
                      <FileIcon category={category(f)} size={15} />
                      <span className="truncate">{base(f.path)}</span>
                    </span>
                  </td>
                  <td className="truncate px-2 py-[3px] text-muted">{dir(f.path)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(!!untracked.length || !!vanishing.length) && (
          <p className="mx-4 mt-2 shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[13px] text-amber-800">
            {!!untracked.length && (
              <>
                <b>{untracked.map((f) => base(f.path)).join(', ')}</b> {untracked.length === 1 ? 'is' : 'are'}{' '}
                untracked and will be deleted from disk — git has no copy to restore.{' '}
              </>
            )}
            {!!vanishing.length && (
              <>
                <b>{vanishing.map((f) => base(f.path)).join(', ')}</b> {vanishing.length === 1 ? 'is' : 'are'}{' '}
                staged as new, so reverting to HEAD removes {vanishing.length === 1 ? 'it' : 'them'} too.{' '}
              </>
            )}
            Use <b>Discard to Stash</b> to keep a copy.
          </p>
        )}

        {err && (
          <pre className="mx-4 mt-2 shrink-0 max-h-24 overflow-auto rounded border border-rose-300 bg-rose-50 px-2 py-1 font-mono text-[13px] whitespace-pre-wrap text-rose-700">
            {err}
          </pre>
        )}

        <div className="flex shrink-0 items-center px-4 py-3">
          <button
            disabled={!picked.length || busy}
            onClick={run}
            className="rounded bg-rose-600 px-5 py-1 font-medium text-white hover:bg-rose-700 disabled:opacity-40 disabled:hover:bg-rose-600"
          >
            Discard
          </button>
          <div className="ml-auto flex gap-2">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn disabled={!picked.length || busy} onClick={toStash} title="Stash these files instead of destroying them">
              Discard to Stash
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

function Radio({
  on,
  onClick,
  disabled,
  children
}: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 disabled:opacity-40">
      <span
        className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${on ? 'border-accent' : 'border-line'}`}
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
      className={`rounded-md border border-line bg-bg px-4 py-1 hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-line disabled:hover:text-fg ${className}`}
    />
  )
}
