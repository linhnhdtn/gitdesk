import { Icon } from './Icons.tsx'

export type Brief = { cwd: string; name: string; branch: string; dirty: boolean }

export function Repositories({
  repos,
  briefs,
  cwd,
  onPick,
  onRemove
}: {
  repos: string[]
  briefs: Record<string, Brief>
  cwd: string | null
  onPick: (p: string) => void
  onRemove: (p: string) => void
}) {
  if (!repos.length)
    return <div className="p-2 text-muted">No repositories yet — use + to add one.</div>

  return (
    <div>
      {repos.map((p) => {
        const b = briefs[p]
        const active = p === cwd
        return (
          <div
            key={p}
            onClick={() => onPick(p)}
            title={p}
            className={`group flex cursor-default items-center gap-1.5 px-2 py-[3px] ${
              active ? 'bg-sel' : 'hover:bg-panel'
            }`}
          >
            <Icon name="repo" size={14} />
            <span className={`truncate ${active ? 'font-semibold' : ''}`}>
              {b?.name ?? p.split('/').pop()}
            </span>
            {b && <span className="shrink-0 text-muted">({b.branch})</span>}
            {b?.dirty && <span className="shrink-0 text-amber-600" title="Uncommitted changes">●</span>}
            <button
              onClick={(e) => (e.stopPropagation(), onRemove(p))}
              title="Remove from list (does not delete anything)"
              className="ml-auto shrink-0 rounded px-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-line hover:text-fg"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
