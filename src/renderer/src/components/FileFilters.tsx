import { Icon, C } from './Icons.tsx'
import type { Category } from '../../../shared/filestate.ts'

export const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'modified', label: 'modified files', color: C.red },
  { key: 'added', label: 'new files', color: C.blue },
  { key: 'deleted', label: 'deleted files', color: C.grey },
  { key: 'renamed', label: 'renamed files', color: C.green },
  { key: 'conflict', label: 'conflicting files', color: C.orange }
]

export const CATEGORY_COLOR = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.color])) as Record<
  Category,
  string
>

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
            <Icon name="file" color={c.color} size={14} />
          </button>
        )
      })}
    </div>
  )
}
