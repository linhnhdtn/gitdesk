import { useEffect, useRef } from 'react'
import type { GitCmd } from '../../../main/git.ts'

const dur = (ms: number) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`)
const home = (p: string) => p.replace(/^\/home\/[^/]+/, '~')

/**
 * Read-only log of every git command the app ran, fed by the main-process bus.
 * Body only — the surrounding Pane supplies the header and the scroll box.
 * ponytail: display only, no input — a real prompt means a PTY, different scope.
 */
export function Console({ cmds }: { cmds: GitCmd[] }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [cmds.length])

  if (!cmds.length)
    return <div className="p-2 text-muted">No commands yet — every git call shows up here.</div>

  return (
    <div className="select-text p-1 font-mono text-[12px] leading-[1.45]">
      {cmds.map((c) => (
        <div key={c.id} className="px-1">
          <div className="flex gap-2">
            <span className="shrink-0 text-muted">{home(c.cwd)}</span>
            <span className="shrink-0 text-muted">$</span>
            <span className={`min-w-0 flex-1 break-all ${c.ok ? 'text-fg' : 'text-rose-700'}`}>
              git {c.args.join(' ')}
            </span>
            <span className="shrink-0 text-muted">
              {c.ok ? '' : '✗ '}
              {dur(c.ms)}
            </span>
          </div>
          {!c.ok && <pre className="whitespace-pre-wrap pl-4 text-rose-700">{c.err}</pre>}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}
