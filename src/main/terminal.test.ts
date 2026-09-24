import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalManager, loginShellArgs, terminalSize } from './terminal.ts'

test('terminalSize supplies defaults and clamps hostile renderer values', () => {
  assert.deepEqual(terminalSize(Number.NaN, 20), { cols: 80, rows: 24 })
  assert.deepEqual(terminalSize(1, 999), { cols: 2, rows: 200 })
  assert.deepEqual(terminalSize(120.8, 31.9), { cols: 120, rows: 31 })
})

test('known interactive shells start as login shells', () => {
  assert.deepEqual(loginShellArgs('/bin/bash'), ['-l'])
  assert.deepEqual(loginShellArgs('/usr/bin/zsh'), ['-l'])
  assert.deepEqual(loginShellArgs('/usr/bin/fish'), [])
})

test('TerminalManager reuses a repo session, routes IO, and isolates owners', () => {
  let onData = (_data: string) => {}
  let onExit = (_event: { exitCode: number; signal?: number }) => {}
  const writes: string[] = []
  const sizes: [number, number][] = []
  let killed = 0
  let spawned = 0
  const fake = {
    write: (data: string) => writes.push(data),
    resize: (cols: number, rows: number) => sizes.push([cols, rows]),
    kill: () => void killed++,
    onData: (cb: typeof onData) => ((onData = cb), { dispose() {} }),
    onExit: (cb: typeof onExit) => ((onExit = cb), { dispose() {} })
  }
  const data: string[] = []
  const exits: number[] = []
  const manager = new TerminalManager(
    (_owner, event) => data.push(event.data),
    (_owner, event) => exits.push(event.exitCode),
    (() => (spawned++, fake)) as any
  )

  const first = manager.start(1, '/tmp/repo', 80, 24)
  const reused = manager.start(1, '/tmp/repo', 120, 40)
  assert.equal(reused.id, first.id)
  assert.equal(spawned, 1)
  manager.write(1, first.id, 'hello')
  manager.resize(1, first.id, 100, 30)
  onData('world')
  assert.deepEqual(writes, ['hello'])
  assert.deepEqual(sizes, [[100, 30]])
  assert.deepEqual(data, ['world'])
  assert.throws(() => manager.write(2, first.id, 'no'), /no longer available/)

  onExit({ exitCode: 7 })
  assert.deepEqual(exits, [7])
  const replacement = manager.start(1, '/tmp/repo', 80, 24)
  assert.notEqual(replacement.id, first.id)
  manager.dispose(1, replacement.id)
  assert.equal(killed, 1)
})
