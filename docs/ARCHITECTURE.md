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

### Generate keeps writing when another scene opens (fix release)

- Generate's draft lives in `features/generate/draftRun.ts`, not in the Generate button, and its
  stream is marked `keepWriting`. Opening another scene keeps the scene being left for it
  (`controller.ts`, `Away`): its editor state stays off screen, the draft goes on landing in it
  (the same `streamDoc` steps as on screen), and its `SceneSession` saves it and writes its
  recovery file as usual. A draft still getting ready is kept the same way (`expectDraft`).
- Coming back picks that editor up again: still writing, with Stop, undo history and all. A draft
  that finished away keeps its editor until Adam is back (if the stored text still matches), so
  one Ctrl+Z still takes the whole draft out. A message says when it is done, with **Show**.
- One Generate draft at a time; the binder marks the scene being written into and the top bar's
  **Writing…** goes back to it. Beat by beat still stops on another scene; switching worlds or
  deleting the scene stops any draft (a kept scene deleted elsewhere stops its draft when its save
  finds the scene gone).

### The memory's clashes are contradictions only (0.6.2)

- The memory raises a clash only when a scene's words can't be true alongside what it says
  (`keeper/agree.ts`). In a field that holds one value (pronouns, age, build, hair, eyes, skin, an
  event's date) a different value is a clash; the same value in other words, more fully or more
  vaguely ("a redder beard" for "red beard", "about twelve" for "12") is not. In a field that
  describes, another description adds to the memory and is never a clash on its own; only the memory
  model's own report of a contradiction raises one (and not when it only rewords the memory).
- Facts Adam typed are never changed either way.
- Issues raised before 0.6.2 that don't meet the rule are set aside as Ignored once per world when it
  opens (`keeper/wordingClashes.ts`, meta `clashRule`), so they can be reopened; one a consistency
  check also found stays.

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

### How the milestone 3 parts work

**Character builder** (`src/main/builder/`, `features/builder/`)
- `model.ts` `builderTarget()` is the only place its model is chosen (see "The character builder model"
  above). `context.ts` is what the AI is told about the world (style guide with Adam's preferences,
  lore with hard rules first, groups and characters, most recently worked on first, trimmed to fit);
  `prompts.ts` system prompts start with `[AIWRITE-BUILDER v1] <job>`; `partial.ts` reads a reply still
  arriving; `profile.ts` tidies fields and recognises Adam's words; `save.ts` sets origins; `jobs.ts`
  streams the jobs, each call recorded with job `'builder'` and scene `''` (so no Drafts list shows it).
- Quick start origins: the entry is `'adam'`. A field is `'adam'` when its words are copied from his
  notes as whole words (never cut short); every other field is `'ai'`, cut to 300 characters on one
  line or 6000 for longer text. It saves once the profile has a name, as each of the reply's two parts
  ("fromNotes", "drafted") completes, at the end, on Stop and when the world closes, never over a field
  someone changed meanwhile. Its state lives in `quickStartStore.ts` and outlives the screen.
- Guided saves: `createBuilderEntry` makes the entry, then `updateEntry` as Adam (changed keys only);
  `keepSuggestions` saves as AI; `restoreBuilderField` is Undo after picking an option. The interview
  isn't stored.

**Codex and entry pages** (`src/main/entryViews/`, `features/codex/`, `features/world/`)
- Where an entry appears (`appearances.ts`, `mentions.ts`): the scene card, words named by the
  keeper's rule (keep `mentions.ts` in step with `keeper/text.ts` `mentionAt`; its tests compare
  them) and changes pinned to scenes. What each scene names is remembered per database handle until
  its version changes; restored scenes are read again. Importance: point of view 3, present or
  location 2, named or changed 1. `warm.ts` reads ahead 400 ms after a world opens, 100 scenes a slice.
- Quotes are cut exactly from the scene's text; `quoteCut` tells the page where to add "…".
- `setFirstExists` replaces the points; places in Recently deleted pass, only places deleted for good
  are refused.
- "You wrote this": one note under the name only on entries wholly his own (no field marked Drafted by
  AI; `allAdams` in `memoryLogic.ts`). A builder-made entry with AI-drafted fields says `YOU_MADE` ("You
  made this. …") instead. On every other entry, and on such builder-made ones in the as-of view, a note
  sits on each of his fields, relationships and facts (matched to the change that set them).
- `codexStore` holds filters, sort, the way back and `anchor` (the card opened, or the first in view,
  and its offset). Cards use `content-visibility: auto` with a 104 px guess, so going back draws the
  60 cards each side of the anchor, then scrolls it to its offset.

**Names in the manuscript, the Cast tab and Add to memory** (`features/editor/names/`,
`features/editor/selection/`, `features/peek/`, `features/cast/`)
- One call per scene, `getSceneNames`, feeds the underlines, hover cards, Cast tab, the entry beside
  the page and the Add to memory form (`names/sceneNames.ts`). It reloads 120 ms after the world,
  `entriesRev`, `memoryRev`, `briefingRev`, a story's title or `outlineOrder()` changes, never on
  `outlineRev` (that moves with every word count), and keeps the last 8 scenes.
- `nameMatch.ts` copies `mentionAt` from `keeper/text.ts`: keep them in step. Underlines are
  decorations with class `aw-name` and `data-name-of` (never `data-entry`, which lists and tests use).
- Code that selects words to show Adam where something is sets the `REVEALED` meta
  (`editor/reveal.ts`), as `controller.revealWords` does, so the "Selected words" bar ignores it.
- The hover card (`role="tooltip"`, in a portal) closes on any key but a lone modifier and lets the key
  through; the bar's Esc (like the floating binder's) is marked taken (`takeEscape`, `lib/escape.ts`),
  so a draft carries on and the next Esc stops it; Ctrl+G does nothing while a layer other than
  Generate's own panels is open; the Add to memory form is a Radix Popover (so `layerOpen()` is true),
  placed once as it opens (`formPlace()`, `avoidCollisions={false}`) so it never moves while in use.
  Pop-ups rendered inside the page's scroll area stop `mousedown`, and `SceneView`'s `onPageMouseDown`
  ignores presses outside its own DOM.
- The scene panel's tabs are Scene card, Context, Cast and Drafts; an entry shown beside the page
  (`peekEntryId`) covers them until Back.
- Narrow page: the workspace keeps `pageMinFor(fontSize, pageWidth)` for the page (about 55 characters
  a line plus the narrow padding); the page gets 40 px padding only from `widePageFrom()` (measured
  with a ResizeObserver in `SceneView`). When even both panels at their narrowest can't leave that,
  the binder floats over the page (`binderFloats`, `useFloatingBinder`; the top bar's button and the
  palette's "Show or hide the binder" show it), leaving the saved layout alone. The Literata
  measurements are `PROSE_CHAR_EM` and `PROSE_CH_EM` in `fitPanels.ts`; re-measure if the font changes.
- The shared toast takes a second button (`secondary`, "Open" beside "Undo"). A screen with a bar at the
  bottom (the builder's, the interview's ask box) calls `useToastsAbove(ref)` (`components/ui/Toast.tsx`)
  so toasts rise above it instead of covering it. Add to memory gathers adds made while its toast shows
  into that toast (as `announceDelete` does): Undo takes them all back, and Open opens the latest,
  beside the page on the writing page, else on the entry's own page.

**Search and the command palette** (`src/main/search/`, `db/search.ts`, `features/palette/`)
- `main/search/index.ts` keeps an in-memory index per world database, built once (about 70 ms for
  320,000 words), then re-reads only rows that TEMP triggers (`db/search.ts`) marked changed, so code
  that writes those tables needs nothing extra (a second connection writing world.db would go unseen).
  If Adam's machine shows pauses on the first build, move it to a worker thread.
- Order: entries, chapters and stories found by a name come before Scenes; entries found only in their
  description, fields or memory, chapters and stories found by goal or premise, summaries, notes and the
  style guide come after. "Mara's" is read as Mara; apostrophes inside words stay part of them.
- A scene result's `card` part opens the Scene card at that part (`cardReveal.ts`, by
  `data-card-part`, else by label); an entry result's `part` opens the entry's page there
  (`entryReveal.ts`, by label or section title). Renaming those labels means changing `LABELS`,
  `TOP_FIELDS`, `NOTES`, `sectionTitle` and `sectionLabel` in `main/search/index.ts`.
- Every keyboard shortcut goes in `lib/shortcuts.ts`; `shortcuts.test.ts` scans the renderer and fails
  if one the app handles isn't listed. Tooltips name keys with `withShortcut` or `shortcutText`.
- A new screen or action needs an entry in `ACTIONS` (`paletteLogic.ts`) and a case in `runAction`
  (`actions.ts`); an action that goes to another page sets `away`, and one that ends on the writing
  page asks for the caret with `requestEditorFocus`.

**Stories** (`src/main/stories/`, `db/stories.ts`, `features/stories/`)
- The rules (`rules.ts`, `points.ts`) are pure over `WorldShape`; the SQL is in `db/stories.ts`.
  `followers(shape, id)` lists books written before a story that now continue after it;
  `declineFollow` keeps or clears Adam's No as a `'follow-declined'` answer, so it travels with backups.
- Editing or undoing a placement always starts from the one the memory has (`StoryDetails.placement`).
  The shelf order comes from `listShelf().order`, for display only (`stories.position` is never
  written for it).
- `storyActions.ts`: `openStorySettings(storyId, section?)` (through `useSectionRequest`, both in
  `sectionRequest.ts`); after a Yes whose Undo has gone, `moveToFollow` starts `sortStartChanges` only if
  the same world is still open.
- `flows.ts` is the flows' quiet line for the open world only (cleared when the world changes and when a
  backup is restored, through `registerDiscarder`), with `runFlow`, `retryFlow`, `stopFlow` and
  `loadFlows` (`listStoryFlows`). A flow that fails while its story's settings aren't showing also says so
  in a toast, with "Story settings" opening the page at its line.
- A scroll area holding `sr-only` inputs must be `relative`.

**Story flows** (`src/main/storyFlows/`)
- A run is a `memory_runs` row with `scene_id = ''`; its lines' `undo_json` starts with
  `{"op":"story-flow"`, and `keeper/undo.ts` hands those to `storyFlows/lines.ts`. Generation records
  use job `'story'` and scene `''`; prompts start with `[AIWRITE-STORY-FLOW v1] <flow>`. The model is
  `flowTarget()`: the memory model (else the writer model) with the memory's Thinking.
- Everything drafted is `'ai'`; nothing automatic overwrites or removes an `'adam'` change ("When did
  these happen?" may move his changes but keeps their origin). Changes of entries in Recently deleted
  are ignored, as the memory ignores them.
- Order at a story's start (`order.ts`): time gap and moved changes go before the changes already there
  about the same entries; a drafted starting description goes before the changes about its entry;
  relationships are never copied to the other side. Positions can be fractions (SQLite REAL).
- Undo and answers only bring back a change the line's own answer took out (`removedByLine`).

**Timeline, relationship map and plot threads board** (`src/main/worldViews/`, `db/worldViews.ts`,
`features/timeline/`, `features/map/`, `features/threads/`)
- Pure builders over `loadShape`/`loadMemoryData`/`buildLine`/`memoryAt`, with the part's SQL in
  `db/worldViews.ts` (scene cards, story time gaps, the saved map layout, the change count); one call
  per view per story (`getTimeline`, `getRelationshipMap`, `getThreadsBoard`).
- `worldViews/index.ts` keeps what the views read per open world, keyed by `changesMade(db)` (SQLite
  `total_changes()`), so any write through the world's connection starts afresh. This relies on the
  open world having one connection (a restore opens a new one, and so a new cache).
- In-world dates (`when.ts`) are read forgivingly and never guessed. A comma, semicolon, bracket, dash
  or full stop ends a reading; numbers that count something else ("3 days before", "Chapter 3",
  "Week 3", "40 miles") are never dates; "may", "march", "fall" and short month names count only beside
  a day or year or among date words; words of a calendar it doesn't know go in `WhenParts.qual` (such a
  date keeps reading order and matches only the same words). Vague steps ("days later") keep order but
  name no day. `whenSort` is never written.
- `placeWhens(items, stories)` leans each text on its own story's dated texts before it. A story's
  opening leans on `WhenStory.from`: a side story on its host where it starts (`sideStart` in
  `timeline.ts`, mirroring `line.ts`: keep them in step), a following book on the end of the book
  before, nothing after a time gap. A following book's first named date starts its own calendar;
  yearless days before a calendar's first named year sort in that year. Events take only the year
  before them and lend nothing on.
- Clashes: the same named day (same calendar, same calendar words) at different most-specific places
  (a place inside another isn't a clash). They use neutral colours; amber is for AI suggestions and the
  board's long-open note (`LONG_OPEN_CHAPTERS = 10` in `threads.ts`).
- Map layout: one deterministic force layout of every relationship between characters the world has
  had, wider than tall (`WIDE` in `layout.ts`, gap `MAP_GAP` in the contract). Characters already
  placed keep their places; only newcomers move. It is kept in the world's `meta` key `map_layout`
  (character id to `[x, y]`), with no migration.
- Map drawing: names and line words stay full size at any zoom and `mapLogic.labelsAt` hides what would
  overlap, best-connected first; portraits shrink with the map but never overlap (`portraitScale`). It
  opens fitted to `RelationshipMap.everyone` (or a group's `allMemberIds`) when that zoom is at least
  `READABLE_ZOOM` or the cast is `SMALL_CAST` (12) or fewer, else at `OPENING_ZOOM` around the
  best-connected character; Fit (0) always shows everyone. The map shows the Story picker until a side
  story, prequel or own version exists, then "As seen in" (it follows `hasOtherKinds` in
  `features/views/asOfLogic.ts`, as `AsSeenIn` does).
- The three screens share `features/timeline/viewParts.tsx` (`useWorldView` reloads on `outlineRev`,
  `entriesRev`, `memoryRev` and `briefingRev`, keeping the last data while it does). Timeline lane
  choices are in localStorage under `aiwrite.timeline.lanes` (this computer only; works without it).

### Who builds what (parallel build, milestone 3)

| Part | Owns |
|---|---|
| Builder | `contracts/builder.ts`, `ipc/builder.ts`, `src/main/builder/`, `features/builder/`, the fake provider's builder replies |
| Entry views | `contracts/entryViews.ts`, `ipc/entryViews.ts`, `db/entryViews.ts`, `features/codex/`, `features/world/`, `features/views/`, `features/binder/WorldSection.tsx` |
| World views | `contracts/worldViews.ts`, `ipc/worldViews.ts`, `db/worldViews.ts`, `src/main/worldViews/`, `features/timeline/`, `features/map/`, `features/threads/` |
| Manuscript | `contracts/manuscript.ts`, `ipc/manuscript.ts`, `db/manuscript.ts`, `features/editor/`, `features/cast/`, `features/peek/`, `features/inspector/`, `layout/Inspector.tsx`, `layout/fitPanels.ts`, the side panels' sizes in App.tsx |
| Search | `contracts/search.ts`, `ipc/search.ts`, `db/search.ts`, `main/search/`, `features/palette/`, `lib/shortcuts.ts`, `layout/TopBar.tsx` |
| Stories | `contracts/stories.ts`, `ipc/stories.ts`, `db/stories.ts`, `features/stories/`, `features/binder/StorySwitcher.tsx` |
| Story flows | `contracts/storyFlows.ts`, `ipc/storyFlows.ts`, `src/main/storyFlows/`, the fake provider's story-flow replies |

Each part also owns its own tests (`*.test.ts` beside its modules, `tests/e2e/<part>.spec.ts`). Shared
files (`src/shared/types.ts`, `api.ts`, `fields.ts`, `defaults.ts`, `lib/store.ts`, `App.tsx`,
`migrations.ts`, this file) change only additively, and only at integration.

## Milestone 4: better drafting

What it adds (spec, Build plan 4): Variants; Beat by beat; the AI tools for selected words (Rewrite,
Expand, Condense, More vivid, Change tone, Fix voice, Alternatives) and Continue, as tracked changes with
Accept and Reject; drafts and history with compare and restore; Ask the world; the outline helper and
next scene ideas; reading aloud with its voice setup and calibration, and dictation (spec, "Read aloud
and dictation"). The data model stays frozen (migrations 1 and 2): world.db is unchanged.

- **history.db.** Scene snapshots (and the drafts a scene holds besides its current one) live in a file
  of their own in each world folder, `history.db`, beside `world.db`, opened by `src/main/history/`.
  A missing, locked or damaged history.db never stops a world from opening: History starts afresh (the
  damaged file is moved aside, never deleted). Backups copy world.db only, so restoring a backup leaves
  history alone. **Milestone 6:** import, export and world copy must carry history.db with world.db.
- **Generation records.** New `job` values: `beat`, `edit`, `chat`, `outline`, `ideas`, `speech`
  (Variants stay `draft`). The extras go in `params` (`variant`, `beat`, `tool`, `chatId`), so no
  migration. Only the scene's current draft counts for the memory; a variant or draft Adam hasn't
  chosen never reaches it.
- **AI calls.** Drafts (Generate, Variants, Beat by beat) go through `ai/draftFlow.ts`
  (`draftBriefing`: the memory catches up first, the briefing is fitted to the writer model, "too long"
  is said in plain words) and `ai/drafts.ts` (`startDraftJob`, with `job`, `partOf` and `exclusive`).
  `prepareContext(input, extras)` takes a part's own closing instruction (`final`) and extra blocks
  (sent last, never shortened). Every other AI call (edits, Ask the world, the outline helper, ideas,
  who says each line) goes through the task runner, `ai/tasks.ts`: it records the call, streams it, saves
  as it goes, and sends `task:progress` (the whole text so far), `task:retrying` and `task:done`; Stop is
  `stopTask(taskId)`. The interface makes the `taskId`, so it hears every event.
- **Models.** `ai/jobModel.ts` picks the model for a job and says in plain words what to set up when
  there is none. New jobs in Settings › Models, each with its own Thinking choice (default Off): "Chat
  and brainstorm model" (`chat`: Ask the world, the outline helper, next scene ideas; the writer model
  until Adam picks one) and "Read aloud model" (`speech`, shown once read aloud is on; the memory model
  until Adam picks one). Beat by beat, Variants and the AI edits use the writer model.
- **Snapshots before AI changes.** Every part that changes the page with AI calls
  `snapshotBefore(sceneId, label)` (`features/history/snapshot.ts`) just before the change goes in;
  Mark done and writing (every 10 minutes) take theirs in the main process (`history/index.ts`:
  `sceneMarkedDone`, `sceneTextSaved`).
- **The page.** The editor bridge (`lib/editorBridge.ts`) adds `editor`, `busy()`, `current()` (the
  page as it would be saved) and `replaceScene()` (other text in place of the whole scene, one Ctrl+Z
  step), and `beginStream(..., { noBreak })` for a beat that carries on without a scene break. AI
  edits and reading aloud add TipTap extensions (`features/edits/suggestions.ts`,
  `features/readAloud/highlight.ts`), listed in `features/editor/extensions.ts`.
- **Screens.** New views: `history`, `variants`, `outline`. `askOpen` shows Ask the world in the right
  panel in place of the scene panel's tabs. The scene toolbar's new buttons (`features/editor/SceneTools.tsx`)
  use `ToolButton`. Each part's piece of a shared screen is a component in the part's own folder, already
  placed: `SceneTools` (Variants, Beat by beat, History, Listen), `SceneView` (ReadAloudBar, SuggestionLayer,
  BeatBar), the selection bar (ListenFromHere), the scene card (SceneIdeas), the top bar (AskButton), entry
  pages (EntryVoice), the binder's rows (`readAloud/PlayingMark.tsx`: a speaker on the scene being read and its
  chapter), the Quick start box (MicButton), App (DictationLayer), Settings › Read aloud and
  dictation (`features/settings/SpeechSettings.tsx`: each part's `section="everyday"` and `"more"`), and
  the palette's actions and shortcuts (Listen Ctrl+L, Stop reading Ctrl+Shift+Space).
- **Speech.** Adam's rule (2 October 2026): from mcreader-v2 and Poor-Mans-Holodeck, only their
  text-to-speech and voice-to-text code may be reused (each such file says where it came from); nothing
  else from either repo, and never keys, tokens or voice clips. Helpers they lean on are written fresh.
  One local speech server (Python) speaks and listens: its source ships with the app; its Python
  environments and models download into the user data folder (`speech/`), never into the app, git, a world
  folder or a backup. AI Write always installs and uses its own copy there, never another app's (Adam,
  2 October 2026: no MCreader install is looked for or reused). It listens on 127.0.0.1:8766; Settings may point at another server on this
  computer, loopback only (`speech/url.ts`). It starts hidden with the app when "Start with AI Write" is
  on and stops as the app quits. Its routes are reached through IPC (the window never calls it directly).
  The Hugging Face token is kept like API keys (`secrets.ts`). Character voices and "Say it as" are in the
  world's `meta` key `read_aloud`, by entry id; speaker marks and spoken audio are a cache in the user data
  folder (audio up to the limit Adam picks, oldest removed first). Dictated audio is never saved.
  AI-written text (Generate, Beat by beat, a picked variant, an accepted AI edit or Continue) has its new or changed
  paragraphs marked in the background as it lands (`readAloud/draftMarks.ts`, from History's snapshot before the change,
  draft starts and ends, and the scene's saves; `Marker.noteAll`, failures only logged), when read aloud is on or set up
  or "Show speakers and tone" is on; Adam's own typing is still marked a little ahead of the reading. "Show speakers and
  tone" (`speech.showSpeakers`, off by default; beside Listen, in Settings and the palette) draws each marked paragraph's
  speaker and tone faintly above it as a CSS-only decoration (`features/readAloud/speakerLabels.ts`), never in the text.
  Everything installs and runs on Windows with no terminal (Python itself through Windows' own installer).
- **World builder.** "Build the world from a summary" (`src/main/worldBuilder/`, `features/worldBuilder/`)
  reads Adam's summary in parts that fit the model and lays the world out kind by kind (characters and
  places first, then groups, items, lore and rules, events, plot threads, the glossary, relationships, and
  the world's themes and tone when they are empty), saving each thing as it is made. Characters get full
  profiles from the character builder (`src/main/builder/`). The summary's own sentences go in as Adam's
  (`origin 'adam'`); what the AI fills in is `'ai'`. Anything already in the world (by name, alias or a
  near match) is left as it is, and where the summary disagrees with it, that is a consistency issue. A
  build is one memory run with no scene (`db/worldBuilder.ts`): its lines undo one by one in What changed,
  or all at once on the page; the page's last build is read back from those lines. The summary is kept in
  the world's `meta` key `world_summary`. Its job is `world` ("World builder model", the character builder
  model until Adam picks one, Thinking Off).
- **World builder: Interview me** (`src/main/worldBuilder/interview.ts`, `features/worldBuilder/WorldInterview.tsx`,
  `interviewStore.ts`). The AI asks one short question at a time about what the summary is missing or thin on:
  one `world` record per question (`askWorldQuestion`, prompt marker `[AIWRITE-WORLD v1] interview`, the World
  builder model and Thinking), reading the summary as it stands and the questions asked so far. Answers never go
  through the AI: each is added to the end of the summary in Adam's words under the question's topic
  ("Setting: ..."), kept as the summary always is, with Undo on its toast. Nothing else about an interview is
  stored; it ends on Stop, on leaving the page or when a build starts (a typed answer is added first).
- **Story days on the timeline.** The outline helper and the World builder date things in the story's own
  count of days, which `when.ts` reads: "Day 1" is the day the story opens ("Day 3, dusk"). The outline
  helper asks for a `When:` line on each scene (carrying on from the story's last scene with a When, from
  Day 1 when none has one), shows it on each suggestion (Edit changes it), and keeps it on the card;
  one the AI left out takes the day of the nearest scene before it with a When, else "Day 1"
  (`fallbackWhen`). A finished build puts the story's opening scene on "Day 1" while none of its scenes
  has a When (`worldBuilder/timeline.ts`), and asks for events during the story on that count. A When
  already on a card is never replaced.
- **Filling in the gaps.** `builder/fill.ts` fills the empty fields of thin characters, places, groups and
  items (summary or description empty, or a third of the fields empty) with the AI, from the world and
  what the story says about them, as `'ai'` ("Drafted by AI"). A field with words in it, a name and other
  names are never changed. Two callers: a World build's last steps ("Filling in missing details": what it
  made, and pages Adam didn't make himself, such as a character the memory found), and the memory keeper,
  which hands the entries a run made from scene text (`newEntryIds`) to `fillFound` on the memory model
  after the run, so it never slows or breaks the memory. Then the build gives each character it made a
  read-aloud voice description, as Suggest would (job `speech`, `readAloud/voiceStore.ts`), unless one
  is set; it is saved even when read aloud isn't set up.
- **The narrator at one pace.** A narration mark keeps its feeling but not its pace (`narratorPace` in
  `readAloud/plan.ts` drops "slow", "fast" and the words that slow or hurry the voice), and a narration note ends with
  `EVEN_PACE`. The player then evens out what the speech model still varies: it measures each narration clip's words
  a second and plays it toward the narrator's usual pace, between 0.8× and 1.3×, pitch kept
  (`features/readAloud/evenPace.ts`). Characters' lines keep their own pace.
- **Voices the AI fills in.** Whenever the AI makes or fills in a character, it gets a read-aloud voice
  description as Suggest would write it (the same prompt and the Read aloud model, job `speech`), and "Say it as"
  only for a name a narrator would likely misread (`readAloud/autoVoice.ts`). Only empty boxes are filled: a voice
  or "Say it as" Adam set is never replaced, even one set while the AI was writing. Callers: the World builder
  (what it made and what it filled in; when a build ends, any still without a voice, stopped part way or a request
  failed, go to `voiceLater`), the memory keeper after `fillFound` (`voiceLater`), and the character builder (Quick
  start when it ends, stopped part way too; AI suggestions Adam keeps, after a 20 second pause). The background
  queue runs one character at a time and asks about each once a session; a request that fails is asked again a
  minute later, up to `VOICE_TRIES` (3) in all, and then leaves the box empty. The entry
  page's voice box shows a voice that arrives while it is open (`memory:changed`), in any box Adam hasn't changed.
- **Tests.** The fake provider answers each part's AI calls by the marker its system prompt starts with
  (`tests/fake-provider/m4/`). The speech engine has its own fake server (`tests/fake-speech/`). Setting
  `AIWRITE_FAKE_MIC=1` gives the window Chromium's fake microphone for dictation tests.

### How the milestone 4 parts work together

- **History.** history.db keeps every snapshot from the last 14 days; older ones thin to the last of
  each day, and a "Mark done" snapshot and a scene's newest are always kept. Writing takes one at most
  every 10 minutes. A scene emptied from the Trash has its history forgotten after 60 days. A
  history.db that can't be opened is tried again every 30 seconds, and the History page says it
  started afresh for 30 days after. The scene toolbar's History button (accessible name "History of
  this scene") hides under 600 px of scene width, and the status pill shows only its dot under 660 px;
  History stays in the palette and the Drafts tab.
- **One draft job per scene at a time.** Generate, Variants and Beat by beat refuse each other on the
  same scene, both in the main process (`ipc/ai.ts`, `ipc/variants.ts`, `ipc/beats.ts`, using
  `isStartingDraft`, `isStartingBeat`, `variantsBusy`) and in the window before anything is asked
  (Generate checks for variants being written before "Replace it or Add below").
- **Drafts tab.** Lists `draft` and `beat` records; a variant or beat says which one it was
  ("Variant 2 of 3", read from `params_json`). "What the AI saw" goes back where it was opened from:
  the Variants page, Ask the world, or a version in History (the view's `from.history`).
- **Ask the world records.** A chat turn is a generation record with `job` `chat`, `sceneId` ''
  (it belongs to no scene) and `params.chatId` starting with the story's id ('world:' when none was
  open), so a story's chats can be
  found without a new column.
- **Toasts.** A panel along the right edge (Ask the world) sets the CSS variable `--toast-right` so
  toasts sit clear of it; a bar along the foot of the window lifts them with `useToastsAbove`.
- **Read aloud audio.** Spoken audio plays from blob URLs, so the window's CSP allows
  `media-src 'self' blob:` (`src/renderer/index.html`).

### Who builds what (parallel build, milestone 4)

| Part | Owns |
|---|---|
| History | `contracts/history.ts`, `ipc/history.ts`, `src/main/history/`, `features/history/`, the Drafts tab (`features/generate/GenerationsPanel.tsx`), the snapshot calls in `GenerateControls.tsx` |
| Variants | `contracts/variants.ts`, `ipc/variants.ts`, `src/main/variants/`, `features/variants/` |
| Beat by beat | `contracts/beats.ts`, `ipc/beats.ts`, `src/main/beats/`, `features/beats/` |
| AI edits | `contracts/edits.ts`, `ipc/edits.ts`, `src/main/edits/`, `features/edits/`, the AI tools in `features/editor/selection/SelectionLayer.tsx`, `tests/fake-provider/m4/edits.mjs` |
| Ask the world | `contracts/ask.ts`, `ipc/ask.ts`, `src/main/ask/`, `features/ask/`, `tests/fake-provider/m4/ask.mjs` |
| Outline | `contracts/outline.ts`, `ipc/outline.ts`, `src/main/outline/`, `features/outline/`, acts in the binder (`features/binder/`), `tests/fake-provider/m4/outline.mjs` |
| Speech engine | `contracts/speech.ts`, `ipc/speech.ts`, `src/main/speech/`, the speech server's source, `features/speech/`, `tests/fake-speech/` |
| Read aloud | `contracts/readAloud.ts`, `ipc/readAloud.ts`, `src/main/readAloud/`, `features/readAloud/`, `tests/fake-provider/m4/readAloud.mjs` |
| Dictation | `contracts/dictation.ts`, `ipc/dictation.ts`, `src/main/dictation/`, `features/dictation/`, the hold-to-talk line in the shortcuts list |
| World builder | `contracts/worldBuilder.ts`, `ipc/worldBuilder.ts`, `src/main/worldBuilder/`, `db/worldBuilder.ts`, `features/worldBuilder/`, `tests/fake-provider/m4/world.mjs` |

The groundwork (shared before the parts start): the task runner, `jobModel`, `draftFlow`, the contracts'
first lines, the new Settings › Models entries, the views, the slots and the editor bridge additions above.
Each part also owns its tests. Shared files change only additively, and only at integration.

## Milestone 5: the consistency checker

What it adds (spec, Build plan 5 and "Consistency checker"): live checks (phrases to avoid, repetition,
name spelling) underlined as Adam types; AI checks (facts, knowledge, timeline and place, voice, style and
tone) when a scene is marked done or on request for a scene, chapter or story; the Issues tab with Fix the
text, Update the memory and Ignore; badges in the binder; the repetition and plot threads reports; and, in
the briefing, ties to people not in the scene (block 11). The data model stays frozen (migrations 1 and 2).

- **Issues** are rows of `issues` (migration 2). Everything beyond its columns goes in `payload_json`
  (`key`, `sources`, `fix`, `memoryFix`). An issue's `key` stops it being raised twice; an ignored key is
  never raised again. Severity is `must-fix` (red), `warning` ("Worth a look") or `minor`. The contract is
  `src/shared/contracts/checks.ts`; its handlers are `src/main/ipc/checks*.ts`.
- **The model.** AI checks are the job `check`: "Consistency check model" in Settings › Models
  (`settings.models.check`, the memory model until Adam picks one, then the writer model), with its own
  Thinking (`settings.thinking.check`, Off). Generation records use job `'check'`; prompts start with
  `[AIWRITE-CHECK v1] <check>`.
- **Ties to people not in this scene** (block 11, priority 11, `ties`): for each character present, the
  characters they have a relationship with who aren't in the scene, as of the scene: the other person's one
  line, where the relationship stands, and the events and changes that name both, newest first. Closest
  and most recent ties first. It is the first block shortened (names and relationship only) and dropped.

- **Phrases to avoid in drafts.** The writer model is told the list in block 1 and again at the end of the
  briefing (`avoidLine` in `ai/prompts.ts`: a short list by name, with "or any close variation"). When a draft
  lands, its note counts the phrases to avoid it used before the common AI phrases, and Show goes to the first.

- **Reports** (`checks/reports.ts`, SQL in `db/checksReports.ts`): repetition skips common words and the names
  and aliases of characters, places, groups, items and glossary terms (names also end a phrase); its thresholds
  are the constants at the top of the file. Plot threads reuse the board (`threadsBoardOf`, `LONG_OPEN_CHAPTERS`)
  for "open too long"; "no setup" walks the story's line through its end. Both are kept per world until
  `changesMade` moves, like the world views.
- **Badges and runs** (`features/consistency/checkStore.ts`): counts reload on `issues:changed`, the story and the
  world, never on `outlineRev`. One check runs at a time in the interface; it shows in the binder (`CheckLine`) and
  on the Consistency page, and ends in a toast.

**Live checks** (`src/shared/liveChecks.ts`, `features/liveChecks/`, `checks/live.ts`, `db/checksLive.ts`)
- The checking happens in the window, paragraph by paragraph (`LiveCache`, by paragraph text), about 300 ms
  after typing pauses; a keystroke only maps the underlines and drops those whose words it touched. Spelling
  matches capitalised words against name words of 4 letters or more with the same first letter (1 letter
  out, 2 for names of 7+), skipping common English words; a misspelt name at the caret waits until the caret
  leaves it. Nothing is underlined while a draft streams in or text is held, nor inside an AI tool's change.
- Ignores are `issues` rows (status `ignored`, severity `minor`, `payload_json.key`); see `liveKey`. A
  spelling is ignored world-wide, a phrase per paragraph, a repetition per scene. Ignoring emits
  `issues:changed`, so a list showing ignored issues shows them too.
- For the Issues tab: `useLiveFlagCounts()` and `revealLiveFlag(kind)` in `features/liveChecks/liveFlags.ts`.

### How the AI checks work

- **What a check sees** (`checks/context.ts`): the scene's memory as of its **start** (`sceneMemory`, the
  line up to just before it), so a clash with earlier scenes or Adam's notes is caught even though the keeper
  has already followed the scene's text. Entries on the card or named in the text (with what has happened to
  them), hard rules, who knows what, the three scenes before (When, where, who), the end of the scene before,
  the style guide's point of view and tense, the card's mood. Entries and scenes get short ids (E1, S1).
- **One request per scene** for every check asked for (`checks/run.ts`), split into parts for a small model;
  a reply that can't be read is asked for once more, one cut off is asked again in halves. `checks/parse.ts`
  drops issues whose quote isn't in the scene and keeps the scene's own words; the key is
  `check:<check>:<entry or scene>:<plain quote>`. A whole re-run replaces what the same checks found there;
  a stopped one (or one whose reply could only be read in part) only adds. A rewrite is kept only for the
  model's whole quote, with which of its places in the scene it is (`occurrence`). `memoryFix` is offered only
  for a short value of a one-line field of Adam's that no earlier scene's change has set.
- **Issues** (`db/checks.ts`): the keeper's and the world builder's rows read as the same `Issue`. Anything
  ignored (by key, the same entry and field, or the same kind with overlapping words: `sameThing`) is never
  raised again, by a check or by the keeper (`raiseIssue` uses `sameThing` too); story issues are keyed on the
  other story, the entry and the field. The live checks' ignored rows (`LIVE_KINDS`) are never counted or
  listed as open, and Reopen deletes them; a check finding what the keeper already raised adds its
  rewrite to the keeper's issue. Open issues whose words have left the scene become `gone` when listed or
  counted. Every change emits `issues:changed` (`onIssuesTouched`, batched after the transaction).
- **Runs** (`checks/runs.ts`): one at a time; Adam may have one of his own going or waiting. Before each
  scene the memory catches up (`catchUpBeforeDraft`, then the keeper's `whenRead` for the scene itself, read
  now if it is still waiting out its quiet time, so its clash isn't raised twice); each run's AbortController
  ends that wait at once on Stop or when the world closes. A check Adam asks for drops a waiting mark-done check
  of a scene it covers. Progress names scenes "Ch 3, Sc 2: The ferry". Marking a scene done queues `DONE_CHECKS` quietly (`runId` `done:<scene>:…`,
  `CheckDone.background`); its `found` counts everything raised since, so the window can say "Found 2 things
  to look at in this scene." Checking a story ends with `checks/stories.ts`: a side story against its host over
  `hostSpans`, a prequel's ending against the opening of `leadsIntoBook`, leaving out what "Which happened
  last?" already asks (`sideClashes`). Closing the world stops runs (`closeRunsFor`).
- **Fix the text** shows the check's rewrite with `showReplacement` (`features/edits/session.ts`: a ready-made
  tracked change, no AI call), or starts Rewrite on the sentence; `onAccepted` marks the issue fixed.

### Who builds what (parallel build, milestone 5)

| Part | Owns |
|---|---|
| Live checks | `src/shared/liveChecks.ts` (pure), `features/liveChecks/` (TipTap decorations, the hover card), `ipc/checksLive.ts`, `src/main/checks/live.ts` |
| AI checks | `src/main/checks/` (but `live.ts`, `reports.ts`), `db/checks.ts`, `ipc/checksIssues.ts`, the `check` job (types, defaults, `jobModel`, `providers`, Settings › Models), `features/issues/`, `tests/fake-provider/m5/` |
| Reports | `src/main/checks/reports.ts`, `ipc/checksReports.ts`, `features/consistency/` (the story's Consistency page), the binder's badges and Check menu items, the palette's actions |
| Briefing | `ai/context.ts` block 11 |

## Milestone 6: polish

What it adds (spec, Build plan 6, "Import and export", "Easy to work with", "Cost and usage", "Look and
feel", "Reliability"): a whole world as one `.aiwrite` file (export, import, make a copy); exporting a story,
chapter or selection to Word, EPUB, PDF, Markdown and plain text, and the series bible to PDF and Markdown;
importing a manuscript (Word, Markdown, plain text) split into chapters and scenes with a preview, then the
import catch-up that builds the memory from it; the first-run setup and the sample world; the usage and cost
page with an optional monthly limit; themes finished (accent colour, reduced motion) and focus mode (F11); a
full pass against the no-jank checks and the speed budgets. The data model stays frozen (migrations 1 and 2).

- **A world travels with its history.** Export, import and Make a copy carry the world folder's `history.db`
  with `world.db`, plus `images/`; never `backups/`, the speech server, its downloads or the audio cache, and
  never API keys (`secrets.ts`). Character voices and "Say it as" are in world.db's `meta`, so they travel. A
  missing or damaged `history.db` never stops a world opening: History starts afresh. An imported or copied
  world gets a new id, so it never collides with the one it came from.
- **Zip files** (`.aiwrite`, `.docx`, `.epub`) are written and read with `fflate` (bundled; a dev dependency
  like the other bundled libraries).
- **New AI jobs** get their own Thinking entry in Settings › Models, default Off. The import catch-up is memory
  work, so it uses the memory model and its Thinking.
- **Settings** stay few: `accent` (Appearance) and `usage.monthlyLimit` (Usage and cost) are the only new ones.

### How world files and export work

**World files and export** (`src/main/transfer/`, `features/transfer/`)
- A `.aiwrite` file (`worldFile.ts`) is a zip: `manifest.json` first (format `aiwrite-world`, `formatVersion`,
  the app's version, the world's name, when, world.db's `user_version`, whether history is in it), then `world.db`
  and `history.db` each copied with SQLite's online backup (the open world's own connection; another world's
  read-only) and made self-contained, then `images/`. Files are streamed through fflate's `Zip`/`Unzip` in 1 MB
  pieces, so the window never stalls and a big world never sits whole in memory. A history.db that can't be read
  is left out (the toast says so); the export still succeeds.
- Import and Make a copy build the world in a hidden folder in the library (`.aiwrite-import-<id>`,
  `.aiwrite-copy-<id>`, removed after an hour if the app closed midway), with world.db under another name until it
  has its new id and name, then rename the folder into place (`freeFolder`). So the library never lists a half-made
  world or two worlds with one id, and `separateCopies()` in world.ts never has to step in. An import with the name
  of a world already here is "<name> (imported)"; a copy is "<name> (copy)". Refused in plain words: not a zip or
  no manifest (`not-a-world-file`), a file cut short or a world.db failing `quick_check` (`damaged-world-file`),
  and a newer format, schema or app version (`newer-world-file`). A history.db in the file that isn't SQLite is
  dropped; deeper damage is handled by History's own open path (set aside, start afresh). Zip entries outside
  `manifest.json`, `world.db`, `history.db` and `images/` are ignored (`stagedName`).
- Manuscripts (`manuscript.ts`) are read from the stored editor documents (plain text for scenes without one):
  paragraphs with italics and bold, block quotes, and one scene break between scenes or where Adam put one. Deleted
  chapters and scenes never come in (`getOutline`), nor scenes with no words. Chapters keep their number in the
  story even in a selection; a title that only says "Chapter 3" isn't repeated. Writers: `docx.ts` (hand-written
  OOXML, Georgia, A4, the title on Heading 1 so it is in Word's navigation pane, a page break before each chapter),
  `epub.ts` (EPUB 3 with nav and toc.ncx, mimetype first and stored), `html.ts` (the EPUB pages and the PDF page,
  A5), `plain.ts` (Markdown and text). PDFs are printed in a hidden window (`pdf.ts`), with the interface's Literata
  files when it finds them in `out/renderer/assets`.
- The series bible (`bible.ts`) is read with `memoryAt` (the story's end), `timelineOf` and `threadsBoardOf`: every
  live entry by kind (threads get their own section from the board), with its fields, relationships, what has
  happened to it and what a character knows; no ids.
- Each call asks where with the system dialog (`showSaveDialog`/`showOpenDialog`; the app tests replace them), writes
  to `<file>.partial` and renames, and sends `transfer:progress` for its `jobId`. In the window, `withProgress`
  (`worldFiles.ts`) shows a progress toast only once work has run 400 ms; the dialogs show it on their status line.
  The last format picked is kept in localStorage (`aiwrite.export.format`, this computer only).
- Ways in: the story menu in the binder (Export story…, Export series bible…), the world menu (Export world…, Make a
  copy, Import a world file…), the Welcome screen (a menu on each world, and Import a world file… under the list,
  shown even with no worlds) and the palette (`export-story`, `export-bible`, `export-world`, `copy-world`,
  `import-world`). The dialogs are mounted once in the workspace (`ExportDialogs`).
**Usage and cost** (`src/main/usage/`, `features/usage/`, Settings › Usage and cost)
- **What is counted.** Every AI call is a `generations` row (job, model, provider, tokens, cost), the memory
  keeper's included (jobs `memory`, `summary`); `memory_runs` only adds those up per run, so it is never read
  (no double counting). Cost is the record's own (`draftCost` and its kin: the provider's figure, else tokens x
  prices, else an estimate), so the page agrees with the toolbar and the Drafts list. A row turned down before
  anything was sent isn't a call; one with no cost counts as "no price from the provider"; a cost with no
  tokens is an estimate. Days and months are local.
- **Across the library** (`library.ts`): each world's sums by day, job, model and provider (`aggregate.ts`),
  read incrementally (rows past the last rowid, plus rows that were still streaming; a changed row count or
  last-row id reads it all again, and spending already counted never goes down). The open world is read
  through its own connection; other worlds read-only, only when world.db or its -wal changed size or time,
  and closed at once. Sums are kept in `usage-cache.json` in the app's data folder (keyed by folder and time
  zone), so the page opens fast after the first time.
- **The limit** (`limit.ts`, `index.ts`): with none set, nothing is added up before AI calls. From 80%, one
  toast a month; at the limit another, and AI calls are held until Adam chooses **Carry on this month**, raises
  the limit or the month turns. What was said is `settings.usage.notice` (one month and one limit; a new month
  or limit starts afresh). Held means: (1) the window's AI-starting calls listed in `ASKS_FIRST` are refused in
  `ipc/index.ts` before the handler runs (UserError code `spend-limit`), and `lib/api.ts` asks ("This month's AI
  spending has reached your $20 limit." Carry on this month / Not now), then makes the same call once more or
  fails with `cancelled`; a new AI action belongs in `ASKS_FIRST`. (2) As a backstop, `insertGeneration` refuses
  any AI call while held (`usage/gate.ts`), before anything is sent, so no job slips past and no draft is cut
  mid-way. (3) Automatic work waits rather than asks: the memory keeper sees the limit as "no model" (scenes stay
  waiting; the top bar's note gives the reason; a run under way stops before its next call), checks after Mark
  done wait in `runOrWait`, and both go again on carry on, a new limit or the month turning. Other automatic work
  (an import catch-up) should check `pausedNote()`/`heldAt()` in `usage/gate.ts` or go through the keeper.
- **Prompt caching** (`ai/client.ts`): the briefing goes out with what stays the same first (`SEND_ORDER` in
  `context.ts`), so models that cache a repeated prompt on their own (OpenAI, DeepSeek, Grok, Gemini 2.5 and
  later) reuse it. Claude through OpenRouter caches only where asked, so `sentMessages` marks the system
  message and, in a draft's briefing, everything before the entries named in the card or direction
  (`ChatMessage.cacheUpTo`, never sent as such; a cached part is reused only when sent again exactly): a
  redraft of the scene within five minutes reads that part at a tenth of the price. Variants after the first
  in a set are sent unmarked (`cache: false`), since they go side by side and couldn't read it yet. Gemini's own
  marks aren't sent, since they add a storage charge and Gemini 2.5 caches anyway. The tokens a provider read
  from its cache (`prompt_tokens_details.cached_tokens`, or DeepSeek's `prompt_cache_hit_tokens`) are kept in
  the record's `params_json` as `cachedTokens` (no migration; the data model stays frozen) and shown on the
  page ("41.2k tokens, 12k from the cache"). Cost is unchanged: OpenRouter's own figure already has the
  discount; a cost worked out from the model's prices counts every prompt token at the full price.
### How manuscript import works

**Reading** (`src/main/importing/`: `docx.ts`, `markdown.ts`, `text.ts`, `lines.ts`, `xml.ts`, `read.ts`)
- Every reader turns the file into `ManuscriptBlock`s (contract `importing.ts`): paragraphs with bold and italic
  runs, headings (`level` from the file, `hint` from the words or a Word style's name), break marks, the title.
  `lines.ts` recognises chapter and part lines by their words and break marks, for every format, and
  `finishBlocks` counts bare numbers ("12") only when there are several and joins "CHAPTER ONE" with a title on
  the next line.
- Word: fflate unzips `word/document.xml`, `styles.xml` and `docProps/core.xml`; `xml.ts` walks tags without a
  tree. Headings come from heading styles, outline levels (the paragraph's own or its style chain's), and style
  names ("Chapter Title"). Deletions, comments, footnotes, field codes, hidden text, text boxes and the table of
  contents are skipped; insertions are kept. Page breaks are noted (`pageBreak`).
- Text files are read as blank-line paragraphs (hard-wrapped lines joined), a paragraph a line, or indented
  paragraphs; bytes decode as UTF-8, UTF-16 with its mark, else Windows-1252.

**The split** (`features/importing/split.ts`, pure). Every heading, break mark, and paragraph Adam split at is a
boundary with a role (act, chapter, scene, ordinary text). `proposeRoles` picks the chapter level (where the
"Chapter ..." headings are; else the top level, or the second when the top holds a few sections of 15,000+ words),
acts above, scenes below, deeper headings as text; with no chapters at all, page breaks start them. Adam's
changes are `SplitEdits` kept apart from the proposal; merging a chapter makes it a scene, merging a scene makes its
heading text (a break mark becomes a line across the page). Text before the first chapter is the "Opening" chapter.
`toPlan` makes the `ImportPlan` the main process imports.

**Importing** (`importing/save.ts`, `importing/doc.ts`, `db/importing.ts`): one transaction through `repo`
(story after the last on the shelf, chapters, scenes, then acts holding their chapters). Each scene is saved as the
editor saves it: paragraphs with fresh 8-character `pid`s, bold and italic marks, hard breaks, horizontal rules, and
the editor's own text form. From the Welcome screen (`importManuscriptFromWelcome`, no world open) the import makes a
world named after the book and its empty "Book 1" gives way (`newWorld`). Undo is the toast's: it deletes the story
(into Recently deleted) and brings back the split to change.

**Unread scenes.** An imported scene is left with `memory_status 'current'`, `memory_version = text_version = 1`
and `memory_paragraphs_json '[]'`: the keeper sees nothing to do, so nothing is read or paid for until Adam asks.
That state means "imported, not read" (`db/importing.ts`); an edit makes it `pending` as any scene, and the keeper
then reads it whole.

**The import catch-up** (`importing/catchUp.ts`) drives the memory keeper rather than reading anything itself: each
unread scene, in reading order, is marked `pending` and handed to the keeper's queue (`updateNow`), two at a time so
Adam's own scenes are read in between and the roll-ups wait for the end, then waited for (`whenRead`). So it runs on
the memory model with the memory's Thinking, writes What changed and summaries, and leaves Generate's catch-up as it
was. The stories still to read are in the world's meta key `import_catchup`; the keeper reads scenes left pending at
app start and the catch-up carries on when the world opens. It pauses with the reason when there is no memory model
or two scenes in a row fail ("Try again"). Stop calls the keeper's `forget` (added for this: drops queued reads and
aborts the one running) and puts the handed scenes back to unread. Progress ("Reading chapter 3 of 24") is the
binder's `ImportLine` under the Check line; the cost estimate (`importing/estimate.ts`) is shown before it starts.
Ways in: the story menu ("Import a manuscript…", "Build the memory from this story" while it has unread scenes) and
the palette (`import-manuscript`, `build-memory`).
### How look and focus work

- **Accent colour** (`contracts/look.ts`, `features/look/accents.ts`, `AccentPicker.tsx`): `settings.accent` is one of
  `ACCENT_IDS` (teal, indigo, plum, graphite) or null for the theme's own (ink blue in Light and Dark, russet in
  Sepia). None reads as amber, red or green. Each has `--accent`, `--accent-hover`, `--accent-soft` and `--accent-fg`
  per theme in `styles.css` (`[data-theme='…'][data-accent='…']`, set by `<html data-accent>`); `accents.ts` holds the
  same values for the swatches, and `accents.test.ts` and `tests/unit/contrast.test.ts` check they agree and keep AA
  contrast in every theme. `--focus` follows the accent. Like the theme, main passes `--aiwrite-accent=…` to the window
  and the preload exposes `initialAccent`, so the first frame already has it; a swatch paints at once, then saves.
- **Tokens added**: `--ai-fg` (text on filled amber), `--overlay` (behind dialogs). Light `--ai` and `--success` were
  darkened a little so their text passes AA on every background they sit on.
- **Reduced motion**: one rule in `styles.css` ends every transition and animation at once (and only once, so nothing
  loops or flickers) and turns off smooth scrolling. Code-driven motion asks `features/look/motion.ts`
  (`reducedMotion()`, `scrollBehavior()`). Panels and popovers use 150–200 ms.
- **Focus mode** (`features/look/focusMode.ts`, pure decisions in `focusLogic.ts`, `FocusLayer.tsx`): F11 (also the
  top bar's button and the palette) on the writing page sets `<html data-focus>` and asks main to fill the screen
  (`setFullScreen`; it only undoes a full screen it made, and `look:fullScreen` ends focus mode if the window leaves
  full screen another way). The binder and scene panel slide shut without touching the saved layout; whatever carries
  `data-focus-chrome` (the top bar, the scene's toolbar, the binder) fades, keeping its room, then is hidden; the
  window behind takes the page's colour. While the panels move, the caret's line (or the line a third of the way
  down) is held at the same height on screen. Esc leaves only when nothing else wanted it (a layer, the selection
  bar, a draft or beat being written, an AI change waiting: those come first, judged as the key went down); F11
  toggles. Leaving the writing page ends it. Ask the world and a name shown beside the page open the scene panel over
  the page's right edge; anything they changed in the saved layout is put back on leaving (`layoutToRestore`).

### Who builds what (parallel build, milestone 6)

| Part | Owns |
|---|---|
| World files and export | `contracts/transfer.ts`, `ipc/transfer.ts`, `src/main/transfer/`, `features/transfer/` |
| Manuscript import | `contracts/importing.ts`, `ipc/importing.ts`, `src/main/importing/`, `features/importing/`, the `import` view |
| Usage and cost | `contracts/usage.ts`, `ipc/usage.ts`, `src/main/usage/`, `features/usage/`, Settings › Usage and cost |
| First run | `contracts/setup.ts`, `ipc/setup.ts`, `src/main/setup/` (the sample world), `features/welcome/`, `features/setup/` |
| Look and focus | `contracts/look.ts`, `ipc/look.ts`, `features/look/`, the theme tokens in `styles.css`, Settings › Appearance, focus mode |

Each part also owns its tests. Shared files (`src/shared/types.ts`, `api.ts`, `defaults.ts`, `lib/store.ts`,
`App.tsx`, menus and the palette, this file) change only additively.

### How the first run works

**First-run setup** (`src/main/setup/state.ts`, `ipc/setup.ts`, `features/setup/`)
- It shows in place of the Welcome screen (and of the workspace) while `useSetup().step` is set. `setupAt` decides at launch:
  a library with no world of Adam's own (the sample doesn't count) and no world open starts at the first step; a setup under
  way resumes at its step with its own world (opened for it); someone with worlds never sees it, nor does a library that
  can't be reached, nor anyone who has used AI Write before (a writer model chosen, or a last world of his own: so deleting
  every world, or a library that can't be read just now, shows the Welcome screen). App.tsx loads it before `init()`, so the
  Welcome screen never flashes first; when the last world reopened, it answers without looking through the library.
- Steps: the world (made at once with `createWorld`; Back renames it), Connect, Writer model, Style, Lay it out. Where it
  stands is one settings field, `Settings.firstRun` (`{ worldId, step, sceneId }`), written by `setSetupStep` as each step
  shows, so quitting midway resumes there. Connect and Writer model use Settings › Models' own pieces (exported from
  `ModelsSettings.tsx`: `OpenRouterCard`, `OtherProviders`, `ModelPicker`, `ChosenModel`, `useConnectionTests`), so keys
  are kept and tested exactly as there. The writer model step suggests a model (`recommendWriter`) with "Use this"; it is
  never chosen silently. Style is saved as Adam's writing preferences (point of view, tense, spelling, voice notes).
- `finishSetup` makes sure the world has a story, chapter and scene and sets `firstRun.step` to `'guide'` on that scene.
  `FirstSceneGuide` (a bar above the page in `SceneView`, never over the words) follows what Adam does: card filled,
  Generate, his own typing in the page (`beforeinput`), Mark done; done or closed, `firstRun` goes back to null for good.
  "Describe my world" opens the World builder instead, with the guide waiting on the scene.
- App tests start at the Welcome screen: `tests/e2e/helpers.ts` sets `AIWRITE_SETUP=off` unless a test asks for `'on'`
  (a setup already under way still resumes).

**The sample world** (`src/main/setup/sampleContent.ts`, `sampleWorld.ts`, `library.ts`)
- Gullhaven, written for AI Write: one story, two chapters, four scenes, four characters with profiles and voices, places
  (one inside another), a group, a hard rule, two plot threads, relationships, knowledge, changes over time and summaries.
  It is made in a closed database through the usual SQL helpers (`initWorld`, `createEntry`, `insertChange`, `putSummary`,
  `addLink`), then opened: Adam-typed pages are `'adam'`, what the memory found is `'text'` with source links to the exact
  words. Every scene is marked read at its version with the paragraphs the keeper stores (`markProcessed`) and summaries
  carry the keeper's fingerprints, so opening it never starts a paid memory run and it never looks unread.
- It is found by the world meta key `sample_world`; `openSampleWorld` opens that one or makes it, so there is only ever
  one, and a deleted one is made again. Ways in: the first run's world step, the Welcome screen, the world switcher and the
  palette ("Explore the sample world"). While it is open, `SampleWorldBar` says so and offers "Start my own world" (the
  setup, or the New world dialog once Adam has worlds).

**Welcome actions** (`features/welcome/welcomeActions.tsx`): `WELCOME_ACTIONS` lists other ways to start, shown on the
Welcome screen and the setup's world step; empty (nothing shows) until "Import a manuscript…" and "Import a world file…"
are each wired in with one line. (The Welcome screen is now the start screen, below; it shows them as tiles.)

### How the start screen works

**The library** (`contracts/library.ts`, `src/main/library/`, `ipc/library.ts`): `getLibrary` reads every world and its
stories (read-only, word counts from `scenes.word_count`, never a scene's text), Recently deleted and where Adam left off.
Deleting a world moves its whole folder into `<library>/Recently deleted/` with a `deleted.json` beside it, for 30 days
(removed for good after that, or by "Empty now"); `listWorlds` never lists that folder. Renames work on any world, open or
not, without switching (`renameWorldIn`, `renameStoryIn`; they send no events, so the window refreshes the store itself).

**The screen** (`features/start/`): `StartScreen.tsx` (Continue, Start something new, the worlds, Recently deleted),
`WorldCard.tsx` (a world opened up to its stories, each with a `CardMenu`: Open, Rename in place with `InlineTitle`,
Details; a world also Export world…, Make a copy, Delete world…), `DeletedWorlds.tsx` (the delete confirmation and
Recently deleted with Restore and Empty now), `startActions.ts` (what each does), `startLogic.ts` (its words, the search,
"Book N" for a plain story; unit-tested), `libraryStore.ts` (the last `getLibrary`, kept on screen while it is read again)
and `Opening.tsx` with its keyframes in `styles.css`.
- **Over the workspace.** `useApp.home` says it shows. App.tsx keeps the workspace mounted under it, hidden with
  visibility and `inert`, so a draft keeps writing into its scene and Continue with the open world is instant. Keys
  pressed on the start screen stop there, so the workspace's shortcuts never fire under it. Opening a world, a story or a
  page (`openWorld`, `createWorld`, `selectScene`, `selectStory`, `navigate`) closes it; something on it that opens a
  world underneath while it stays up (deleting a story in another world, New story…) runs inside `keepHome`. With no
  world open it always shows, except for Settings and the manuscript import, which have their pages without a world.
  Opening another world stops a draft with its words kept (`flushBeforeWorldChange`, as the world menu does).
- **At launch.** `init()` asks `startScreenAtLaunch()` once, alongside the settings: true once per run when "When AI
  Write opens" (`Settings.startWith`, Settings › Appearance) is the start screen, false on a window reload and with
  `AIWRITE_START=off`. A first-run setup wins (App passes `startScreen: false`), so the start screen never follows it.
  Nothing waits for the library: with a world open, Continue shows at once from the store; the worlds fill in when
  `getLibrary` answers (nothing is below them to move). App tests set `AIWRITE_START=off` (`tests/e2e/helpers.ts`)
  unless they ask for `'on'`; with no worlds the screen is the old "Create a world" card, so `createWorldFromWelcome`
  still works.
- **The opening** plays once per run: the mark's strokes (`pathLength` 1) draw in the accent colour while the cards rise
  (`.start-rise`, `--rise` orders them), about a second in all, and a faint texture of the accent drifts behind them
  (a transform only). Any key or click, or the time running out, sets `data-opening='done'`, which ends every
  animation where it would have ended; `data-paused` holds it while the window is hidden; with less motion it is a fade.
  Coming back later, the screen just fades in.
- **Deleting a world** asks first (it names the world and what it holds), saves and stops any draft when it is the open
  one, then the store goes to no world (`closeWorld`). Undo in the toast restores it (and reopens it behind the start
  screen if it was open). A story is deleted with the usual `deleteStory` (Undo, Recently deleted in its world, a backup
  first when other stories start in it), its world opened behind the start screen first.
- **Ways back**: the top bar's Home button (left of the binder button), "Go to the start screen" in the world menu, and
  the palette (`start-screen`). From the start screen, any palette action leaves it first. Importing a manuscript from it
  always makes a new world named after the book (`useImport.forNewWorld`), even with another world open behind it.
- **New story from a recipe…** (`RecipeTile` in `StartScreen.tsx`) shows once there is a finished recipe: it picks the recipe, then
  the world, sets `useRecipes.forStory` and opens New story in that world (`newStoryIn`), so the dialog starts with the recipe chosen.

## Genres and writing styles

What it adds (spec, "Genres and writing styles"): genre presets, the rules against common AI phrasing with underlines
for any that slip through, content intensity levels, "Write a sample for me", an optional polish pass after a draft,
`min_p` for Balanced and Adventurous, and the genre in the style check and Change tone. No migration: everything is new
keys in JSON that already reads with defaults (world meta `style`, `stories.style_json`, the preferences file).

- **Story feel** (`StyleGuide.genres`, `genreNotes`, `intensity`; `src/shared/genres.ts`, `intensity.ts`). Up to two genre
  ids (the first leads, the second blends); a story's non-empty list replaces the world's, each intensity scale it sets
  replaces the world's, `genreNotes` layers like the other text fields (`effectiveStyle`). Preset ids are stored, so never
  rename one. Every preset, rule and phrase is AI Write's own wording (the repository is public).
- **Block 1** (`ai/prompts.ts` `instructionsText`) adds "Genre and feel" (`genreText`: the lead's guidance, a blend's first
  sentence and feel, Adam's own take, a few of the genre's worn-out moves), "Content" (`contentText`: one sentence per scale
  set; the content limits still win) and "Write like a person, not like an AI" (`aiPhrasesText`: `SLOP_RULES` and the
  `PROMPT_SLOP` short list), on while `WritingPrefs.avoidAiPhrases` isn't false. Its short form keeps the lead genre and the
  rules without the phrase list. It grows by about 400 tokens for one genre and about 540 for a blend with all three levels
  (`ai/feel.test.ts`). Ask the world passes `proseRules: false`. `finalInstruction` ends with `feelLine` (the genre's feel and
  the story's, series' or world's tone), since models follow what comes last most closely.
- **Common AI phrases** (`src/shared/slop.ts`): about 40 patterns in groups, `findSlop` for the underlines. The prompt names
  only the worst offenders: naming a phrase can prime it. They are a live check of kind `'ai'` (`shared/liveChecks.ts`,
  `features/liveChecks/`): a dotted amber underline while `avoidAiPhrases` is on, a card with **Fix** (Rewrite on the
  sentence) and **Ignore** (stored as a per-paragraph `phrase` ignore with the key `phrase:<pid>:ai-phrase:<id>`, so no new
  issue kind; `Issue.aiPhrase` labels it). The Issues tab counts them, and a draft that lands with some says so in a toast
  whose Show goes to the draft's first one (the editor's draft-end step carries where the draft landed).
- **The Story feel area** (`features/style/StoryFeel.tsx` and its parts) comes first on both tabs of the Style guide screen:
  genre tiles (colours from each preset's hue through the `--genre-*` theme tokens), the three intensity controls (clicking
  the picked step clears it), the AI phrases switch (also in My writing preferences), and "Write a sample for me" under the
  sample passage (`sampleStore.ts`; Undo after "Use this" goes to whichever form is open).
- **Write a sample for me** (`contracts/style.ts`, `src/main/style/`): a task-runner call, job `'sample'`, marker
  `[AIWRITE-STYLE v1] sample`, the writer model with `settings.thinking.sample` (Off). It is written from the description
  (any existing sample passage is left out of the prompt).
- **The polish pass** (`contracts/polish.ts`, `ipc/polish.ts`, `features/generate/polish*.ts`): "Polish after drafting" in
  the draft options (off; remembered on this computer). When a Generate draft finishes in full, `startPolish` (job
  `'polish'`, `settings.thinking.polish`, Steady) critiques it and returns the whole scene, shown as one change to accept or
  reject; a failure keeps the draft. The cost estimate doubles while it is on.
- **Refusals at strong levels** (`ai/errors.ts` `strongContentRefusal`): with any scale above its second step, a refusal,
  a moderation error, a content filter or a short reply that is plainly a refusal says some models won't write that level
  and to pick another writer model.
- **min_p** 0.05 with Balanced and Adventurous, sent only to OpenRouter; a provider that rejects it is asked again without.
- **From a recipe:** the Recipe maker suggests genres and levels in the recipe's "Genre and content" part (Story
  recipes), so a story started from it gets them too.

## AI sound effects under Read aloud

Optional and off by default (`settings.speech.soundEffects`, Settings › Read aloud and dictation › More), with a download
of its own (`SpeechDownloadKind` `'sounds'`). The contract is `src/shared/contracts/sounds.ts`. The data model is unchanged.

- **The speech server** makes the sounds on this computer: `app/workers/sound.py` runs Stable Audio Open 1.0 through
  diffusers' StableAudioPipeline in its own environment (`venvs/sound`, the same CUDA torch pin as Breeze), takes one at a
  time (fp16, 100 steps), and keeps the take CLAP (laion/larger_clap_general, on the processor) ranks closest to the
  description. `app/sound_audio.py` trims effects, makes ambience a seamless loop (its tail crossfaded into its head) and
  brings every sound to -20 LUFS. `POST /v1/sounds/generate` answers a 44.1 kHz stereo WAV; a 503 with `x-sound-retry: 1`
  means try later. The weights download only the diffusers parts (about 5 GB) and are loaded from the snapshot folder.
  The licence (Stability AI Community) is gated: Adam accepts it on Hugging Face, and the existing key flow (`hfkey.ts`)
  reaches only the weights step; Settings shows "Powered by Stability AI".
- **Sharing the graphics card** (`app/engines/gpu.py`, `Engine.load`): each card engine has a rough memory need and a
  priority. Another engine is let go only when nvidia-smi's free memory can't hold the one loading; the voices always win
  (a sound being made is stopped for them), and sounds never push out voices that spoke in the last minute. The sound
  model is let go after 90 s unused. Health says whether sounds can sit `beside` the voices; the app holds sound-making
  while a reading plays when they can't.
- **Word timing**: `POST /v1/align` hears a spoken clip with the downloaded dictation model (faster-whisper word times, or
  Parakeet token times) without changing Adam's dictation choice. The app keeps the word times beside the clip in the
  Read aloud audio cache (`<key>.words.json`), maps each sound's anchor word to them (`sounds/align.ts`), and estimates by
  the word's place in the clip when there is no dictation model or the words don't line up.
- **Marking** (`src/main/sounds/marks.ts`, `prompt.ts`): a part at a time just ahead of the voice, beside the speaker
  marking, with the Read aloud model and its own Thinking (`settings.thinking.sounds`, `ThinkingJob`; records are job
  `speech` with `params.sounds`; prompt marker `[AIWRITE-READ-ALOUD v1] sounds`). Each cue is anchored to a word by a
  short quote and the word. The AI's marks are a cache per scene in `speech-cache/sounds/`, per paragraph with its text
  hash. A draft landing marks its sounds in the background too. Sounds never hold a reading up.
- **Adam's sounds** live in the world's meta key `sounds` (`SoundEdits` by scene). Any edit makes the paragraph the sound
  starts in his: the AI's sounds there are copied in as his and the AI never marks it again. Undo restores the scene's
  edits as they were.
- **The sound library** (`sounds/library.ts`): app-wide in `<userData>/sounds/`, never in a world. Exact key on the
  normalised description, then a near-duplicate check; the marking prompt is shown the library's sounds and reuses them.
  Sounds are made one at a time ahead of the reading (`sounds/making.ts`); one not ready in time is skipped. Read aloud's
  Clear leaves it; Clear sounds (with Undo) empties it.
- **Playing** (`features/sounds/`): one Web Audio mixer; each clip carries the ambience in force as it starts (`bed`)
  and its sounds (`sounds`); edges fire when the voice's audio element reaches the anchor's time, at any speed and across
  pause. Ambience loops, crossfades and ducks under the voice; volume is `settings.speech.soundVolume`.
- **The Sounds tab** in the scene panel (while sound effects are on) lists the scene's sounds and lets Adam add, move,
  re-describe and remove them, each with Undo; the page marks their words faintly while it shows. Each sound has its
  own volume (25% to 200%) and mute (`SoundCue.volume`, `muted`: edits, so the paragraph becomes Adam's); a muted sound
  is left out of plans. "New take" makes a library sound afresh with a new seed; the earlier take is kept aside
  (`clips/<id>.prev.wav`) until Adam keeps the new one or goes back (`keepTake`). The reading bar's "Mute sounds in this
  scene" is `SoundEdits.muted`: a muted scene's plan has no sounds and no ambience.

## Interview me on scenes and chapters

The world builder's "Interview me", on a scene card and on a chapter (spec, Writing workflow › Planning). It is the
outline helper's job: `'outline'` generation records with the chat and brainstorm model and its Thinking (no new
job), prompt markers `[AIWRITE-OUTLINE v1] interview scene|chapter`, `fill scene` and `plan chapter`
(`src/main/outline/interview.ts`; the fake provider answers them in `tests/fake-provider/m4/outline.mjs`). Nothing
about an interview is stored: the answers live in the window (`features/outline/planInterviewStore.ts`, one per
scene and chapter while the app is open) and are sent with each request.

- **Questions.** One request per question (`askPlanQuestion`), with what next scene ideas are told (a scene: the
  card as it is on screen and which parts are empty) or the chapter with the outline around it
  (`chapterAroundText`), plus the interview so far. The AI says `{"done": true}` when it has enough; after
  `MOST_QUESTIONS` (8) it is done without asking. Adam answers (typed or dictated), skips, or presses Done (Stop
  while nothing is answered); an answer typed but not sent is used too.
- **A scene** (`PlanInterview` at the top of the scene card, beside "Ideas for this scene"; the palette's "Interview
  me about this scene"): `fillSceneCard` asks for the card's empty parts as JSON; names are matched to the world's
  characters and places (`matchEntry`), unknown ones left out. The window puts in only parts still empty on the card
  on screen (`planInterviewLogic.fillOnCard`), so nothing Adam wrote changes; Undo empties only what is still as it
  was put in.
- **A chapter** (the binder's chapter menu "Interview me about this chapter", and the palette): the outline view with
  a `chapterId` (`ChapterPlanner.tsx`), showing the chapter's goal (editable, saved to the chapter) and the
  interview. When it ends, `startChapterPlan` streams the outline helper's form with no chapter heading; it is a
  helper session of its own (`helperStore.suggestChapter`, key `<story>#<chapter>`) whose `lead` is the chapter's
  heading and whose chapter node starts out kept, so `Suggestions` (with `chapterId`) lists the scene cards and Keep,
  Edit, Discard and their Undo work as on the outline helper's page. A goal in the reply goes to the chapter only
  while it has none, with Undo. The first scene kept into a chapter whose only scene is an untouched "Scene 1"
  becomes that scene (`keepOutline`), and its Undo puts it back.
## Story recipes

What it adds (spec, "Story recipes", its own update after milestone 6): Adam brings in a whole story (Word, Markdown,
plain text, or pasted) and the AI distils it into a **recipe**: the story's themes, writing style and structure,
without its words. Recipes are kept in a recipe library on his computer, can be read, edited, renamed, copied and
deleted, and a new story can be planned from one. The data model stays frozen: world.db is unchanged.

- **Where it lives.** `<library>/Recipes` (`recipes/paths.ts`; "Story recipes" only if a world already uses a
  folder called Recipes), beside the worlds and never one of them: it holds no world.db, so the world list, the usage
  page's worlds and world files never see it; `listWorlds` skips it by name too, and `slugify` never names a world's
  folder "Recipes". Backups, world exports and the installer only ever take world folders or the app, so they never
  include it; `.gitignore` ignores a stray `/Recipes/` at the repository root. Each recipe is a folder named by id
  (never by the story's title): `recipe.json`, `source.json` (the story's text) and, while it is made, `making.json`
  (each chapter's notes). Deleting or cancelling moves the folder to `.removed/` for its Undo toast; it is deleted for
  good after 10 minutes or when the app quits.
- **The story's text** goes only to the Recipe maker's model, and only while a recipe is made (or read again). It is
  kept with the recipe after it is made, as the spec says ("so it can be read again"), until Adam presses **Forget
  the story's text** (Undo in its toast). A copy of a recipe doesn't copy the text. The notes on each chapter go once
  the recipe is made.
- **The Recipe maker** is its own job, `recipe`: "Recipe maker" in Settings › Models (`settings.models.recipe`, the
  memory model until Adam picks one, then the writer model), with its own Thinking (`settings.thinking.recipe`, Off).
  Prompts start with `[AIWRITE-RECIPE v1] <step>` (`chapter`, `combine`, `fix`, `story`); the fake provider answers
  them in `tests/fake-provider/recipes.mjs`.
- **What it costs is counted, without the words.** Recipe calls go through the task runner (`ai/tasks.ts`) like any
  AI call, so the monthly limit holds them before anything is sent, but their records are written to the recipe
  library's own `Recipes/spending.db` (same `generations` table, `recipes/spending.ts`), never to a world. As each
  call ends its words are wiped from its record (what was sent, the reply, the error), leaving job `recipe`, the
  model, tokens and cost. `usage/index.ts` adds that file's tally to the library's spending (and so to the monthly
  limit) as the job group "Story recipes"; it is not counted as a world and never shows in one world's figures.
  `startRecipe`, `carryOnRecipe`, `readRecipeAgain` and `startRecipeStory` are in `ASKS_FIRST`.

### How a recipe is made

- **In.** The make page uses the manuscript import's readers (`chooseManuscript`; pasted text through
  `readPastedStory`, read as a .txt file is) and its split (`features/importing/split.ts`): the chapters with their
  words, scenes and opening words, and merging one with the one before. Before anything is sent the page shows the
  estimate (`recipes/estimate.ts`: one request per chapter, or per piece of a long chapter cut to fit the model, plus
  the recipe and a possible fix) and says the story goes only to the recipe maker model.
- **The maker** (`recipes/maker.ts`, wired in `recipes/index.ts`) works like the import catch-up: in the background,
  one recipe at a time in the order asked, chapter by chapter ("Reading chapter 3 of 24", Cancel), each chapter's notes
  saved as they come so it carries on after a restart. It pauses with the reason when there is no model or the monthly
  limit holds AI calls (and carries on by itself when the models or the limit change), or after two failed calls in a
  row (Try again). Its calls aren't stopped by a window reload (`outlivesWindow` in the task runner), so they are
  never paid for twice. The notes file is written before a recipe says it is being made, and a recipe left "being
  made" without one is paused at start; something unexpected breaking pauses the recipe with Try again. Cancel on a
  finished recipe being read again puts it back as it was (`wasReady`); only a new recipe leaves the library. Then it writes the recipe from the notes and the pacing figures code counted (`recipes/source.ts`:
  words, scenes, share of dialogue, where each chapter falls), and checks it.
- **No names, places or sentences** (`recipes/leaks.ts`). The prompts forbid them; then the recipe is checked against
  the story: names (words capitalised mid-sentence twice, or once and never in lower case, even ordinary words such as
  "Will" or "Rose"; words only ever at sentence starts that aren't ordinary English words; the title's words) and any
  run of 8 or more words copied from the story, judged as the whole matching run (only a run under 12 words made
  entirely of little words passes). Parts that leak are asked for once more (`fix`); whatever still leaks is taken out a
  sentence at a time. A suggested name that gives the story away becomes "A story in N chapters".
- **A recipe holds** (`contracts/recipes.ts`): themes (with each act's tone and mood), tone, point of view, tense,
  writing style in plain words, a sample passage written fresh, shape and turning points, beats as general moves, cast
  roles, pacing and devices, and its genre and content: "Genres: Horror, Mystery. Romance: Fade to black. Violence:
  Vivid. Language: Mild." (`recipes/feel.ts`: the prompt lists the preset and step labels from `genres.ts` and
  `intensity.ts`; the reply is read back by those labels, any case, unknown words left out, and saved in their own
  form, so it holds none of the story's words and skips the leak check; '' in a recipe made before it). Every part is editable on its page (saved as he types); a part he changed is his
  (`edited`) and **Read the story again** never overwrites it. A neutral name the AI suggests, or his own.

### A new story from a recipe

- The New story dialog shows "From a recipe" once the library has a finished recipe (a recipe's page opens the dialog
  with it picked): his own guidance, and "Write it in the recipe's style, with its themes and tone" (on by default).
- On Create, `applyRecipeToStory` (`recipes/apply.ts`) puts the recipe's point of view, tense, writing style and sample
  passage into the story's style guide (`Story.style`), with its genres and each level its "Genre and content" part
  names (read the same way, so Adam's own edits count; nothing there changes nothing), and its themes and tone into
  the story's (Undo in the toast, `unapplyRecipe`, puts the genres and levels back too). From then on drafting reads the story's style guide, not the recipe.
- The plan page (View `recipePlan`) asks `startRecipeStory`: the **chat and brainstorm model** (the outline helper's),
  an `outline` record in the world holding the recipe and the guidance (never the source text), with the world's
  characters, places and threads, the guidance first ("it wins wherever it differs"). The answer is a `Premise:` line
  and then the outline helper's own form, so `features/outline/helperStore.ts` (`suggestOutlineWith`, added for this)
  reads it and its `Suggestions` keep, edit and discard acts, chapters and scene cards exactly as the outline helper
  does. The premise is kept as the story's premise, with Undo.
- Ways in: the palette (`go-recipes`, `make-recipe`), the top bar's world menu and the Welcome screen ("Story
  recipes"); the library works with no world open, but a story needs one.
- Not yet: "Interview me" for a recipe, and matching each cast role to one of Adam's characters (or building a new one
  as Quick start does).

| Part | Owns |
|---|---|
| Story recipes | `contracts/recipes.ts`, `ipc/recipes.ts`, `src/main/recipes/`, `features/recipes/`, the `recipe` job (types, defaults, `jobModel`, providers, Settings › Models), `tests/fake-provider/recipes.mjs`, `tests/e2e/recipes.spec.ts` |

## The two looks: the New look and Classic

Settings › Appearance › Style chooses between the **New look** ("Lamplight", the default) and **Classic** (the app
exactly as it was before it). It is the setting `look` in settings.json; the window opens in it (`--aiwrite-look=…`,
as the theme and accent, `window.aiwrite.initialLook`) and `<html data-look>` paints it (`features/look/look.ts`).
Someone updating from before the New look (a settings.json with no `look`) gets the one-time note offering Classic
(`lookNote`, `lookNoteDue` in `contracts/look.ts`, `features/look/LookNote.tsx`); a fresh install doesn't. App tests
start in Classic with no note (`AIWRITE_LOOK=classic` in `tests/e2e/helpers.ts`); a test asks for the New look with
`env: { AIWRITE_LOOK: 'new' }`, or `''` for what Adam gets.

- **Not a fork of screens.** The same components read the same tokens. `styles.css` adds the New look's tokens with
  Classic's values (exactly what each place used before): `--raise`, elevation (`--elev-1..3`, `--elev-page`; Tailwind
  `shadow-e1..3`, `shadow-sheet`), the kind inks (`--k-char`, `--k-place` ..., with `-soft` tints; `KIND_INK` in
  `features/world/kindIcons.ts`), `--heading-font` (`font-heading`), `--r-card` (`rounded-card`) and motion
  (`--dur-press`, `--dur-quick`, `--dur-base`, `--dur-view`; `ease-glide`, `ease-spring`). The New look sets its own
  per theme under `[data-look='new']`. Where a shape differs, a class says so with the `look-new:` variant (or
  `look-classic:`). Less motion sets every duration to 0.
- **Icons** come only from `components/ui/icons.tsx` (by their Lucide names, or `<Icon name>`): Lucide in Classic,
  Phosphor two-tone in the New look, filled when `selected`. Only the two Phosphor weights the app draws are kept, in
  `phosphorShapes.ts`, written by `node build/phosphor-icons.mjs` from ICONS.
- **Fonts.** Classic's prose is the static Literata it always had (`--serif-font`); the New look uses Literata's
  variable font, whose optical sizes give the headings their display cut. Each look loads only its own.
- **The New look's frame** (Classic renders today's binder and sample bar instead): the area rail
  (`layout/AreaRail.tsx`: Write, Plan, World, Check; Ask and Settings at its foot), the area's side list in the
  binder's pane (`layout/AreaList.tsx`; Write's is the binder without its World section), the trail in the top bar
  (`layout/Trail.tsx`) and the sample world as a chip. **Which area a screen belongs to is one table**,
  `AREA_OF` in `layout/areas.ts` (TypeScript asks for every view), so a screen opened from anywhere lights its
  area. The selection glides (`components/ui/GlidePill.tsx`: one pill behind a list, moved by transform), and a
  new page fades in with a small rise (`.view-in`, styles.css).
- **Classic can't drift**: `tests/e2e/classic.spec.ts` compares the main screens in Classic, Light and Dark, on the
  sample world, with screenshots taken before the New look began (one set per platform).
- Contrast: `tests/unit/contrast.test.ts` checks the New look's colours and kind inks in every theme and accent.

## The editor chat (Ask the world, October 2026)

Ask the world is also an editor: it talks and brainstorms, looks things up for itself, and proposes changes that
only happen when Adam applies them. Adam's choices: it may propose any change (words, scene cards, memory entries,
new entries, scenes and chapters, new titles) but never deletes; each change has Apply and Not this, with Apply all;
it uses the Chat and brainstorm model, with no setting of its own.

- **Tool calling.** `ai/client.ts` sends `tools` and reads streamed `tool_calls`; `ai/tasks.ts` runs the loop when a
  request has `agent`: up to `MAX_STEPS` (12) requests, the last one without tools so the model answers in words.
  Cost and tokens add up across steps; each step's label is kept in `params.steps` (What the AI saw: "Steps it
  took").
- **The tools** (`ask/agent.ts`, `EditorAgent`): `read_scene`, `outline`, `search`, `get_entry`, `style_guide`,
  `scene_issues` look things up; the `propose_*` tools only record a proposal (checked first: an edit's words must
  be in the scene exactly once, on one line) and tell the model nothing has changed yet. A mistake goes back to the
  model as the tool's answer, never as an error. Proposals are saved with the answer's record (`db/ask.ts`) and
  sent as `ask:proposals`; each step as `ask:step`.
- **Applying** happens in the window (`features/ask/applyProposal.ts`) through the usual APIs, each with its Undo:
  words go into the page as one step after `snapshotBefore`; a new character is made as the builder makes one, so
  it gets its read-aloud voice. The cards are `features/ask/Proposals.tsx`.
- **Honest about what is waiting.** A `propose_*` call that fails answers "Not proposed: nothing is waiting"; an
  edit that overlaps another waiting one is turned down (once one is applied the other's words would be gone), and
  `revises: N` replaces change N instead. Before the last request (no tools) the model is told what it proposed
  (`lastWords`). If an answer still speaks of changes to apply and none came with it, the chat says so under it
  (`speaksOfChanges`, `features/ask/askWords.ts`).
- **A model that can't use tools** is said so in plain words (`ai/errors.ts`), pointing to Settings › Models.
- **Ask about this** on the selection bar opens Ask with the words quoted in the box (`features/ask/open.ts`).
- Tests: `tests/e2e/editorChat.spec.ts`; the fake provider's tool calls are in `tests/fake-provider/m4/ask.mjs`.

## Milestone 1 scope

Installer and auto-update; library, worlds and stories; binder; editor with autosave
and backups; providers and model choice; simple forms for characters, places and lore;
style guide; scene cards; context assembly with fixed priorities; Generate draft with
streaming and Stop; "What the AI saw". Anything from a later milestone waits.
