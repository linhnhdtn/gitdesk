import { useEffect } from 'react'
import { Icon } from './Icons.tsx'
import type { GitCmd } from '../../../main/git.ts'

/**
 * A failed git command, shown where it cannot be missed.
 *
 * It used to be a strip under the toolbar, which is easy to scroll past and
 * easy to mistake for part of the layout. The command that failed is shown with
 * it: "would be overwritten by checkout" means little until you know which
 * checkout.
 */
export function ErrorDialog({
  message,
  cmd,
  onCopy,
  onClose
}: {
  message: string
  /** the command that produced it, when the console caught one */
  cmd?: GitCmd
  onCopy: (text: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const full = cmd ? `git ${cmd.args.join(' ')}\n\n${message}` : message

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-[660px] max-w-full flex-col rounded-xl border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-center rounded-t-xl border-b border-line px-3 py-1.5">
          <span className="flex-1 text-center font-semibold">Git Error</span>
          <button onClick={onClose} className="rounded px-2 hover:bg-line" title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="flex shrink-0 items-start gap-3 px-4 pt-4 pb-2">
          <Icon name="error" size={30} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">The command did not complete</div>
            {cmd && (
              <div className="mt-1 truncate font-mono text-[13px] text-muted" title={`git ${cmd.args.join(' ')}`}>
                git {cmd.args.join(' ')}
              </div>
            )}
          </div>
        </div>

        <pre className="mx-4 min-h-0 flex-1 overflow-auto rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 font-mono text-[13px] whitespace-pre-wrap text-rose-700">
          {message}
        </pre>

        <div className="flex shrink-0 justify-end gap-2 px-4 py-3">
          <button
            onClick={() => onCopy(full)}
            className="rounded-md border border-line bg-bg px-4 py-1 hover:border-accent hover:text-accent"
          >
            Copy
          </button>
          <button
            autoFocus
            onClick={onClose}
            className="rounded-md border border-line bg-bg px-4 py-1 hover:border-accent hover:text-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
