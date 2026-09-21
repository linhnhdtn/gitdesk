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

function parseCommit(r: string): Commit {
  const [hash, parents, author, email, date, subject, refs] = r.split('\x1f')
  return { hash, parents: parents ? parents.split(' ') : [], author, email, date, subject, refs }
}

/** One commit by any ref — a sha, a branch, or a stash entry. */
export async function commitAt(cwd: string, ref: string): Promise<Commit> {
  return parseCommit((await git(cwd, ['log', '-1', `--format=${LOG_FMT}`, ref])).replace(/\x1e[\s\S]*$/, ''))
}

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
    .map(parseCommit)
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

/** Write a file back into the worktree. Same containment check as reading one. */
export async function writeWorktree(cwd: string, path: string, text: string) {
  await writeFile(inRepo(cwd, path), text)
  return ''
}

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
/**
 * Create and switch in one step — `checkout -b` rather than `branch` + `checkout`,
 * so a name git rejects leaves nothing half-made. `start` defaults to HEAD.
 */
export const createBranch = (cwd: string, name: string, start?: string) =>
  git(cwd, ['checkout', '-b', name, ...(start ? [start] : [])])
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

export type Stash = {
  ref: string
  /** raw reflog subject, kept so nothing is lost if the parse misses */
  subject: string
  /** the title the user typed, or the commit it was taken from */
  message: string
  branch: string
  date: string
}

/**
 * git writes two shapes of subject: "On <branch>: <title>" when the user gave
 * a message, "WIP on <branch>: <sha> <subject>" when they did not. Split them
 * so the sidebar can show the title on its own line.
 */
export function parseStash(ref: string, subject: string, date: string): Stash {
  const m = /^(WIP on|On) ([^:]+): (.*)$/.exec(subject)
  if (!m) return { ref, subject, message: subject, branch: '', date }
  const [, kind, branch, rest] = m
  const message = kind === 'WIP on' ? rest.replace(/^[0-9a-f]{7,40}\s+/, '') : rest
  return { ref, subject, message, branch, date }
}

export async function stashList(cwd: string): Promise<Stash[]> {
  // %gs, not %s: the reflog message is what `git stash list` shows and the only
  // thing `stash store -m` can change — %s stays frozen at the commit's own
  // subject, so a renamed stash would still read under its old title.
  const raw = await git(cwd, ['stash', 'list', '--format=%gd%x1f%gs%x1f%cI'])
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [ref, subject, date] = l.split('\x1f')
      return parseStash(ref, subject, date)
    })
}

/** With `paths`, only those files are stashed — the rest of the tree is left alone. */
export const stashSave = (cwd: string, msg = '', paths: string[] = []) =>
  git(cwd, [
    'stash',
    'push',
    '-u',
    ...(msg ? ['-m', msg] : []),
    ...(paths.length ? ['--', ...paths] : [])
  ])
export const stashApply = (cwd: string, ref: string) => git(cwd, ['stash', 'apply', ref])
export const stashDrop = (cwd: string, ref: string) => git(cwd, ['stash', 'drop', ref])

/**
 * Throw away changes.
 *
 * `toHead` reverts the index too, so the file ends up exactly as HEAD has it;
 * otherwise only the worktree is rolled back to whatever is staged. Untracked
 * files are deleted either way — `restore` silently no-ops on them.
 *
 * Note a file staged as NEW is not in HEAD, so reverting it to HEAD removes it
 * from disk. The dialog says so before it runs.
 */
export async function discard(
  cwd: string,
  tracked: string[],
  untracked: string[] = [],
  toHead = false
) {
  if (tracked.length)
    await git(cwd, [
      'restore',
      ...(toHead ? ['--source=HEAD', '--staged'] : []),
      '--worktree',
      '--',
      ...tracked
    ])
  if (untracked.length) await git(cwd, ['clean', '-fd', '--', ...untracked])
  return ''
}

/** Cheap one-line summary for the repositories sidebar — no full status parse. */
export async function repoBrief(cwd: string) {
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  const dirty = (await git(cwd, ['status', '--porcelain', '-uall'])).trim().length > 0
  return { cwd, name: cwd.split('/').filter(Boolean).pop() ?? cwd, branch, dirty }
}

/**
 * Files touched by one commit.
 *
 * `-m --first-parent` is the whole trick: a merged pull request IS a merge
 * commit, and for those git reports NO files at all by default. First-parent
 * means "what this merge brought into the branch", which is what the journal
 * is asking. It is also correct for ordinary and root commits.
 */
const isStashRef = (ref: string) => /^stash@\{\d+\}$/.test(ref)

/** NUL "STATUS\0path\0", and "R100\0old\0new\0" for a rename. */
function parseNameStatus(raw: string): FileStatus[] {
  const rec = raw.split('\0').filter((r) => r.length > 0)
  const out: FileStatus[] = []
  for (let i = 0; i < rec.length; i++) {
    const code = rec[i][0]
    if (code === 'R' || code === 'C')
      out.push({ x: code, y: '.', origPath: rec[++i], path: rec[++i], kind: 'renamed' })
    else out.push({ x: code, y: '.', path: rec[++i], kind: 'ordinary' })
  }
  return out
}

/**
 * A stash keeps its untracked files in a THIRD parent, outside its own tree,
 * so they are invisible to a plain first-parent diff. `^3` is absent when the
 * stash had none, hence the catch.
 */
async function stashUntracked(cwd: string, ref: string): Promise<Set<string>> {
  const raw = await git(cwd, ['ls-tree', '-r', '--name-only', '-z', `${ref}^3`]).catch(() => '')
  return new Set(raw.split('\0').filter(Boolean))
}

export async function commitFiles(cwd: string, sha: string): Promise<FileStatus[]> {
  // `stash show -u` is the only form that reports the untracked half as well
  if (isStashRef(sha))
    return parseNameStatus(await git(cwd, ['stash', 'show', '-u', '--name-status', '-M', '-z', sha]))
  const raw = await git(cwd, [
    'show',
    '-m',
    '--first-parent',
    '--name-status',
    '-M',
    '-z',
    '--format=',
    sha
  ])
  return parseNameStatus(raw)
}

/** One file's patch inside a commit — same first-parent rule as commitFiles. */
export async function commitDiff(cwd: string, sha: string, path: string): Promise<string> {
  if (isStashRef(sha)) {
    // `stash show` rejects a pathspec, so go through the parents directly
    if ((await stashUntracked(cwd, sha)).has(path))
      return newFilePatch(path, await git(cwd, ['show', `${sha}^3:${path}`]))
    return git(cwd, ['diff', `${sha}^1`, sha, '--', path])
  }
  return git(cwd, ['show', '-m', '--first-parent', '-M', '--format=', sha, '--', path])
}

/**
 * git has no rename: re-store the same commit under a new message, then drop
 * the old entry. `store` pushes onto stash@{0}, so the original has shifted
 * down one slot by the time it is dropped.
 */
export async function renameStash(cwd: string, ref: string, message: string) {
  const m = /^stash@\{(\d+)\}$/.exec(ref)
  if (!m) throw new Error(`not a stash ref: ${ref}`)
  const sha = (await git(cwd, ['rev-parse', ref])).trim()
  const cur = (await git(cwd, ['stash', 'list', '--format=%gd%x1f%gs'])).split('\n').find((l) => l.startsWith(ref + '\x1f'))
  const { branch } = parseStash(ref, cur?.split('\x1f')[1] ?? '', '')
  // keep the "On <branch>: " shape so the list still shows where it came from
  await git(cwd, ['stash', 'store', '-m', branch ? `On ${branch}: ${message}` : message, sha])
  await git(cwd, ['stash', 'drop', `stash@{${Number(m[1]) + 1}}`])
  return ''
}

/** Full patch for one commit, for the Diff tab when a journal row is clicked. */
export const showCommit = (cwd: string, sha: string) =>
  git(cwd, ['show', '--stat', '--patch', '--format=fuller', sha])
