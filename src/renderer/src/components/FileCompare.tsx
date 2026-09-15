import { useEffect, useMemo, useRef, useState } from 'react'
import { api, must } from '../api.ts'
import { sideBySide, type Cell, type Compare } from '../../../shared/sidebyside.ts'
import type { FileStatus } from '../../../main/git.ts'

const BG: Record<Cell['kind'], string> = {
  same: '',
  del: 'bg-rose-100',
  add: 'bg-emerald-100',
  // SmartGit hatches the gap where a side has no line at all
  pad: 'bg-[repeating-linear-gradient(135deg,#f2f1f0_0_5px,#e6e4e1_5px_10px)]'
}

/** Which two revisions a file is compared between, phrased the way git means it. */
function sides(f: FileStatus, staged: boolean) {
  if (f.kind === 'untracked') return ['(None)', '(Working Tree)']
  return staged ? ['(HEAD)', '(Index)'] : ['(Index)', '(Working Tree)']
}

export function FileCompare({
  cwd,
  file,
  staged,
  onClose
}: {
  cwd: string
  file: FileStatus
  /** compare HEAD↔index instead of index↔worktree */
  staged: boolean
  onClose: () => void
}) {
  const [cmp, setCmp] = useState<Compare | null>(null)
  const [err, setErr] = useState('')
  const [at, setAt] = useState(-1)
  const [reload, setReload] = useState(0)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const [leftLabel, rightLabel] = sides(file, staged)

  useEffect(() => {
    let dead = false
    setCmp(null)
    setErr('')
    ;(async () => {
      try {
        // huge -U so the whole file arrives as one hunk: git diffs, we only split sides
        const patch =
          file.kind === 'untracked'
            ? await must(api.diffNew(cwd, file.path))
            : await must(api.diff(cwd, file.path, staged, 1_000_000))
        if (!dead) setCmp(sideBySide(patch))
      } catch (e: any) {
        if (!dead) setErr(String(e.message ?? e))
      }
    })()
    return () => void (dead = true)
  }, [cwd, file, staged, reload])

  const blocks = cmp?.blocks ?? []
  const go = (d: 1 | -1) => {
    if (!blocks.length) return
    const i = Math.min(blocks.length - 1, Math.max(0, at === -1 ? (d === 1 ? 0 : blocks.length - 1) : at + d))
    setAt(i)
    rows.current[blocks[i]]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown' && e.altKey) (e.preventDefault(), go(1))
      else if (e.key === 'ArrowUp' && e.altKey) (e.preventDefault(), go(-1))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const changed = useMemo(() => cmp?.pairs.filter((p) => p.change).length ?? 0, [cmp])

  return (
    // The overlay is a row flex box with a definite height (inset-0), so the
    // default align-items:stretch gives the dialog an exact height to divide up.
    // `grid place-items-center` + h-full does not: the percentage resolves
    // against a content-sized track, the dialog grows past the viewport and the
    // inner scroller is never constrained enough to scroll.
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[1600px] min-h-0 flex-col rounded border border-line bg-bg shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 rounded-t border-b border-line bg-panel px-3 py-1.5">
          <span className="truncate font-semibold">[{file.path}] — File Compare</span>
          <button onClick={onClose} className="ml-auto rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-1">
          <Tool icon="⟳" label="Reload" onClick={() => setReload((r) => r + 1)} />
          <div className="mx-1 h-6 w-px bg-line" />
          <Tool icon="↑" label="Prev. Change" onClick={() => go(-1)} disabled={!blocks.length} />
          <Tool icon="↓" label="Next Change" onClick={() => go(1)} disabled={!blocks.length} />
          <span className="ml-auto text-muted">
            {blocks.length
              ? `${at >= 0 ? at + 1 : '–'} / ${blocks.length} change${blocks.length === 1 ? '' : 's'} · ${changed} changed line${changed === 1 ? '' : 's'}`
              : cmp && 'No differences'}
          </span>
        </div>

        <div className="grid shrink-0 grid-cols-2 border-b border-line bg-panel">
          <div className="truncate border-r border-line px-2 py-0.5">
            {file.origPath ?? file.path} <span className="text-muted">{leftLabel}</span>
          </div>
          <div className="truncate px-2 py-0.5">
            {file.path} <span className="text-muted">{rightLabel}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[1.45]">
          {err && <div className="p-3 text-rose-700">{err}</div>}
          {!cmp && !err && <div className="p-3 text-muted">Loading…</div>}
          {cmp?.binary && <div className="p-3 text-muted">Binary file — nothing to compare.</div>}
          {cmp && !cmp.binary && !cmp.pairs.length && (
            <div className="p-3 text-muted">
              {file.kind === 'untracked' ? 'New file is empty.' : 'File is identical on both sides.'}
            </div>
          )}
          {cmp?.pairs.map((p, i) => (
            <div
              key={i}
              ref={(el) => void (rows.current[i] = el)}
              className={`grid grid-cols-2 ${blocks[at] === i ? 'outline outline-accent' : ''}`}
            >
              <Line cell={p.left} className="border-r border-line" />
              <Line cell={p.right} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Line({ cell, className = '' }: { cell: Cell; className?: string }) {
  return (
    <div className={`flex min-w-0 ${BG[cell.kind]} ${className}`}>
      <span className="w-10 shrink-0 border-r border-line/60 pr-1 text-right text-muted select-none">
        {cell.no ?? ''}
      </span>
      {/* ponytail: wrap instead of a synced horizontal scroller — grid rows keep
          both halves aligned for free, and nothing is ever cut off */}
      <span className="min-w-0 flex-1 pl-2 break-all whitespace-pre-wrap">{cell.text || ' '}</span>
    </div>
  )
}

function Tool({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-line disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span>{icon}</span>
      {label}
    </button>
  )
}
