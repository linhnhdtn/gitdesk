import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { join } from 'node:path'
import * as G from './git.ts'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.mjs'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

/** Every git call is funnelled through here so errors reach the UI as strings, not crashes. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true as const, data: await fn(...(args as A)) }
    } catch (e: any) {
      return { ok: false as const, error: String(e.message ?? e) }
    }
  })
}

handle('repo:pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (r.canceled) return null
  const cwd = r.filePaths[0]
  await G.git(cwd, ['rev-parse', '--git-dir']) // throws if not a repo
  return cwd
})

handle('git:status', (cwd: string) => G.status(cwd))
handle('git:log', (cwd: string, limit: number, skip: number, all: boolean) =>
  G.log(cwd, limit, skip, all)
)
handle('git:diff', (cwd: string, path: string, staged: boolean, context: number) =>
  G.diffFile(cwd, path, staged, context)
)
handle('git:readWorktree', (cwd: string, path: string) => G.readWorktree(cwd, path))
handle('git:diffNew', (cwd: string, path: string) => G.diffNew(cwd, path))
handle('git:remove', (cwd: string, tracked: string[], untracked: string[]) =>
  G.remove(cwd, tracked, untracked)
)
handle('git:ignore', (cwd: string, patterns: string[]) => G.ignore(cwd, patterns))
handle('git:merge', (cwd: string, ref: string, ffOnly: boolean) => G.merge(cwd, ref, ffOnly))
handle('git:rebase', (cwd: string, ref: string) => G.rebase(cwd, ref))
handle('git:createBranch', (cwd: string, name: string, start?: string) =>
  G.createBranch(cwd, name, start)
)
handle('git:renameBranch', (cwd: string, from: string, to: string) => G.renameBranch(cwd, from, to))
handle('git:deleteBranch', (cwd: string, name: string, force: boolean) =>
  G.deleteBranch(cwd, name, force)
)
handle('git:pushBranch', (cwd: string, b: string, up: boolean) => G.pushBranch(cwd, b, up))
handle('git:stage', (cwd: string, paths: string[]) => G.stage(cwd, paths))
handle('git:unstage', (cwd: string, paths: string[]) => G.unstage(cwd, paths))
handle('git:commit', (cwd: string, msg: string, opts: G.CommitOpts) => G.commit(cwd, msg, opts))
handle('git:lastMessage', (cwd: string) => G.lastMessage(cwd))
handle('git:fetch', (cwd: string) => G.fetch(cwd))
handle('git:pull', (cwd: string, rebase: boolean) => G.pull(cwd, rebase))
handle('git:push', (cwd: string, force: boolean) => G.push(cwd, force))
handle('git:refs', (cwd: string) => G.refs(cwd))
handle('git:checkout', (cwd: string, ref: string) => G.checkout(cwd, ref))
handle('git:discard', (cwd: string, paths: string[], untracked: string[]) =>
  G.discard(cwd, paths, untracked)
)
handle('git:stashList', (cwd: string) => G.stashList(cwd))
handle('git:stashSave', (cwd: string, msg: string) => G.stashSave(cwd, msg))
handle('git:stashApply', (cwd: string, ref: string) => G.stashApply(cwd, ref))
handle('git:stashDrop', (cwd: string, ref: string) => G.stashDrop(cwd, ref))
handle('git:repoBrief', (cwd: string) => G.repoBrief(cwd))
handle('git:showCommit', (cwd: string, sha: string) => G.showCommit(cwd, sha))

handle('sys:openPath', async (cwd: string, path: string) => {
  const e = await shell.openPath(G.inRepo(cwd, path))
  if (e) throw new Error(e) // openPath reports failure as a string, it does not throw
})
handle('sys:copy', (text: string) => clipboard.writeText(text))
handle('sys:reveal', (cwd: string, path: string) => shell.showItemInFolder(G.inRepo(cwd, path)))

// Single-window app, so no ref to keep and no listener to tear down on re-create.
G.bus.on('cmd', (e) => BrowserWindow.getAllWindows()[0]?.webContents.send('git:cmd', e))

app.whenReady().then(createWindow)
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
