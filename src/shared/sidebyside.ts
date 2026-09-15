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
