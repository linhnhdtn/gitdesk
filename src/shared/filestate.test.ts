import test from 'node:test'
import assert from 'node:assert/strict'
import { category, state, isStaged, counts } from './filestate.ts'
import type { FileStatus } from '../main/git.ts'

const f = (x: string, y: string, kind: FileStatus['kind'] = 'ordinary'): FileStatus => ({
  path: 'p',
  x,
  y,
  kind
})

test('category: each file lands in exactly one bucket', () => {
  assert.equal(category(f('?', '?', 'untracked')), 'added')
  assert.equal(category(f('A', '.')), 'added')
  assert.equal(category(f('M', '.')), 'modified')
  assert.equal(category(f('.', 'M')), 'modified')
  assert.equal(category(f('R', '.', 'renamed')), 'renamed')
  assert.equal(category(f('D', '.')), 'deleted')
  assert.equal(category(f('.', 'D')), 'deleted')
  assert.equal(category(f('U', 'U', 'unmerged')), 'conflict')
})

test('category: a new file edited after staging is still "added"', () => {
  // hiding new files has to hide this one too, or the toggle lies
  assert.equal(category(f('A', 'M')), 'added')
})

test('category: conflict outranks everything', () => {
  assert.equal(category(f('D', 'D', 'unmerged')), 'conflict')
})

test('state: both halves of the code are reported', () => {
  assert.equal(state(f('M', '.')), 'Staged Modified')
  assert.equal(state(f('.', 'M')), 'Modified')
  assert.equal(state(f('A', 'M')), 'Staged Added, Modified')
  assert.equal(state(f('?', '?', 'untracked')), 'Untracked')
  assert.equal(state(f('.', '.')), 'Unchanged')
})

test('isStaged ignores the untracked and ignored markers', () => {
  assert.equal(isStaged(f('M', '.')), true)
  assert.equal(isStaged(f('.', 'M')), false)
  assert.equal(isStaged(f('?', '?', 'untracked')), false)
  assert.equal(isStaged(f('!', '!', 'ignored')), false)
})

test('counts totals every file exactly once', () => {
  const files = [f('A', '.'), f('?', '?', 'untracked'), f('.', 'M'), f('D', '.')]
  const c = counts(files)
  assert.deepEqual(c, { conflict: 0, deleted: 1, renamed: 0, added: 2, modified: 1 })
  assert.equal(Object.values(c).reduce((a, b) => a + b, 0), files.length)
})
