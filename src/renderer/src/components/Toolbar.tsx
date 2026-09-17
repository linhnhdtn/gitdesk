import { Icon, type ToolbarIcon } from './Icons.tsx'

/** SmartGit's icon strip. Each group is separated by a rule. */
export function Toolbar({ groups }: { groups: Item[][] }) {
  return (
    <div className="flex h-12 shrink-0 items-stretch gap-1 border-b border-line bg-panel px-2">
      {groups.map((g, i) => (
        <div key={i} className="flex items-stretch gap-0.5">
          {i > 0 && <div className="mx-1 my-2 w-px bg-line" />}
          {g.map((it) => (
            <ToolBtn key={it.label} {...it} />
          ))}
        </div>
      ))}
    </div>
  )
}

export type Item = {
  label: string
  icon: ToolbarIcon
  onClick: () => void
  disabled?: boolean
  title?: string
  badge?: string | number
  active?: boolean
}

function ToolBtn({ label, icon, onClick, disabled, title, badge, active }: Item) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`relative flex w-[58px] flex-col items-center justify-center gap-0.5 rounded px-1 py-1 leading-tight hover:bg-line disabled:cursor-default disabled:opacity-35 disabled:grayscale disabled:hover:bg-transparent ${
        active ? 'bg-line' : ''
      }`}
    >
      <Icon name={icon} size={22} />
      <span className="w-full truncate text-[12px]">{label}</span>
      {badge != null && badge !== 0 && (
        <span className="absolute top-0.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  )
}
