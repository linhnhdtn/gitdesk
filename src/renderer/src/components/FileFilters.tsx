import { FileIcon } from './Icons.tsx'
import type { Category } from '../../../shared/filestate.ts'

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'modified', label: 'modified files' },
  { key: 'added', label: 'new files' },
  { key: 'deleted', label: 'deleted files' },
  { key: 'renamed', label: 'renamed files' },
  { key: 'conflict', label: 'conflicting files' }
]

/** One small toggle per file category, the way SmartGit gates its Files list. */
export function FileFilters({
  hidden,
  counts,
  onToggle
}: {
  hidden: Set<Category>
  counts: Record<Category, number>
  onToggle: (c: Category) => void
}) {
  return (
    <div className="flex items-center overflow-hidden rounded border border-line">
      {CATEGORIES.map((c) => {
        const on = !hidden.has(c.key)
        return (
          <button
            key={c.key}
            onClick={() => onToggle(c.key)}
            title={`${on ? 'Hide' : 'Show'} ${c.label} (${counts[c.key]})`}
            aria-pressed={on}
            className={`border-r border-line px-1 py-0.5 last:border-r-0 ${
              on ? 'bg-bg hover:bg-line' : 'bg-panel opacity-35 grayscale hover:opacity-70'
            }`}
          >
            <FileIcon category={c.key} size={14} />
          </button>
        )
      })}
    </div>
  )
}
