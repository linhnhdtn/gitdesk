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
    // w-max so rows keep their natural width and the pane scrolls to reach the
    // rest; min-w-full so a short row's highlight still spans the whole pane
    <div className="w-max min-w-full">
      {repos.map((p) => {
        const b = briefs[p]
        const active = p === cwd
        return (
          <div
            key={p}
            onClick={() => onPick(p)}
            title={p}
            className={`group flex cursor-default items-center gap-1.5 px-2 py-[3px] whitespace-nowrap ${
              active ? 'bg-sel' : 'hover:bg-panel'
            }`}
          >
            <Icon name="repo" size={14} />
            {/* nothing here truncates: the name identifies the row, so cutting
                it is the one thing that must not happen. Widen the pane and
                more comes into view. */}
            <span className={active ? 'font-semibold' : ''}>{b?.name ?? p.split('/').pop()}</span>
            {b && <span className="text-muted">({b.branch})</span>}
            {b?.dirty && <span className="text-amber-600" title="Uncommitted changes">●</span>}
            <button
              onClick={(e) => (e.stopPropagation(), onRemove(p))}
              title="Remove from list (does not delete anything)"
              // sticky, so it stays reachable on a row wider than the pane —
              // it is the only way to drop a repository
              className={`sticky right-0 ml-auto rounded px-1 pl-1.5 text-muted opacity-0 group-hover:opacity-100 hover:text-rose-700 ${
                active ? 'bg-sel' : 'bg-bg group-hover:bg-panel'
              }`}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
