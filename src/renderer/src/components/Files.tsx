import type { FileStatus } from '../../../main/git.ts'

/** porcelain-v2 x/y codes -> the words SmartGit puts in its State column. */
const WORD: Record<string, string> = {
  M: 'Modified',
  T: 'Type Changed',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Conflict'
}

export function state(f: FileStatus): string {
  if (f.kind === 'untracked') return 'Untracked'
  if (f.kind === 'ignored') return 'Ignored'
  if (f.kind === 'unmerged') return 'Conflict'
  const parts: string[] = []
  if (f.x !== '.') parts.push(`Staged ${WORD[f.x] ?? f.x}`)
  if (f.y !== '.') parts.push(WORD[f.y] ?? f.y)
  return parts.join(', ') || 'Unchanged'
}

export const isStaged = (f: FileStatus) => f.x !== '.' && f.x !== '?' && f.x !== '!'
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function Files({
  files,
  sel,
  onSelect
}: {
  files: FileStatus[]
  sel: Set<string>
  /** ctrl/meta held -> extend the selection instead of replacing it */
  onSelect: (path: string, extend: boolean) => void
}) {
  if (!files.length) return <div className="p-2 text-muted">Working tree clean</div>

  return (
    <table className="w-full table-fixed border-collapse">
      <thead className="sticky top-0 z-10">
        <tr className="bg-panel text-left text-muted">
          <Th className="w-[40%]">Name</Th>
          <Th className="w-[22%]">State</Th>
          <Th>Relative Directory</Th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => {
          const on = sel.has(f.path)
          const conflict = f.kind === 'unmerged'
          return (
            <tr
              key={f.path}
              onClick={(e) => onSelect(f.path, e.ctrlKey || e.metaKey)}
              title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
              className={`cursor-default ${on ? 'bg-sel' : 'hover:bg-panel'}`}
            >
              <Td className={conflict ? 'text-rose-700' : ''}>
                <span className="mr-1">{isStaged(f) ? '✓' : f.kind === 'untracked' ? '?' : '•'}</span>
                {base(f.path)}
              </Td>
              <Td className={conflict ? 'font-medium text-rose-700' : 'text-muted'}>{state(f)}</Td>
              <Td className="text-muted">{dir(f.path)}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const Th = ({ className = '', children }: { className?: string; children: React.ReactNode }) => (
  <th className={`truncate border-b border-line px-2 py-1 font-medium ${className}`}>{children}</th>
)
const Td = ({ className = '', children }: { className?: string; children: React.ReactNode }) => (
  <td className={`truncate px-2 py-[2px] ${className}`}>{children}</td>
)
