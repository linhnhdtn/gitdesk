import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, push } from './git.ts'

async function fixture(t: TestContext, committed = true) {
  const root = await mkdtemp(join(tmpdir(), 'beogit-push-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'local')
  const remote = join(root, 'remote.git')
  await git(root, ['init', '--bare', remote])
  await git(root, ['init', '-b', 'feature/first-push', cwd])
  await git(cwd, ['config', 'user.name', 'Push Test'])
  await git(cwd, ['config', 'user.email', 'push@example.com'])
  await git(cwd, ['config', 'commit.gpgSign', 'false'])
  await git(cwd, ['config', 'core.hooksPath', join(root, 'no-hooks')])
  await git(cwd, ['config', 'push.default', 'simple'])
  await git(cwd, ['config', 'push.autoSetupRemote', 'false'])
  await git(cwd, ['remote', 'add', 'origin', remote])
  if (committed) await commit(cwd, 'initial')
  return { root, cwd, remote }
}

const commit = (cwd: string, message: string) => git(cwd, ['commit', '--allow-empty', '-m', message])
const head = async (cwd: string, ref = 'HEAD') => (await git(cwd, ['rev-parse', ref])).trim()
const upstream = async (cwd: string) =>
  (await git(cwd, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feature/first-push'])).trim()

test('first push publishes a slash-named branch and subsequent pushes use its upstream', async (t) => {
  const { cwd, remote } = await fixture(t)
  await push(cwd)
  assert.equal(await upstream(cwd), 'origin/feature/first-push')
  assert.equal(await head(remote, 'refs/heads/feature/first-push'), await head(cwd))
  await commit(cwd, 'next')
  await push(cwd)
  assert.equal(await head(remote, 'refs/heads/feature/first-push'), await head(cwd))
})

test('existing upstream on another remote is preserved', async (t) => {
  const { root, cwd, remote } = await fixture(t)
  const other = join(root, 'other.git')
  await git(root, ['init', '--bare', other])
  await git(cwd, ['remote', 'add', 'other', other])
  await git(cwd, ['push', '-u', 'other', 'feature/first-push'])
  await commit(cwd, 'next')
  await push(cwd)
  assert.equal(await upstream(cwd), 'other/feature/first-push')
  assert.equal(await head(other, 'refs/heads/feature/first-push'), await head(cwd))
  assert.equal((await git(remote, ['for-each-ref', 'refs/heads'])).trim(), '')
})

test('missing origin, unborn branches and detached HEAD give actionable errors', async (t) => {
  const { cwd } = await fixture(t, false)
  await assert.rejects(push(cwd), /without commits/)
  await commit(cwd, 'initial')
  await git(cwd, ['checkout', '--detach'])
  await assert.rejects(push(cwd), /detached HEAD/)
  await git(cwd, ['checkout', 'feature/first-push'])
  await git(cwd, ['remote', 'remove', 'origin'])
  await assert.rejects(push(cwd), /Configure origin first/)
})

test('a rejected first push leaves upstream unset and preserves the remote branch', async (t) => {
  const { cwd, remote } = await fixture(t)
  await git(cwd, ['push', 'origin', 'feature/first-push'])
  const original = await head(cwd)
  await git(cwd, ['commit', '--amend', '--allow-empty', '-m', 'rewritten'])
  await assert.rejects(push(cwd), /rejected/)
  assert.equal(await upstream(cwd), '')
  assert.equal(await head(remote, 'refs/heads/feature/first-push'), original)
  await push(cwd, true)
  assert.equal(await upstream(cwd), 'origin/feature/first-push')
  assert.equal(await head(remote, 'refs/heads/feature/first-push'), await head(cwd))
})

test('force-with-lease supports rewrites but refuses unseen remote changes', async (t) => {
  const { cwd, remote } = await fixture(t)
  await push(cwd)
  await git(cwd, ['commit', '--amend', '--allow-empty', '-m', 'rewritten'])
  await push(cwd, true)
  const expected = await head(cwd)
  assert.equal(await head(remote, 'refs/heads/feature/first-push'), expected)

  await commit(cwd, 'remote advance')
  const advanced = await head(cwd)
  // Push by path so origin's tracking ref stays stale, like another client's push.
  await git(cwd, ['push', remote, 'feature/first-push'])
  await git(cwd, ['reset', '--soft', expected])
  await commit(cwd, 'local advance')
  await assert.rejects(push(cwd, true), /stale info/)
  assert.equal(await head(remote, 'refs/heads/feature/first-push'), advanced)
})
