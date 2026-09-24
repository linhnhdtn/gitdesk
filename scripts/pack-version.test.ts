import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bumpPackVersion } from './pack-version.ts'

async function fixture(t: TestContext, version = '1.0.0') {
  const root = await mkdtemp(join(tmpdir(), 'beogit-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'gitdesk', version }))
  return root
}

test('each pack reserves the next patch even without completed artifacts', async (t) => {
  const root = await fixture(t)
  assert.equal(await bumpPackVersion(root), '1.0.1')
  assert.equal(await bumpPackVersion(root), '1.0.2')
  assert.deepEqual(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')), {
    name: 'gitdesk', version: '1.0.2'
  })
})

test('existing deb and AppImage versions are skipped and artifacts preserved', async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, 'dist'))
  const artifacts = ['gitdesk_1.0.9_amd64.deb', 'BeoGit-1.0.12.AppImage', 'BeoGit-0.1.99.AppImage']
  for (const artifact of artifacts) await writeFile(join(root, 'dist', artifact), 'old installer')
  assert.equal(await bumpPackVersion(root), '1.0.13')
  for (const artifact of artifacts)
    assert.equal(await readFile(join(root, 'dist', artifact), 'utf8'), 'old installer')
})

test('invalid or prerelease versions fail without changing package.json', async (t) => {
  const root = await fixture(t, '1.0.0-beta.1')
  const before = await readFile(join(root, 'package.json'), 'utf8')
  await assert.rejects(bumpPackVersion(root), /stable major.minor.patch/)
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), before)
})
