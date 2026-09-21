import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sideBySide,
  newFilePatch,
  takeLeft,
  rightText,
  blockKind,
  blockKinds,
  rowBlocks,
  ribbonInset,
  wordDiff,
  type Seg
} from './sidebyside.ts'

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

const patch2 = (...body: string[]) =>
  ['diff --git a/f b/f', 'index 111..222 100644', '--- a/f', '+++ b/f', ...body].join('\n')

test('takeLeft: a replaced line goes back to the left version', () => {
  const c = sideBySide(patch2('@@ -1,3 +1,3 @@', ' a', '-old', '+new', ' b'))
  const t = takeLeft(c, new Set([1]))
  assert.equal(rightText(t), 'a\nold\nb')
  assert.deepEqual(t.blocks, [], 'nothing is left to change')
})

test('takeLeft: reverting an insertion deletes those rows entirely', () => {
  const c = sideBySide(patch2('@@ -1,2 +1,4 @@', ' a', '+x', '+y', ' b'))
  assert.equal(rightText(c), 'a\nx\ny\nb')
  const t = takeLeft(c, new Set([1]))
  assert.equal(rightText(t), 'a\nb')
  assert.equal(t.pairs.length, 2, 'the two added rows are gone, not blanked')
})

test('takeLeft: reverting a deletion brings the line back', () => {
  const c = sideBySide(patch2('@@ -1,3 +1,2 @@', ' a', '-gone', ' b'))
  assert.equal(rightText(c), 'a\nb')
  assert.equal(rightText(takeLeft(c, new Set([1]))), 'a\ngone\nb')
})

test('takeLeft: the right-hand numbering is renumbered after the edit', () => {
  const c = sideBySide(patch2('@@ -1,2 +1,4 @@', ' a', '+x', '+y', ' b'))
  const t = takeLeft(c, new Set([1]))
  assert.deepEqual(t.pairs.map((p) => p.right.no), [1, 2])
  assert.deepEqual(t.pairs.map((p) => p.left.no), [1, 2], 'the left side never moves')
})

test('takeLeft: only the named block is taken, the other survives', () => {
  const c = sideBySide(patch2('@@ -1,5 +1,5 @@', ' a', '-b', '+B', ' c', '-d', '+D'))
  const t = takeLeft(c, new Set([c.blocks[0]]))
  assert.equal(rightText(t), 'a\nb\nc\nD')
  assert.equal(t.blocks.length, 1, 'the second block is still pending')
})

test('takeLeft: taking every block reproduces the left document', () => {
  const c = sideBySide(patch2('@@ -1,4 +1,4 @@', ' a', '-b', '+B', '-c', '+C', ' d'))
  const t = takeLeft(c, new Set(c.blocks))
  assert.equal(rightText(t), 'a\nb\nc\nd')
  assert.deepEqual(t.blocks, [])
})

test('blockKind: a replaced line is a change, not an add and a delete', () => {
  const c = sideBySide(patch2('@@ -1,1 +1,1 @@', '-old', '+new'))
  assert.equal(blockKind(c, 0), 'change')
})

test('blockKind: lines only on the right are an insert', () => {
  const c = sideBySide(patch2('@@ -1,1 +1,3 @@', ' a', '+x', '+y'))
  assert.equal(blockKind(c, 1), 'insert')
})

test('blockKind: lines only on the left are a delete', () => {
  const c = sideBySide(patch2('@@ -1,3 +1,1 @@', ' a', '-x', '-y'))
  assert.equal(blockKind(c, 1), 'delete')
})

test('blockKind: an uneven replace is still a change', () => {
  // two lines become one: both a removal and an addition happened
  const c = sideBySide(patch2('@@ -1,2 +1,1 @@', '-a', '-b', '+c'))
  assert.equal(blockKind(c, 0), 'change')
})

test('blockKinds: every row of every block is coloured, context rows are not', () => {
  const c = sideBySide(patch2('@@ -1,4 +1,5 @@', ' a', '-b', '+B', ' c', '+new', ' d'))
  const m = blockKinds(c)
  assert.equal(m.get(1), 'change')
  assert.equal(m.get(3), 'insert')
  assert.equal(m.get(0), undefined, 'context stays uncoloured')
  assert.equal([...m.values()].length, 2)
})

test('rowBlocks: every row knows its block, its length and its offset', () => {
  const c = sideBySide(patch2('@@ -1,5 +1,6 @@', ' a', '+x', '+y', ' b', '-c', '+C', ' d'))
  const m = rowBlocks(c)
  assert.deepEqual(m.get(1), { start: 1, len: 2, idx: 0, kind: 'insert' })
  assert.deepEqual(m.get(2), { start: 1, len: 2, idx: 1, kind: 'insert' })
  assert.equal(m.get(0), undefined, 'context rows belong to no block')
  assert.equal(m.get(4)?.kind, 'change')
})

test('ribbonInset: a short block is square, not tapered', () => {
  for (const len of [1, 2, 3]) {
    assert.equal(ribbonInset(0, len), 0)
    assert.equal(ribbonInset(0.5, len), 0)
  }
})

test('ribbonInset: a tall block pinches at the ends and opens in the middle', () => {
  const ends = ribbonInset(0, 20)
  const mid = ribbonInset(0.5, 20)
  assert.ok(ends > 0.7, `the tip should be nearly closed, got ${ends}`)
  assert.equal(mid, 0, 'the waist is fully open')
  assert.ok(ribbonInset(0.25, 20) < ends && ribbonInset(0.25, 20) > mid, 'it eases between')
})

test('ribbonInset: symmetric about the middle', () => {
  assert.equal(ribbonInset(0.2, 20).toFixed(6), ribbonInset(0.8, 20).toFixed(6))
})

const txt = (segs: Seg[]) => segs.map((s) => (s.hi ? `[${s.text}]` : s.text)).join('')

test('wordDiff: only the word that changed is marked', () => {
  const d = wordDiff(['const a = 1'], ['const b = 1'])
  assert.equal(txt(d.left[0]), 'const [a] = 1')
  assert.equal(txt(d.right[0]), 'const [b] = 1')
})

test('wordDiff: text appended to a line marks only the tail', () => {
  const d = wordDiff(['run test'], ['run test --watch'])
  assert.equal(txt(d.right[0]), 'run test[ --watch]')
  assert.equal(txt(d.left[0]), 'run test', 'nothing on the left changed')
})

test('wordDiff: one line becoming several keeps the shared opening plain', () => {
  const d = wordDiff(['first, then: node x'], ['first, then:', '  node x [extra]'])
  assert.ok(txt(d.right[0]).startsWith('first, then:'), txt(d.right[0]))
  assert.equal(d.right.length, 2, 'one segment list per right line')
  assert.ok(txt(d.right[1]).includes('['), 'the new second line is marked')
})

test('wordDiff: identical text is marked nowhere', () => {
  const d = wordDiff(['same'], ['same'])
  assert.equal(d.left[0].some((s) => s.hi), false)
  assert.equal(d.right[0].some((s) => s.hi), false)
})

test('wordDiff: an empty side leaves the other fully marked', () => {
  const d = wordDiff([], ['brand new'])
  assert.equal(txt(d.right[0]), '[brand new]')
})

test('wordDiff: always returns one entry per line, even blank ones', () => {
  const d = wordDiff(['a', '', 'b'], ['a', '', 'c'])
  assert.equal(d.left.length, 3)
  assert.equal(d.right.length, 3)
})

test('wordDiff: adjacent tokens of the same state are merged into one span', () => {
  const d = wordDiff(['x'], ['completely different text here'])
  assert.equal(d.right[0].length, 1, 'one span, not one per word')
})
