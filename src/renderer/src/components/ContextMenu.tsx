import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem = 'sep' | { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  // Flip the menu back inside the window once its real size is known.
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
      ready: true
    })
  }, [x, y])

  useEffect(() => {
    // Capture, so the menu closes even when the click lands on something that
    // stops propagation. But a mousedown INSIDE the menu must be ignored: closing
    // there unmounts the button before its own click event can fire, which makes
    // every item look decorative.
    const down = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return
      onClose()
    }
    const close = () => onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down, true)
    window.addEventListener('wheel', close, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  return (
    <div
      ref={box}
      style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] min-w-52 rounded border border-line bg-panel py-1 shadow-xl"
    >
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="my-1 border-t border-line" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick()
            }}
            className={`block w-full px-4 py-[3px] text-left whitespace-nowrap disabled:opacity-35 ${
              it.disabled ? '' : it.danger ? 'hover:bg-rose-600 hover:text-white' : 'hover:bg-accent hover:text-white'
            }`}
          >
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

/** Electron has no window.prompt, so text input needs a real dialog. */
export function Prompt({
  title,
  label,
  initial = '',
  confirmLabel = 'OK',
  onCancel,
  onOk
}: {
  title: string
  label?: string
  initial?: string
  confirmLabel?: string
  onCancel: () => void
  onOk: (v: string) => void
}) {
  // Uncontrolled on purpose: the DOM node owns the text, React never writes the
  // value back. A controlled input silently eats keystrokes whenever its state
  // fails to round-trip, and it is the usual culprit behind IME composition
  // (Vietnamese Telex, pinyin) being dropped mid-word.
  const box = useRef<HTMLInputElement>(null)
  const [empty, setEmpty] = useState(!initial.trim())

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-6" onClick={onCancel}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          const v = box.current?.value.trim()
          if (v) onOk(v)
        }}
        className="w-[460px] max-w-full rounded border border-line bg-panel shadow-2xl"
      >
        <div className="border-b border-line px-3 py-1.5 text-center font-semibold">{title}</div>
        <div className="p-4">
          {label && <label className="mb-1 block text-muted">{label}</label>}
          <input
            ref={box}
            autoFocus
            defaultValue={initial}
            // only tracks whether the field is blank, for the submit button
            onInput={(e) => setEmpty(!e.currentTarget.value.trim())}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
          />
        </div>
        <div className="flex justify-end gap-2 px-4 pb-3">
          <button type="button" onClick={onCancel} className="rounded border border-line bg-bg px-4 py-1 hover:border-accent">
            Cancel
          </button>
          <button
            type="submit"
            disabled={empty}
            className="rounded border border-line bg-bg px-4 py-1 hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
