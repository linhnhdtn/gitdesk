import { useEffect, useState } from 'react'
import { api, must } from '../api.ts'
import { Files } from './Files.tsx'
import { Diff, Empty } from './Diff.tsx'
import { Split } from './Split.tsx'
import type { Commit, FileStatus } from '../../../main/git.ts'

/** What one commit changed: its files on the left, the selected file's patch on the right. */
export function CommitDetail({
  cwd,
  refName,
  onClose
}: {
  cwd: string
  /** a sha, or a stash entry like stash@{0} — both resolve to one commit */
  refName: string
  onClose: () => void
}) {
  const [commit, setCommit] = useState<Commit | null>(null)
  const [files, setFiles] = useState<FileStatus[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [err, setErr] = useState('')
  const [width, setWidth] = useState(340)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    let dead = false
    setCommit(null)
    setFiles(null)
    setSel(null)
    setDiff('')
    Promise.all([must(api.commitAt(cwd, refName)), must(api.commitFiles(cwd, refName))])
      .then(([c, f]) => {
        if (dead) return
        setCommit(c)
        setFiles(f)
        // land on something readable instead of an empty pane
        if (f.length) setSel(f[0].path)
      })
      .catch((e) => !dead && setErr(String(e.message ?? e)))
    return () => void (dead = true)
  }, [cwd, refName])

  useEffect(() => {
    if (!sel) return setDiff('')
    let dead = false
    must(api.commitDiff(cwd, refName, sel))
      .then((d) => !dead && setDiff(d))
      .catch((e) => !dead && setErr(String(e.message ?? e)))
    return () => void (dead = true)
  }, [cwd, refName, sel])

  const merge = (commit?.parents.length ?? 0) > 1
  const stash = refName.startsWith('stash@{')

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[1600px] min-h-0 flex-col rounded-xl border border-line bg-bg shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 rounded-t-xl border-b border-line bg-panel px-3 py-1.5">
          <span className="shrink-0 font-mono text-muted">
            {stash ? refName : (commit?.hash.slice(0, 7) ?? '…')}
          </span>
          <span className="truncate font-semibold">{commit?.subject ?? 'Loading…'}</span>
          {merge && !stash && (
            <span className="shrink-0 rounded bg-accent/15 px-1.5 text-[12px] text-accent">merge</span>
          )}
          <button onClick={onClose} className="ml-auto rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 gap-3 border-b border-line bg-panel px-3 py-1 text-muted">
          <span className="truncate">
            {commit ? `${commit.author} <${commit.email}>` : ''}
          </span>
          <span className="shrink-0">{commit?.date.slice(0, 16).replace('T', ' ')}</span>
          <span className="ml-auto shrink-0">
            {files ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'loading…'}
            {merge && !stash && ' vs first parent'}
          </span>
        </div>

        {err && (
          <pre className="shrink-0 border-b border-rose-300 bg-rose-50 px-3 py-1.5 font-mono text-[13px] whitespace-pre-wrap text-rose-700">
            {err}
          </pre>
        )}

        <div className="flex min-h-0 flex-1">
          <div style={{ width }} className="min-h-0 shrink-0 overflow-auto">
            {files === null && <div className="p-2 text-muted">Loading…</div>}
            {files?.length === 0 && (
              <div className="p-2 text-muted">
                {stash
                  ? 'This stash holds no changes.'
                  : merge
                    ? 'This merge brought in no changes.'
                    : 'This commit changed nothing.'}
              </div>
            )}
            {!!files?.length && (
              <Files
                files={files}
                sel={new Set(sel ? [sel] : [])}
                history
                onSelect={(p) => setSel(p)}
                onCompare={() => {}}
                onMenu={() => {}}
              />
            )}
          </div>

          <Split dir="x" value={width} min={200} max={900} onChange={setWidth} />

          <div className="min-w-0 flex-1">
            {sel ? <Diff text={diff} /> : <Empty>Select a file</Empty>}
          </div>
        </div>
      </div>
    </div>
  )
}
