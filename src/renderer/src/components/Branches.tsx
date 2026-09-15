import { useState } from 'react'
import type { Ref, Stash } from '../../../main/git.ts'

type Props = {
  refs: Ref[]
  stashes: Stash[]
  onCheckout: (ref: string) => void
  onStashApply: (ref: string) => void
  onStashDrop: (ref: string) => void
}

export function Branches({ refs, stashes, onCheckout, onStashApply, onStashDrop }: Props) {
  const local = refs.filter((r) => r.kind === 'local')
  const tags = refs.filter((r) => r.kind === 'tag')
  const remotes = [...new Set(refs.filter((r) => r.kind === 'remote').map((r) => r.remote))].sort()

  return (
    <div className="py-0.5">
      <Node title="Local" count={local.length} open>
        {local.map((r) => (
          <Row
            key={r.name}
            onDoubleClick={() => !r.current && onCheckout(r.name)}
            title={`Double-click to check out ${r.name}`}
          >
            <span className={r.current ? 'font-semibold text-accent' : ''}>
              {r.current && '▶ '}
              {r.name}
            </span>
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
            <Row key={r.name} onDoubleClick={() => onCheckout(r.name)}>
              <span className="text-ref">{r.name}</span>
            </Row>
          ))}
        </Node>
      )}

      <Node title="Stashes" count={stashes.length}>
        {stashes.map((s) => (
          <Row key={s.ref} onDoubleClick={() => onStashApply(s.ref)} title="Double-click to apply">
            <span className="text-muted">{s.ref}</span> {s.subject}
            <button
              onClick={(e) => (e.stopPropagation(), onStashDrop(s.ref))}
              className="ml-1 rounded px-1 text-muted hover:bg-line hover:text-rose-700"
              title="Drop stash"
            >
              ✕
            </button>
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

function Row({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...p} className="cursor-default truncate py-[2px] pr-2 pl-7 hover:bg-panel">
      {children}
    </div>
  )
}
