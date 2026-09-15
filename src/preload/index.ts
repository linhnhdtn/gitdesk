import { contextBridge, ipcRenderer } from 'electron'

type Res<T> = { ok: true; data: T } | { ok: false; error: string }
const call = <T>(ch: string, ...a: unknown[]): Promise<Res<T>> => ipcRenderer.invoke(ch, ...a)

export const api = {
  pickRepo: () => call<string | null>('repo:pick'),
  status: (cwd: string) => call<import('../main/git.ts').RepoStatus>('git:status', cwd),
  log: (cwd: string, limit = 200, skip = 0, all = true) =>
    call<import('../main/git.ts').Commit[]>('git:log', cwd, limit, skip, all),
  diff: (cwd: string, path: string, staged: boolean, context = 3) =>
    call<string>('git:diff', cwd, path, staged, context),
  readWorktree: (cwd: string, path: string) => call<string>('git:readWorktree', cwd, path),
  /** Untracked files need a synthesised patch — `git diff` returns nothing for them. */
  diffNew: (cwd: string, path: string) => call<string>('git:diffNew', cwd, path),
  stage: (cwd: string, paths: string[]) => call<string>('git:stage', cwd, paths),
  unstage: (cwd: string, paths: string[]) => call<string>('git:unstage', cwd, paths),
  commit: (cwd: string, msg: string, opts: import('../main/git.ts').CommitOpts = {}) =>
    call<string>('git:commit', cwd, msg, opts),
  lastMessage: (cwd: string) => call<string>('git:lastMessage', cwd),
  fetch: (cwd: string) => call<string>('git:fetch', cwd),
  pull: (cwd: string, rebase = true) => call<string>('git:pull', cwd, rebase),
  push: (cwd: string, force = false) => call<string>('git:push', cwd, force),
  refs: (cwd: string) => call<import('../main/git.ts').Ref[]>('git:refs', cwd),
  checkout: (cwd: string, ref: string) => call<string>('git:checkout', cwd, ref),
  discard: (cwd: string, paths: string[], untracked: string[] = []) =>
    call<string>('git:discard', cwd, paths, untracked),
  stashList: (cwd: string) => call<import('../main/git.ts').Stash[]>('git:stashList', cwd),
  stashSave: (cwd: string, msg = '') => call<string>('git:stashSave', cwd, msg),
  stashApply: (cwd: string, ref: string) => call<string>('git:stashApply', cwd, ref),
  stashDrop: (cwd: string, ref: string) => call<string>('git:stashDrop', cwd, ref),
  repoBrief: (cwd: string) =>
    call<{ cwd: string; name: string; branch: string; dirty: boolean }>('git:repoBrief', cwd),
  showCommit: (cwd: string, sha: string) => call<string>('git:showCommit', cwd, sha),

  /** Main->renderer push (the only one). Returns an unsubscribe for useEffect cleanup. */
  onGitCmd: (cb: (e: import('../main/git.ts').GitCmd) => void) => {
    const h = (_: unknown, e: import('../main/git.ts').GitCmd) => cb(e)
    ipcRenderer.on('git:cmd', h)
    return () => void ipcRenderer.off('git:cmd', h)
  },
  // --- GitHub ---
  saveToken: (t: string) => call<{ encrypted: boolean }>('gh:saveToken', t),
  hasToken: () => call<boolean>('gh:hasToken'),
  clearToken: () => call<void>('gh:clearToken'),
  whoami: () => call<{ login: string; name: string }>('gh:whoami'),
  prs: (o: string, r: string) => call<import('../main/github.ts').PR[]>('gh:prs', o, r),
  defaultBranch: (o: string, r: string) => call<string>('gh:defaultBranch', o, r),
  createPR: (o: string, r: string, b: { title: string; head: string; base: string; body?: string; draft?: boolean }) =>
    call<import('../main/github.ts').PR>('gh:createPR', o, r, b),
  mergePR: (o: string, r: string, n: number, m: 'merge' | 'squash' | 'rebase') =>
    call<{ merged: boolean; message: string }>('gh:mergePR', o, r, n, m),
  closePR: (o: string, r: string, n: number) => call<unknown>('gh:closePR', o, r, n),
  checks: (o: string, r: string, sha: string) =>
    call<import('../main/github.ts').Check[]>('gh:checks', o, r, sha),
  reviews: (o: string, r: string, n: number) =>
    call<{ state: string; user: { login: string } }[]>('gh:reviews', o, r, n),
  openExternal: (url: string) => call<void>('sys:openExternal', url),

  remote: (cwd: string) =>
    call<{ url: string; host: string; owner: string; repo: string; provider: string }>(
      'git:remote',
      cwd
    )
}

contextBridge.exposeInMainWorld('api', api)
