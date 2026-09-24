import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { AIRunner, buildAIContext, buildAIPrompt, providerArgs } from './ai.ts'
import type { AIRequest } from '../shared/ai.ts'

const exec = promisify(execFile)

test('Codex runs in an ephemeral read-only sandbox at the repository root', () => {
  const args = providerArgs('codex', '/repo', '/tmp/result')
  assert.deepEqual(args, [
    'exec', '-C', '/repo', '--sandbox', 'read-only', '--ephemeral', '--color', 'never',
    '--output-last-message', '/tmp/result', '-'
  ])
})

test('Claude print mode exposes only read-oriented tools', () => {
  const args = providerArgs('claude', '/repo')
  assert.ok(args.includes('plan'))
  assert.ok(args.includes('Read,Glob,Grep'))
  assert.ok(!args.includes('--permission-prompts'))
  assert.ok(!args.some((arg) => /Edit|Write|Bash/.test(arg)))
})

test('review prompt treats patch contents as data and requires actionable locations', () => {
  const prompt = buildAIPrompt('review', 'diff --git a/a.ts b/a.ts')
  assert.match(prompt, /untrusted data/)
  assert.match(prompt, /file:line/)
  assert.match(prompt, /No findings/)
})

test('review prompt requests Vietnamese when selected', () => {
  const prompt = buildAIPrompt('review', 'patch', 'vi')
  assert.equal(prompt.match(/NGÔN NGỮ PHẢN HỒI BẮT BUỘC/g)?.length, 2)
  assert.match(prompt, /Toàn bộ phần giải thích.*PHẢI viết bằng tiếng Việt/)
  assert.match(prompt, /END UNTRUSTED CHANGE CONTEXT/)
  assert.match(prompt, /Không phát hiện vấn đề/)
})

test('commit prompt follows repository history style and returns only the message', () => {
  const prompt = buildAIPrompt('commit-message', 'patch')
  assert.match(prompt, /COMMIT LANGUAGE: ENGLISH/)
  assert.match(prompt, /imperative/)
  assert.match(prompt, /72 characters/)
  assert.match(prompt, /Return only the commit message/)
})

test('commit prompt follows the selected Vietnamese language', () => {
  const prompt = buildAIPrompt('commit-message', 'patch', 'vi')
  assert.equal(prompt.match(/NGÔN NGỮ COMMIT BẮT BUỘC/g)?.length, 2)
  assert.match(prompt, /Tiêu đề và nội dung commit PHẢI viết bằng tiếng Việt/)
  assert.doesNotMatch(prompt, /Use English/)
})

test('AI context keeps staged, selected, and all scopes distinct', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'gitdesk-ai-test-'))
  const secret = `${cwd}-secret`
  try {
    await exec('git', ['init', '-q'], { cwd })
    await exec('git', ['config', 'user.email', 'test@example.com'], { cwd })
    await exec('git', ['config', 'user.name', 'Test'], { cwd })
    await writeFile(join(cwd, 'tracked.txt'), 'base\n')
    await exec('git', ['add', 'tracked.txt'], { cwd })
    await exec('git', ['commit', '-qm', 'base'], { cwd })

    await writeFile(join(cwd, 'tracked.txt'), 'staged version\n')
    await exec('git', ['add', 'tracked.txt'], { cwd })
    await writeFile(join(cwd, 'tracked.txt'), 'working version\n')
    await writeFile(join(cwd, 'new.txt'), 'untracked version\n')

    const staged = await buildAIContext(cwd, { kind: 'staged' })
    assert.match(staged, /staged version/)
    assert.doesNotMatch(staged, /working version|untracked version/)

    const selected = await buildAIContext(cwd, { kind: 'selected', paths: ['new.txt'] })
    assert.match(selected, /untracked version/)
    assert.doesNotMatch(selected, /tracked\.txt/)

    const all = await buildAIContext(cwd, { kind: 'all' })
    assert.match(all, /working version/)
    assert.match(all, /untracked version/)

    await writeFile(secret, 'must never leave the filesystem')
    await symlink(secret, join(cwd, 'leak'))
    const link = await buildAIContext(cwd, { kind: 'selected', paths: ['leak'] })
    assert.match(link, /new file mode 120000/)
    assert.match(link, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(link, /must never leave/)

    await writeFile(join(cwd, 'large-a.txt'), 'a'.repeat(300 * 1024))
    await writeFile(join(cwd, 'large-b.txt'), 'b'.repeat(300 * 1024))
    await assert.rejects(buildAIContext(cwd, { kind: 'all' }), /larger than 512 KiB|too large/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
    await rm(secret, { force: true })
  }
})

const request = (id: string): AIRequest => ({
  requestId: id,
  cwd: '/repo',
  provider: 'claude',
  action: 'review',
  language: 'en',
  scope: { kind: 'all' }
})

test('AIRunner reserves a repo immediately and cancellation works before spawn', async () => {
  let finishLookup: (path: string) => void = () => {}
  let spawns = 0
  const runner = new AIRunner({
    findExecutable: () => new Promise((done) => (finishLookup = done)),
    buildContext: async () => 'context',
    spawnProcess: (() => {
      spawns++
      throw new Error('must not spawn')
    }) as any
  })

  const first = runner.run(1, request('request-1'))
  await assert.rejects(runner.run(1, request('request-2')), /already running/)
  assert.equal(runner.cancel(1, 'request-1'), true)
  finishLookup('/fake/claude')
  await assert.rejects(first, /cancelled/)
  assert.equal(spawns, 0)
})

test('AIRunner absorbs stdin EPIPE and reports the CLI failure', async () => {
  const child = new EventEmitter() as any
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  const runner = new AIRunner({
    findExecutable: async () => '/fake/claude',
    buildContext: async () => 'context',
    spawnProcess: (() => {
      queueMicrotask(() => {
        child.stderr.write('authentication failed')
        child.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
        child.emit('close', 1)
      })
      return child
    }) as any
  })

  await assert.rejects(runner.run(1, request('request-3')), /authentication failed/)
})
