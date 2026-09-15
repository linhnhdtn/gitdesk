import test from 'node:test'
import assert from 'node:assert/strict'
import { sideBySide, newFilePatch } from './sidebyside.ts'

const patch = (...body: string[]) =>
  ['diff --git a/f b/f', 'index 111..222 100644', '--- a/f', '+++ b/f', ...body].join('\n')

test('pure insertion pads the left side and keeps numbering right', () => {
  const c = sideBySide(patch('@@ -1,2 +1,3 @@', ' a', '+new', ' b'))
  assert.deepEqual(
    c.pairs.map((p) => [p.left.no, p.left.kind, p.right.no, p.right.kind]),
    [
      [1, 'same', 1, 'same'],
      [null, 'pad', 2, 'add'],
      [2, 'same', 3, 'same']
    ]
  )
  assert.deepEqual(c.blocks, [1])
})

test('a replaced line puts del and add on the same row', () => {
  const c = sideBySide(patch('@@ -1,2 +1,2 @@', ' a', '-old', '+new'))
  const r = c.pairs[1]
  assert.equal(r.left.text, 'old')
  assert.equal(r.right.text, 'new')
  assert.equal(r.left.kind, 'del')
  assert.equal(r.right.kind, 'add')
  assert.deepEqual([r.left.no, r.right.no], [2, 2])
})

test('uneven replace pads the shorter side', () => {
  const c = sideBySide(patch('@@ -1,3 +1,2 @@', '-a', '-b', '+z'))
  assert.equal(c.pairs.length, 2)
  assert.equal(c.pairs[1].right.kind, 'pad')
  assert.equal(c.pairs[1].left.text, 'b')
})

test('hunk header resets both line counters', () => {
  const c = sideBySide(patch('@@ -10,1 +20,1 @@', ' x'))
  assert.deepEqual([c.pairs[0].left.no, c.pairs[0].right.no], [10, 20])
})

test('several change blocks are indexed separately', () => {
  const c = sideBySide(patch('@@ -1,4 +1,4 @@', ' a', '-b', '+B', ' c', '-d', '+D'))
  assert.deepEqual(c.blocks, [1, 3])
})

test('headers and no-newline markers are not rows', () => {
  const c = sideBySide(patch('@@ -1,1 +1,1 @@', '-a', '\\ No newline at end of file', '+a'))
  assert.equal(c.pairs.length, 1)
})

test('binary diffs are flagged, not rendered', () => {
  const c = sideBySide('diff --git a/f b/f\nBinary files a/f and b/f differ\n')
  assert.equal(c.binary, true)
  assert.equal(c.pairs.length, 0)
})

test('untracked file becomes all-additions on the right, nothing on the left', () => {
  const c = sideBySide(newFilePatch('f', 'one\ntwo\n'))
  assert.equal(c.pairs.length, 2, 'the trailing newline is not a third line')
  assert.ok(c.pairs.every((p) => p.left.kind === 'pad' && p.left.no === null))
  assert.deepEqual(c.pairs.map((p) => [p.right.no, p.right.text]), [[1, 'one'], [2, 'two']])
  assert.deepEqual(c.blocks, [0])
})

test('an empty new file yields no rows rather than one blank one', () => {
  assert.equal(sideBySide(newFilePatch('f', '')).pairs.length, 0)
})

test('the patch-ending newline never becomes a phantom context row', () => {
  // git always terminates the patch with \n; split() leaves a trailing ''
  const c = sideBySide('--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n a\n')
  assert.equal(c.pairs.length, 1)
  assert.equal(c.pairs[0].left.no, 1)
})

test('a genuinely blank context line is still a row', () => {
  const c = sideBySide('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n \n')
  assert.equal(c.pairs.length, 2)
  assert.equal(c.pairs[1].left.text, '')
})
