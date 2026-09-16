import type { FileStatus } from '../main/git.ts'

/**
 * Presentation of a porcelain-v2 entry. Kept here, away from the components,
 * because the mapping from x/y codes to words is fiddly enough to want a test.
 */

export type Category = 'conflict' | 'deleted' | 'renamed' | 'added' | 'modified'

/**
 * Exactly ONE bucket per file, so the visibility toggles can't contradict each
 * other. Checked in priority order: a file staged as new and then edited again
 * is still "added", not "modified" — hiding new files must hide it.
 */
export function category(f: FileStatus): Category {
  if (f.kind === 'unmerged') return 'conflict'
  if (f.kind === 'untracked') return 'added'
  if (f.x === 'D' || f.y === 'D') return 'deleted'
  if (f.kind === 'renamed') return 'renamed'
  if (f.x === 'A') return 'added'
  return 'modified'
}

const WORD: Record<string, string> = {
  M: 'Modified',
  T: 'Type Changed',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Conflict'
}

/**
 * The words SmartGit puts in its State column.
 *
 * `history` = the entry came from a past commit, where the index/worktree split
 * has no meaning: it is plainly "Modified", never "Staged Modified".
 */
export function state(f: FileStatus, history = false): string {
  if (history) return WORD[f.x] ?? f.x
  if (f.kind === 'untracked') return 'Untracked'
  if (f.kind === 'ignored') return 'Ignored'
  if (f.kind === 'unmerged') return 'Conflict'
  const parts: string[] = []
  if (f.x !== '.') parts.push(`Staged ${WORD[f.x] ?? f.x}`)
  if (f.y !== '.') parts.push(WORD[f.y] ?? f.y)
  return parts.join(', ') || 'Unchanged'
}

/**
 * Staged means "recorded in the index and ready to commit". An unmerged entry
 * carries index codes too (U/A/D), but git refuses to commit while it is
 * conflicted — so it is not staged, it is blocked.
 */
export const isStaged = (f: FileStatus) =>
  f.kind !== 'unmerged' && f.x !== '.' && f.x !== '?' && f.x !== '!'

export function counts(files: FileStatus[]): Record<Category, number> {
  const out: Record<Category, number> = { conflict: 0, deleted: 0, renamed: 0, added: 0, modified: 0 }
  for (const f of files) out[category(f)]++
  return out
}
