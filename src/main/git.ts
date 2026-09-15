import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** Raw git call. Returns stdout. Throws with stderr on non-zero exit. */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      // ponytail: no locale/pager surprises; add GIT_ASKPASS here if auth prompts show up
      env: { ...process.env, LC_ALL: 'C', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' }
    })
    return stdout
  } catch (e: any) {
    throw new Error(e.stderr?.trim() || e.message)
  }
}

export type FileStatus = {
  path: string
  origPath?: string
  /** index (staged) state: '.' unmodified, M A D R C */
  x: string
  /** worktree state */
  y: string
  kind: 'ordinary' | 'renamed' | 'unmerged' | 'untracked' | 'ignored'
}

export type RepoStatus = {
  branch: string
  upstream?: string
  ahead: number
  behind: number
  files: FileStatus[]
}

/**
 * Parse `git status --porcelain=v2 -z --branch -uall`.
 * -z means NUL-separated records AND, for rename entries ('2'), the original
 * path arrives as its own following record instead of being tab-separated.
 */
export function parseStatusV2(raw: string): RepoStatus {
  const rec = raw.split('\0').filter((r) => r.length > 0)
  const out: RepoStatus = { branch: '(detached)', ahead: 0, behind: 0, files: [] }

  for (let i = 0; i < rec.length; i++) {
    const line = rec[i]
    const tag = line[0]

    if (tag === '#') {
      const [, key, ...rest] = line.split(' ')
      const val = rest.join(' ')
      if (key === 'branch.head') out.branch = val
      else if (key === 'branch.upstream') out.upstream = val
      else if (key === 'branch.ab') {
        for (const part of val.split(' ')) {
          if (part.startsWith('+')) out.ahead = Number(part.slice(1))
          else if (part.startsWith('-')) out.behind = Number(part.slice(1))
        }
      }
      continue
    }

    if (tag === '1') {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const f = line.split(' ')
      out.files.push({ x: f[1][0], y: f[1][1], path: f.slice(8).join(' '), kind: 'ordinary' })
    } else if (tag === '2') {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>  then NUL  <origPath>
      const f = line.split(' ')
      out.files.push({
        x: f[1][0],
        y: f[1][1],
        path: f.slice(9).join(' '),
        origPath: rec[++i],
        kind: 'renamed'
      })
    } else if (tag === 'u') {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const f = line.split(' ')
      out.files.push({ x: f[1][0], y: f[1][1], path: f.slice(10).join(' '), kind: 'unmerged' })
    } else if (tag === '?') {
      out.files.push({ x: '?', y: '?', path: line.slice(2), kind: 'untracked' })
    } else if (tag === '!') {
      out.files.push({ x: '!', y: '!', path: line.slice(2), kind: 'ignored' })
    }
  }
  return out
}

export async function status(cwd: string): Promise<RepoStatus> {
  return parseStatusV2(await git(cwd, ['status', '--porcelain=v2', '-z', '--branch', '-uall']))
}

export type Commit = {
  hash: string
  parents: string[]
  author: string
  email: string
  date: string
  subject: string
  refs: string
}

const LOG_FMT = ['%H', '%P', '%an', '%ae', '%aI', '%s', '%D'].join('%x1f') + '%x1e'

export async function log(cwd: string, limit = 200, skip = 0): Promise<Commit[]> {
  const raw = await git(cwd, [
    'log',
    `--format=${LOG_FMT}`,
    `-n${limit}`,
    `--skip=${skip}`,
    '--all'
  ])
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim().length > 0)
    .map((r) => {
      const [hash, parents, author, email, date, subject, refs] = r.split('\x1f')
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        date,
        subject,
        refs
      }
    })
}

/** Unified diff for one file. staged=true diffs index vs HEAD. */
export function diffFile(cwd: string, path: string, staged: boolean): Promise<string> {
  return git(cwd, ['diff', ...(staged ? ['--cached'] : []), '--', path])
}

export const stage = (cwd: string, paths: string[]) => git(cwd, ['add', '--', ...paths])
export const unstage = (cwd: string, paths: string[]) =>
  git(cwd, ['restore', '--staged', '--', ...paths])
export const commit = (cwd: string, message: string, amend = false) =>
  git(cwd, ['commit', ...(amend ? ['--amend'] : []), '-m', message])
export const fetch = (cwd: string) => git(cwd, ['fetch', '--all', '--prune'])
export const pull = (cwd: string, rebase = true) =>
  git(cwd, ['pull', rebase ? '--rebase' : '--no-rebase'])
/** ponytail: force-with-lease only, never bare --force */
export const push = (cwd: string, force = false) =>
  git(cwd, ['push', ...(force ? ['--force-with-lease'] : [])])

export const branches = async (cwd: string) =>
  (await git(cwd, ['branch', '--format=%(refname:short)%09%(upstream:short)%09%(HEAD)', '-a']))
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, upstream, head] = l.split('\t')
      return { name, upstream: upstream || undefined, current: head === '*' }
    })

export const checkout = (cwd: string, ref: string) => git(cwd, ['checkout', ref])

/** Remote URL -> which hosting provider, for the PR/MR panel later. */
export async function remoteInfo(cwd: string) {
  const url = (await git(cwd, ['remote', 'get-url', 'origin'])).trim()
  const m = url.match(/(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/(.+?)(?:\.git)?$/)
  if (!m) return { url, host: '', owner: '', repo: '', provider: 'unknown' as const }
  const [, host, owner, repo] = m
  const provider = host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : 'unknown'
  return { url, host, owner, repo, provider } as const
}
