/**
 * Turn a unified diff into aligned left/right rows for a File Compare view.
 *
 * Deliberately not a diff algorithm: git already produced the patch (ask for a
 * huge -U so the whole file arrives as one hunk). This only distributes the
 * lines across two columns and pads the short side so the rows line up.
 */

export type Kind = 'same' | 'del' | 'add' | 'pad'
export type Cell = { no: number | null; text: string; kind: Kind }
export type Pair = { left: Cell; right: Cell; change: boolean }

export type Compare = {
  pairs: Pair[]
  /** index of the first row of each change block, for Prev/Next Change */
  blocks: number[]
  binary: boolean
}

const PAD: Cell = { no: null, text: '', kind: 'pad' }

export function sideBySide(patch: string): Compare {
  const pairs: Pair[] = []
  let ln = 0
  let rn = 0
  let inHunk = false
  let dels: string[] = []
  let adds: string[] = []
  let binary = false

  /** Pair up a run of -/+ lines; a replaced line sits on one row, extras get a pad. */
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      pairs.push({
        left: i < dels.length ? { no: ++ln, text: dels[i], kind: 'del' } : PAD,
        right: i < adds.length ? { no: ++rn, text: adds[i], kind: 'add' } : PAD,
        change: true
      })
    }
    dels = []
    adds = []
  }

  const raw = patch.split('\n')
  if (raw.at(-1) === '') raw.pop() // patches end in a newline; that's not a line

  for (const line of raw) {
    if (line.startsWith('@@')) {
      flush()
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line)
      if (m) {
        // counters are pre-incremented on emit, so start one below
        ln = Number(m[1]) - 1
        rn = Number(m[2]) - 1
      }
      inHunk = true
      continue
    }
    if (!inHunk) {
      if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) binary = true
      continue // diff --git / index / --- / +++ headers
    }
    if (line.startsWith('\\')) continue // "\ No newline at end of file"

    const body = line.slice(1)
    if (line[0] === '-') dels.push(body)
    else if (line[0] === '+') adds.push(body)
    else if (line[0] === ' ' || line === '') {
      flush()
      pairs.push({
        left: { no: ++ln, text: body, kind: 'same' },
        right: { no: ++rn, text: body, kind: 'same' },
        change: false
      })
    }
  }
  flush()

  const blocks: number[] = []
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].change && !pairs[i - 1]?.change) blocks.push(i)
  }
  return { pairs, blocks, binary }
}

/**
 * `git diff` has no knowledge of untracked files and returns an empty patch for
 * them, which would render as "no changes" everywhere. Build the patch a new
 * file *would* have produced, so every consumer keeps one code path.
 */
export function newFilePatch(path: string, text: string): string {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop() // trailing newline isn't a line
  return [
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => '+' + l)
  ].join('\n')
}

/**
 * "Take Left" on the given blocks: the right side gives up its version and
 * takes the left's, exactly as SmartGit's `»` does.
 *
 * Rows are rebuilt rather than patched in place because the right-hand line
 * numbers all shift once a block changes length — reverting an insertion of two
 * lines moves every later line up by two.
 */
export function takeLeft(cmp: Compare, starts: ReadonlySet<number>): Compare {
  const taken = new Set<number>()
  for (const s of starts) {
    let e = s
    while (e < cmp.pairs.length && cmp.pairs[e].change) taken.add(e++)
  }

  const pairs: Pair[] = []
  let rn = 0
  for (let i = 0; i < cmp.pairs.length; i++) {
    const p = cmp.pairs[i]
    if (!taken.has(i)) {
      // only the right-hand numbering moves; the left is untouched
      const right = p.right.kind === 'pad' ? PAD : { ...p.right, no: ++rn }
      pairs.push({ ...p, right })
      continue
    }
    // the left had nothing here, so taking left deletes the added line outright
    if (p.left.kind === 'pad') continue
    const text = p.left.text
    pairs.push({
      left: { no: p.left.no, text, kind: 'same' },
      right: { no: ++rn, text, kind: 'same' },
      change: false
    })
  }

  const blocks: number[] = []
  for (let i = 0; i < pairs.length; i++) if (pairs[i].change && !pairs[i - 1]?.change) blocks.push(i)
  return { pairs, blocks, binary: cmp.binary }
}

/** The right-hand document as plain text, ready to write back to the file. */
export function rightText(cmp: Compare): string {
  return cmp.pairs
    .filter((p) => p.right.kind !== 'pad')
    .map((p) => p.right.text)
    .join('\n')
}

/**
 * What a change block actually is, which decides both its colour and its button.
 *
 * The colour follows the BLOCK, not the side: a modified line is red on both
 * sides, because the point is "this line changed", not "this half was removed".
 * Only a pure insertion is green, and only on the side that has it.
 */
export type BlockKind = 'change' | 'insert' | 'delete'

export function blockKind(cmp: Compare, start: number): BlockKind {
  let del = false
  let add = false
  for (let i = start; i < cmp.pairs.length && cmp.pairs[i].change; i++) {
    if (cmp.pairs[i].left.kind === 'del') del = true
    if (cmp.pairs[i].right.kind === 'add') add = true
  }
  if (del && add) return 'change'
  return add ? 'insert' : 'delete'
}

/** row index -> the kind of the block it belongs to, for colouring every row. */
export function blockKinds(cmp: Compare): Map<number, BlockKind> {
  const m = new Map<number, BlockKind>()
  for (const start of cmp.blocks) {
    const k = blockKind(cmp, start)
    for (let i = start; i < cmp.pairs.length && cmp.pairs[i].change; i++) m.set(i, k)
  }
  return m
}

/** Where a row sits inside its change block, for drawing the ribbon slice. */
export type RowBlock = { start: number; len: number; idx: number; kind: BlockKind }

export function rowBlocks(cmp: Compare): Map<number, RowBlock> {
  const m = new Map<number, RowBlock>()
  for (const start of cmp.blocks) {
    let len = 0
    while (start + len < cmp.pairs.length && cmp.pairs[start + len].change) len++
    const kind = blockKind(cmp, start)
    for (let i = 0; i < len; i++) m.set(start + i, { start, len, idx: i, kind })
  }
  return m
}

/**
 * How far the ribbon is pulled in from the empty side at vertical fraction `f`
 * of a block, as a 0..1 share of the gutter width.
 *
 * A block that exists on only one side is drawn tapering to a waist against the
 * side that has nothing, which is what makes a 25-line insertion read as
 * belonging to one point opposite. Short blocks stay square — a taper across
 * two rows is noise, not information.
 */
export function ribbonInset(f: number, len: number): number {
  if (len < 4) return 0
  const u = Math.min(1, Math.max(0, Math.min(f, 1 - f) * 2))
  const smooth = u * u * (3 - 2 * u) // smoothstep, so the edge curves
  return (1 - smooth) * 0.72
}

/** A run of text within a line, `hi` marking the part that actually differs. */
export type Seg = { text: string; hi: boolean }

/** Words, punctuation, runs of spaces and newlines — each its own token. */
const tokenise = (s: string) => s.match(/\n|[^\S\n]+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? []

/**
 * Mark the differing run inside a change block, so the words that are genuinely
 * new stand out against the block's own colour.
 *
 * Common leading and trailing tokens are trimmed and everything between is
 * marked. Not a full LCS: a line edited in two separate places gets one wider
 * highlight instead of two exact ones, which is worth an O(n) pass rather than
 * an O(n*m) table that would need a size cap to stay safe on a big block.
 */
export function wordDiff(
  leftLines: string[],
  rightLines: string[]
): { left: Seg[][]; right: Seg[][] } {
  const l = tokenise(leftLines.join('\n'))
  const r = tokenise(rightLines.join('\n'))

  let p = 0
  while (p < l.length && p < r.length && l[p] === r[p]) p++
  let q = 0
  while (q < l.length - p && q < r.length - p && l[l.length - 1 - q] === r[r.length - 1 - q]) q++

  const split = (tok: string[], lines: number): Seg[][] => {
    const out: Seg[][] = [[]]
    tok.forEach((t, i) => {
      if (t === '\n') return void out.push([])
      const hi = i >= p && i < tok.length - q
      const cur = out[out.length - 1]
      const last = cur[cur.length - 1]
      // merge neighbours so a line is a handful of spans, not one per token
      if (last && last.hi === hi) last.text += t
      else cur.push({ text: t, hi })
    })
    while (out.length < lines) out.push([])
    return out
  }

  return { left: split(l, leftLines.length), right: split(r, rightLines.length) }
}
