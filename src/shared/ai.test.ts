import test from 'node:test'
import assert from 'node:assert/strict'
import { aiScopeLabel, chooseAIScope } from './ai.ts'
import type { FileStatus } from '../main/git.ts'

const file = (path: string, x: string, y: string, kind: FileStatus['kind'] = 'ordinary'): FileStatus => ({
  path,
  x,
  y,
  kind
})

test('chooseAIScope: visible selection wins over staged files', () => {
  const scope = chooseAIScope(['work.ts'], [file('index.ts', 'M', '.'), file('work.ts', '.', 'M')])
  assert.deepEqual(scope, { kind: 'selected', paths: ['work.ts'] })
})

test('chooseAIScope: staged changes win when nothing is selected', () => {
  assert.deepEqual(chooseAIScope([], [file('index.ts', 'M', '.'), file('work.ts', '.', 'M')]), {
    kind: 'staged'
  })
})

test('chooseAIScope: falls back to all local and untracked changes', () => {
  assert.deepEqual(chooseAIScope([], [file('work.ts', '.', 'M'), file('new.ts', '?', '?', 'untracked')]), {
    kind: 'all'
  })
})

test('aiScopeLabel describes each scope', () => {
  assert.equal(aiScopeLabel({ kind: 'selected', paths: ['a'] }), '1 selected file')
  assert.equal(aiScopeLabel({ kind: 'selected', paths: ['a', 'b'] }), '2 selected files')
  assert.equal(aiScopeLabel({ kind: 'staged' }), 'staged changes')
  assert.equal(aiScopeLabel({ kind: 'all' }), 'all changes')
})
