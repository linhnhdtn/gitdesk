# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The package manager is **bun** (`bun install`), not pnpm/npm. Electron's postinstall only
runs because `trustedDependencies` in `package.json` lists `electron` and `esbuild`.

```bash
bun run dev                     # electron-vite dev, hot reload
bun run build                   # tsc --noEmit (typecheck) + bundle to out/
bun run test                    # node:test over src/main + src/shared
bun run pack                    # build + electron-builder → dist/ (.deb, AppImage)

node --test src/main/git.test.ts                        # single file
node --test --test-name-pattern 'rename' src/*/*.test.ts  # single test
bunx tsc --noEmit                                       # typecheck only
```

Always `bun run <script>` — bare `bun test` / `bun build` are bun's own commands and skip
these scripts. Tests run under `node --test`, not bun's runner: they are `node:test` files
and rely on Node 22 type stripping, so Node stays a requirement.

The `test` script lists `src/main/*.test.ts src/shared/*.test.ts` explicitly because scripts
run under `sh`, where `**` matches **one** directory level. A test placed in a new directory
(e.g. `src/renderer/src/`) is silently skipped until that path is added to the script.

Requires system `git` on PATH. There is no Rust or libgit2. The embedded
terminal uses `node-pty` as a production/trusted dependency; Electron Builder
rebuilds and unpacks it. `@xterm/xterm` stays in the renderer; PTY processes
stay in main.

## Architecture

Electron three-process app. Node 22 runs the `.ts` sources directly (type stripping), so
`tsconfig.json` sets `allowImportingTsExtensions` — **every relative import must carry its
`.ts`/`.tsx` extension**.

```
src/main/     Node side. The only place that touches git or the network.
src/preload/  contextBridge → window.api. contextIsolation on, sandbox off.
src/renderer/ React 19 + Tailwind v4. No node access at all.
src/shared/   Pure logic imported by both sides, each with a node:test file.
```

`src/main/terminal.ts` owns PTYs by webContents/repository. `src/main/ai.ts`
builds bounded diff context and invokes only the fixed `codex`/`claude` CLI
providers; quick actions must remain read-only.

### Adding a capability = four edits in lockstep

1. `src/main/git.ts` — the actual implementation
2. `src/main/index.ts` — one `handle('namespace:verb', fn)` line
3. `src/preload/index.ts` — one entry on the `api` object with the response type
4. renderer — call it through `must(api.thing(...))`

Skipping step 3 means the renderer sees `undefined`; there is no dynamic channel lookup.

### The `{ok, data} | {ok, error}` envelope

Nothing throws across IPC. `handle()` in `src/main/index.ts` catches every error and returns
`{ ok: false, error: string }`; `must()` in `src/renderer/src/api.ts` unwraps and re-throws on
the renderer side so UI code can `try/catch` once. Both `App.tsx` (`run`) and `PrDetail`
(`act`) wrap calls in a busy/error helper that surfaces the message in a banner. Never add an
`ipcMain.handle` directly — go through `handle()` or errors become renderer crashes.

### Types cross the process boundary, code does not

`preload/index.ts` and the renderer use `import type` against `src/main/git.ts`
(`RepoStatus`, `FileStatus`, `Commit`, `Ref`, `Stash`, `GitCmd`). These are erased at build
time — never import a *value* from `src/main/` into the renderer.

### Git layer

All git goes through one `git(cwd, args)` in `src/main/git.ts` that shells out to the CLI with
`LC_ALL=C`, `GIT_PAGER=cat`, `GIT_OPTIONAL_LOCKS=0` and a 64 MB buffer, and rethrows stderr as
the error message. Add new git operations as thin wrappers here, not as ad-hoc `execFile` calls.

`parseStatusV2` is the one piece of real parsing and the reason `git.test.ts` exists. It reads
`status --porcelain=v2 -z --branch -uall`, where:
- records are NUL-separated, so paths with spaces survive `line.split(' ')` only because the
  path is reassembled with `f.slice(N).join(' ')`
- a rename (`2`) entry's original path arrives as the **next NUL record**, consumed with `rec[++i]`

`FileStatus.x` is the index/staged state, `.y` the worktree state. `App.tsx` derives its two
panes from those codes (`x !== '.' && x !== '?' && x !== '!'` → staged; `y !== '.' ||
untracked` → unstaged), so changing the parser's semantics changes the UI split.

`push()` uses `--force-with-lease`, never bare `--force`.

### Renderer state model

Single `App.tsx` owns repo path (persisted to `localStorage`), tab, status, log, selection and
modals. There is **no filesystem watcher** — `refresh()` re-runs on window `focus`.

Tailwind v4 with no config file — the palette (`bg`, `panel`, `line`, `fg`, `muted`, `accent`)
is defined in `@theme` inside `src/renderer/src/index.css`.

## Conventions

`ponytail:` comments mark deliberate shortcuts with their known ceiling and upgrade path
(focus-based refresh instead of a watcher; 8-lane clamp on the commit graph). Keep that
format when adding one.

Non-trivial logic leaves one runnable `node:test` file behind — see `git.test.ts`,
`filestate.test.ts`, `graph.test.ts` and `sidebyside.test.ts`. No test framework, no
fixtures.
