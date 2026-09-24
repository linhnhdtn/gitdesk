# Repository Guidelines

## Project Structure & Module Organization

BeoGit is an Electron desktop client built with React 19, TypeScript, and Tailwind CSS v4.

- `src/main/` contains Electron startup, IPC handlers, and all Git CLI access.
- `src/preload/` exposes the typed `window.api` bridge.
- `src/renderer/` contains the HTML entry point and React UI; reusable panes and dialogs live in `src/renderer/src/components/`.
- `src/shared/` holds pure logic shared across process boundaries.
- Tests sit beside logic as `*.test.ts`; generated bundles and packages go to `out/` and `dist/`.

When adding an IPC capability, update `src/main/git.ts`, register it through `handle()` in `src/main/index.ts`, expose it in `src/preload/index.ts`, and call it through `must()` in the renderer. Do not import runtime values from `src/main/` into renderer code.

## Build, Test, and Development Commands

Use Bun 1.2+, Node 22.18+, and a system `git` executable.

- `bun install` installs dependencies and Electron.
- `bun run dev` starts Electron with hot reload.
- `bun run build` type-checks and bundles into `out/`.
- `bun run test` runs all `node:test` suites.
- `bun run start` previews the built app.
- `bun run pack` creates Linux `.deb` and AppImage packages in `dist/`.
- `bunx tsc --noEmit` performs a type-only check.

Use `bun run test`, not `bun test`; the latter invokes Bun's different test runner. Run one suite with `node --test src/shared/graph.test.ts`.

## Coding Style & Naming Conventions

Follow the existing TypeScript style: two-space indentation, single quotes, no semicolons, `camelCase` functions/variables, `PascalCase` React components and types, and one component per `.tsx` file. Keep strict typing and include `.ts` or `.tsx` on relative imports. There is no configured formatter or linter, so match surrounding code. Preserve the `ponytail:` prefix for comments documenting deliberate shortcuts.

## Testing Guidelines

Use the built-in `node:test` and `node:assert` APIs. Add focused tests for parsing and other non-trivial pure logic, named `<module>.test.ts`. The package script only discovers tests in `src/main/` and `src/shared/`; update it if adding another test directory. Run tests and `bun run build` before submitting.

## Commit & Pull Request Guidelines

History favors short, imperative, lowercase subjects such as `rename the app to BeoGit`; optionally prefix a feature area (`File Compare: ...`). Keep commits narrowly scoped. Pull requests should explain behavior and motivation, list verification commands, link relevant issues, and include screenshots or recordings for UI changes. Call out IPC, Git-command, or packaging changes explicitly.
