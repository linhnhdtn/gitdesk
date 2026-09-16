import type { FileStatus } from '../../../main/git.ts'
import { FileIcon } from './Icons.tsx'
import { category, state } from '../../../shared/filestate.ts'

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export function Files({
  files,
  sel,
  onSelect,
  onCompare,
  onMenu
}: {
  files: FileStatus[]
  sel: Set<string>
  /** ctrl/meta held -> extend the selection instead of replacing it */
  onSelect: (path: string, extend: boolean) => void
  onCompare: (f: FileStatus) => void
  onMenu: (f: FileStatus, x: number, y: number) => void
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
              onDoubleClick={() => onCompare(f)}
              onContextMenu={(e) => {
                e.preventDefault()
                // right-clicking outside the selection acts on that row instead
                if (!sel.has(f.path)) onSelect(f.path, false)
                onMenu(f, e.clientX, e.clientY)
              }}
              title={`${f.origPath ? `${f.origPath} → ` : ''}${f.path}\nDouble-click to compare`}
              className={`cursor-default ${on ? 'bg-sel' : 'hover:bg-panel'}`}
            >
              <Td className={conflict ? 'text-rose-700' : ''}>
                <span className="flex items-center gap-1.5">
                  <FileIcon category={category(f)} />
                  <span className="truncate">{base(f.path)}</span>
                </span>
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
