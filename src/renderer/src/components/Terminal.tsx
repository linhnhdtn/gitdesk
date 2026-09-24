import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api, must } from '../api.ts'
import { aiScopeLabel, chooseAIScope, type AIAction, type AILanguage, type AIProvider, type AIProviderInfo, type AIResult } from '../../../shared/ai.ts'
import type { FileStatus } from '../../../main/git.ts'

const PROVIDER_KEY = 'gitdesk.aiProvider'
const LANGUAGE_KEY = 'gitdesk.aiReviewLanguage'
const NOTICE_KEY = 'gitdesk.terminalNotice'
// Keep the shell implementation available for later, but do not start or show
// a PTY while this workspace is used only for the AI quick actions.
const TERMINAL_ENABLED = false

export function TerminalWorkspace({
  repos,
  cwd,
  active,
  files,
  selected,
  onUseCommit
}: {
  repos: string[]
  cwd: string | null
  active: boolean
  files: FileStatus[]
  selected: string[]
  onUseCommit: (message: string) => void
}) {
  return (
    <div className={`h-full min-h-0 ${active ? '' : 'hidden'}`}>
      {repos.map((repo) => (
        <div key={repo} className={`h-full min-h-0 ${repo === cwd ? '' : 'hidden'}`}>
          <RepoTerminal
            cwd={repo}
            active={active && repo === cwd}
            files={repo === cwd ? files : []}
            selected={repo === cwd ? selected : []}
            onUseCommit={onUseCommit}
          />
        </div>
      ))}
    </div>
  )
}

function RepoTerminal({
  cwd,
  active,
  files,
  selected,
  onUseCommit
}: {
  cwd: string
  active: boolean
  files: FileStatus[]
  selected: string[]
  onUseCommit: (message: string) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<XTerm | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const session = useRef<string | null>(null)
  const deadSessions = useRef(new Set<string>())
  const ignoredSessions = useRef(new Set<string>())
  const activeRef = useRef(active)
  const mounted = useRef(true)
  const cleanups = useRef<(() => void)[]>([])
  const activeRequest = useRef<string | null>(null)
  const [exited, setExited] = useState(false)
  const [terminalError, setTerminalError] = useState('')
  const [providers, setProviders] = useState<AIProviderInfo[] | null>(null)
  const [provider, setProvider] = useState<AIProvider>(() =>
    localStorage.getItem(PROVIDER_KEY) === 'claude' ? 'claude' : 'codex'
  )
  const [language, setLanguage] = useState<AILanguage>(() =>
    localStorage.getItem(LANGUAGE_KEY) === 'vi' ? 'vi' : 'en'
  )
  const [requestId, setRequestId] = useState<string | null>(null)
  const [result, setResult] = useState<AIResult | null>(null)
  const [aiError, setAIError] = useState('')
  const [showNotice, setShowNotice] = useState(() => !localStorage.getItem(NOTICE_KEY))
  const scope = useMemo(() => chooseAIScope(selected, files), [selected, files])
  activeRef.current = active

  const resize = () => {
    if (!activeRef.current || !term.current || !fit.current || !session.current) return
    try {
      fit.current.fit()
      void api.terminalResize(session.current, term.current.cols, term.current.rows).catch(() => {})
    } catch {
      // A hidden or zero-sized pane cannot be fitted yet; the next activation retries.
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const clean of cleanups.current) clean()
      cleanups.current = []
      term.current?.dispose()
      if (session.current) void api.terminalDispose(session.current).catch(() => {})
      if (activeRequest.current) void api.aiCancel(activeRequest.current).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!TERMINAL_ENABLED || !active || term.current || !host.current) return
    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: '#111827',
        foreground: '#e5e7eb',
        cursor: '#f9fafb',
        selectionBackground: '#374151'
      }
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host.current)
    term.current = terminal
    fit.current = fitAddon

    const input = terminal.onData((data) => {
      if (session.current) void api.terminalWrite(session.current, data).catch(() => {})
    })
    const offData = api.onTerminalData((event) => {
      if (event.cwd !== cwd || deadSessions.current.has(event.id) || ignoredSessions.current.has(event.id))
        return
      if (!session.current || event.id === session.current) terminal.write(event.data)
    })
    const offExit = api.onTerminalExit((event) => {
      if (event.cwd !== cwd) return
      deadSessions.current.add(event.id)
      if (ignoredSessions.current.delete(event.id)) return
      if (session.current && event.id !== session.current) return
      session.current = null
      setExited(true)
      terminal.write(`\r\n\x1b[33m[process exited with code ${event.exitCode}]\x1b[0m\r\n`)
    })
    const observer = new ResizeObserver(() => resize())
    observer.observe(host.current)
    cleanups.current.push(() => input.dispose(), offData, offExit, () => observer.disconnect())

    requestAnimationFrame(() => {
      if (!mounted.current) return
      fitAddon.fit()
      must(api.terminalStart(cwd, terminal.cols, terminal.rows))
        .then((started) => {
          if (!mounted.current) return void api.terminalDispose(started.id).catch(() => {})
          if (deadSessions.current.has(started.id)) {
            session.current = null
            setExited(true)
            return
          }
          session.current = started.id
          setExited(false)
          terminal.focus()
        })
        .catch((e) => {
          setTerminalError(String(e.message ?? e))
          setExited(true)
        })
    })
  }, [active, cwd])

  useEffect(() => {
    if (!active || !term.current) return
    requestAnimationFrame(() => {
      resize()
      term.current?.focus()
    })
  }, [active])

  useEffect(() => {
    if (!active || providers) return
    must(api.aiProviders())
      .then((found) => {
        setProviders(found)
        if (!found.some((p) => p.provider === provider && p.available)) {
          const fallback = found.find((p) => p.available)
          if (fallback) {
            setProvider(fallback.provider)
            localStorage.setItem(PROVIDER_KEY, fallback.provider)
          }
        }
      })
      .catch((e) => setAIError(String(e.message ?? e)))
  }, [active, provider, providers])

  useEffect(() => {
    if (!active) return
    setProvider(localStorage.getItem(PROVIDER_KEY) === 'claude' ? 'claude' : 'codex')
    setShowNotice(!localStorage.getItem(NOTICE_KEY))
  }, [active])

  const restart = async () => {
    if (!term.current || !fit.current) return
    setTerminalError('')
    term.current.reset()
    fit.current.fit()
    if (session.current) ignoredSessions.current.add(session.current)
    session.current = null
    try {
      const started = await must(api.terminalRestart(cwd, term.current.cols, term.current.rows))
      if (deadSessions.current.has(started.id)) {
        setExited(true)
        return
      }
      session.current = started.id
      setExited(false)
      term.current.focus()
    } catch (e: any) {
      setTerminalError(String(e.message ?? e))
      setExited(true)
    }
  }

  const runAI = async (action: AIAction) => {
    const id = crypto.randomUUID()
    activeRequest.current = id
    setRequestId(id)
    setAIError('')
    setResult(null)
    try {
      const response = await must(api.aiRun({ requestId: id, cwd, provider, action, language, scope }))
      if (mounted.current) setResult(response)
    } catch (e: any) {
      if (mounted.current) setAIError(String(e.message ?? e))
    } finally {
      activeRequest.current = null
      if (mounted.current) setRequestId(null)
    }
  }

  const cancel = () => activeRequest.current && void must(api.aiCancel(activeRequest.current)).catch(() => {})
  const available = providers?.some((p) => p.provider === provider && p.available) ?? false

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {showNotice && (
        <div className="flex shrink-0 items-start gap-2 border-b border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-900">
          <span className="min-w-0 flex-1">
            AI actions send the selected diff to the chosen CLI provider running with your user permissions.
          </span>
          <button
            className="rounded px-1 hover:bg-amber-100"
            onClick={() => {
              localStorage.setItem(NOTICE_KEY, '1')
              setShowNotice(false)
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-2 py-1">
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as AIProvider
            setProvider(next)
            localStorage.setItem(PROVIDER_KEY, next)
          }}
          className="rounded border border-line bg-bg px-1.5 py-0.5 outline-none focus:border-accent"
          title="AI CLI used for quick actions"
        >
          {(providers ?? [{ provider: 'codex', available: false }, { provider: 'claude', available: false }]).map((p) => (
            <option key={p.provider} value={p.provider} disabled={providers !== null && !p.available}>
              {p.provider === 'codex' ? 'Codex' : 'Claude'}{providers !== null && !p.available ? ' (not found)' : ''}
            </option>
          ))}
        </select>
        <select
          value={language}
          onChange={(e) => {
            const next = e.target.value as AILanguage
            setLanguage(next)
            localStorage.setItem(LANGUAGE_KEY, next)
          }}
          className="rounded border border-line bg-bg px-1.5 py-0.5 outline-none focus:border-accent"
          title="AI output language"
        >
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
        <span className="text-[12px] text-muted">Scope: {aiScopeLabel(scope)}</span>
        <button className="ml-auto rounded border border-line bg-bg px-2 py-0.5 hover:border-accent disabled:opacity-40" disabled={!available || !!requestId} onClick={() => runAI('review')}>
          Review Changes
        </button>
        <button className="rounded border border-line bg-bg px-2 py-0.5 hover:border-accent disabled:opacity-40" disabled={!available || !!requestId} onClick={() => runAI('commit-message')}>
          Generate Commit Message
        </button>
        {requestId && (
          <button className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-rose-700 hover:bg-rose-100" onClick={cancel}>
            Cancel
          </button>
        )}
        {TERMINAL_ENABLED && exited && (
          <button className="rounded border border-line bg-bg px-2 py-0.5 hover:border-accent" onClick={restart}>
            Restart Shell
          </button>
        )}
      </div>

      {requestId && <div className="shrink-0 border-b border-line px-2 py-1 text-[12px] text-muted">Running {provider}…</div>}
      {(aiError || (TERMINAL_ENABLED && terminalError)) && (
        <div className="shrink-0 border-b border-rose-300 bg-rose-50 px-2 py-1 text-[12px] text-rose-700">
          {aiError || (TERMINAL_ENABLED ? terminalError : '')}
          {/not found|log in|auth/i.test(aiError) && (
            <span> Run `{provider === 'claude' ? 'claude auth login' : 'codex login'}` in your system terminal.</span>
          )}
        </div>
      )}
      {providers && !providers.some((p) => p.available) && (
        <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-900">
          No supported AI CLI found. Install Codex or Claude, then restart the app.
        </div>
      )}
      {result && (
        <div className="flex min-h-0 flex-1 flex-col bg-panel">
          <div className="flex shrink-0 items-center gap-2 px-2 py-1 text-[12px] text-muted">
            <span className="font-semibold text-fg">{result.action === 'review' ? 'AI Review' : 'Commit Message'}</span>
            <span>{result.provider} · {result.scopeLabel}</span>
            <button className="ml-auto hover:text-fg" onClick={() => void must(api.copy(result.text)).catch((e) => setAIError(String(e.message ?? e)))}>Copy</button>
            {result.action === 'commit-message' && (
              <button className="rounded border border-accent px-2 text-accent hover:bg-accent/10" onClick={() => onUseCommit(result.text)}>
                Use in Commit
              </button>
            )}
            <button className="hover:text-fg" onClick={() => setResult(null)}>Close</button>
          </div>
          <pre className="select-text min-h-0 overflow-auto border-t border-line bg-bg px-2 py-1 text-[13px] whitespace-pre-wrap">{result.text}</pre>
        </div>
      )}

      {!result && (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted">
          <div>
            <div className="font-medium text-fg">AI quick actions</div>
            <div className="mt-1 text-[12px]">Select changed files, then choose Review Changes or Generate Commit Message.</div>
          </div>
        </div>
      )}
      {TERMINAL_ENABLED && <div ref={host} className="min-h-0 flex-1 bg-[#111827] p-1" />}
    </div>
  )
}
