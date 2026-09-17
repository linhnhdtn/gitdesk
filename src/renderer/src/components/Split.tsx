import { useCallback } from 'react'

/** Drag handle between two panes. Shared by all four splitters. */
export function Split({
  dir,
  value,
  onChange,
  min = 120,
  max = 900
}: {
  dir: 'x' | 'y'
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}) {
  const down = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const start = dir === 'x' ? e.clientX : e.clientY
      const base = value
      const move = (ev: PointerEvent) => {
        const now = dir === 'x' ? ev.clientX : ev.clientY
        onChange(Math.min(max, Math.max(min, base + (now - start))))
      }
      const up = () => {
        el.releasePointerCapture(e.pointerId)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    },
    [dir, value, onChange, min, max]
  )

  return (
    <div
      onPointerDown={down}
      className={`shrink-0 bg-line hover:bg-accent ${
        dir === 'x' ? 'w-px cursor-col-resize hover:w-[3px]' : 'h-px cursor-row-resize hover:h-[3px]'
      }`}
    />
  )
}

/** Pane chrome: the grey title strip SmartGit puts above every list. */
export function Pane({
  title,
  right,
  children,
  className = ''
}: {
  title: React.ReactNode
  right?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`flex min-h-0 min-w-0 flex-col ${className}`}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <span className="truncate font-medium">{title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">{right}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg">{children}</div>
    </section>
  )
}
