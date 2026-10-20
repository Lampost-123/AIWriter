# AI Write

Desktop app (Electron + React + SQLite) for writing long, consistent stories with AI.
Adam (the user) doesn't code. Anything he sees must be in plain words, polished, and without jank.

## Project map

- `src/shared/` types and the `AppApi` contract both sides use
- `src/main/` Electron main process: database, memory engine, AI, IPC handlers
- `src/preload/` exposes `window.aiwrite`, nothing else
- `src/renderer/src/` the React interface: `components/ui` design system, `features/` screens
- `tests/` `unit/` (Vitest), `e2e/` (Playwright), plus evals (`traps/`, `chat-eval/`, `recall-eval/`) and fakes
- `docs/ARCHITECTURE.md` full layout, rules, and one section per feature; links the spec

<important if="you are about to change code">
Read `docs/ARCHITECTURE.md` lines 1-116 (Stack, Layout, Rules, Releases) first, then the section for the feature you are touching. It is long; don't read it end to end.
</important>

<important if="you are deciding what to build or how a feature should behave">
The spec (linked at the top of `docs/ARCHITECTURE.md`) is the source of truth. Don't redesign; build what the current milestone lists.
</important>

<important if="you need to run commands to build, test, or package the app">

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check main and renderer |
| `npm test` | Vitest unit tests |
| `npm run build` | Build the app |
| `npm run test:e2e` | Playwright app tests (builds first). Needs a display: `xvfb-run -a` on Linux |
</important>

<important if="you are writing interface text, error messages, or anything else Adam will read">
Use plain words with no jargon. Errors meant for Adam are thrown as `UserError` with a plain message and a next step.
</important>
