# AI Write

Desktop app (Electron + React + SQLite) for writing long, consistent stories with AI.
Read docs/ARCHITECTURE.md before changing code; it lists the layout and the rules.

- `npm run typecheck`, `npm test` (Vitest), `npm run build`, `npm run test:e2e` (Playwright, needs a display: use `xvfb-run -a` on Linux).
- Adam (the user) doesn't code. Anything he sees must be in plain words, polished, and without jank.
- The spec (linked in docs/ARCHITECTURE.md) is the source of truth. Don't redesign; build what the current milestone lists.
