# BeoGit

A personal Git desktop client for Ubuntu, in the shape of SmartGit. Electron +
React 19 + Tailwind v4. Every git operation shells out to the `git` CLI — no
libgit2, no Rust, no native modules.

## Getting started

Install [bun](https://bun.sh) once:

```bash
curl -fsSL https://bun.sh/install | bash        # Linux / macOS
# Windows (PowerShell):  powershell -c "irm bun.sh/install.ps1 | iex"
```

Then:

```bash
git clone git@github.com:linhnhdtn/gitdesk.git
cd gitdesk
bun install
bun run dev
```

`bun install` downloads the Electron binary through its postinstall script —
that only runs because `trustedDependencies` in `package.json` lists `electron`
and `esbuild`. If `node_modules/electron/dist/` ends up empty, that entry is
what to check.

You need:

| | |
|---|---|
| **bun 1.2+** | package manager and script runner; tested on 1.3.x |
| **Node 22.18+** | the tests still run under `node --test`, which needs built-in type stripping |
| **git on PATH** | the app is a front end for it; `git 2.34` is enough |

`bun run test` shells out to `node --test`, not to `bun test` — the suites are
`node:test` files and bun's own runner is a different API. Keep Node installed
even though bun does everything else.

Nothing else. No API keys, no accounts, no services.

The **Terminal** tab works without extra setup. Its AI shortcuts optionally use
an installed and logged-in `codex` or `claude` CLI; credentials stay with that
CLI and are never stored by BeoGit.

On first launch the window is empty — press **Open Repository…** (or the `+` in
the Repositories pane) and pick any folder that contains a `.git`. The choice
is remembered in `localStorage`, so the next launch reopens it.

## Commands

```bash
bun run dev      # hot reload; edits to src/main restart Electron, src/renderer swap live
bun run build    # tsc --noEmit, then bundle into out/
bun run test     # node:test, no framework
bun run start    # run the built output without the dev server
bun run pack     # build, increment patch version, then .deb + AppImage into dist/
```

`bun run <script>` and not bare `bun <script>` — `bun test` and `bun build` are
bun's own built-in commands and would ignore these scripts entirely.

Each `bun run pack` increments `package.json`'s patch version after a successful
build: `1.0.0` → `1.0.1` → `1.0.2`. Installers include this version in their names,
for example `dist/gitdesk_1.0.1_amd64.deb` and `dist/BeoGit-1.0.1.AppImage`.
Existing installers are kept; versions already present in `dist/` within the
same major/minor series are skipped. If packaging fails after the increment,
that version stays reserved and the next run increments again. No Git commit
or tag is created automatically. Packaging metadata and `linux-unpacked/`
still reflect the latest run. Run packs one at a time in a checkout.

Narrower runs while working:

```bash
node --test src/shared/sidebyside.test.ts                  # one file
node --test --test-name-pattern 'rename' src/*/*.test.ts   # one test
bunx tsc --noEmit                                          # typecheck only
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

**Terminal + AI** — a real shell per repository, kept alive while switching
repositories. Quick actions review the selected/staged/local diff or draft a
commit message through Codex or Claude in read-only mode. Interactive AI edits
remain explicit: run the CLI yourself in the terminal.

## Layout

| Path | What |
|---|---|
| `src/main/git.ts` | every git call. One `git(cwd, args)` shells out; everything else wraps it |
| `src/main/ai.ts`, `terminal.ts` | read-only AI tasks and PTY session management |
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

**A test outside `src/main/` or `src/shared/` is silently skipped.** The `test`
script names those two directories explicitly (`src/main/*.test.ts
src/shared/*.test.ts`) because a `src/**/*.test.ts` glob expands to one
directory level in `sh`. Add the directory to the script when tests move, and
verify with `node --test <path>` directly if a new test seems not to run.

**There is no filesystem watcher.** The working tree is re-read when the window
regains focus. Edit a file in another program and BeoGit catches up when you
click back into it. Marked with a `ponytail:` comment in `App.tsx`.

**`ponytail:` comments mark deliberate shortcuts**, each naming its ceiling and
what to do when it is reached. Keep the format when adding one.

## Not done

Hunk and line staging · 3-way conflict solver · interactive rebase · blame ·
submodules · worktrees · LFS · any hosting integration (GitHub, GitLab).
