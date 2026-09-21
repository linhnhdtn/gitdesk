import { useCallback, useEffect, useRef } from 'react'

/** Drag handle between two panes. Shared by all four splitters. */
export function Split({
  dir,
  value,
  onChange,
  min = 120,
  max = 900,
  /** -1 when the pane being sized sits on the far side of the handle */
  sign = 1
}: {
  dir: 'x' | 'y'
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  sign?: 1 | -1
}) {
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const down = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const start = dir === 'x' ? e.clientX : e.clientY
      const base = value
      let pending = value

      const move = (ev: PointerEvent) => {
        const now = dir === 'x' ? ev.clientX : ev.clientY
        pending = Math.min(max, Math.max(min, base + (now - start) * sign))
        // Coalesce to one update per frame. A pointer reports far more often
        // than the screen refreshes, and each update re-renders every pane.
        if (raf.current) return
        raf.current = requestAnimationFrame(() => {
          raf.current = 0
          onChange(pending)
        })
      }
      const up = () => {
        cancelAnimationFrame(raf.current)
        raf.current = 0
        onChange(pending) // whatever the last frame missed
        el.releasePointerCapture(e.pointerId)
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    },
    [dir, value, onChange, min, max, sign]
  )

  // The visible line never changes size: a hover that grew the handle relaid
  // out both panes and made the bar jump away from the pointer. The grab area
  // is widened with a pseudo-element instead, which costs no layout.
  return (
    <div
      onPointerDown={down}
      className={`relative shrink-0 bg-line transition-colors hover:bg-accent before:absolute before:content-[''] ${
        dir === 'x'
          ? 'w-px cursor-col-resize before:inset-y-0 before:-inset-x-[3px]'
          : 'h-px cursor-row-resize before:inset-x-0 before:-inset-y-[3px]'
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
