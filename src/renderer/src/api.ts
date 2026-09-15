declare global {
  interface Window {
    api: Api
  }
}

type Api = typeof import('../../preload/index.ts')['api']
type Res<T> = { ok: true; data: T } | { ok: false; error: string }

/** Unwraps the {ok,data|error} envelope. Throws so callers can try/catch once. */
export async function must<T>(p: Promise<Res<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}

export const api: Api = window.api
