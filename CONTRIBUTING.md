# Contributing to AI Write

Thanks for wanting to help. AI Write is a Windows desktop app for writing long, consistent stories with AI.
Most of its users are writers, not programmers, so the bar for what appears on screen is high: plain words,
nothing that jumps or flickers, and nothing that can lose someone's work.

## Reporting a bug or asking for a feature

[Open an issue](https://github.com/Lampost-123/AIWriter/issues/new/choose) and pick **Bug report** or
**Feature request**. You don't need to know any code. Please never paste an API key, and only include story text
you're happy to share publicly.

## Setting up

You need Windows (the app is built and shipped for Windows x64), [Node.js 22](https://nodejs.org) and Git.

```
git clone https://github.com/Lampost-123/AIWriter.git
cd AIWriter
npm ci             # install exactly what package-lock.json lists (it never changes the file)
npm run dev        # run the app with hot reload
```

Other commands:

| Command | What it does |
|---|---|
| `npm run typecheck` | TypeScript checks for the main process and the window |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Build the app |
| `npm run test:e2e` | App tests (Playwright driving the built app; run `npm run build` first) |
| `npm run dist:win` | Build the Windows installer into `release/` |
| `npm run traps` | Opt-in test of story memory against a real model. It needs a DeepSeek key and **costs money**, so it never runs in CI. |

The app tests use a fake AI provider and a fake speech server (`tests/fake-provider`, `tests/fake-speech`), so they
need no keys and cost nothing.

## Before you change code

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It describes the layout (`src/main` for the Electron main
process, `src/preload`, `src/renderer` for the React window, `src/shared` for types and logic used by both) and the
rules below in more detail.

## The rules

**Data**
- Change the database only by **appending** a migration in `src/main/db/migrations.ts`. Never edit a migration that
  has shipped.
- All SQL lives in `src/main/db/`.

**API between the window and the main process**
- Add new methods to `AppApi` in `src/shared/api.ts`, then implement them in the matching handler in
  `src/main/ipc/`.
- Errors meant for the user are thrown as `UserError` with a plain-words message and a next step.

**Keys**
- API keys never reach the window (renderer), a world folder, a backup, a world file or an export.

**Look**
- Colours come only from the theme tokens in `src/renderer/src/styles.css` (`bg-surface`, `text-muted`,
  `border-line`, `bg-accent`, `text-ai` and so on). Amber marks AI suggestions, red only must-fix problems, green
  done. Both looks (New look and Classic) and all three themes (Light, Dark, Sepia) must work.

**No jank**
- No layout shift while loading: reserve the space, or render nothing rather than a flash.
- No "are you sure?" dialogs for routine actions. Make them undoable and show a toast with **Undo** instead.
- Saving is automatic and silent.
- Every AI action streams its output and can be stopped.
- Anything that holds unsaved work registers with `registerFlusher` (`src/renderer/src/lib/flush.ts`), so it is
  saved before the window closes or the world changes.

**Words on screen**
- Use the writer's words: world, story, chapter, scene, character, place, lore, draft. Never "entity", "LLM",
  "generation" or other programmer terms.
- Short, plain sentences. Say what happened and what to do next.

## Tests

- Add or update unit tests next to the logic you change (`*.test.ts`).
- If you change something on screen, run the app tests that cover it. Locally, running the unit tests plus the
  affected Playwright specs is enough; CI runs the full suite on your pull request.
- CI runs the typecheck, the unit tests (on Linux and Windows), the app tests in four shards, and builds the
  Windows installer. Everything must be green.

## Pull requests

1. Make a branch from `main`.
2. Keep each pull request to one change, with a clear title and a short description of what changes for the writer.
3. Include a screenshot for anything visible.
4. Don't bump the version or edit `build/release-notes.md` unless you're preparing a release.

## Screenshots

The pictures in `docs/images/` are taken from the real app by `tests/docs/screenshots.spec.ts`, using the
Gullhaven sample world and a stand-in AI server, so no AI service is called and nothing costs money.
CI doesn't run it. To retake them all:

```
npm run docs:screenshots
```

To retake only some, name them, for example `DOCS_SHOTS=hero,ask npx playwright test -c tests/docs/playwright.config.ts`
(this skips the build). Look at every picture before you commit it.

## Releases

Releases are made by the maintainer. Running `.github/workflows/release.yml` (by hand from the Actions tab,
or by pushing a tag `vX.Y.Z` that matches `version` in `package.json`) publishes the installer to GitHub Releases. Installed copies update
themselves from there. `build/release-notes.md` holds that version's notes, in plain words.
