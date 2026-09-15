import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatusV2, commitArgs } from './git.ts'

// -z output: records joined by NUL. Rename entries put origPath in the NEXT record.
const sample = [
  '# branch.oid abc123',
  '# branch.head feature/login',
  '# branch.upstream origin/feature/login',
  '# branch.ab +3 -1',
  '1 M. N... 100644 100644 100644 aaa bbb src/app.ts',
  '1 .M N... 100644 100644 100644 ccc ddd src/util.ts',
  '1 MM N... 100644 100644 100644 eee fff has space.md',
  '2 R. N... 100644 100644 100644 111 222 R100 new/name.ts',
  'old/name.ts',
  'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.ts',
  '? untracked.txt',
  '! ignored.log'
].join('\0')

test('branch header', () => {
  const s = parseStatusV2(sample)
  assert.equal(s.branch, 'feature/login')
  assert.equal(s.upstream, 'origin/feature/login')
  assert.equal(s.ahead, 3)
  assert.equal(s.behind, 1)
})

test('staged vs worktree states', () => {
  const f = parseStatusV2(sample).files
  assert.deepEqual(
    f.find((x) => x.path === 'src/app.ts'),
    { x: 'M', y: '.', path: 'src/app.ts', kind: 'ordinary' }
  )
  assert.equal(f.find((x) => x.path === 'src/util.ts')?.x, '.')
  assert.equal(f.find((x) => x.path === 'src/util.ts')?.y, 'M')
})

test('paths containing spaces survive', () => {
  assert.ok(parseStatusV2(sample).files.some((f) => f.path === 'has space.md'))
})

test('rename consumes the following NUL record as origPath', () => {
  const r = parseStatusV2(sample).files.find((f) => f.kind === 'renamed')
  assert.equal(r?.path, 'new/name.ts')
  assert.equal(r?.origPath, 'old/name.ts')
  // and origPath must NOT leak in as a separate entry
  assert.equal(parseStatusV2(sample).files.filter((f) => f.path === 'old/name.ts').length, 0)
})

test('unmerged, untracked, ignored', () => {
  const f = parseStatusV2(sample).files
  assert.equal(f.find((x) => x.kind === 'unmerged')?.path, 'conflict.ts')
  assert.equal(f.find((x) => x.kind === 'untracked')?.path, 'untracked.txt')
  assert.equal(f.find((x) => x.kind === 'ignored')?.path, 'ignored.log')
})

test('clean repo', () => {
  const s = parseStatusV2('# branch.head main\0')
  assert.equal(s.files.length, 0)
  assert.equal(s.ahead, 0)
})

test('commitArgs: no options is a plain index commit', () => {
  assert.deepEqual(commitArgs('hello'), ['commit', '-m', 'hello'])
})

test('commitArgs: flags come before -m, paths after a -- terminator', () => {
  assert.deepEqual(commitArgs('m', { amend: true, signoff: true, noVerify: true, paths: ['a', 'b'] }), [
    'commit',
    '--amend',
    '--signoff',
    '--no-verify',
    '-m',
    'm',
    '--',
    'a',
    'b'
  ])
})

test('commitArgs: an empty path list still commits the index, not nothing', () => {
  assert.deepEqual(commitArgs('m', { paths: [] }), ['commit', '-m', 'm'])
})

test('commitArgs: a path that looks like a flag stays a path', () => {
  // it sits after --, so git cannot read it as an option
  const a = commitArgs('m', { paths: ['--amend'] })
  assert.equal(a.indexOf('--amend'), a.indexOf('--') + 1)
})
