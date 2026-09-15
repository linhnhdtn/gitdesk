import { contextBridge, ipcRenderer } from 'electron'

type Res<T> = { ok: true; data: T } | { ok: false; error: string }
const call = <T>(ch: string, ...a: unknown[]): Promise<Res<T>> => ipcRenderer.invoke(ch, ...a)

export const api = {
  pickRepo: () => call<string | null>('repo:pick'),
  status: (cwd: string) => call<import('../main/git.ts').RepoStatus>('git:status', cwd),
  log: (cwd: string, limit = 200, skip = 0) =>
    call<import('../main/git.ts').Commit[]>('git:log', cwd, limit, skip),
  diff: (cwd: string, path: string, staged: boolean) => call<string>('git:diff', cwd, path, staged),
  stage: (cwd: string, paths: string[]) => call<string>('git:stage', cwd, paths),
  unstage: (cwd: string, paths: string[]) => call<string>('git:unstage', cwd, paths),
  commit: (cwd: string, msg: string, amend = false) => call<string>('git:commit', cwd, msg, amend),
  fetch: (cwd: string) => call<string>('git:fetch', cwd),
  pull: (cwd: string) => call<string>('git:pull', cwd),
  push: (cwd: string, force = false) => call<string>('git:push', cwd, force),
  branches: (cwd: string) =>
    call<{ name: string; upstream?: string; current: boolean }[]>('git:branches', cwd),
  checkout: (cwd: string, ref: string) => call<string>('git:checkout', cwd, ref),
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
