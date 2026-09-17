import { useEffect, useMemo, useState } from 'react'
import { api, must } from '../api.ts'
import { FileIcon, Icon } from './Icons.tsx'
import { category } from '../../../shared/filestate.ts'
import type { FileStatus } from '../../../main/git.ts'

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function StashDialog({
  cwd,
  files,
  branch,
  onClose,
  onDone
}: {
  cwd: string
  files: FileStatus[]
  branch: string
  onClose: () => void
  onDone: () => void
}) {
  const [msg, setMsg] = useState('')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(files.map((f) => f.path)))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const picked = useMemo(() => files.filter((f) => checked.has(f.path)), [files, checked])
  const all = picked.length === files.length

  const go = () => {
    setBusy(true)
    setErr('')
    // no paths at all means "stash everything", which is also git's own default
    must(api.stashSave(cwd, msg.trim(), all ? [] : picked.map((f) => f.path)))
      .then(onDone)
      .catch((e) => setErr(String(e.message ?? e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-[620px] max-w-full flex-col rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center rounded-t-xl border-b border-line px-3 py-1.5">
          <span className="flex-1 text-center font-semibold">Stash</span>
          <button onClick={onClose} className="rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Stash local changes</div>
            <div className="text-muted">
              Set the changes aside and clean the working tree. Give them a title so they are easy to
              find later.
            </div>
          </div>
          <Icon name="stash" size={26} />
        </div>

        <label className="mx-4 mt-1 shrink-0 text-muted">Title:</label>
        <input
          autoFocus
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && picked.length && !busy && go()}
          placeholder={`WIP on ${branch}`}
          className="mx-4 mt-1 shrink-0 rounded-md border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
        />

        <div className="mt-3 flex shrink-0 items-center gap-4 border-t border-line px-4 py-1.5">
          <span className="text-muted">Files to stash</span>
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

        {err && (
          <pre className="mx-4 mt-2 shrink-0 max-h-24 overflow-auto rounded-md border border-rose-300 bg-rose-50 px-2 py-1 font-mono text-[13px] whitespace-pre-wrap text-rose-700">
            {err}
          </pre>
        )}

        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn disabled={!picked.length || busy} onClick={go} title="Enter">
            Stash {picked.length} file{picked.length === 1 ? '' : 's'}
          </Btn>
        </div>
      </div>
    </div>
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
