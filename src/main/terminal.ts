import { randomUUID } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'

export type TerminalSession = { id: string; cwd: string }
export type TerminalData = TerminalSession & { data: string }
export type TerminalExit = TerminalSession & { exitCode: number; signal?: number }

type Session = TerminalSession & {
  owner: number
  key: string
  pty: IPty
}
type SpawnPty = typeof spawnPty

export function terminalSize(cols: number, rows: number): { cols: number; rows: number } {
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) return { cols: 80, rows: 24 }
  return {
    cols: Math.max(2, Math.min(500, Math.floor(cols))),
    rows: Math.max(1, Math.min(200, Math.floor(rows)))
  }
}

export function loginShellArgs(shell: string): string[] {
  return ['bash', 'zsh'].includes(basename(shell)) ? ['-l'] : []
}

export class TerminalManager {
  private sessions = new Map<string, Session>()
  private repos = new Map<string, string>()
  private sendData: (owner: number, event: TerminalData) => void
  private sendExit: (owner: number, event: TerminalExit) => void
  private spawn: SpawnPty

  constructor(
    sendData: (owner: number, event: TerminalData) => void,
    sendExit: (owner: number, event: TerminalExit) => void,
    spawn: SpawnPty = spawnPty
  ) {
    this.sendData = sendData
    this.sendExit = sendExit
    this.spawn = spawn
  }

  start(owner: number, cwd: string, cols: number, rows: number): TerminalSession {
    const root = resolve(cwd)
    const key = `${owner}\0${root}`
    const existing = this.repos.get(key)
    if (existing) return { id: existing, cwd: root }

    const size = terminalSize(cols, rows)
    const shell = process.env.SHELL || '/bin/bash'
    const processPty = this.spawn(shell, loginShellArgs(shell), {
      name: 'xterm-256color',
      cwd: root,
      cols: size.cols,
      rows: size.rows,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    })
    const id = randomUUID()
    const session: Session = { id, cwd: root, owner, key, pty: processPty }
    this.sessions.set(id, session)
    this.repos.set(key, id)
    processPty.onData((data) => this.sendData(owner, { id, cwd: root, data }))
    processPty.onExit(({ exitCode, signal }) => {
      this.drop(session)
      this.sendExit(owner, { id, cwd: root, exitCode, signal })
    })
    return { id, cwd: root }
  }

  restart(owner: number, cwd: string, cols: number, rows: number): TerminalSession {
    const key = `${owner}\0${resolve(cwd)}`
    const id = this.repos.get(key)
    if (id) this.dispose(owner, id)
    return this.start(owner, cwd, cols, rows)
  }

  write(owner: number, id: string, data: string) {
    const session = this.owned(owner, id)
    if (Buffer.byteLength(data) > 64 * 1024) throw new Error('Terminal input is too large.')
    session.pty.write(data)
  }

  resize(owner: number, id: string, cols: number, rows: number) {
    const session = this.owned(owner, id)
    const size = terminalSize(cols, rows)
    session.pty.resize(size.cols, size.rows)
  }

  dispose(owner: number, id: string): boolean {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) return false
    this.drop(session)
    try {
      session.pty.kill()
    } catch {
      // It may have exited between the lookup and kill.
    }
    return true
  }

  disposeOwner(owner: number) {
    for (const session of [...this.sessions.values()])
      if (session.owner === owner) this.dispose(owner, session.id)
  }

  private owned(owner: number, id: string): Session {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) throw new Error('Terminal session is no longer available.')
    return session
  }

  private drop(session: Session) {
    this.sessions.delete(session.id)
    if (this.repos.get(session.key) === session.id) this.repos.delete(session.key)
  }
}
