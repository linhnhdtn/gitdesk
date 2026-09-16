import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { newFilePatch } from '../shared/sidebyside.ts'

const exec = promisify(execFile)

/** One console line: every git invocation the app makes, success or not. */
export type GitCmd = {
  id: number
  cwd: string
  args: string[]
  ms: number
  ok: boolean
  out: string
  err: string
}

/** `git()` is the only place that shells out, so this sees 100% of commands. */
export const bus = new EventEmitter<{ cmd: [GitCmd] }>()
let cmdId = 0

/** Raw git call. Returns stdout. Throws with stderr on non-zero exit. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const id = ++cmdId
  const t0 = Date.now()
  try {
    const { stdout } = await exec('git', args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      // ponytail: no locale/pager surprises; add GIT_ASKPASS here if auth prompts show up
      env: { ...process.env, LC_ALL: 'C', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' }
    })
    // ponytail: 4 KB of stdout is enough to eyeball; full diffs have their own pane
    bus.emit('cmd', { id, cwd, args, ms: Date.now() - t0, ok: true, out: stdout.slice(0, 4096), err: '' })
    return stdout
  } catch (e: any) {
    const err = e.stderr?.trim() || e.message
    bus.emit('cmd', { id, cwd, args, ms: Date.now() - t0, ok: false, out: '', err })
    throw new Error(err)
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

export async function log(cwd: string, limit = 200, skip = 0, all = true): Promise<Commit[]> {
  const raw = await git(cwd, [
    'log',
    `--format=${LOG_FMT}`,
    `-n${limit}`,
    `--skip=${skip}`,
    // topo-order so the graph lanes stay contiguous instead of interleaving by date
    '--topo-order',
    ...(all ? ['--all'] : [])
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

/**
 * Unified diff for one file. staged=true diffs index vs HEAD.
 * `context` is git's -U: the side-by-side view asks for a huge one so the whole
 * file comes back as a single hunk — git does the diffing, we only split sides.
 */
export function diffFile(cwd: string, path: string, staged: boolean, context = 3): Promise<string> {
  return git(cwd, ['diff', `-U${context}`, ...(staged ? ['--cached'] : []), '--', path])
}

/**
 * Untracked files are not in the object database, so `git diff` has nothing to
 * show. Read them off disk instead, refusing anything outside the repo — the
 * path crosses an IPC boundary, so it gets checked rather than trusted.
 */
export async function diffNew(cwd: string, path: string): Promise<string> {
  return newFilePatch(path, await readWorktree(cwd, path))
}

export function inRepo(cwd: string, path: string): string {
  const root = resolve(cwd)
  const full = resolve(root, path)
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`path escapes repo: ${path}`)
  return full
}

export const readWorktree = (cwd: string, path: string) => readFile(inRepo(cwd, path), 'utf8')

/**
 * Delete files. Tracked ones go through `git rm` so the removal is staged;
 * untracked ones only exist on disk, so they are unlinked directly.
 */
export async function remove(cwd: string, tracked: string[], untracked: string[] = []) {
  if (tracked.length) await git(cwd, ['rm', '-f', '-r', '--', ...tracked])
  for (const p of untracked) await rm(inRepo(cwd, p), { recursive: true, force: true })
  return ''
}

/** Append patterns to .gitignore, creating it and keeping one per line. */
export async function ignore(cwd: string, patterns: string[]) {
  const file = inRepo(cwd, '.gitignore')
  const old = await readFile(file, 'utf8').catch(() => '')
  const have = new Set(old.split('\n').map((l) => l.trim()))
  const add = patterns.filter((p) => !have.has(p.trim()))
  if (!add.length) return old
  const body = old && !old.endsWith('\n') ? old + '\n' : old
  await writeFile(file, body + add.join('\n') + '\n')
  return body + add.join('\n') + '\n'
}

export const merge = (cwd: string, ref: string, ffOnly = false) =>
  git(cwd, ['merge', ...(ffOnly ? ['--ff-only'] : []), ref])
export const rebase = (cwd: string, ref: string) => git(cwd, ['rebase', ref])
export const renameBranch = (cwd: string, from: string, to: string) =>
  git(cwd, ['branch', '-m', from, to])
/** -d refuses to drop unmerged work; -D is the explicit override. */
export const deleteBranch = (cwd: string, name: string, force = false) =>
  git(cwd, ['branch', force ? '-D' : '-d', name])
export const pushBranch = (cwd: string, branch: string, setUpstream = false) =>
  git(cwd, ['push', ...(setUpstream ? ['-u'] : []), 'origin', branch])

export const stage = (cwd: string, paths: string[]) => git(cwd, ['add', '--', ...paths])
export const unstage = (cwd: string, paths: string[]) =>
  git(cwd, ['restore', '--staged', '--', ...paths])
export type CommitOpts = {
  amend?: boolean
  signoff?: boolean
  noVerify?: boolean
  /**
   * Empty commits the index exactly as staged. With paths, git records the
   * WORKING TREE content of those paths and ignores what is staged for them —
   * that is git's own rule for `commit -- <pathspec>`, and the dialog says so
   * when the two actually differ.
   */
  paths?: string[]
}

/** Split out from commit() so the flag combinations are testable without a repo. */
export function commitArgs(message: string, o: CommitOpts = {}): string[] {
  return [
    'commit',
    ...(o.amend ? ['--amend'] : []),
    ...(o.signoff ? ['--signoff'] : []),
    ...(o.noVerify ? ['--no-verify'] : []),
    '-m',
    message,
    // `--` must come last: everything after it is a pathspec, so a path that
    // looks like a flag cannot be read as one.
    ...(o.paths?.length ? ['--', ...o.paths] : [])
  ]
}

export const commit = (cwd: string, message: string, o: CommitOpts = {}) =>
  git(cwd, commitArgs(message, o))

/** HEAD's message, so ticking Amend cannot silently throw the old one away. */
export const lastMessage = async (cwd: string) =>
  (await git(cwd, ['log', '-1', '--format=%B'])).trimEnd()
export const fetch = (cwd: string) => git(cwd, ['fetch', '--all', '--prune'])
export const pull = (cwd: string, rebase = true) =>
  git(cwd, ['pull', rebase ? '--rebase' : '--no-rebase'])
/** ponytail: force-with-lease only, never bare --force */
export const push = (cwd: string, force = false) =>
  git(cwd, ['push', ...(force ? ['--force-with-lease'] : [])])

export type Ref = {
  kind: 'local' | 'remote' | 'tag'
  /** short name: 'main', 'origin/main', 'v1.0' */
  name: string
  /** remote name for kind==='remote', else '' */
  remote: string
  upstream?: string
  sha: string
  current: boolean
}

const REF_FMT = ['%(refname)', '%(refname:short)', '%(upstream:short)', '%(objectname:short)', '%(HEAD)'].join('%09')

/** All refs in one call, grouped by kind — `branch -a` can't tell a tag from a branch. */
export async function refs(cwd: string): Promise<Ref[]> {
  const raw = await git(cwd, [
    'for-each-ref',
    `--format=${REF_FMT}`,
    'refs/heads',
    'refs/remotes',
    'refs/tags'
  ])
  const out: Ref[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [full, name, upstream, sha, head] = line.split('\t')
    // origin/HEAD is a symref pointer, not a branch anyone checks out
    if (name.endsWith('/HEAD')) continue
    const kind = full.startsWith('refs/heads/')
      ? 'local'
      : full.startsWith('refs/tags/')
        ? 'tag'
        : 'remote'
    out.push({
      kind,
      name,
      remote: kind === 'remote' ? name.slice(0, name.indexOf('/')) : '',
      upstream: upstream || undefined,
      sha,
      current: head === '*'
    })
  }
  return out
}

export const checkout = (cwd: string, ref: string) => git(cwd, ['checkout', ref])

export type Stash = { ref: string; subject: string }

export async function stashList(cwd: string): Promise<Stash[]> {
  const raw = await git(cwd, ['stash', 'list', '--format=%gd%x1f%s'])
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [ref, subject] = l.split('\x1f')
      return { ref, subject }
    })
}

export const stashSave = (cwd: string, msg: string) =>
  git(cwd, ['stash', 'push', '-u', ...(msg ? ['-m', msg] : [])])
export const stashApply = (cwd: string, ref: string) => git(cwd, ['stash', 'apply', ref])
export const stashDrop = (cwd: string, ref: string) => git(cwd, ['stash', 'drop', ref])

/**
 * Throw away worktree changes. Tracked paths are restored from the index,
 * untracked ones deleted — `restore` alone silently no-ops on untracked files.
 */
export async function discard(cwd: string, paths: string[], untracked: string[] = []) {
  if (paths.length) await git(cwd, ['restore', '--worktree', '--', ...paths])
  if (untracked.length) await git(cwd, ['clean', '-fd', '--', ...untracked])
  return ''
}

/** Cheap one-line summary for the repositories sidebar — no full status parse. */
export async function repoBrief(cwd: string) {
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const dirty = (await git(cwd, ['status', '--porcelain', '-uall'])).trim().length > 0
  return { cwd, name: cwd.split('/').filter(Boolean).pop() ?? cwd, branch, dirty }
}

/** Full patch for one commit, for the Diff tab when a journal row is clicked. */
export const showCommit = (cwd: string, sha: string) =>
  git(cwd, ['show', '--stat', '--patch', '--format=fuller', sha])

/** Remote URL -> which hosting provider, for the PR/MR panel later. */
export async function remoteInfo(cwd: string) {
  const url = (await git(cwd, ['remote', 'get-url', 'origin'])).trim()
  const m = url.match(/(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/(.+?)(?:\.git)?$/)
  if (!m) return { url, host: '', owner: '', repo: '', provider: 'unknown' as const }
  const [, host, owner, repo] = m
  const provider = host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : 'unknown'
  return { url, host, owner, repo, provider } as const
}
