# GitDesk

Personal Git desktop client for Ubuntu. GitHub only.

## Run

```bash
pnpm dev      # hot-reload dev
pnpm test     # porcelain v2 parser self-check
pnpm build    # typecheck + bundle to out/
pnpm pack     # .deb + AppImage into dist/
```

Needs system `git` on PATH. No Rust, no native deps.

## Layout

| Path | What |
|---|---|
| `src/main/git.ts` | every git call — shells out to `git` CLI, parses porcelain v2 |
| `src/main/index.ts` | Electron window + IPC handlers (`{ok,data}`/`{ok,error}` envelope) |
| `src/preload/index.ts` | typed `window.api` bridge, contextIsolation on |
| `src/renderer/src/App.tsx` | whole UI: status, stage/unstage, commit, log, diff |

## GitHub setup

Settings (⚙) → paste a Personal Access Token. Scopes: `repo` (classic), or fine-grained
with **Pull requests: Read+Write** and **Checks: Read**.

Token is encrypted via Electron `safeStorage` → GNOME Keyring. With no keyring backend
it falls back to a `0600` file and the UI says so.

## Done

**Git** — open repo · status (staged/unstaged/untracked/renamed/conflict) · stage/unstage
per file · commit · unified diff · log · fetch/pull/push (force-with-lease) · branch list.

**GitHub** — PR list with CI badge · PR detail (body, check runs, reviews) ·
create PR from current branch · merge (squash/merge/rebase) · close · open in browser.

## Not done yet

Hunk/line staging · commit graph lanes · 3-way conflict solver · branch create/delete ·
stash · tag · PR review comments · interactive rebase · blame.
