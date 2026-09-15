import { useMemo } from 'react'
import type { Commit } from '../../../main/git.ts'
import { lanes } from '../../../shared/graph.ts'

const ROW = 22
const LANE = 14
const COLORS = ['#2a6099', '#2e7d32', '#b26a00', '#8e24aa', '#00838f', '#c62828']
const cx = (l: number) => l * LANE + LANE / 2

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

const BADGE: Record<string, string> = {
  head: 'bg-accent text-white',
  local: 'bg-accent/15 text-accent',
  remote: 'bg-ref/15 text-ref',
  tag: 'bg-amber-100 text-amber-800'
}

export function Journal({
  commits,
  sel,
  onSelect
}: {
  commits: Commit[]
  sel: string | null
  onSelect: (sha: string) => void
}) {
  const rows = useMemo(() => lanes(commits), [commits])
  if (!commits.length) return <div className="p-2 text-muted">No commits</div>
  const railW = (rows[0]?.width ?? 1) * LANE

  return (
    <div className="min-w-max">
      {commits.map((c, i) => {
        const row = rows[i]
        // lanes arriving from the row above, so the rail joins up seamlessly
        const incoming = i > 0 ? [...new Set(rows[i - 1].edges.map((e) => e.to))] : []
        return (
          <div
            key={c.hash}
            onClick={() => onSelect(c.hash)}
            style={{ height: ROW }}
            className={`flex cursor-default items-center gap-2 pr-2 ${
              sel === c.hash ? 'bg-sel' : 'hover:bg-panel'
            }`}
          >
            <svg width={railW} height={ROW} className="shrink-0" aria-hidden>
              {incoming
                // a lane that curves into this commit is drawn by its up-edge instead
                .filter((l) => !row.edges.some((e) => e.up && e.from === l))
                .map((l) => (
                  <line
                    key={`i${l}`}
                    x1={cx(l)}
                    y1={0}
                    x2={cx(l)}
                    y2={ROW / 2}
                    stroke={COLORS[l % COLORS.length]}
                    strokeWidth={1.5}
                  />
                ))}
              {row.edges.map((e, k) => (
                <path
                  key={k}
                  d={
                    e.from === e.to
                      ? `M${cx(e.from)},${ROW / 2}V${ROW}`
                      : e.up
                        ? `M${cx(e.from)},0C${cx(e.from)},${ROW * 0.3} ${cx(e.to)},${ROW * 0.2} ${cx(e.to)},${ROW / 2}`
                        : `M${cx(e.from)},${ROW / 2}C${cx(e.from)},${ROW * 0.8} ${cx(e.to)},${ROW * 0.7} ${cx(e.to)},${ROW}`
                  }
                  fill="none"
                  stroke={COLORS[(e.up ? e.from : e.to) % COLORS.length]}
                  strokeWidth={1.5}
                />
              ))}
              <circle
                cx={cx(row.lane)}
                cy={ROW / 2}
                r={3.5}
                fill={c.parents.length > 1 ? COLORS[row.lane % COLORS.length] : '#fff'}
                stroke={COLORS[row.lane % COLORS.length]}
                strokeWidth={1.5}
              />
            </svg>

            {decorations(c.refs).map((d) => (
              <span
                key={d.kind + d.name}
                className={`shrink-0 rounded-sm px-1 text-[11px] leading-[15px] font-medium ${BADGE[d.kind]}`}
              >
                {d.name}
              </span>
            ))}

            <span className="min-w-0 flex-1 truncate">{c.subject}</span>
            <span className="shrink-0 text-muted">{c.author}</span>
            <span className="shrink-0 font-mono text-muted">{c.hash.slice(0, 7)}</span>
            <span className="shrink-0 text-muted">{c.date.slice(0, 16).replace('T', ' ')}</span>
          </div>
        )
      })}
    </div>
  )
}
