import { useState } from 'react'
import type { Ref, Stash } from '../../../main/git.ts'
import { Icon, C, type ListIcon } from './Icons.tsx'

type Props = {
  refs: Ref[]
  stashes: Stash[]
  onMenu: (r: Ref, x: number, y: number) => void
  onStashMenu: (s: Stash, x: number, y: number) => void
  onCheckout: (ref: string) => void
}

export function Branches({ refs, stashes, onMenu, onStashMenu, onCheckout }: Props) {
  const menu = (r: Ref) => (e: React.MouseEvent) => {
    e.preventDefault()
    onMenu(r, e.clientX, e.clientY)
  }
  const local = refs.filter((r) => r.kind === 'local')
  const tags = refs.filter((r) => r.kind === 'tag')
  const remotes = [...new Set(refs.filter((r) => r.kind === 'remote').map((r) => r.remote))].sort()

  return (
    <div className="py-0.5">
      <Node title="Local" count={local.length} open>
        {local.map((r) => (
          <Row
            key={r.name}
            icon={r.current ? 'head' : 'branch'}
            color={r.current ? C.green : undefined}
            active={r.current}
            onContextMenu={menu(r)}
            onDoubleClick={() => !r.current && onCheckout(r.name)}
            title={r.current ? `${r.name} is checked out` : `Double-click to check out ${r.name}`}
          >
            <span className={r.current ? 'font-semibold text-accent' : ''}>{r.name}</span>
            {r.upstream && <span className="text-muted"> = {r.upstream}</span>}
          </Row>
        ))}
      </Node>

      {remotes.map((rm) => {
        const list = refs.filter((r) => r.kind === 'remote' && r.remote === rm)
        return (
          <Node key={rm} title={rm} count={list.length}>
            {list.map((r) => (
              <Row
                key={r.name}
                icon="remote"
                onContextMenu={menu(r)}
                onDoubleClick={() => onCheckout(r.name.slice(rm.length + 1))}
                title={`Double-click to check out ${r.name}`}
              >
                {r.name.slice(rm.length + 1)}
              </Row>
            ))}
          </Node>
        )
      })}

      {!!tags.length && (
        <Node title="Tags" count={tags.length}>
          {tags.map((r) => (
            <Row key={r.name} icon="tag" color={C.orange} onContextMenu={menu(r)} onDoubleClick={() => onCheckout(r.name)}>
              <span className="text-ref">{r.name}</span>
            </Row>
          ))}
        </Node>
      )}

      {/* open by default: a stash you cannot see is a stash you forget */}
      <Node title="Stashes" count={stashes.length} open>
        {stashes.map((s) => (
          <Row
            key={s.ref}
            icon="drawer"
            onContextMenu={(e) => {
              e.preventDefault()
              onStashMenu(s, e.clientX, e.clientY)
            }}
            title={`${s.subject}${s.date ? `\n${s.date.slice(0, 16).replace('T', ' ')}` : ''}\nRight-click for actions`}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              {/* the title is what the user typed, so it gets the room; the
                  branch gives way first and the date lives in the tooltip */}
              <span className="min-w-0 flex-1 truncate">{s.message}</span>
              <span className="min-w-0 shrink truncate text-[12px] text-muted">{s.branch}</span>
            </span>
          </Row>
        ))}
      </Node>
    </div>
  )
}

function Node({
  title,
  count,
  open: initial = false,
  children
}: {
  title: string
  count: number
  open?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(initial)
  return (
    <div>
      <div
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-default items-center gap-1 px-2 py-[3px] font-medium hover:bg-panel"
      >
        <span className="w-3 shrink-0 text-muted">{open ? '▾' : '▸'}</span>
        {title}
        {!!count && <span className="text-muted">({count})</span>}
      </div>
      {open && <div>{children}</div>}
    </div>
  )
}

function Row({
  children,
  icon,
  color,
  active,
  ...p
}: React.HTMLAttributes<HTMLDivElement> & {
  icon: ListIcon
  color?: string
  /** the checked-out branch, tinted so it is findable in a long list */
  active?: boolean
}) {
  return (
    <div
      {...p}
      className={`flex cursor-default items-center gap-1.5 py-[3px] pr-2 pl-6 ${
        active ? 'bg-accent/10' : 'hover:bg-panel'
      }`}
    >
      <Icon name={icon} color={color} size={13} className={active ? '' : 'opacity-80'} />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}
