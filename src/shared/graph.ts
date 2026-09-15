/** One journal row's rail geometry. Pure — no git, no DOM. */
export type Row = {
  /** column this commit's dot sits in */
  lane: number
  /**
   * Rail segments. `up` ones are drawn in the row's TOP half (a branch arriving
   * into this commit); the rest in the bottom half (continuing or forking out).
   * Getting that wrong makes a merge look like it joins below its own dot.
   */
  edges: Edge[]
  /** lanes occupied on this row, so the renderer knows how wide the rail is */
  width: number
}

/** ponytail: 8 lanes then reuse; a repo branchier than that draws merged rails */
export type Edge = { from: number; to: number; up?: boolean }

export const MAX_LANES = 8

/**
 * Assign each commit a column, walking the log top-down.
 *
 * `open[i]` is the hash lane `i` is currently waiting for. A commit takes the
 * lane that was waiting for it (or the first free one), then hands that lane to
 * its first parent; extra parents (a merge) claim free lanes and fork the rail.
 *
 * Input must be topo-ordered — `git log --topo-order` — or parents can appear
 * before their children and the lanes cross.
 */
export function lanes(commits: { hash: string; parents: string[] }[]): Row[] {
  const open: (string | null)[] = []
  const rows: Row[] = []

  const free = () => {
    const i = open.indexOf(null)
    if (i !== -1) return i
    if (open.length < MAX_LANES) return open.push(null) - 1
    return MAX_LANES - 1 // out of lanes: share the last one
  }

  for (const c of commits) {
    let lane = open.indexOf(c.hash)
    if (lane === -1) {
      lane = free()
      open[lane] = c.hash
    }
    // A commit can be awaited by several lanes (two children merged it) —
    // collapse the duplicates into this one so they don't draw forever.
    const edges: Edge[] = []
    for (let i = 0; i < open.length; i++) {
      if (i !== lane && open[i] === c.hash) {
        edges.push({ from: i, to: lane, up: true })
        open[i] = null
      }
    }

    const [first, ...rest] = c.parents
    open[lane] = first ?? null
    if (first) edges.push({ from: lane, to: lane })

    for (const p of rest) {
      const existing = open.indexOf(p)
      const to = existing !== -1 ? existing : free()
      open[to] = p
      edges.push({ from: lane, to })
    }

    // Every other still-open lane continues straight down.
    for (let i = 0; i < open.length; i++) {
      if (open[i] && i !== lane && !edges.some((e) => !e.up && e.from === i))
        edges.push({ from: i, to: i })
    }

    rows.push({ lane, edges, width: open.length })
  }

  // Trailing lanes may only appear late; give every row the final max so the
  // rail column doesn't jitter as you scroll.
  const w = rows.reduce((m, r) => Math.max(m, r.width), 1)
  for (const r of rows) r.width = w
  return rows
}
