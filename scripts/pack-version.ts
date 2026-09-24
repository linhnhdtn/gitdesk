import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Reserve a new version before packaging, including after a failed pack. */
export async function bumpPackVersion(root: string): Promise<string> {
  const path = join(root, 'package.json')
  const pkg = JSON.parse(await readFile(path, 'utf8'))
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(pkg.version)
  if (!match) throw new Error('Packaging requires a stable major.minor.patch version in package.json.')
  const [, major, minor, patch] = match
  let highestPatch = BigInt(patch)
  const files = await readdir(join(root, 'dist')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const file of files) {
    const artifact = /^(?:gitdesk_(\d+)\.(\d+)\.(\d+)_[^/]+\.deb|BeoGit-(\d+)\.(\d+)\.(\d+)\.AppImage)$/.exec(file)
    if (!artifact) continue
    const [artifactMajor, artifactMinor, artifactPatch] = artifact[1] ? artifact.slice(1, 4) : artifact.slice(4, 7)
    if (artifactMajor === major && artifactMinor === minor && BigInt(artifactPatch) > highestPatch)
      highestPatch = BigInt(artifactPatch)
  }
  pkg.version = `${major}.${minor}.${highestPatch + 1n}`
  await writeFile(path, JSON.stringify(pkg, null, 2) + '\n')
  return pkg.version
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url))
  console.log(`Packaging BeoGit ${await bumpPackVersion(root)}`)
}
