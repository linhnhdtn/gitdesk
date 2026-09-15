/**
 * Inline SVG icon set. No asset files and no dependency: the glyphs are simple
 * enough that paths cost less than a sprite sheet, and they inherit currentColor
 * so hover and disabled states come for free.
 */

export const C = {
  green: '#3d8b40',
  orange: '#d98324',
  blue: '#3b7dd8',
  red: '#c0504d',
  grey: '#8a8f96',
  tan: '#a98b55'
}

// ── 24x24 toolbar glyphs ───────────────────────────────────────────────
const TOOLBAR: Record<string, React.ReactNode> = {
  pull: (
    <>
      <path d="M12 3.5v9.5" stroke={C.green} />
      <path d="M8 9.5l4 4 4-4" stroke={C.green} />
      <path d="M4.5 18.5h15" stroke={C.green} />
    </>
  ),
  push: (
    <>
      <path d="M12 20.5V11" stroke={C.orange} />
      <path d="M8 14.5l4-4 4 4" stroke={C.orange} />
      <path d="M4.5 5.5h15" stroke={C.orange} />
    </>
  ),
  fetch: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" stroke={C.blue} />
      <path d="M20.5 3.5v5h-5" stroke={C.blue} />
    </>
  ),
  commit: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7.5h8M8 11h5" />
      <path d="M8.5 16l2.5 2.5 5-5.5" stroke={C.green} strokeWidth="2.2" />
    </>
  ),
  stage: (
    <>
      <path d="M12 2.5v9.5" stroke={C.green} />
      <path d="M8.5 8.5l3.5 3.5 3.5-3.5" stroke={C.green} />
      <path d="M4 17h16M4 20.5h16" />
    </>
  ),
  unstage: (
    <>
      <path d="M12 12V2.5" />
      <path d="M8.5 6l3.5-3.5L15.5 6" />
      <path d="M4 17h16M4 20.5h16" />
    </>
  ),
  discard: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" stroke={C.red} />
      <path d="M3.5 3.5v5h5" stroke={C.red} />
    </>
  ),
  stash: (
    <>
      <rect x="3.5" y="13" width="17" height="8" rx="1.5" />
      <path d="M7.5 17h9" />
      <path d="M12 2v8.5M8.5 7l3.5 3.5L15.5 7" stroke={C.green} />
    </>
  ),
  apply: (
    <>
      <rect x="3.5" y="13" width="17" height="8" rx="1.5" />
      <path d="M7.5 17h9" />
      <path d="M12 10.5V2M8.5 5.5L12 2l3.5 3.5" stroke={C.orange} />
    </>
  ),
  console: (
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="2" />
      <path d="M6.5 9.5l3 2.5-3 2.5M12.5 15h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4L5.3 5.3" />
    </>
  )
}

// ── 16x16 list glyphs ──────────────────────────────────────────────────
const LIST: Record<string, React.ReactNode> = {
  /** a page with a folded corner — colour carries the file's state */
  file: (
    <>
      <path d="M3.5 1.5h5.5l3.5 3.5v9.5h-9z" fill="#fff" />
      <path d="M9 1.5v3.5h3.5" />
      <path d="M5.5 8.5h5M5.5 11h5" opacity="0.5" />
    </>
  ),
  repo: (
    <>
      <ellipse cx="8" cy="3.9" rx="5.4" ry="2" fill="#f3e7cf" stroke={C.tan} />
      <path d="M2.6 3.9v8.2c0 1.1 2.4 2 5.4 2s5.4-.9 5.4-2V3.9" stroke={C.tan} />
      <path d="M13.4 8c0 1.1-2.4 2-5.4 2s-5.4-.9-5.4-2" stroke={C.tan} />
    </>
  ),
  branch: (
    <>
      <circle cx="4.5" cy="3.4" r="1.7" />
      <circle cx="4.5" cy="12.6" r="1.7" />
      <circle cx="11.5" cy="6.2" r="1.7" />
      <path d="M4.5 5.1v5.8M4.5 9.5h3.5a3.3 3.3 0 0 0 3.5-1.8" />
    </>
  ),
  remote: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2.2 2.6 2.2 9.4 0 12M8 2C5.8 4.6 5.8 11.4 8 14" opacity="0.7" />
    </>
  ),
  tag: (
    <>
      <path d="M1.8 7.6V2.3h5.3l7 7-5.3 5.3z" />
      <circle cx="4.6" cy="5.1" r="1" />
    </>
  ),
  drawer: (
    <>
      <rect x="1.8" y="3.6" width="12.4" height="9" rx="1" />
      <path d="M1.8 8.1h12.4" />
      <path d="M6.6 5.9h2.8M6.6 10.3h2.8" opacity="0.7" />
    </>
  )
}

export type ToolbarIcon = keyof typeof TOOLBAR
export type ListIcon = keyof typeof LIST

export function Icon({
  name,
  color,
  size,
  className = ''
}: {
  name: ToolbarIcon | ListIcon
  /** overrides currentColor — used for the per-state file glyphs */
  color?: string
  size?: number
  className?: string
}) {
  const big = name in TOOLBAR
  const box = big ? 24 : 16
  return (
    <svg
      width={size ?? box}
      height={size ?? box}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={big ? 1.7 : 1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {big ? TOOLBAR[name] : LIST[name]}
    </svg>
  )
}
