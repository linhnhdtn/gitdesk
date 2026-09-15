import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollup, type CheckRun } from './checks.ts'

const done = (c: string): CheckRun => ({ status: 'completed', conclusion: c })
const running: CheckRun = { status: 'in_progress', conclusion: null }

test('no checks -> no badge', () => assert.equal(rollup([]), null))

test('all success -> passed', () =>
  assert.equal(rollup([done('success'), done('success')])?.label, 'passed'))

test('skipped and neutral still count as passed', () =>
  assert.equal(rollup([done('success'), done('skipped'), done('neutral')])?.label, 'passed'))

test('any failure -> failed', () =>
  assert.equal(rollup([done('success'), done('failure')])?.label, 'failed'))

test('timed_out and cancelled count as failed', () => {
  assert.equal(rollup([done('timed_out')])?.label, 'failed')
  assert.equal(rollup([done('cancelled')])?.label, 'failed')
})

test('running beats failure — it may still be retried', () =>
  assert.equal(rollup([done('failure'), running])?.label, 'running'))

test('unknown conclusion -> mixed, never a false green', () =>
  assert.equal(rollup([done('success'), done('action_required')])?.label, 'mixed'))
