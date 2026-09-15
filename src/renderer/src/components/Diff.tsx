/** Unified diff renderer. Colours lines by prefix — no parser needed for a read-only view. */
export function Diff({ text }: { text: string }) {
  if (!text.trim()) return <Empty>No changes to show</Empty>

  return (
    <pre className="h-full overflow-auto font-mono text-[12px] leading-[1.45]">
      {text.split('\n').map((line, i) => {
        const c = line[0]
        const cls =
          line.startsWith('+++') || line.startsWith('---')
            ? 'text-muted'
            : line.startsWith('@@')
              ? 'bg-accent/10 text-accent'
              : c === '+'
                ? 'bg-emerald-500/12 text-emerald-300'
                : c === '-'
                  ? 'bg-rose-500/12 text-rose-300'
                  : c === '\\'
                    ? 'text-muted'
                    : 'text-fg/80'
        return (
          <div key={i} className={`px-3 whitespace-pre-wrap break-all ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-muted">{children}</div>
}
