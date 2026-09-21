import { Icon } from './Icons.tsx'

export type Brief = { cwd: string; name: string; branch: string; dirty: boolean }

export function Repositories({
  repos,
  briefs,
  cwd,
  labels,
  onPick,
  onMenu
}: {
  repos: string[]
  briefs: Record<string, Brief>
  cwd: string | null
  /** user-set names, for telling two clones of the same folder apart */
  labels: Record<string, string>
  onPick: (p: string) => void
  onMenu: (path: string, x: number, y: number) => void
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
            onContextMenu={(e) => {
              e.preventDefault()
              onPick(p)
              onMenu(p, e.clientX, e.clientY)
            }}
            title={p}
            className={`flex cursor-default items-center gap-1.5 px-2 py-[3px] whitespace-nowrap ${
              active ? 'bg-sel' : 'hover:bg-panel'
            }`}
          >
            <Icon name="repo" size={14} />
            {/* nothing here truncates: the name identifies the row, so cutting
                it is the one thing that must not happen. Widen the pane and
                more comes into view. */}
            <span className={active ? 'font-semibold' : ''}>
              {b?.name ?? p.split('/').pop()}
              {labels[p] && <span className="font-normal"> - {labels[p]}</span>}
            </span>
            {b && <span className="text-muted">({b.branch})</span>}
            {b?.dirty && <span className="text-amber-600" title="Uncommitted changes">●</span>}
          </div>
        )
      })}
    </div>
  )
}
