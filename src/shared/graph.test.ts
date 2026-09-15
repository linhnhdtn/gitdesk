import test from 'node:test'
import assert from 'node:assert/strict'
import { lanes } from './graph.ts'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

test('linear history stays in lane 0', () => {
  const r = lanes([c('c', 'b'), c('b', 'a'), c('a')])
  assert.deepEqual(
    r.map((x) => x.lane),
    [0, 0, 0]
  )
  assert.equal(r[0].width, 1)
})

test('merge forks a second lane, then both collapse at the base', () => {
  //   m        merge of f and b
  //   |\
  //   f |      feature
  //   | b      main
  //   |/
  //   a
  const r = lanes([c('m', 'f', 'b'), c('f', 'a'), c('b', 'a'), c('a')])
  assert.equal(r[0].lane, 0, 'merge commit sits in lane 0')
  assert.equal(r[1].lane, 0, 'first parent inherits the merge lane')
  assert.equal(r[2].lane, 1, 'second parent got a fresh lane')
  assert.equal(r[3].lane, 0, 'shared base returns to the lowest lane')
  assert.equal(r[0].width, 2, 'two lanes in use')
  // the merge row draws a branch off to lane 1
  assert.ok(r[0].edges.some((e) => e.from === 0 && e.to === 1))
  // the base row collapses lane 1 into lane 0, drawn arriving (top half) so the
  // line joins the dot rather than passing under it
  assert.ok(r[3].edges.some((e) => e.from === 1 && e.to === 0 && e.up))
  // forks and straight continuations are never 'up'
  assert.ok(r[0].edges.every((e) => (e.from === 0 ? !e.up : true)))
})

test('two unrelated roots occupy separate lanes', () => {
  const r = lanes([c('x', 'x0'), c('y', 'y0'), c('x0'), c('y0')])
  assert.deepEqual(
    r.map((v) => v.lane),
    [0, 1, 0, 1]
  )
})

test('lane count is clamped', () => {
  // one commit with 20 parents must not open 20 lanes
  const r = lanes([c('m', ...Array.from({ length: 20 }, (_, i) => `p${i}`))])
  assert.ok(r[0].width <= 8)
})
