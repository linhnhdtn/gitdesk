import type { Commit } from '../../../main/git.ts'

const ROW = 25

/** Split `%D` — "HEAD -> main, origin/main, tag: v1" — into drawable badges. */
export function decorations(refs: string) {
  return refs
    .split(', ')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith('tag: ')) return { kind: 'tag' as const, name: r.slice(5) }
      if (r.startsWith('HEAD -> ')) return { kind: 'head' as const, name: r.slice(8) }
      if (r === 'HEAD') return { kind: 'head' as const, name: 'HEAD' }
      return { kind: r.includes('/') ? ('remote' as const) : ('local' as const), name: r }
    })
}

export const BADGE: Record<string, string> = {
  head: 'bg-accent text-white',
  local: 'bg-accent/15 text-accent',
  remote: 'bg-ref/15 text-ref',
  tag: 'bg-amber-100 text-amber-800'
}

function Rows({
  commits,
  sel,
  onSelect,
  empty
}: {
  commits: Commit[]
  sel: string | null
  onSelect: (sha: string) => void
  empty: string
}) {
  if (!commits.length) return <div className="p-2 text-muted">{empty}</div>
  return (
    <div className="min-w-max">
      {commits.map((c) => (
        <div
          key={c.hash}
          onClick={() => onSelect(c.hash)}
          style={{ height: ROW }}
          className={`flex cursor-default items-center gap-2 pr-2 ${
            sel === c.hash ? 'bg-sel' : 'hover:bg-panel'
          }`}
        >
          <span
            className="ml-2 shrink-0 text-[10px] text-accent"
            title={c.parents.length > 1 ? 'Merge commit' : 'Commit'}
          >
            {c.parents.length > 1 ? '◆' : '○'}
          </span>

          {decorations(c.refs).map((d) => (
            <span
              key={d.kind + d.name}
              className={`shrink-0 rounded-sm px-1.5 text-[12px] leading-[17px] font-medium ${BADGE[d.kind]}`}
            >
              {d.name}
            </span>
          ))}

          <span className="min-w-0 flex-1 truncate">{c.subject}</span>
          <span className="shrink-0 text-muted">{c.author}</span>
          <span className="shrink-0 font-mono text-muted">{c.hash.slice(0, 7)}</span>
          <span className="shrink-0 text-muted">{c.date.slice(0, 16).replace('T', ' ')}</span>
        </div>
      ))}
    </div>
  )
}

const Head = ({ text, n }: { text: string; n: number }) => (
  <div className="sticky top-0 z-10 flex shrink-0 gap-1.5 border-b border-line bg-panel px-2 py-0.5 text-[12px] font-medium text-muted">
    {text} <span>({n})</span>
  </div>
)

/**
 * The branch's own line: --first-parent, so a merge counts as one step and the
 * commits it brought in are skipped. The header says so, otherwise the missing
 * commits look like a bug — the full log is in the commit window's graph.
 */
export function Journal({
  main,
  sel,
  onSelect
}: {
  main: Commit[]
  sel: string | null
  onSelect: (sha: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Head text="Branch line" n={main.length} />
      <div className="min-h-0 flex-1 overflow-auto">
        <Rows commits={main} sel={sel} onSelect={onSelect} empty="No commits" />
      </div>
    </div>
  )
}
