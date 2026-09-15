import { useRef } from 'react'

/**
 * Tab strip the user can drag into any order. Native HTML5 drag and drop, no
 * library: the reorder happens on dragEnter, so the strip itself previews where
 * the tab will land and no separate drop indicator is needed.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  onReorder,
  label
}: {
  tabs: T[]
  active: T
  onSelect: (t: T) => void
  onReorder: (t: T[]) => void
  label?: (t: T) => React.ReactNode
}) {
  const from = useRef<number | null>(null)

  return (
    <div className="-mx-2 flex">
      {tabs.map((t, i) => (
        <button
          key={t}
          draggable
          onClick={() => onSelect(t)}
          onDragStart={(e) => {
            from.current = i
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnter={() => {
            const f = from.current
            if (f === null || f === i) return
            const next = [...tabs]
            next.splice(i, 0, ...next.splice(f, 1))
            from.current = i // the dragged tab now lives here
            onReorder(next)
          }}
          onDragOver={(e) => e.preventDefault()} // without this the drop is rejected
          onDragEnd={() => (from.current = null)}
          title="Drag to reorder"
          className={`px-3 whitespace-nowrap capitalize ${
            active === t ? 'border-b-2 border-accent font-semibold' : 'text-muted hover:text-fg'
          }`}
        >
          {label ? label(t) : t}
        </button>
      ))}
    </div>
  )
}
