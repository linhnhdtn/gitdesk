# GitDesk

A personal Git desktop client for Ubuntu, in the shape of SmartGit. Electron +
React 19 + Tailwind v4. Every git operation shells out to the `git` CLI — no
libgit2, no Rust, no native modules.

## Getting started

```bash
git clone git@github.com:linhnhdtn/gitdesk.git
cd gitdesk
pnpm install
pnpm dev
```

You need:

| | |
|---|---|
| **Node 22.18+** | the tests run `.ts` files directly, which needs built-in type stripping |
| **pnpm** | tested on 11.x |
| **git on PATH** | the app is a front end for it; `git 2.34` is enough |

Nothing else. No API keys, no accounts, no services.

On first launch the window is empty — press **Open Repository…** (or the `+` in
the Repositories pane) and pick any folder that contains a `.git`. The choice
is remembered in `localStorage`, so the next launch reopens it.

## Commands

```bash
pnpm dev      # hot reload; edits to src/main restart Electron, src/renderer swap live
pnpm build    # tsc --noEmit, then bundle into out/
pnpm test     # node:test, no framework
pnpm start    # run the built output without the dev server
pnpm pack     # .deb + AppImage into dist/
```

Narrower runs while working:

```bash
node --test src/shared/sidebyside.test.ts                  # one file
node --test --test-name-pattern 'rename' src/*/*.test.ts   # one test
npx tsc --noEmit                                           # typecheck only
```

## What it does

**Repositories** — several at once in the sidebar, each with its current branch
and a dot when it is dirty. Right-click for a label (two clones of the same
folder are otherwise indistinguishable), copy path, reveal, remove.

**Files** — a table of Name / State / Relative Directory. Filter by text, or
toggle whole categories off with the five buttons: modified, new, deleted,
renamed, conflicting. `Ctrl+A` selects everything on screen. Staged rows carry
a green tick and a tinted background.

**Stage, commit, discard, stash** — each opens a dialog that picks files rather
than acting on everything. Commit offers staged vs local changes, amend,
sign-off, and bypassing hooks. Discard asks whether to revert to HEAD or to the
index, warns when a file would be deleted outright, and offers *Discard to
Stash* as the recoverable way out. Stash takes a title so it is findable later.

**Branches** — local, per remote, tags and stashes in one tree. Right-click to
check out, create, rename, delete, merge, fast-forward merge, rebase onto, or
push. The checked-out branch carries a green arrowhead and a tinted row.

**Journal** — the branch's own line (`--first-parent`): a merge counts as one
step and the commits it brought in are skipped, so what actually landed is
legible. Click any commit for a window with its files, their diffs, and the
full commit graph.

**File Compare** — double-click a file for a side-by-side view. Each change
block has one button that takes the left version; nothing is written until
**Save**, and `Ctrl+Z` lifts the last one. Words that actually differ are
marked inside the block, and a bar down the right edge maps every change in the
file and jumps to it.

**Console** — every git command the app runs, with its duration, and the full
stderr when one fails. A failure also raises a dialog carrying the command that
caused it.

## Layout

| Path | What |
|---|---|
| `src/main/git.ts` | every git call. One `git(cwd, args)` shells out; everything else wraps it |
| `src/main/index.ts` | Electron window and IPC handlers |
| `src/preload/index.ts` | the typed `window.api` bridge; contextIsolation on |
| `src/renderer/src/App.tsx` | state and layout; the panes are components beside it |
| `src/renderer/src/components/` | one file per pane or dialog |
| `src/shared/` | pure logic used by both sides, each with a `node:test` file |

## Adding a capability

Four edits, in lockstep:

1. `src/main/git.ts` — the implementation
2. `src/main/index.ts` — one `handle('namespace:verb', fn)` line
3. `src/preload/index.ts` — one entry on the `api` object
4. the renderer — call it through `must(api.thing(...))`

Skip step 3 and the renderer silently gets `undefined`; there is no dynamic
channel lookup. Never register an `ipcMain.handle` directly — `handle()` wraps
every error into `{ ok: false, error }`, and `must()` re-throws it on the other
side so UI code can `try/catch` once.

## Things that will catch you out

**Relative imports need their `.ts` / `.tsx` extension, and the typechecker
will not tell you.** `moduleResolution: bundler` accepts an extensionless
import and `tsc --noEmit` stays quiet, but `node --test` dies with
`ERR_MODULE_NOT_FOUND` because it loads the sources directly.

**A test outside `src/main/` or `src/shared/` is silently skipped.** The script
glob is `src/**/*.test.ts`, npm scripts run under `sh`, and there `**` is just
`*` — one directory level. A test in `src/renderer/src/` matches nothing and
`pnpm test` reports success without it. Verify with `node --test <path>`
directly if a new test seems not to run.

**There is no filesystem watcher.** The working tree is re-read when the window
regains focus. Edit a file in another program and GitDesk catches up when you
click back into it. Marked with a `ponytail:` comment in `App.tsx`.

**`ponytail:` comments mark deliberate shortcuts**, each naming its ceiling and
what to do when it is reached. Keep the format when adding one.

## Not done

Hunk and line staging · 3-way conflict solver · interactive rebase · blame ·
submodules · worktrees · LFS · any hosting integration (GitHub, GitLab).
