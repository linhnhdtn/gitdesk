import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, must } from '../api.ts'
import { Icon } from './Icons.tsx'
import {
  sideBySide,
  takeLeft,
  rightText,
  blockKind,
  blockKinds,
  rowBlocks,
  ribbonInset,
  wordDiff,
  sourceBlock,
  type Seg,
  type Cell,
  type Compare
} from '../../../shared/sidebyside.ts'
import type { FileStatus } from '../../../main/git.ts'

const HATCH = 'bg-[repeating-linear-gradient(135deg,#f2f1f0_0_5px,#e6e4e1_5px_10px)]'

/**
 * A block's colour says what happened to it, not which half you are looking at:
 * a modified line is red on BOTH sides. Only a genuine insertion is green.
 */
const BLOCK_BG = { change: 'bg-rose-100', insert: 'bg-emerald-100', delete: 'bg-rose-100' }
/** same colours, as a fill the ribbon slices can inherit */
const BLOCK_FILL = { change: 'text-rose-100', insert: 'text-emerald-100', delete: 'text-rose-100' }

/** `»` replaces, `×` removes what was added, `+` puts back what was deleted. */
const BLOCK_GLYPH = { change: '»', insert: '×', delete: '+' }
const BLOCK_HINT = {
  change: 'Take Left — replace this block with the version on the left',
  insert: 'Take Left — remove these added lines',
  delete: 'Take Left — put these deleted lines back'
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
  onClose,
  onChanged
}: {
  cwd: string
  file: FileStatus
  /** compare HEAD↔index instead of index↔worktree */
  staged: boolean
  onClose: () => void
  /** a block was staged or discarded, so the file lists outside are stale */
  onChanged?: () => void
}) {
  const [cmp, setCmp] = useState<Compare | null>(null)
  const [err, setErr] = useState('')
  const [at, setAt] = useState(-1)
  const [reload, setReload] = useState(0)
  /**
   * Blocks taken from the left, in the order they were taken — a list, not a
   * set, so Ctrl+Z can lift the most recent one. Nothing hits disk until Save.
   */
  const [taken, setTaken] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  /** the three-way prompt that a two-button confirm cannot express */
  const [asking, setAsking] = useState(false)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const [marks, setMarks] = useState<
    { row: number; top: number; height: number; kind: 'change' | 'insert' | 'delete' }[]
  >([])
  const [leftLabel, rightLabel] = sides(file, staged)

  useEffect(() => {
    let dead = false
    setCmp(null)
    setTaken([])
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

  // Only the working tree is a file we can write; the index is not.
  const editable = !staged && file.kind !== 'untracked'
  const dirty = taken.length > 0
  const view = useMemo(
    () => (cmp && dirty ? takeLeft(cmp, new Set(taken)) : cmp),
    [cmp, taken, dirty]
  )

  const blocks = view?.blocks ?? []
  /** which row starts the block a given row belongs to, -1 outside a block */
  const blockOf = useMemo(() => {
    const m = new Map<number, number>()
    let head = -1
    view?.pairs.forEach((p, i) => {
      if (!p.change) return void (head = -1)
      if (head === -1) head = i
      m.set(i, head)
    })
    return m
  }, [view])
  const kinds = useMemo(
    () => (view ? blockKinds(view) : new Map<number, ReturnType<typeof blockKind>>()),
    [view]
  )
  /** Word-level marks inside change blocks, keyed by row. */
  const segs = useMemo(() => {
    const m = new Map<number, { left?: Seg[]; right?: Seg[] }>()
    if (!view) return m
    for (const start of view.blocks) {
      if (blockKind(view, start) !== 'change') continue // nothing to compare against
      const rows: number[] = []
      for (let i = start; i < view.pairs.length && view.pairs[i].change; i++) rows.push(i)
      const lRows = rows.filter((i) => view.pairs[i].left.kind === 'del')
      const rRows = rows.filter((i) => view.pairs[i].right.kind === 'add')
      const d = wordDiff(
        lRows.map((i) => view.pairs[i].left.text),
        rRows.map((i) => view.pairs[i].right.text)
      )
      lRows.forEach((row, k) => m.set(row, { ...m.get(row), left: d.left[k] }))
      rRows.forEach((row, k) => m.set(row, { ...m.get(row), right: d.right[k] }))
    }
    return m
  }, [view])

  const rb = useMemo(() => (view ? rowBlocks(view) : new Map<number, ReturnType<typeof rowBlocks> extends Map<number, infer V> ? V : never>()), [view])

  /** Jump to the next or previous change block. */
  const go = (d: 1 | -1) => {
    if (!blocks.length) return
    const i = Math.min(
      blocks.length - 1,
      Math.max(0, at === -1 ? (d === 1 ? 0 : blocks.length - 1) : at + d)
    )
    setAt(i)
    rows.current[blocks[i]]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  /**
   * Overview bar positions. Measured from the real rows rather than derived
   * from row indexes, because a wrapped line is taller than its neighbours and
   * an index-proportional map would drift away from the content it points at.
   */
  useLayoutEffect(() => {
    const box = scroller.current
    if (!box || !view) return setMarks([])
    const measure = () => {
      const total = box.scrollHeight
      if (!total) return
      setMarks(
        view.blocks.flatMap((start) => {
          let len = 0
          while (start + len < view.pairs.length && view.pairs[start + len].change) len++
          const first = rows.current[start]
          const last = rows.current[start + len - 1]
          if (!first || !last) return []
          const top = first.offsetTop
          const bottom = last.offsetTop + last.offsetHeight
          return [
            {
              row: start,
              top: (top / total) * 100,
              height: ((bottom - top) / total) * 100,
              kind: blockKind(view, start)
            }
          ]
        })
      )
    }
    measure()
    const ro = new ResizeObserver(measure) // wrapping changes when the window does
    ro.observe(box)
    return () => ro.disconnect()
  }, [view])

  const changed = useMemo(() => view?.pairs.filter((p) => p.change).length ?? 0, [view])

  /** Write the edited side back to the file. Resolves false if the write failed. */
  const save = (): Promise<boolean> => {
    if (!view) return Promise.resolve(false)
    setSaving(true)
    setErr('')
    // reproduce the file's own trailing-newline habit instead of guessing
    return must(api.readWorktree(cwd, file.path))
      .then((orig) =>
        must(api.writeWorktree(cwd, file.path, rightText(view) + (orig.endsWith('\n') ? '\n' : '')))
      )
      .then(() => {
        setTaken([])
        setReload((r) => r + 1)
        onChanged?.()
        return true
      })
      .catch((e) => {
        setErr(String(e.message ?? e))
        return false
      })
      .finally(() => setSaving(false))
  }

  const close = () => (dirty ? setAsking(true) : onClose())

  /** `viewRow` is where the block starts in the CURRENT view, not the source. */
  const take = (viewRow?: number) => {
    if (!cmp || !view || viewRow === undefined) return
    const src = sourceBlock(cmp, taken, view.blocks.indexOf(viewRow))
    if (src !== undefined) setTaken((t) => [...t, src])
  }

  const undo = () => setTaken((t) => t.slice(0, -1))

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // while the prompt is up it owns Escape: cancelling it means keep editing
      if (e.key === 'Escape') return void (asking ? setAsking(false) : close())
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !asking) {
        e.preventDefault()
        return void undo()
      }
      if (e.key === 'ArrowDown' && e.altKey) (e.preventDefault(), go(1))
      else if (e.key === 'ArrowUp' && e.altKey) (e.preventDefault(), go(-1))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  return (
    // The overlay is a row flex box with a definite height (inset-0), so the
    // default align-items:stretch gives the dialog an exact height to divide up.
    // `grid place-items-center` + h-full does not: the percentage resolves
    // against a content-sized track, the dialog grows past the viewport and the
    // inner scroller is never constrained enough to scroll.
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30 p-6" onClick={close}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-[1600px] min-h-0 flex-col rounded-xl border border-line bg-bg shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 rounded-t-xl border-b border-line bg-panel px-3 py-1.5">
          <span className="truncate font-semibold">
            {dirty && <span title="Unsaved changes">*</span>}[{file.path}] — File Compare
          </span>
          <button onClick={close} className="ml-auto rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-line bg-panel px-2 py-1">
          <Tool
            icon={<Icon name="save" size={15} />}
            label="Save"
            onClick={save}
            disabled={!dirty || saving}
            title="Write the edited side back to the file"
          />
          <Tool
            icon="⟳"
            label="Reload"
            onClick={() => (setTaken([]), setReload((r) => r + 1))}
            title={dirty ? 'Re-read the file and drop the unsaved edits' : 'Re-read the file'}
          />
          <div className="mx-1 h-6 w-px bg-line" />
          <Tool icon="↑" label="Prev. Change" onClick={() => go(-1)} disabled={!blocks.length} />
          <Tool icon="↓" label="Next Change" onClick={() => go(1)} disabled={!blocks.length} />
          {dirty && (
            <Tool
              icon="↶"
              label="Undo"
              onClick={undo}
              title={`Undo the last Take Left (Ctrl+Z) — ${taken.length} pending`}
            />
          )}
          <span className="ml-auto text-muted">
            {blocks.length
              ? `${at >= 0 ? at + 1 : '–'} / ${blocks.length} change${blocks.length === 1 ? '' : 's'} · ${changed} changed line${changed === 1 ? '' : 's'}`
              : view && 'No differences'}
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

        <div className="flex min-h-0 flex-1">
        <div
          ref={scroller}
          className="relative select-text min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-[1.45]"
        >
          {err && <div className="p-3 text-rose-700">{err}</div>}
          {!cmp && !err && <div className="p-3 text-muted">Loading…</div>}
          {view?.binary && <div className="p-3 text-muted">Binary file — nothing to compare.</div>}
          {view && !view.binary && !view.pairs.length && (
            <div className="p-3 text-muted">
              {file.kind === 'untracked' ? 'New file is empty.' : 'File is identical on both sides.'}
            </div>
          )}
          {view?.pairs.map((p, i) => (
            <div
              key={i}
              ref={(el) => void (rows.current[i] = el)}
              className={`grid grid-cols-[1fr_64px_1fr] ${
                blocks[at] === i ? 'outline outline-accent' : ''
              }`}
            >
              <Line
                cell={p.left}
                kind={kinds.get(i)}
                segs={segs.get(i)?.left}
                className="border-r border-line"
              />
              <Gutter
                block={rb.get(i)}
                showButton={editable && !!rb.get(i) && rb.get(i)!.idx === Math.floor(rb.get(i)!.len / 2)}
                onTake={() => take(rb.get(i)?.start)}
              />
              <Line cell={p.right} kind={kinds.get(i)} segs={segs.get(i)?.right} />
            </div>
          ))}
        </div>

        <Minimap
          marks={marks}
          active={blocks[at]}
          onJump={(row) => {
            setAt(blocks.indexOf(row))
            rows.current[row]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }}
        />
        </div>
      </div>

      {asking && (
        <AskSave
          busy={saving}
          onDiscard={onClose}
          onCancel={() => setAsking(false)}
          onSave={() => save().then((done) => (done ? onClose() : setAsking(false)))}
        />
      )}
    </div>
  )
}

/** Every change in the file at its real position, as a jump target. */
function Minimap({
  marks,
  active,
  onJump
}: {
  marks: { row: number; top: number; height: number; kind: 'change' | 'insert' | 'delete' }[]
  active?: number
  onJump: (row: number) => void
}) {
  if (!marks.length) return null
  return (
    <div className="relative w-3.5 shrink-0 border-l border-line bg-panel">
      {marks.map((m) => (
        <button
          key={m.row}
          onClick={() => onJump(m.row)}
          title={`Jump to this ${m.kind}`}
          style={{ top: `${m.top}%`, height: `max(3px, ${m.height}%)` }}
          className={`absolute right-[2px] left-[2px] rounded-[1px] ${MARK_BG[m.kind]} ${
            m.row === active ? 'ring-1 ring-fg' : ''
          }`}
        />
      ))}
    </div>
  )
}

/** pink for an edit, green for an insertion — the same language as the rows */
const MARK_BG = {
  change: 'bg-rose-400 hover:bg-rose-500',
  insert: 'bg-emerald-400 hover:bg-emerald-500',
  delete: 'bg-rose-400 hover:bg-rose-500'
}

/**
 * One row's slice of the connecting ribbon.
 *
 * Drawn per row rather than as one shape, because rows wrap and so have no
 * fixed height — preserveAspectRatio="none" lets each slice stretch to whatever
 * its row turned out to be, and stacked they form the curve.
 */
function Gutter({
  block,
  showButton,
  onTake
}: {
  block?: { start: number; len: number; idx: number; kind: 'change' | 'insert' | 'delete' }
  showButton: boolean
  onTake: () => void
}) {
  if (!block) return <div className="border-r border-line" />

  const { len, idx, kind } = block
  const a = ribbonInset(idx / len, len) * 100
  const b = ribbonInset((idx + 1) / len, len) * 100
  // the ribbon narrows toward whichever side has nothing on it
  const d =
    kind === 'insert'
      ? `M${a},0 H100 V100 H${b} Z`
      : kind === 'delete'
        ? `M0,0 H${100 - a} L${100 - b},100 H0 Z`
        : 'M0,0 H100 V100 H0 Z'

  return (
    <div className="relative border-r border-line">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        // the colour lives on the svg, not the wrapper: as currentColor on the
        // parent it also tints the button's own label into invisibility
        className={`absolute inset-0 h-full w-full ${BLOCK_FILL[kind]}`}
        aria-hidden
      >
        <path d={d} fill="currentColor" />
      </svg>
      {showButton && (
        // horizontally the button hugs the side that actually holds the lines:
        // an insertion lives on the right, a deletion and a replace on the left
        <div
          className={`absolute inset-0 flex items-center ${
            kind === 'insert' ? 'justify-end pr-px' : 'justify-start pl-px'
          }`}
        >
          <GutterBtn
            label={BLOCK_GLYPH[kind]}
            title={`${BLOCK_HINT[kind]}. Press Save to write it.`}
            onClick={onTake}
          />
        </div>
      )}
    </div>
  )
}

/** Closing with unsaved edits needs three answers, so it cannot be a confirm(). */
function AskSave({
  busy,
  onDiscard,
  onCancel,
  onSave
}: {
  busy: boolean
  onDiscard: () => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[430px] max-w-full rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex items-center rounded-t-xl border-b border-line px-3 py-1.5">
          <span className="flex-1 text-center font-semibold">File Changed</span>
          <button onClick={onCancel} className="rounded px-2 hover:bg-line" title="Keep editing (Esc)">
            ✕
          </button>
        </div>
        <div className="flex items-start gap-3 px-4 py-4">
          <Icon name="warning" size={34} />
          <div className="min-w-0">
            <div className="font-semibold">Do you want to save your changes?</div>
            <div className="mt-1 text-muted">Your changes will be lost if you don't save them.</div>
          </div>
        </div>
        <div className="flex items-center px-4 pb-3">
          <button
            onClick={onDiscard}
            disabled={busy}
            className="rounded-md border border-line bg-bg px-4 py-1 hover:border-rose-600 hover:text-rose-700 disabled:opacity-40"
          >
            Discard
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-line bg-bg px-4 py-1 hover:border-accent disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              autoFocus
              onClick={onSave}
              disabled={busy}
              className="rounded-md bg-emerald-600 px-5 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function GutterBtn({
  label,
  title,
  disabled,
  onClick
}: {
  label: string
  title: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="grid h-[17px] w-[17px] place-items-center rounded border border-line bg-panel leading-none hover:border-accent hover:text-accent disabled:opacity-35 disabled:hover:border-line disabled:hover:text-fg"
    >
      {label}
    </button>
  )
}

/** The word-level mark sits on top of the block colour, not instead of it. */
const SEG_HI = { change: 'bg-emerald-200', insert: 'bg-emerald-200', delete: 'bg-rose-200' }

function Line({
  cell,
  kind,
  segs,
  className = ''
}: {
  cell: Cell
  kind?: 'change' | 'insert' | 'delete'
  segs?: Seg[]
  className?: string
}) {
  const bg = cell.kind === 'pad' ? HATCH : kind ? BLOCK_BG[kind] : ''
  // the left half of a change lost text, so its marks read as removals
  const hi = cell.kind === 'del' ? SEG_HI.delete : SEG_HI.change
  return (
    <div className={`flex min-w-0 ${bg} ${className}`}>
      <span className="w-10 shrink-0 border-r border-line/60 pr-1 text-right text-muted select-none">
        {cell.no ?? ''}
      </span>
      {/* ponytail: wrap instead of a synced horizontal scroller — grid rows keep
          both halves aligned for free, and nothing is ever cut off */}
      <span className="min-w-0 flex-1 pl-2 break-all whitespace-pre-wrap">
        {segs?.length
          ? segs.map((sg, k) => (
              <span key={k} className={sg.hi ? `rounded-sm ${hi}` : ''}>
                {sg.text}
              </span>
            ))
          : cell.text || '\u00a0'}
      </span>
    </div>
  )
}

function Tool({
  icon,
  label,
  onClick,
  disabled,
  title
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-line disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span>{icon}</span>
      {label}
    </button>
  )
}
