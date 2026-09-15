import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const tokenFile = () => join(app.getPath('userData'), 'gh.token')

/** safeStorage hits GNOME Keyring on Linux. If no keyring backend, fall back to 0600. */
export function saveToken(token: string): { encrypted: boolean } {
  const f = tokenFile()
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(f, safeStorage.encryptString(token), { mode: 0o600 })
    return { encrypted: true }
  }
  writeFileSync(f, token, { mode: 0o600, encoding: 'utf8' })
  return { encrypted: false }
}

export function loadToken(): string | null {
  const f = tokenFile()
  if (!existsSync(f)) return null
  const buf = readFileSync(f)
  try {
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
  } catch {
    return buf.toString('utf8') // written before a keyring existed
  }
}

export const clearToken = () => existsSync(tokenFile()) && rmSync(tokenFile())

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = loadToken()
  if (!token) throw new Error('No GitHub token. Add one in Settings.')
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(`GitHub ${res.status}: ${body?.message ?? res.statusText}`)
  }
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

export type PR = {
  number: number
  title: string
  body: string | null
  state: string
  draft: boolean
  html_url: string
  user: { login: string; avatar_url: string }
  head: { ref: string; sha: string }
  base: { ref: string }
  created_at: string
  updated_at: string
}

export type Check = { name: string; status: string; conclusion: string | null; html_url: string }

export const whoami = () => gh<{ login: string; name: string }>('/user')

export const listPRs = (o: string, r: string) =>
  gh<PR[]>(`/repos/${o}/${r}/pulls?state=open&per_page=50&sort=updated&direction=desc`)

export const defaultBranch = async (o: string, r: string) =>
  (await gh<{ default_branch: string }>(`/repos/${o}/${r}`)).default_branch

export const createPR = (
  o: string,
  r: string,
  b: { title: string; head: string; base: string; body?: string; draft?: boolean }
) => gh<PR>(`/repos/${o}/${r}/pulls`, { method: 'POST', body: JSON.stringify(b) })

export const mergePR = (
  o: string,
  r: string,
  n: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash'
) =>
  gh<{ merged: boolean; message: string }>(`/repos/${o}/${r}/pulls/${n}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: method })
  })

export const closePR = (o: string, r: string, n: number) =>
  gh<PR>(`/repos/${o}/${r}/pulls/${n}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) })

export const checks = async (o: string, r: string, sha: string) =>
  (await gh<{ check_runs: Check[] }>(`/repos/${o}/${r}/commits/${sha}/check-runs`)).check_runs

export const reviews = (o: string, r: string, n: number) =>
  gh<{ state: string; user: { login: string } }[]>(`/repos/${o}/${r}/pulls/${n}/reviews`)
