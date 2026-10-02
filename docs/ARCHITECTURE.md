# AI Write architecture

The spec is the source of truth: https://claude.ai/code/artifact/a4551334-2c4b-4c42-b4be-4c6726465a79
This file says how the code is laid out so each part can be built without
stepping on the others. Milestone 1 is the first working version.

## Stack

Electron 44, React 19, TypeScript, Vite (electron-vite), Tailwind CSS 4 with
Radix UI primitives, TipTap 3 for the manuscript editor, SQLite through
better-sqlite3 (N-API prebuilds ship in the package, so no native rebuild is
needed for Electron), electron-builder for the Windows installer, electron-updater
for updates, Vitest for logic tests and Playwright (`_electron`) for app tests.

Electron 44 no longer downloads its own binary when installed, and `electron-vite dev` won't
fetch it ("Error: Electron uninstall"), so the `postinstall` script runs `install-electron`.

## Layout

```
src/shared/      Types and the API contract shared by both sides. Only additive changes.
  types.ts       Domain types (World, Story, Chapter, Scene, Entry, Settings, GenerationRecord...)
  api.ts         AppApi: every call the interface can make, plus main->renderer events
  fields.ts      Character / place / lore field lists (forms and context assembly both use them)
  defaults.ts    Default scene card, style guide, settings, creativity presets, countWords
src/main/        Electron main process
  memory/        The memory engine (milestone 2): types.ts is its contract; line.ts (which stories,
                 chapters and scenes come before a point), state.ts (what is true there), scene.ts
                 (reads the database: what counts for one scene). Pure where it can be.
  keeper/        The memory keeper (milestone 2): reads scene text with the memory model and keeps
                 the memory in step with it, plus summaries at every level
  index.ts       Window, lifecycle, flush-on-close
  world.ts       The open world (one folder: world.db, images/, backups/)
  db/            migrations.ts (append-only), repo.ts and other modules holding all SQL (no Electron imports)
  settings.ts    App settings (userData/settings.json) and writing preferences (library folder)
  secrets.ts     API keys, encrypted with safeStorage, kept out of worlds and backups
  ipc/           One handler object per area; ipc/index.ts checks every AppApi method is implemented
  ai/            Providers, context assembly, generation records
  services/      backups.ts, updater.ts
src/preload/     Exposes window.aiwrite (invoke + events). Nothing else.
src/renderer/src/
  lib/           api client, zustand store (navigation + open world), flush registry, editor bridge, theme
  components/ui  The design system. Use these, not raw elements, for buttons, fields, tabs, dialogs, selects
  layout/        Top bar, resizable side panes, inspector, update banner
  features/      binder, editor, inspector, world, style, settings, generate, welcome
```

## Rules

- **Data model.** Change the database only by appending a migration in
  `src/main/db/migrations.ts`. Never edit a shipped migration. All SQL lives in `src/main/db/`.
- **API.** Add methods to `AppApi` in `src/shared/api.ts`, then implement them in
  the matching `src/main/ipc/*.ts` handler object. Errors meant for Adam are thrown as
  `UserError` with a plain-words message and a next step.
- **Keys** never reach the renderer, a world folder, a backup or an export.
- **Look.** Colours come only from the theme tokens in `styles.css` (bg-surface,
  text-muted, border-line, bg-accent, text-ai ...). Amber (`ai`) marks AI suggestions,
  red (`danger`) only must-fix problems, green (`success`) done. Interface text is Inter;
  prose is Literata (`font-serif`). Motion is 150–200 ms and never on text.
- **No jank.** No layout shift while loading (reserve space, render nothing rather than a
  flash), no modals or "are you sure?" for routine actions (make them undoable and show a
  toast), saving is automatic and silent, every AI action streams and can be stopped.
  Deletes are announced with `announceDelete` (`lib/undoDelete.ts`): one Undo toast that
  gathers deletes made while it shows, and Settings › Recently deleted for 30 days after.
- **Words.** On screen, use Adam's words: world, story, chapter, scene, character, place,
  lore, draft. Never "line", "main history", "entity", "generation" or "LLM".
- **Never lose a keystroke.** Anything holding unsaved work registers with
  `registerFlusher` (`lib/flush.ts`); it runs before the window closes and before switching worlds.

## Releases and updates

- `.github/workflows/release.yml` publishes the installer to GitHub Releases of
  Lampost-123/AIWriter when a tag `vX.Y.Z` matching `version` in package.json is pushed, or
  when it is run by hand on `main`. CI also builds one on every push (the run's Artifacts) and
  checks it holds only the app (`build/check-package.mjs`).
- Each release's text is `build/release-notes.md`: plain words for Adam, shown on the release
  page and, through latest.yml, under "What's new" when the app offers the update (about 600
  characters at most, or the app cuts it short). Its first line is `<!-- version: X.Y.Z -->`
  and must match package.json; the release workflow and `tests/unit/releaseNotes.test.ts`
  check it, so bumping the version means writing that version's notes.
- Installed copies look for updates there (electron-updater, `publish` in electron-builder.yml)
  **without a token**, so the releases must be readable by anyone: the repository has to be
  public, or the installers published to a separate public releases repository (point `publish`
  at it and give the release workflow a token that can write there; never put a token in
  electron-builder.yml, it would ship inside the app). While the releases can't be read,
  installed copies say "Automatic updates aren't set up yet".
- `AUTO_UPDATES` in src/shared/defaults.ts turns the checks off entirely (Adam then updates by
  hand; Settings › About links to the Releases page). It is on: Adam wants automatic updates.
- In electron-builder.yml each platform's `files` list is complete: a platform list replaces the
  top-level one rather than adding to it.
- The installer isn't code-signed yet, so Windows shows "Windows protected your PC" when it is
  first run; the README says what to click.

## Milestone 2: memory that keeps up

What it adds: mark scene done; summaries at every level; changes over time (baseline plus changes);
relationships and knowledge; plot threads; the memory keeper; context budgeting with short forms;
the Context tab with pins. It also stores everything stories outside one series need (story kinds,
start and end points, start-of-story changes, where entries first exist, Adam's answers), with
the rules in the spec's "Multi-story rules" tab; most of their screens arrive in milestone 3.

**The data model is frozen after this milestone** (migration 2). A later change needs a written
reason here and a new migration, never a rewrite. Until 0.2.0 ships, migration 2 may still change.
Each world's overrides of Adam's writing preferences (spec: "Stored in milestone 2") live in the
`meta` table under the key `writing_prefs_overrides`, as JSON (`Partial<WritingPrefs>`); the
preferences themselves stay outside world.db and are not frozen.

### How memory over time works

- An entry row is its **baseline**. Every later fact is a row in `changes`, pinned to an anchor:
  `baseline` (relationships and knowledge Adam sets on the entry page), `story-start` (before a
  story's first scene) or `scene` (it happens in that scene). Kinds: `update` (a note of what is
  now different, plus new field values), `full` (start-of-story full description), `relationship`
  (one per pair of entries, from either side; a later one replaces it), `knowledge` (a character
  learns or forgets a fact; facts are shared by id), `thread` (a plot thread opens or is resolved).
- **The line** (`memory/line.ts`) decides what counts at a point, exactly as the Multi-story rules
  say. Every question about what came earlier goes through `buildLine`: state, the previous scene
  (block 3), story-so-far, the "knows what happened in" sentence, the memory keeper.
- **State** (`memory/state.ts`) applies the baseline, then every change that counts, in line order.
  A full description resets the entry's description, knowledge and relationships (both sides).
  Where a side story and its host change the same thing between the side story's start and end,
  the host wins until Adam answers "Which happened last?" (`answers`, kind `which-last`).
- **Existence:** an entry counts at a scene only if one of its `exists_points` is on the line at or
  before it. Defaults follow the rules (made by hand in the world's first story or outside any story:
  the beginning of the world; in another story: that story's start; found by the memory keeper:
  characters and items at the scene, everything else at the story's start).
- **Places in plain words:** "Book 1, Ch 12, Sc 3" counts live chapters and scenes from 1. Never
  "line", "main history" or "entry" on screen.

### The memory keeper (Adam, 2026-10-02; spec "Source links and automatic upkeep")

The memory updates itself whenever a scene changes, so Adam never has to manage it. There is no
approval step and no Review inbox.

- **Origin.** Every fact records who made it (`Origin` in `shared/types.ts`): `text` (read from a
  scene by the keeper), `adam` (typed or edited by him) or `ai` (drafted by AI). Entries record it
  for the entry and for each field (`entries.origin`, `field_origins_json`); changes, summaries and
  voice lines record it per row. Any hand edit makes the fact (or field) Adam's, and the keeper
  never changes or removes Adam's facts: when the text contradicts one, it raises a consistency
  issue (`issues`) instead. AI-drafted facts are replaced when the text on the same line says
  otherwise. `entries.by_hand` marks an entry Adam ever touched, so it is never moved to Trash
  automatically.
- **Source links** (`source_links`, `db/history.ts`) tie a text fact to the exact words: scene,
  scene version, paragraph id, character range and the quoted words, with a state (`ok`, `changed`,
  `gone`). Every editor paragraph has a stable id. Editing those words updates the fact; a fact goes
  only when its last link is gone or no longer supports it. A text entry whose last mention is gone
  and which Adam never edited moves to Trash for 30 days.
- **History.** Every change to a fact, automatic or by hand, writes a version (`fact_versions`, via
  `recordVersion`) with the run that made it, so any entry can be compared and restored. The SQL
  helpers in `db/repo.ts`, `db/memory.ts` and `db/history.ts` record versions themselves; pass the
  origin and run when the keeper calls them.
- **Runs** (`memory_runs`): after 30 seconds without typing in a scene, on leaving it, on marking it
  done, after a scene version is restored, and at app start for scenes left behind. Runs queue per
  scene and a newer run replaces a queued one. Before a draft is generated, queued or failed runs for
  earlier scenes on the line run first. A run reads only the scene's current draft, finds paragraphs
  added, changed or deleted since the last processed version (by paragraph hash; `scenes.text_version`,
  `memory_version`, `memory_paragraphs_json`), sends them to the memory model with the scene card
  and the linked facts, and applies the model's keep/update/remove/add reply. Runs are idempotent.
  A malformed reply is repaired or retried once; if that fails the scene shows "Memory not updated"
  (`scenes.memory_status = 'failed'`) and is retried on the next trigger and at app start.
- **What changed** (`memory_log`) lists every change grouped by run, newest first: the entry, before
  and after, and the words it came from. Judgement calls apply a default and carry a question mark
  with the alternatives (`question_json`), such as "Which happened last?" and "First seen
  elsewhere". **Undo** restores the previous version and records a suppression (`suppressions`) so
  the same fact isn't added again from the same words unless they change. A quiet "Memory updated"
  note in the top bar opens the list; Adam never has to look at it.
- **Deleting** a scene, chapter or story takes its words out of the memory (a run with status
  `removed`, so the usual last-link and Trash rules apply); restoring it undoes that run and reads
  the scene again. Scenes emptied from Recently deleted are covered when a world opens.
- **The memory model** is chosen in Settings › Models ("Memory model", `settings.models.memory`);
  until Adam picks one, the keeper uses the writer model.
- **Thinking** is set for each job in Settings › Models (`settings.thinking`: Model decides, Off,
  Low, Medium, High; every job starts on Off, at Adam's ask). `ai/client.ts` sends it
  as OpenRouter's `reasoning.effort` or, to other servers, `reasoning_effort`, and steps down (Off:
  `none`, then `low`, then nothing) for a model that turns it down. Thinking counts against the reply
  limit, so limits leave room for it (`THINKING_SHARE`), and a call that comes back empty because the
  model spent it all thinking is asked once more with more room (`thinkingRoom`). Any new AI job
  (the character Quick start, chat) gets its own level here.
- **The character builder model** (milestone 3: Quick start, Flesh out, Give me options, Interview)
  is its own job, `builder`: "Character builder model" in Settings › Models (`settings.models.builder`,
  the writer model until Adam picks one) with its own Thinking (`settings.thinking.builder`, Off). The
  automatic story flows (time gap, a prequel's starting cast, "When did these happen?") are memory
  work, so they use the memory model and its Thinking, as the spec says.
- **Mark scene done** (Ctrl+Enter; stored as `scenes.accepted_at`, named after the spec's earlier
  "Accept") sets the scene's status and refreshes its summary (checks arrive in milestone 5).
  Memory doesn't wait for it.

### Generate on a scene that already has text (0.2.2)

- Generate asks first: **Replace it** or **Add below** (Ctrl+G then Enter adds below, as Ctrl+G
  always did). An empty scene drafts straight away. Once picked, the keyboard goes into the page,
  and Ctrl+Z on the Generate button undoes there too.
- **Replacing** (`streamDoc.ts`): from the pick until the draft's first words arrive, the old text
  is held (`holding`: read-only and dimmed), so nothing typed then goes with it. The first words
  take its place in one step; at that moment the controller keeps the old text with the draft's
  record (`keepReplacedText`, stored as `replaced` in `generations.params_json`, no migration).
  When the draft ends, one Ctrl+Z puts the old text back exactly. While it writes, Ctrl+Z undoes
  Adam's own edits, then stops the draft and puts the old text back (`undoVerdict`).
- Later (another scene opened, the app closed), the Drafts tab marks the draft "Replaced", and
  What the AI saw shows the text it replaced with **Copy** and **Put it back** (`putBack.ts`).
- Known behaviour, not special to Replace: if the memory keeper has read the draft before the old
  text is put back, entries only the old text named are in Recently deleted, and reading the old
  text again makes them afresh (new ids) rather than bringing those back. The same happens when a
  paragraph is deleted by hand and undone after a read.

### Who builds what (parallel build, milestone 2)

| Part | Owns |
|---|---|
| Memory core | `memory/line.ts`, `memory/state.ts`, `memory/scene.ts`, `db/memory.ts` (SQL for changes, exists points, summaries, pins, answers, placement), `ipc/memory.ts`, the test world (`tests/unit/testWorld*`) |
| Memory keeper | `keeper/*`, `db/keeper.ts`, `ipc/keeper.ts`, its tables at the end of migration 2, memory-model prompts, the fake provider's memory replies |
| Briefing | `ai/context.ts`, `ai/gather.ts`, `ai/prompts.ts` (writer), short forms and budgeting, pins and block modes in the briefing |
| Interface | `src/renderer/**`: Mark scene done, Context tab, entry pages for every kind with relationships, knowledge and changes, plot threads on the scene card, summaries, the "What changed" list and the keeper's status |

Shared files (`src/shared/*`, `migrations.ts`, `ARCHITECTURE.md`) change only additively; say so in
the commit message.

## Milestone 3: builders and views

What it adds (spec, Build plan 3, plus the multi-story screens milestone 2 left for it): the character
builder (Quick start, Flesh out, Give me options, Interview) and lighter builders for places, groups and
items; portraits; the codex; entry pages with an as-of slider; the timeline; the relationship map; the
plot threads board; names underlined in the manuscript with hover cards and the entry in the side panel;
the Cast tab; Add to memory; search and the command palette (Ctrl+K); the shortcuts list (?); the New
story dialog, story settings and the automatic story flows. The data model stays frozen: everything here
is built on migrations 1 and 2.

- **Portraits** are kept in the world's database (`entries.image`, a `data:` URL of a picture the
  interface has made small, `lib/image.ts`), so backups, restores and the trash keep them. Lists never
  carry the picture: `Entry.image` is its address, `aiwrite-image://entry/<id>?v=<version>`, served
  by `src/main/portraits.ts`. Show one with `features/views/Portrait.tsx`; let Adam change it with
  `PortraitDrop.tsx`.
- **As of a point.** `AsOf` (shared/types.ts) is a story's start, the end of a scene (its own changes
  included) or a story's end, optionally seen along another story's line (`seenIn`, the "As seen in"
  picker). `memory/asOf.ts` works it out with the same line as drafting: `memoryAt`, `entryAsOf`,
  `asOfStops`. The interface has `useAsOfStops`, `useEntryAsOf`, `AsOfSlider` and `AsSeenIn` in
  `features/views/`.
- **Contracts.** Each part declares its calls, events and types in its own file in
  `src/shared/contracts/`; `AppApi` and `AppEvents` extend them. Each has its own handler file in
  `src/main/ipc/` (same name), registered in `ipc/index.ts`.
- **Screens.** New views in `lib/store.ts`: `codex`, `builder`, `timeline`, `map`, `threads`, `story`.
  `peekEntry(id)` shows an entry in the scene panel without leaving the scene; `setNewStoryOpen` opens
  the New story dialog. The command palette, the shortcuts list and the New story dialog are mounted
  once in the workspace (App.tsx).

### Who builds what (parallel build, milestone 3)

| Part | Owns |
|---|---|
| Builder | `contracts/builder.ts`, `ipc/builder.ts`, `src/main/builder/`, `features/builder/`, the fake provider's builder replies |
| Entry views | `contracts/entryViews.ts`, `ipc/entryViews.ts`, `db/entryViews.ts`, `features/codex/`, `features/world/`, `features/views/`, `features/binder/WorldSection.tsx` |
| World views | `contracts/worldViews.ts`, `ipc/worldViews.ts`, `db/worldViews.ts`, `src/main/worldViews/`, `features/timeline/`, `features/map/`, `features/threads/` |
| Manuscript | `contracts/manuscript.ts`, `ipc/manuscript.ts`, `db/manuscript.ts`, `features/editor/`, `features/cast/`, `features/peek/`, `features/inspector/`, `layout/Inspector.tsx`, `layout/fitPanels.ts`, the side panels' sizes in App.tsx |
| Search | `contracts/search.ts`, `ipc/search.ts`, `db/search.ts`, `features/palette/`, `lib/shortcuts.ts`, `layout/TopBar.tsx` |
| Stories | `contracts/stories.ts`, `ipc/stories.ts`, `db/stories.ts`, `features/stories/`, `features/binder/StorySwitcher.tsx` |
| Story flows | `contracts/storyFlows.ts`, `ipc/storyFlows.ts`, `src/main/storyFlows/`, the fake provider's story-flow replies |

Each part also owns its own tests (`*.test.ts` beside its modules, `tests/e2e/<part>.spec.ts`). Shared
files (`src/shared/types.ts`, `api.ts`, `fields.ts`, `defaults.ts`, `lib/store.ts`, `App.tsx`,
`migrations.ts`, this file) change only additively, and only at integration.

## Milestone 1 scope

Installer and auto-update; library, worlds and stories; binder; editor with autosave
and backups; providers and model choice; simple forms for characters, places and lore;
style guide; scene cards; context assembly with fixed priorities; Generate draft with
streaming and Stop; "What the AI saw". Anything from a later milestone waits.
