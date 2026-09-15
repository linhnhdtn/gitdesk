import { useEffect, useState } from 'react'
import { api, must } from '../api.ts'

export function Settings({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState('')
  const [who, setWho] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    must(api.hasToken()).then((h) => {
      if (h) must(api.whoami()).then((u) => setWho(u.login)).catch(() => setWho(null))
    })
  }, [])

  async function save() {
    setErr('')
    try {
      const { encrypted } = await must(api.saveToken(token.trim()))
      const u = await must(api.whoami())
      setWho(u.login)
      setToken('')
      setNote(
        encrypted
          ? 'Saved, encrypted with your system keyring.'
          : 'Saved — but no keyring backend was found, so the token sits in a 0600 file. Install gnome-keyring for encryption.'
      )
    } catch (e: any) {
      setErr(String(e.message ?? e))
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/30" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] rounded-lg border border-line bg-panel p-5 shadow-2xl"
      >
        <h2 className="mb-1 text-lg font-semibold">GitHub</h2>
        <p className="mb-4 text-muted">
          {who ? (
            <>
              Signed in as <span className="text-accent">{who}</span>
            </>
          ) : (
            'Not signed in'
          )}
        </p>

        <label className="mb-1 block text-[11px] font-semibold tracking-wide text-muted uppercase">
          Personal access token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_… or ghp_…"
          className="w-full rounded border border-line bg-bg px-3 py-2 font-mono outline-none focus:border-accent"
        />
        <p className="mt-2 text-[12px] text-muted">
          Needs scopes <code className="text-fg">repo</code> (classic) or{' '}
          <code className="text-fg">Pull requests: RW</code> + <code className="text-fg">Checks: R</code> (fine-grained).{' '}
          <button
            className="text-accent hover:underline"
            onClick={() => api.openExternal('https://github.com/settings/tokens')}
          >
            Create one ↗
          </button>
        </p>

        {note && <p className="mt-3 text-[12px] text-emerald-700">{note}</p>}
        {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}

        <div className="mt-5 flex gap-2">
          <button
            disabled={!token.trim()}
            onClick={save}
            className="rounded bg-accent px-4 py-1.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            Save
          </button>
          {who && (
            <button
              onClick={() => must(api.clearToken()).then(() => (setWho(null), setNote('Token removed.')))}
              className="rounded border border-line px-3 py-1.5 text-muted hover:border-rose-600 hover:text-rose-600"
            >
              Sign out
            </button>
          )}
          <button onClick={onClose} className="ml-auto rounded border border-line px-3 py-1.5 hover:border-accent">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreatePr({
  repo,
  head,
  onClose,
  onCreated
}: {
  repo: { owner: string; repo: string }
  head: string
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    must(api.defaultBranch(repo.owner, repo.repo)).then(setBase).catch(() => setBase('main'))
  }, [repo])

  async function create() {
    setBusy(true)
    setErr('')
    try {
      const pr = await must(api.createPR(repo.owner, repo.repo, { title, head, base, body, draft }))
      await api.openExternal(pr.html_url)
      onCreated()
    } catch (e: any) {
      setErr(String(e.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/30" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] rounded-lg border border-line bg-panel p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-lg font-semibold">New Pull Request</h2>
        <div className="mb-3 flex items-center gap-2 text-muted">
          <code className="rounded bg-bg px-2 py-1 text-accent">{head}</code> →
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="rounded border border-line bg-bg px-2 py-1 text-accent outline-none focus:border-accent"
          />
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 w-full rounded border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Description"
          rows={6}
          className="w-full resize-none rounded border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
        />
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          Create as draft
        </label>
        {err && <p className="mt-3 text-[12px] text-rose-700">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button
            disabled={!title.trim() || !base.trim() || busy}
            onClick={create}
            className="rounded bg-accent px-4 py-1.5 font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            Create
          </button>
          <button onClick={onClose} className="ml-auto rounded border border-line px-3 py-1.5 hover:border-accent">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
