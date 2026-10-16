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
                 (reads the database: what counts for one scene), items.ts (who has what, and an item's
                 main word), calendar.ts and storyCalendar.ts (the story calendar, fix 11). Pure where it can be.
  keeper/        The memory keeper (milestone 2): reads scene text with the memory model and keeps
                 the memory in step with it, plus summaries at every level
  retrieval/     Story memory step 5: sticky entries, what was said, and searching the story so far by
                 keyword and by meaning (its own file, search-index.db, and the search model in model/:
                 onnxruntime-node, or a TypeScript reader where that can't start)
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
  prose is Literata (`font-serif`).
- **Motion** goes by how often a thing happens, at the New look's speeds (`--dur-*` in `styles.css`): instant (0)
  for typing, switching scenes, arrow keys and anything done from the keyboard; press 90 ms; quick 150 ms (hovers,
  menus opening); base 220 ms (the selection, tabs, dialogs, panels); view 280 ms (a change of screen); moment
  500–900 ms only for rare moments (a scene done, the start screen). Exits are quicker than entries (140 ms) and
  leave the way they came; nothing eases in. Text never moves: new AI words may fade in (opacity only, 160 ms) and
  settle from amber into ink, never slide, and the page follows a draft being written by easing over time, never by
  jumps. A screen's pieces arrive once a session (the desk's rooms), never again on coming back. Loops are only for
  the AI at work (its dock's shimmer) and stop with less motion. Less motion
  (Windows' Animation effects off) makes every change instant, View Transitions too. Classic keeps the 150–200 ms it
  always had, except presses, which go in and come back as in the New look. See "The two looks", Motion.
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

**Migration 3: facts follow their words** (World Memory Overhaul part A, 2026-10-08). The written reason:
a fact whose words were edited and that the memory model said nothing clear about stayed marked
`changed` for ever: it was never asked about again, never removed when its words were later deleted,
and the writer was still told it as true. To settle such facts, a source link has to remember how many
reads since the edit have left its fact unconfirmed, so `source_links` gains `checks` (that count) and
`changed_at` (when the words were edited). Both have defaults, so older worlds open unchanged (a link
already `changed` takes its `updated_at` as `changed_at`). The rules that use them are in
`src/main/keeper/apply.ts` (a text fact still unconfirmed one read after it was first left so goes, with
Undo; what Adam made himself never does) and `src/main/memory/scene.ts` `writerData` (the writer leaves
such a fact out until a read confirms it). An entry's own summary also gets source links, as fact kind
`summary` with field `summary`, which the schema already allowed.

**Part B, round 1** (2026-10-08) needs no migration. Every source line opens the scene at the exact words (in their
own paragraph first; the paragraph itself when they were edited since: `features/editor/reveal.ts`), and "(since
edited)" offers "Check again now" (`Keeper.checkAgain`: the scene is read again though its text hasn't moved on). The
memory check list ("Worth a look" on What changed) is `src/main/keeper/checkQueue.ts`: unconfirmed text facts, the
AI's guesses, summaries being updated and notes on Adam's own facts, with Keep (it becomes Adam's and its links go),
Remove and Undo. Each part of the writer's briefing records what its memory lines rest on as small tags
(`ContextBlock.memory`, built in `ai/memoryTags.ts`, stored inside `blocks_json`: names and ids only);
`shared/memoryTags.ts` `countMemoryTags` and `db/generations.ts` `memoryTagCounts` count them for a record.

**Migration 4: facts with a start and an end** (Part B round 2, B1, 2026-10-08). The written reason: a change was true
from its scene for ever, so "lost her knife" was still told to the writer chapters after she found it again; the only
ends were a relationship's `ended`, a known fact's `forgets` and a thread's resolve, each a new change the writer had to
weigh against the old one. `changes` gains `until_scene_id`, `until_when` (the story's words for when, optional),
`until_origin`, `until_quote` and `until_paragraph_id` (the words that end it, so the end follows them). Columns only,
all empty for older worlds, so every change keeps holding as before. `Change.until` carries them; `db/memory.ts`
`setChangeUntil` sets or clears one with a version. The line (`memory/state.ts`) stops counting a change when the walk
reaches its until scene: its note moves from `happened` to `ended` (history), a field it set goes back to what it was
unless something later set it again, a relationship it set ends and a fact it taught is no longer known. The briefing,
what must stay true and the memory keeper's "So far" see only what holds; the canon timeline marks what ended as past
("Mara: lost her knife (until Ch 4, Sc 2)", `ai/timeline.ts`); entry pages say "until …" (`changeViews` `untilWhere`).
The memory model ends a fact with an "end" item (a "So far" note or a K id, with "when" if the words say;
`keeper/apply.ts` `endChange`): never one Adam made himself (a quiet note instead), Undo puts it back and records a
suppression, and `settleEnds` makes the end follow its words (moved words carry it; gone words make the fact true
again, with Undo).

**Part B round 2, the rest** (2026-10-08, no further migration):
- *B4, the open threads ledger.* `memory/threadQuiet.ts` `threadTouches`: the step on a story's line that last touched
  each plot thread (a thread change, or a scene holding words its facts rest on: `db/history.ts` `entryLinkScenes`) and
  how many scenes it has been quiet since. The board gives each thread `lastTouched` and, while open, `quietScenes`
  (to the story's end); the Plot threads board has a Board / Ledger switch (`ThreadsBoard.tsx` `Ledger`, rows sortable by
  quiet-for or name, `boardLogic.ts` `ledgerRows`). The scene memory gives each thread `quiet`, `lastStoryId` and
  `lastWhere` (`memory/scene.ts` `withLedger`, formerly `withQuiet`); the writer's open threads block (`ai/openThreads.ts`) always keeps the
  most overdue (quiet for `QUIET_SCENES`, 6, or more, and last touched in the story being written; at most 2) and ends
  with one line, "Quiet for a while: … If it fits here, a passing mention keeps it alive; never force it." The promises
  ledger (long story memory fix 10, below) builds on it: `threadTouches` also gives where a thread change first opened
  each thread (`opened`), so a later touch is a step on.
- *B5, who knows what from who was there.* `keeper/presence.ts` `onStageAt`: on stage at a paragraph are the scene
  card's people and anyone named in that paragraph or the two before, less those a change in the scene says left or
  died earlier; people only. Something said is known by the speaker, those the model says heard it and everyone on
  stage (not when whispered or said aside); an event is known by everyone on stage ("Saw it happen", `seen`). Each such
  knowledge change keeps `there` (who was on stage) and is linked to the same words, so it follows edits like any fact;
  an event's Undo takes its witnesses' knowledge with it. `FactState.backed` (`memory/state.ts`) is true when every
  learning of the fact on the line is Adam's, has `there`, or is something said (which always names who heard it); the
  writer's "Kept from …" lines (`ai/mustStay.ts` `secretsAmong`, so the plan's too) and the check's and repair's "Not
  known by" leave out every fact that isn't backed: a plain "knows" the memory read on its own says nothing of who
  doesn't know it.
- *B7, clear actions for the memory model.* The reading prompt (`keeper/prompts.ts`) has one rule line, "Actions on
  the memory", and four items in the same shape (an entry id, a quote): `end` (B1), `guess` with `do` confirm or
  withdraw (the memory lines mark the AI's own guesses "(guess)", `keeper/request.ts`), `close` (an open thread, applied
  as a resolve under the same rules: `applyThread`) and `summary` (A2's revise). A guess confirmed gets a link and
  becomes text-born; withdrawn, it is cleared (never an entry's summary); only `guessFields` count, so Adam's fields and
  the world builder's drafts are never touched; each has Undo and a suppression. To make room, some examples were cut,
  so the prompt is 5,948 characters (about 1,700 tokens; 5,806 before round 2) and still fits a 3,000-token model.
  (5,875 since long story memory fix 12 added the "name" item and tightened the wording, to leave later fixes room;
  5,942 since fix 9 gave "knows" its how, from and wrong, again with tighter wording.)
- *B8, re-read buttons.* "Re-read this scene" (the binder's scene menu, the palette) and "Re-read the whole story" (the
  story menu, the palette) open `features/memory/RereadDialog.tsx`, which first asks `estimateReread`
  (`ipc/keeper.ts` `rereadEstimate`: the reading requests as `importing/estimate.ts` `guessReread` reckons them, priced at
  what the memory model has lately cost per token in its own `memory_runs` records, `db/keeper.ts`
  `memoryCostPerToken`, else at its prices; "Free with your local model" for a local server; "The cost isn't known"
  otherwise), then `startReread` (in `ASKS_FIRST`, so the spending limit asks first). `Keeper.reread` queues the scenes
  through the usual queue; `runScene` with `whole` reads every paragraph (`planRead` diffs against nothing), facts already
  read told to the model as such. `MemoryStatus.rereading` carries progress; the top bar shows "Re-reading 3 of 12…"
  with Stop (`stopReread`: the waiting scenes are dropped, the one being read stops with nothing applied). While there is
  no model (the limit) the scenes stay asked for and go on when it comes back. Nothing is kept across a restart.

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

### Things are items, and what the memory finds holds only what the story says (Adam, 2026-10-07)

A trap test with a real model found the memory filing a blue glass bead (promised to a child, later bought for
her) as a character, and the follow-on fill then wrote it eyes, fears and lines of dialogue, some of them from
later in the story ("It lies in Wren's palm at the Assize… still promised"). The model chose "character"; the
fill was told to choose "what fits" where the story says nothing, and was given the whole world and the story's
plan to choose from.

- **Kinds.** The memory model is told that a thing someone has, wants, gives or buys is an item, and an animal
  in its own right is a character. As a guard (`keeper/kinds.ts`), a new entry it calls a character is made as an
  item when its name or summary says it is a thing (or it is "it"), nothing says it is a person or an animal, and
  nothing shows it acting: no line of the scene has it speak, think or feel, and the model's reply gives it no
  words, knowledge or feelings. A description the model reads with a new entry is now kept (it was dropped).
- **Filling in what the memory found** (`fillFound`, `fromStory`) uses only the scene's words about the entry:
  the paragraphs that name it or that it was read from. No world list and no premise. Each value must come with
  words copied from those paragraphs, and is kept only when the words are there and the value rests on them
  (half of what it says is in them); "none" and guesses are dropped, so a field the story doesn't fill stays
  empty. The arc, role, sample lines and "never says" are never filled this way. With nothing about it in the
  scene, nothing is asked. The World builder's own fill still drafts what fits the world, as before.
- **Adam's entries and old worlds.** Only entries the keeper is making are ever re-kinded; an entry already in the
  world, Adam's above all, is matched by name and left as it is. Facts Adam typed are never overwritten. Worlds
  made before this keep their entries as they are: nothing is rewritten automatically and nothing new is offered
  on screen. The fix applies to what the memory finds from now on.

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
  Since long story memory fix 12 it also underlines what the scene's words call a character (`SceneNames.called`,
  marked `data-called` with the words, which the hover card says: "Character · “her brother” in this scene"), and
  reads names by the one rule `mentionAt`, the briefing and what must stay true share (`shared/names.ts`: any
  apostrophe for any, no word joined on by a hyphen, and not "Will you…?"; see "Long story memory: spotting characters").
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
  While it is on, paragraphs with no marks yet (Adam's own words, older scenes, an edit) are marked in the background
  (`speakerLabels` with `mark`: as the scene opens and 6 s after typing stops, twice at most for the same words). A line
  given a speaker but no note on how it is said is asked about once more (`Ask.again`); marks files from before (v1)
  drop the empty notes on named speakers' lines that Mark who says what never filled in.
  Everything installs and runs on Windows with no terminal (Python itself through Windows' own installer).
- **MCreader's newer speech (Adam, 7 October 2026).** The Breeze worker is MCreader's current one: a voice designed
  from a description is made as a clean studio recording (`STUDIO` after the description), the first of three takes
  that says its whole line, saved whole or not at all; a hurried line is read only a touch quicker (pace `lively`,
  `calmed` in `readAloud/emotion.ts` takes the note's words for hurrying out); `calmPunctuation` (`cleanText.ts`)
  tames ". . .", "?!?!" and clips with no words. The **studio voices** are their own download (`SpeechDownloadKind`
  `'studio'`, run with the voices' environment, which comes first): `tools/install.py studio-voices` reads each native
  English speaker of the EARS dataset (CC BY-NC 4.0) out of its zip by HTTP range, never copied from another app, into
  `voices/library/` (calm clip, ten acted feelings, whispering and reading loudly; `index.json` with name, gender, age
  band and pitch, named as MCreader names them), and `check-model` fetches the word check's listener
  (distil-whisper small English, into `models/hf`); `studio-check` leaves `voices/library/.ready`. The server lists
  them as `clip:library/<id>.wav` voices, which the window marks Studio. With "Studio voices for new characters"
  (`speech.studioVoices`, on) the background voices (`voiceLater`, `castAfter`) also give each new character a studio
  voice: one call to the Read aloud model casts them, all different and none another character or the narrator has,
  and `pickVoices` (`readAloud/studio.ts`) fills in by gender, age and pitch. Their description stays, so clearing the
  pick goes back to it; a voice picked from the list is never replaced. Settings' "Give characters studio voices"
  casts every character in the open world without a list voice (Undo restores those not changed since). With "Act out
  feelings" (`speech.actFeelings`, on) a studio voice's line of dialogue goes out with `mood` (`moodFor`: whisper for a
  hushed note, loud for a shout, else the feeling `emotionOf` reads in the note; none for calm or a hint of one), and
  the worker copies that line from the speaker's acted clip (`MOOD_CLIPS`). "Redo this line" (the reading bar) reads
  the line again as another take, kept per clip in `speech-cache/takes.json` (`readAloud/takes.ts`) and applied when
  planning. "Check each line's words" (`speech.checkWords`, off) has the worker listen back with the word check and
  voice a line once more past 15% words wrong. `mood`, `take` and `check` go in a clip's request (and its cache key)
  only when set, so audio kept before still plays.
  Adam's own MCreader voices (7 October 2026, "everything") were copied once into his speech folder on his computer,
  never into git: voices made in MCreader's voice studio in `voices/library/` with `custom.json` (listed as his, "your
  voice", and never cast by the AI), the four Expresso voices added to `index.json`, and the voices MCreader designed
  from descriptions in `voices/mcreader/` (listed "From MCreader ·" and the start of the description, which the server
  reads; also in `voices/breeze/` where that description wasn't designed here yet). `Remove downloads` removes them too.
- **World builder.** "Build the world from a summary" (`src/main/worldBuilder/`, `features/worldBuilder/`)
  reads Adam's summary in parts that fit the model (at most `OVERVIEW_PART_TOKENS` each), reads each part again
  for what its list left out (`overviewMoreUser`, up to `MORE_LOOKS` times, stopping when a look finds nothing
  new: a long list is cut off, and models skip minor things), and lays the world out kind by kind (characters and
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
  builder model and Thinking), reading the summary as it stands and the questions asked so far, each with Adam's
  answer. A reply that repeats an earlier question, or a topic already answered in the summary ("Setting: ..."
  lines), is sent back once (`repeatOf`, `askedAlready`). Answers never go
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
  is set; it is saved even when read aloud isn't set up. Since 2026-10-07 the memory keeper's fill is from
  the story alone (see "Things are items" under milestone 2).
- **Who says each line, from the writer.** With read aloud on (or "Show speakers and tone"), a draft's closing
  instruction asks the writer to put the speaker, and how the line is said, in curly braces just before each quote
  (`SPEAKER_TAG_LINE`, `ai/speakerTags.ts`). `SpeakerTagFilter` takes the tags out as the draft streams (always, a
  variant's too), so they never reach the page, the record or the word count; `onSpeakers` hands what they said to
  `noteWriterSpeakers` (`readAloud/index.ts`), which puts them on the new paragraphs' quotes as marks
  (`writerMarks`). The writer tags only the dialogue: the narration's mood is the marker's (below). What the writer
  didn't write (Adam's own words, older drafts, a line it left untagged) is marked by the writer model as well,
  without thinking (`askFor`); the Read aloud model only suggests voices (and marks sound effects).
  A tag is `{Who|how|pace|sound}`, its fields read as the marker's notes are (`readMark`); both are told the same rules
  for a note (`HOW_NOTE` in `readAloud/speakers.ts`). A tag belongs to the line it sits inside, else the next line in
  its paragraph; the untagged part of a line split by an action takes the tagged part's speaker and tone, and "Wen" is
  the character Old Wen (`memberNamed`). A tilde mood a writer gives unasked carries on until its next one
  (`readAloud/writerBlocks.ts`), and the marker's "same" carries the mood before it. Continue and the AI edits ask for
  tags too (`edits/prompts.ts`, the task runner's `onSpeakers`); a variant's or an edit's tags wait by record
  (`noteGenerationSpeakers`) until History's snapshot before it goes in names it (`generationGoingIn`). Every tagged
  record keeps `params.speakerTags` (quotes, tagged, toned, moods, dropped), and the reply gets 15% more room
  (`TAG_ALLOWANCE`). Writer tags that cover a paragraph emit 'readAloud:marked', as the AI's marks do.
  Live checks (4 October 2026, DeepSeek V4.1 Flash, invented scenes): asked for dialogue tags only, it tagged 87% of
  quotes (109 of 125, never failing outright); asked for narration moods as well, 65–69%, and now and then it put
  moods before every quote in place of speakers. It tends to leave the viewpoint character's short replies untagged;
  the marker's background call for the narration names those too.
- **Speakers the rules only guess** (a name nearby, turn-taking) are checked by the AI and wait for its answer; only
  a dialogue tag is taken without asking. A name the AI writes a little differently ("Adam (whispering)", "Adam
  Reyes" for a page called Adam) is still that character (`memberNamed`).
- **Speech in italics** (a ring that talks: *Go on,* said the ring.) is dialogue when a dialogue tag sits beside it,
  and so are the same speaker's later italic stretches in that paragraph (`readAloud/italicSpeech.ts`). Reading
  aloud plans and marks the paragraph with that speech in quote marks (`asSpoken`), and puts every place back where it
  is on the page. "the ring" in any case is the character Ring (`nameGroups`, `cast.ts`).
- **Nobody who isn't there** (Adam, 2026-10-04: Laura given a line in a scene with only Jane). A paragraph's
  narration gives an untagged line to a character only when a sentence opens with their name ("Jane set the cup
  down."), not when it only mentions them; with one character on the card, an untagged line is theirs; a turn goes
  back only to someone in the scene. The AI is told who is on the card (`[in this scene]`, `hereNote`). The writer's
  tags go only to the paragraphs its draft added, and those it said of lines that never reached the page are dropped.
- **Recall across scenes** (Adam, 2026-10-04: inconsistencies between scenes). Entries named in the card's goal,
  conflict, outcome or mood, or at the end of the previous scene (the part block 3 sends), are selected too
  (`WHY.cardWords`, `WHY.previous`). Block 8 was then every earlier scene of this story by its own summary; since
  2026-10-08 it is the canon timeline (below, "The AI writer makes full use of the story memory"), and since 2026-10-15
  it grows with the writer model's reading limit ("Long story memory: the quick wins"). The fitting still shortens it
  two levels (`shortTo`) before shortening anything above it.
- **A scene's summary follows its facts.** When a read finds the words a fact came from edited or deleted, the
  scene's summary is marked stale (`applyRead`) and written again after the run, however small the edit; otherwise
  it waits for Mark done or a large change, as before. Chapter and story roll-ups follow it. Since long story memory
  fix 15 it is always written again from the scene's words, never patched, and the roll-ups are made from the level
  below and the story record ("Long story memory: summaries rebuilt from the record", below).
- **Where things stand** (`continuity/tracker.ts`, `@shared/continuity`): each character's where, wearing, position,
  holding, condition, mood and last action as a scene ends, and its time, weather and light; only the latest of each
  is kept. Worked out by the memory model before a draft (the last few scenes, oldest first) and kept in `meta`
  'continuity' with the hashes of the words and of the state it built on; a state stands only while both (all the way
  back) are unchanged, so nothing outlives its words. Sent to the writer as block 3b and to the continuity check.
  Recall in the Cast tab (`features/cast/RecallSection.tsx`, contracts/recall.ts) browses it; Adam's changes stay
  until that scene's words change.
- **Carrying on from the scene so far** (Adam, 2026-10-07: positions, poses and clothing forgotten within a scene).
  Add below (`DraftOptions.addBelow`), a later beat and Continue are told where things stand at the end of the words
  already in the scene, not as the previous scene ended: `stateAtText` (continuity/tracker.ts, through the keeper's
  `continuityAt` and `standAtText` in ai/gather.ts, waiting at most `STAND_LIMIT_MS`, Continue `CONTINUE_STAND_MS`).
  For the scene's saved words it is the scene's own state (kept, shown in Recall); for other words it is kept as a
  checkpoint (below); when the model can't say, nothing is told rather than the previous scene's state under the
  wrong title. Add below also gets the scene so far as a block (`soFarBlock`, as Beat by beat) and a closing
  instruction to carry it on rather than start the scene (`finalInstruction` with `addBelow`). Block 3b is sent last
  but for what must stay true (below), right above the closing instruction, after the scene so far. The tracker asks
  for every piece of clothing and how it
  sits, the whole pose, and nothing guessed; a value may be up to `LONGEST_VALUE` (400) characters.
- **The live stage** (Adam, 2026-10-07: "a comprehensive framework that ensures consistency instead of the model
  guessing"; step 2 of the consistency plan). Changes, not guesses: the memory model gives each value as
  `{value, quote}`, and `readChanges` (shared/continuity.ts) keeps a value only when `quoteFound` finds its words in
  what the model was given to read (two words or more in each place it quotes; never the lead-in before a
  checkpoint, which is already counted); the rest carries on from before. The words go with the value (`SceneState.said`, by
  `sourceKey`), carried on until a new value replaces it or Adam sets his own. Checkpoints inside scenes (`meta`
  'continuity-points', by scene, with the hash of the words up to each and of the state the scene starts from; at most
  `MOST_POINTS` per scene and `MOST_SCENES` scenes): every reading partway through or at the end of a scene is kept,
  and the next starts from the latest that still matches the words (`readUpTo`), reading only what follows with a
  short lead-in. Every reading of a scene builds on the same start (`startOf`, the scene before's kept end), so the
  scene so far, the scene's end and Recall at the cursor share checkpoints; the scene so far and Recall need only the
  last few scenes before to be fresh (`startsFresh`), not the whole line, so a scene far back waiting to be read again
  doesn't leave them with nothing. Adam's Recall edits are laid over the scene-end checkpoint, so they carry into
  words added after.
  After each memory read (`KeeperDeps.onSceneRead`, `standLater` in keeper/index.ts), the scene-end state is brought
  up to date on its own and Recall reloads (`recall:changed`). Recall has Scene end and At the cursor: the latter
  follows the cursor (`wordsToCursor`, edits/session.ts) and shows the checkpoint at or before it
  (`storedStateAt`), worked out exactly there on request (`refreshRecallAt`); it is for reading, not changing.
- **What must stay true** (Adam, 2026-10-07: step 4 of the consistency plan; `ai/mustStay.ts`). The app, not the
  model, writes a short list of the facts that matter right now, sent right above the closing instruction with the
  full briefing above it (block `must-stay-true`, "Must stay true"). Only current values, each with where it became
  true ("Mara: left arm in a sling (since Ch 3, Sc 2)"; "earlier in this scene"; another story's place keeps its
  title): from the stage at the point of writing (each value's words, `said`, name the scene: `stageWhere` in
  ai/gather.ts), and from the codex entries of the people in the scene: their distinguishing marks, a Basics or Looks
  field a change set during the story (`EntryState.changedWhere`, memory/state.ts; when a side story added whole
  loses a clash, the host's place goes back with the host's value), anyone in the briefing who is dead, and up to
  three things kept from someone in the scene, the most lately learned first (`FactState.at`): "Kept from Tobin: …
  (Mara knows it). Tobin must not learn, guess or think it here unless the scene card says so" (`secretsAmong`; since
  long story memory fix 9, among everyone in the scene, and what someone here believes wrongly after them). How
  much of the stage (`stageReach`): all of it carrying on inside a scene (Add below, a later beat, Continue); at a
  new scene's start on the same day ("Day 3"; since fix 11 read on the story calendar, so "That night" after "Day 3,
  dusk" is the same day, else both cards' "Day N"), injuries and what people wear and hold (the card sets where and
  when); on a later day, or when how long has passed isn't known (no When), only injuries; nothing from another story. Mood and the last thing done are not facts to keep to. At most 12 lines, a
  long value cut short before its "(since …)"; the short form has 6, without who knows what, changed looks or the
  lead. Since 2026-10-15 it opens with what the scene is most likely to break and is never left out ("Long story
  memory: the quick wins"); before, it sat with block 11 and went out first when room was short. AI edits and Continue get it too, right before the
  closing ask (`edits/briefing.ts`; short when the people are left out to fit, and out on the last try): Continue
  with where things stand at the cursor; the other tools don't wait for the memory model, so only a checkpoint kept at
  exactly that point (`standKept`), else the codex's facts alone. Variants get it with the rest of Generate's briefing.
  Since long story memory fix 13 it leaves out what the scene's contract, right above it, says word for word.
- **What someone gave away or lost stays known, and items are found by their main word** (Adam, 2026-10-07: in the
  trap story's real run, Wren gave her brass compass to Mother Agate in scene 7, and in scene 23 the writer had her take
  it out of her pocket. The codex had it, but only as about the nineteenth newest thing that had happened to her, and
  "the compass" never found the entry "The brass compass"). `memory/items.ts`, pure:
  - **Who has what** (`holdingsOf`): read from the codex as of the point being written, on its own line, so never from a
    later scene or another storyline: what has happened to each character ("gave her brass compass to Mother Agate"),
    to each item ("stolen by Bryn") and in each event the keeper made, and ties between a character and an item
    ("holds", "owned by", "formerly owned"). Only items that are codex entries count, so "lost her temper" or "lost her
    left hand" never does, and nothing that didn't happen ("did not give", "promised to give", "took a bearing with the
    compass"). An item has one holder at a time and the latest says who: given away and got back is had again, and
    whoever had it no longer does. Something had from the starting setup is no change; one got during the story is.
  - **In what must stay true**: for each person in the scene, at most `MUST_ITEMS` (4) lines, "Wren: no longer has the
    brass compass (gave her grandmother's brass compass to Mother Agate as a toll; since Ch 2, Sc 7)", "…has the brass
    compass again (got it back…)". Those whose item the card, beats, direction or scene so far name come first and rank
    just after injuries; the rest come after what people wear and hold. AI edits and Continue get them too.
  - **In check and repair**: a list of them with O ids (`codexLines`, the items the new words name first, at most 12),
    and the prompt says using a thing an O line says is gone is a slip. Like every slip against the memory, it is asked
    as a question, never mended. The critic's facts check gets the same list. Who knows what (K lines, at most 30; the
    critic's 40) keeps, when there are more, those that name what the words name, then those about the people there or
    known by only some of them, then the most lately learned (`factsThatMatter`), no longer simply the first ones.
  - **An item's main word** (`mainWord`, `itemHeads`): the last word of a name with other words besides it ("compass" in
    "The brass compass" and in "Wren's compass"), only when no other entry has that word in its name (a place "The
    Compass Rose" means neither is found by "compass") and it isn't a common word ("the Dragon's Eye" is never found by
    "eye"). An item is also found by its name without "the" ("brass compass"). So "the compass" on the card, in the
    beats, the direction, the end of the previous scene or the scene so far (`ContextInput.soFar`, "Named in the scene so
    far") brings the entry into block 9 within its usual priority and room, and the checks find it in the scene's words.
- **Where things stand: an empty hand clears what was held; a new time starts fresh; only people in the scene**
  (Adam, 2026-10-07, after the trap run's 12-step Add below/Continue chains):
  - **Something gone** (`saysGone`, `layGone` in shared/continuity.ts). Wren put the survey case on the sill and the
    memory model said she held "nothing" with no words, so it was left out and "holding: the survey case" carried on
    into the writer's must-stay list and repair. Now a holding or wearing value that only says something is gone
    ("nothing", "empty-handed", a thing set down, hung up or given away; a coat or boots off, barefoot) is kept even
    without words (`readChanges` lists it in `gone`) and laid over the old value piece by piece (`mergeState`): what was
    put down goes ("nothing" when the hand is empty), what came off replaces how it was worn, the rest of the outfit
    stays, and the old value's words go with it. "Not put down" never counts. The tracker's prompt asks for "nothing"
    and the words where it was put down or taken off.
  - **A new time starts fresh** (`sameWhen`, `withoutSceneTime`; tracker `startFrom`; `timeCarries` in ai/context.ts).
    "Morning, the sun has come up" from a "Day 23" scene was carried through "Day 23, night, rain" and the writer had
    a man say "Morning". The time of day, light and weather carry into the next scene only at the same moment in the
    same story (stricter than `stageReach`'s same day): since fix 11 the same day and time of day on the story calendar
    (`sameMoment`, tracker `sameTime`), else, where it can't tell, both cards giving the same When; otherwise the scene starts without them, before its
    first checkpoint, and that start is part of the state's hash (a When changed on a card means a fresh read). What is
    told also leaves out a time, light or weather whose words come from another scene unless it carries over, so a
    reading kept from before this fix is never told either.
  - **Only the people in the scene** (`stageInScene`, ai/mustStay.ts; `stageScope`, `toldStage` in ai/context.ts).
    Bryn, Gale, Oskar and "the boy" from earlier scenes sat in an inn scene's stage, and a stale line about the boy
    raised a wrong question. The stage block, what must stay true, the plan and repair's W lines (`stageTold`) hold
    only those on the scene card, or named (by name, alias, or a first name no one else here shares) in its card's
    words, Adam's direction or the scene so far; Continue and AI edits the same, from the words around them
    (edits/index.ts). The stage as kept, and Recall, stay whole.
  - **No aims already on the page.** Carrying on (Add below, a later beat), the memory's notes on this scene ("Ash:
    went out to see to the horses") are already in the scene so far, so they are no longer listed as what the scene
    should bring about (Ash went out twice). Adam's own notes stay, "only what the scene so far hasn't already"; the
    card's goal, outcome and beats stay as they are.
- **The stage piece by piece: every piece of clothing, the things in the place, who touches or sees whom** (Adam,
  2026-10-07: step 2b of the consistency plan, after checking the plan's "The stage" against what was built. What
  someone wore was one line with one quote, and the scene had only its time, weather and light; a real-model test had a
  door barred and then opened from outside with nothing keeping track of it, and a case put on a windowsill back in
  someone's hand). `shared/stageItems.ts` (pure), `shared/continuity.ts`, `continuity/tracker.ts`:
  - **Each piece of clothing is its own entry** (`CharacterState.clothes`: a name and how it is now, "on" or "off" first,
    where it is when off, then how it sits: "boots off, by the hearth", "grey coat on, buttoned to the throat"), each
    with its own words (`pieceKey`). The memory model is asked only for the pieces the words show or change (marker
    `[AIWRITE-CONTINUITY v3]`), and a change finds the piece it is about (`matching`: the same name, or one with its last
    word that says no more or less, so "cloak" is the "grey cloak" but a "blue dress" is another dress; never left for
    right) and touches only that one: boots off never touches the coat. "Gone" takes a piece off the list (given away,
    burnt). A piece that only says it came off is kept even without words, as an empty hand is.
  - **The things in the place** (`SceneState.things`: "the door: shut and barred from inside", "the survey case: on the
    windowsill", "the lamp: lit"), only what the words put there or change, each with its words; picked up or carried
    off is "gone" (it is then what someone holds). They carry on through the scene, and into the next scene only when
    both scene cards name the same place in the same story (`samePlace`, tracker `startFrom`), so a door barred at the
    inn is never told to a scene in the yard. A place changed on a card means the scene is read again.
  - **Who touches whom, and who can see or hear whom** (`touching`, `sees`): only when the words say so, never worked
    out from where people are; they belong to the moment, so a new scene never starts with them (`newSceneStage`).
  - **At most** 12 pieces a person and 12 things (`MOST_CLOTHES`, `MOST_THINGS`; those changed longest ago go first).
  - **States kept before this read as pieces, with nothing lost** (`clothesOf`, `itemsFromText`): the one line is split
    where a comma or semicolon starts another piece, words that only say how or where the piece before is ("unbuttoned
    to the waist", "over the chair") staying with it, and each piece reads exactly as the line did ("boots off (by the
    door)"); the line's words go with each piece. world.db is unchanged (the stage stays in `meta`). An old state, and
    Adam's old edits, are laid over exactly as before, so their hashes match and nothing is read again on their account.
    A model that answers the old way (one "wearing" line) is still read, as the whole outfit.
  - **How it is told.** The stage block (and the tracker's own "before") gives each piece a line of its own under its
    person ("  - wearing: boots off, by the hearth") and the things under "Things here:". What must stay true holds at most
    `MUST_CLOTHES` (3) pieces a person (those the card, beats, direction or scene so far name first, then what is off,
    then what is on in some way: "Wren: boots off, by the hearth", "Wren is wearing: grey coat on, buttoned") and
    `MUST_THINGS` (3) things (named first, then those changed most lately), within the list's 12; who touches and sees
    whom only carrying on inside a scene; things at a new scene's start only when they carried (the same place). The
    plan's check (`checkPlan`) puts a piece or a thing it relies on in the stage's own words, leaves out putting on a
    piece already on and a change that starts wrong ("the door: open" when it is barred), and lets dressing, touching
    and picking things up or opening a door through without asking (seeing someone can be what happens, so it isn't).
    Check and repair has a W line for each piece and each thing; a thing is mended in place only under the same cautious
    rules as clothes (plainly impossible at that same moment, with its words just before), and a door opened when
    someone could have unbarred it off the page is a question. Who touches or sees whom is never mended.
  - **Recall** shows each piece ("Wearing: boots off, by the hearth") and each thing ("the door: barred") on its own line,
    with its words when the pointer rests on it; Adam can change one, take it out (leave it empty) or add one ("Add a
    piece of clothing", "Add a thing"), kept until the scene's words change like any other value (`StateEdits.clothes`,
    `StateEdits.things`, by the piece's or thing's name).
  - **After review** (2026-10-07): a piece that is off, or that the scene names, ranks above what people hold, but a
    piece simply on ("shirt on") ranks below the things in the place, and the short list has at most one piece a
    person, so plain clothes never crowd out a held case or a barred door. A piece "removed" or "no longer worn" is off
    and stays listed; only "gone" or "no longer theirs" takes it off. "Boot" is never both boots (only a bare plural is
    about every piece with the word). Adam's piece edits find their piece again when it is read under another name
    ("boots" and "riding boots", an old long name), so a piece he took out stays out. An old edit for someone missing
    from a state kept before step 2b builds them the old way, so the hash holds. Words shared by an old one-line outfit
    (`StateSource.line`) never let repair mend a piece without asking. The stage block tells at most about 400
    characters of what each person wears and 600 of the things, the most lately changed first, each line 160 at most.
  - **Cost.** The stand call's instructions are about 300 tokens longer, its reply a little longer (a line for each
    piece or thing that changes, each with its words), and the writer's briefing a few dozen to about 150 tokens longer
    (the pieces and things lines). No new call.
  - **One place for each thing** (Adam, 2026-10-07, "fix the case slip first"). In a trap run Wren set the survey case
    down flat on the sill; the stand call put the case there and emptied her hand, but its list of what she wore left out
    the case strap, so "case strap on, case on her back" carried on beside it, the writer was told both, and had her sit
    up "with the case against her hip". Now: when a thing is put somewhere (its state says where: "on the windowsill",
    "hung on the peg"; not "barred" or "lit"), a piece someone has on or anything they hold that names it goes (put down
    means not worn or held; `onePlace` in `mergeState`); when someone takes it up, with words that show it (that name it,
    or say it was picked up or slung on), and it wasn't put down in the same change with words that show that, it is no
    longer where it was. "Ash's coat" only touches Ash; "the mugs" is never "a mug"; a piece already off stays. A piece
    the stand call simply leaves out keeps its value (leaving out isn't taking off). What must stay true never tells a
    piece worn or a thing held beside a thing line that puts it elsewhere (`pieceClashes`, `heldNotPlaced`), ranks what
    is held and the things in the place above "no longer has" (the case had been crowded out by twelve lines of injuries
    and lost things), and says nothing of the marks or lost things of the dead, or (Continue and the other edit tools) of
    anyone only named near the words: the list's people were everyone in the briefing, not just those in the scene, so
    the items lines (#64) passed by #65's people-in-the-scene rule; now only those on the card, speaking, or on the stage
    as told. "A grey gelding lent by Ash", in Wren's own note, is now hers (it was read as her no longer having Cinder).
    Check and repair: a claim that has a thing put somewhere in this scene (or an empty hand, with its words in this
    scene) moved off the page ("between": action) is always a question, whatever the model's verdict, unless the words
    since show it picked up or moved; never mended without asking. The repair prompt says so too.
- **Facts to keep to and details to show.** In the writer's briefing (not Ask the world or the checks), a character's
  Basics and distinguishing marks are "Facts to keep to" and the rest of Looks "Details to show now and then, not all
  at once" (`fieldSections` with `split`), so a cheap model stops describing eye colour in every scene.
- **Plan before writing** (Adam, 2026-10-07: step 4; `src/main/plan/`). Before Generate, Add below and each beat, one
  short call to the memory model (its own Thinking, Off by default; job 'memory', marker `[AIWRITE-PLAN v1]`; only a
  scene's newest 10 keep their whole prompt, `forgetOldPrompts`) plans the scene from the scene card, what must stay
  true, where things stand (under its own title, with what of it may have changed since the scene before: the same
  `stageReach` as the list, and none of it from another story), the end of the scene so far or of the previous scene,
  the closing instruction the writer will get, and the entries in the briefing and the names of those that aren't.
  Beat by beat plans only the beat (`withPlan` with `focus`, once the beats are settled, so never twice). It says what
  the scene relies on, what will change on the page (from, to and how) and up to four entries it needs. The app checks
  it (`checkPlan`, pure). A position it relies on is told in the stage's own words where the stage holds here; one the
  stage doesn't vouch for here only when the scene card says it (never where people were in the scene before). A fact
  only when its words are in what the planner was given, and never one kept from someone in the scene. A change is left
  out when it is already so, starts from something the stage says isn't so (`contradicts`: the word nearest a thing
  that says how it is, in pairs such as on/off, open/shut, sitting/standing), is made by someone dead, says something
  kept from someone in the scene that the card doesn't bring up, or is an event (an injury, someone not on the card
  turning up) the scene card, the beat or the author's direction doesn't call for (`calledFor`: a third of its words
  there); moving, dressing and picking things up need no asking. The entries it asks for, by name or other name exactly,
  come into block 9 ("Asked for by the plan"; only what exists here and Adam didn't keep out). What is left goes in
  after the closing instruction as the opening of the writer's own notes ("My notes before I write…", ending "Now the
  prose itself:"), so the prose carries on from it rather than from a distant rule (cheap models ignored required
  events given as a rule 9 times in 9, and followed them 3 times in 3 as text they carried on from). It is block `plan`
  of the record, so What the AI saw shows it; the planner's own call is a memory record. Notes the writer says again
  before its prose are taken off the start of the draft as it streams (`plan/echo.ts`, in drafts.ts), so they never
  reach the page. Not a prefilled reply: DeepSeek's API takes one only at its beta address with `prefix: true`,
  OpenRouter's support depends on the model and its provider, models that think may ignore it, and a model carrying
  on from notes in its own reply could put more notes on the page; the end of the user's turn works the same with
  every provider. It never holds a draft up: a plan that fails, is stopped (Stop while the draft gets ready), says
  nothing usable or takes over 30 s (`PLAN_LIMIT_MS`; the call is stopped) is no plan. It goes in only where there is
  room (`keepsRoom`): with the entries it asked for, else without them, else not at all, never at the cost of a part
  the briefing had room for without it, the reply's room or the budget. Not for Variants (one plan for the set would
  make its drafts alike), Continue (a paragraph or two, and meant to be quick) or the AI edits (they keep what
  happens). With a scene contract (long story memory fix 13) it also says what must change, for the contract's list;
  with a continuity brief (fix 14) it also reads the whole story record (and the book so far when it can) and writes a
  short brief for the writer, with longer to do it (90 s, or 120 s with the book: `BRIEF_LIMIT_MS`).
  Settings › Models, "Plan before writing" (`settings.planFirst`, on by default; beside "Check new words
  straight away"; `features/plan/PlanSettings.tsx`): off, no call, and the list still goes in. `AIWRITE_PLAN=off`
  always turns it off: app tests set it (tests/e2e/helpers.ts) and ask for planning with `AIWRITE_PLAN=on`; the fake
  provider answers in `tests/fake-provider/plan.mjs`.
- **The critic.** Every draft (not a variant) is checked in the background 15 seconds after it lands
  (`checkAfterDraft`, `ipc/checksIssues.ts`) with every check, `continuity` included; checks get the story so far
  and where things stood. Each reply says what each check looked at (`checked`), kept as the scene's latest report
  (`checks/report.ts`, `meta` 'check_reports') and shown collapsed at the top of the Issues tab (`CheckReportCard`).
  When check and repair (below) checked the drafts' words as they landed, the critic leaves out only what those checks
  covered and finished (`criticChecks`, by the drafts' records: `DraftActivity.generationId`): continuity when there
  was a stage to compare with, who knows what when the memory listed any, the timeline when there were scenes before
  (`coveredBy`). It waits for a check still running (`CRITIC_WAIT_MS`, a minute at most); drafts that land in a row
  before it runs are checked together, and it leaves out only what every one of their checks covered. A check that
  didn't run (switched off, no memory model, the draft finished in another scene), failed or ran out of time covers
  nothing, so the critic checks it all.
- **Check and repair** (Adam, 2026-10-07: step 3 of the consistency plan, "check and repair, straight away";
  `src/main/repair/`, `contracts/repair.ts`, `features/repair/`). As soon as a draft, Add below, a beat or Continue
  lands (Continue once accepted; a polished draft once Adam accepts the polished version), the page sends the new
  words (each paragraph, with which part of it the AI wrote) to `checkNewWords`. One call on the memory model (its own
  Thinking, Off by default), marker `[AIWRITE-REPAIR v1]`, job 'memory'. It is told where things stood just before the
  new words, exactly as the writer was told it (`noteStage`, kept by record as each draft, beat or Continue starts:
  the live stage's checkpoint, so no extra call), each value with an id (W1...) and the story's words for it; the
  memory's facts as of the scene's start (E entries named in the new words or on the card, K who knows what, D who is
  dead, S the scenes just before, from `checks/context.ts`); a lead-in; and the new words. The model lists the claims
  the new words make (where, position, each item worn, what is held, injuries, who knows what, what is owned, time),
  each with its exact quote, the line it touches and a verdict: fits, shown (the words show the change) or slip. The
  app then judges them one at a time (`judgeClaims`, pure): a claim whose quote isn't in the new words, or whose line
  doesn't exist, is dropped, and so is one the model says could be true together with the line (`bothTrue` yes). A slip
  is **mended in place** only when it plainly can't be true at that same moment (Adam, 2026-10-07, after the trap
  story's real runs showed the repair too eager: a sleeping man's hand on the floor, a man who went home later by his
  own fire, someone gone for the night seen in the yard, hats put on hours before and held later, all "fixed"):
  - the model says the two can't both be true (`bothTrue` no) with nothing that could have happened between
    (`between` nothing: no time passing, no one moving, no action off the page), and the prompt says what is not a
    slip, with those examples;
  - the line is what someone wears or holds, or an injury (`MENDABLE`), never where someone is, how they are placed,
    what they did, the time or the mood;
  - it is the same moment (`sameMoment`): the line's own words are just before the claim, within `SAME_MOMENT_CHARS`
    (600, about a hundred words), with no scene break between (Add below's draft goes below one, so its slips are
    asked);
  - the fix is about the thing the line names (`sameThing`: a word such as "pipe" or "hat" in both, names aside),
    changes at most `FIX_MOST_WORDS` (6) whole words (never "up" inside "cup") overlapping the quote, adds at most
    `FIX_MORE_WORDS` (2), brings in no new name, sits in a paragraph that is all the AI's own (`allTheAis`: Adam didn't
    type in it while it streamed in, and all of its AI part is in the record of what the AI wrote, in order), and no
    other fix is there.

  Anything else becomes **one question** (an open issue whose message is the question, with
  the model's rewrite as "Review the fix" when it has one; it points at the new words, never the same words earlier in
  the scene: `placeInScene` from `beforeChars`). A slip Adam ignored is neither mended nor asked again.
  In the page (`features/repair/apply.ts`, pure), the fixes go in as one undo step (`WORDS_META` 'ai-net'), only in
  paragraphs exactly as they landed (found by paragraph id), never where Adam's cursor or selection is, nor in a
  draft being written or under a waiting AI change; his cursor maps with his words. Each fix shows in amber
  (`features/repair/marks.ts`, a decoration, never in the document; hovering says what the AI had written and why)
  until its words are edited or another scene opens. A message says what was mended, with Undo (the AI's words back,
  and the fixed issue becomes ignored) and, when there are questions, Show (the Issues tab). Fixes the page couldn't
  make (Adam was in those words) become questions (`repairsApplied`); made ones are kept as fixed issues. Ctrl+Z on a
  fix does what Undo does (decided in review, 2026-10-07: taking the change back says he didn't want it, so it is ignored
  rather than asked again), and Ctrl+Y, or Ctrl+Z after Undo, brings it back in amber and fixed (`onRepairHistory`).
  The plugin also notes the paragraphs Adam types in while a draft or beat streams in (`typedWhileStreaming`, by
  paragraph id): they are sent `edited`, and nothing in them is mended. A beat's fixes are undo steps on top of it, so
  Write it again takes them out with the beat (`PageMark.steps`, quietly: `quietRepairs`). The page saves first, so a
  question's words are in the saved scene. Closing the world stops a check under way. Only a scene's newest
  `KEEP_PROMPTS` (10) checks keep their whole prompt for What the AI saw (`forgetOldPrompts`); older ones keep their
  cost, tokens and reply. Not checked: a draft that finished while Adam was in
  another scene, a picked variant (Adam read and chose those words), and Polish after drafting's draft before it is
  accepted. **The off switch** (Adam, 2026-10-07): Settings › Models, "Check new words straight away"
  (`settings.checkNewWords`, on by default; `features/repair/RepairSettings.tsx`). Off, the page sends nothing, no call
  is made, and the critic after a draft checks all six as before (`criticChecks`). One rule (`repairWanted`):
  `AIWRITE_REPAIR=off` always turns it off, whatever the switch says; otherwise the switch decides. App tests set it off
  (tests/e2e/helpers.ts), since it is one more call after every draft, and ask for it with `AIWRITE_REPAIR=on`; the
  fake provider answers it in `tests/fake-provider/repair.mjs`. Since long story memory fix 13 the same call also goes
  through the scene's contract the words were written to, item by item (see that section).
- **Recall by meaning, sticky entries, and what was said** (Adam, 2026-10-07: step 5 of the consistency plan;
  `src/main/retrieval/`, `contracts/searchModel.ts`, `features/retrieval/`). Before, an entry reached the writer only
  when its name or alias was on the card, in the beats or direction, or at the end of the previous scene; "her
  brother", a carried item or a promise ten chapters back were missed, and earlier events came only as summaries.
  Step 5 adds three things to each briefing (`ContextInput.recall`, gathered in `ai/draftFlow.ts` `assemble`, so the
  Context tab, Generate, Variants and Beat by beat all get it; it stops with the draft's Stop). They are candidates:
  `finishContext` fits the briefing without them (Auto's length included), then puts each in, in the longest form that
  fits in the room left (step 7: the entries, then what was said, then the passages). Since 2026-10-15 a share of the
  room is held for them while the rest is fitted (`RECALL_SHARE`, see "Long story memory: the quick wins"), and what
  they don't use goes back. Adam can still set a block to Full in the Context tab.
  - **Sticky entries** (`sticky.ts`): whoever and whatever was on the cards of the last two scenes before this one on
    its story's line, or named in their words, stays in the briefing: block "Also in mind" (`recall-entries`, priority
    9), with entries found by searching; the Context tab says "In one of the last two scenes".
  - **What was said** (`said.ts`; the keeper's "said" items in `keeper/prompts.ts` and `apply.ts`): promises, threats
    and secrets told are kept as one knowledge fact on the speaker and on each character who heard it, with the line
    itself and who heard it there (`KnowledgePayload.said`: kind, by, words, heard; JSON in `changes.payload_json`, so
    no migration). The usual rules hold: they count from the scene they were said in, on that story's line; Adam's
    facts are never changed (an edit on the entry page keeps the line); the line's source link follows edits to it
    (`db/retrieval.ts` `saidChanges` sends the words as the scene now has them, and leaves a line out once its words are
    gone). The same line by the same speaker read again is the fact already kept, however the model words it
    (`changeContent`, and the fact id reused). An entry page shows the line under the fact. The briefing's block "What
    was said, word for word" (priority 9) has one line for each time something was said (`recall.ts` `saidTimes`):
    those said or heard there by someone in the scene, newest first, then those a search found; at most 8 lines, 60
    words a line and about 300 words in all.
  - **Searching the story so far** (`recall.ts`): the scene card's parts, each beat, Adam's direction and the end of
    the scene so far (or of the scene before) are each searched for, over the passages of earlier scenes (a few
    paragraphs each, `text.ts` `scenePassages`), the codex facts as of this scene (profiles, what happened, ties,
    things said; names of those on the card are left out of this search) and the scene and chapter summaries of the
    other stories on the line. Only what comes before the scene on its story's line is searched (`buildLine`, as the
    memory does), so later scenes, what-ifs and prequels never leak in; the end of the previous scene already sent in
    block 3 isn't offered again. Keyword search uses SQLite's full-text search (FTS5, already in better-sqlite3) for
    passages and BM25 in memory for the rest; meaning search compares the search model's vectors; every list is joined
    by reciprocal rank fusion (`rank.ts`). Entries found join "Also in mind" ("Found by searching for what the scene
    is about"); the best passages and summaries are the block "Earlier passages that may matter" (priority 9, word for
    word, oldest first; short: the best two, then one). No re-ranking model and no AI call: a draft costs nothing more
    than the extra words in its briefing.
  - **The search's own words and the model's queue** (`vectors.ts`): a search's own words are read at the front of the
    model's queue and stopped with the search: after `MEANING_WAIT_MS` (6 seconds) it goes ahead by keyword alone and
    its words are taken out of the queue (`withLimit`, `pool.ts`). Facts' and summaries' vectors are read in the
    background, behind any search's words, waited for while there is time and kept (memory and the index) for the next
    search; passages' vectors come only from the background indexing. A text being read is never read twice, however
    many searches (the Context tab, a draft, the cost estimate) ask for it at once.
  - **The search index** (`store.ts`; Adam's go, 2026-10-07): one file in each world folder, `search-index.db`,
    beside world.db and history.db. It holds the passages with a full-text index, and the search model's vectors by
    the hash of their words. Everything in it can be made again from the world, so it never stops a world opening: a
    missing file is made; a damaged one is moved aside as `search-index.db.damaged-<time>` (never deleted, as
    history.db's) and started afresh; one locked by another program or from a newer AI Write is left as it is, and an
    index in memory stands in for that session. It is brought up to date by the hash of each scene's words
    (`indexing.ts`), so a backup brought back or a copied world is caught: in the background 4 seconds after a world
    opens (a few scenes at a time, each batch's words read again just before they go in, stopped when the world closes:
    `world.ts`), and for the scenes changed since, just before each search; when that catch-up fails, the search goes
    without earlier passages rather than send words that may be gone. Exports, world copies and backups leave it out
    (it is made again where the world lands); deleting a world moves it with the folder.
  - **The search model** (`model/`): bge-small-en-v1.5 (BAAI, MIT licence), downloaded once, like the speech models,
    into the app's data folder (`search-model/`, never the app, git, a world or a backup) from Hugging Face at a fixed
    revision, each file checked by size and hash, with installed.json last (`files.ts`, `download.ts`). Two engines
    (Adam, 2026-10-07: "add onnxruntime-node"): **onnxruntime-node** 1.30.0 (MIT), the fast one, on one worker thread
    with a quarter of the processor's threads (1 to 4) of its own, reading `onnx/model.onnx`, on the CPU only; and the
    **TypeScript reader** (`wordpiece.ts`, `bert.ts`), on 1 to 4 worker threads sharing one copy of `model.safetensors`,
    used where the fast engine can't start (noted in installed.json as `onnxFailed`; the other form, also 133 MB, is
    then downloaded instead). Only one form is downloaded (133 MB). Both give the same vectors (cosine 1.0000 on 20
    made-up sentences with the real model, 2026-10-07; `model/real.test.ts` and `fixtures/bge-reference.json` check
    them when `AIWRITE_TEST_SEARCH_MODEL` points at the files). Speed on Adam's PC (16 threads), a 150-word passage:
    the fast engine 26 ms (4 threads; a 100,000-word book in about 20 seconds), the TypeScript reader 1.6 s on one
    thread (about 4 to 5 minutes for the book on 4). Before first use with each engine it must tell related sentences
    from unrelated ones (`checkModel`), or it is not used and Settings says so; threads that stop are started again
    once, then Settings says it isn't working (`manager.ts`). Download, Stop, Remove and the switch can come in any
    order: only the newest of each counts. RAM: the model once (about 130 MB) and the open world's vectors (about 1.5
    KB a passage).
  - **Packaging**: `onnxruntime-node/bin/**` is unpacked from the asar (its binding loads onnxruntime.dll beside it), and
    each installer keeps only its own platform's engine, without DirectML's GPU files (they load only when asked for)
    or the install scripts (electron-builder.yml; `build/check-package.mjs` checks it). The Windows installer grows by
    about 7 MB (113.9 to 120.7 MB). Its install script fetches nothing on Windows (only Linux would fetch CUDA files),
    so CI needs no setting for it.
  - **Settings** (Settings › Models, "Finding earlier passages", `features/retrieval/FindByMeaningSettings.tsx`): "Find
    by meaning" (`settings.findByMeaning`, on by default) with the download (133 MB, progress and Stop), Remove, and how
    far the open world's passages have been read. Off, or until it is downloaded, keyword search, sticky entries and
    what was said go on. `AIWRITE_RECALL=off` turns all of step 5 off; app tests set it (tests/e2e/helpers.ts) and ask
    for it with `AIWRITE_RECALL=on`; `AIWRITE_SEARCH_MODEL=stub` uses a stand-in model (`stub.ts`) that knows a few
    words of like meaning, for tests only.
  - **The download by itself** (Adam, 2026-10-08: "download the search model automatically"; `model/auto.ts`): while
    "Find by meaning" is on and the model isn't here, it downloads quietly in the background 45 seconds after start-up
    (so opening isn't slowed) or 5 seconds after the switch is turned on. Stop or Remove sets `settings.searchModelAuto`
    false, and it never starts by itself again until Adam presses Download (which sets it true); the switch off stops
    nothing under way but never starts it. A failed download (offline, a damaged file) is tried again an hour later,
    then two, four, up to a day apart, and at the next start; Settings shows the problem as before, with no pop-ups.
    `AIWRITE_SEARCH_MODEL_AUTO=off` keeps it out of app tests (tests/e2e/helpers.ts), unit tests (vitest.config.ts)
    and trap runs; `AIWRITE_SEARCH_MODEL_AUTO_MS` shortens the wait for the one app test about it, which uses a local
    server, never Hugging Face.
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
  them), hard rules, who knows what (since long story memory fix 9 with since when and how each knows it, and what
  anyone there believes wrongly), the three scenes before (When, where, who), the end of the scene before,
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
  rewrite to the keeper's issue. Open issues whose words have left the scene become `gone` when the scene is saved,
  listed or counted (see "Findings that stay current"). Every change emits `issues:changed` (`onIssuesTouched`, batched
  after the transaction).
- **Runs** (`checks/runs.ts`): one at a time; Adam may have one of his own going or waiting. Before each
  scene the memory catches up (`catchUpBeforeDraft`, then the keeper's `whenRead` for the scene itself, read
  now if it is still waiting out its quiet time, so its clash isn't raised twice); each run's AbortController
  ends that wait at once on Stop or when the world closes. A check Adam asks for drops a waiting mark-done check
  of a scene it covers. Progress names scenes "Ch 3, Sc 2: The ferry". Marking a scene done queues `DONE_CHECKS` quietly (`runId` `done:<scene>:…`,
  `CheckDone.background`); its `found` counts everything raised since, so the window can say "Found 2 things
  to look at in this scene." Checking a story ends with `checks/stories.ts`: a side story against its host over
  `hostSpans`, a prequel's ending against the opening of `leadsIntoBook`, leaving out what "Which happened
  last?" already asks (`sideClashes`). Closing the world stops runs (`closeRunsFor`).
- **Rule checks** (long story memory fix 8, below): free rules over the memory, the stage and the calendar (the dead
  speaking, one thing in two hands, time running backwards…) run with no AI call after each read of a scene and in every
  check; their rows (`by: 'rule'`) are issues like these, marked "Found by a rule, not the AI".
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
  is left out (the toast says so); the export still succeeds. The search index (`search-index.db`, story memory
  step 5) is never in it: it is made again from the world wherever it is opened.
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
  (`reducedMotion()`, `scrollBehavior()`). The speeds are in Rules, Motion.
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
  set; the content limits still win), "Sex scenes" when romance is Explicit and the job writes prose (`sexSceneText`: stage each act, blunt words, direct talk; Ask the world leaves it out), and "Write like a person, not like an AI" (`aiPhrasesText`: `SLOP_RULES` and the
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
  (`--dur-press`, `--dur-quick`, `--dur-base`, `--dur-view`, `--dur-exit`; `ease-glide`, `ease-spring`,
  `ease-drawer`). The New look sets its own per theme under `[data-look='new']`. Where a shape differs, a class says so
  with the `look-new:` variant (or `look-classic:`). Less motion sets every duration to 0.
- **Motion in the New look** (the speeds are in Rules, Motion; Classic keeps the motion it had, with no exits, but its
  presses are the New look's, below).
  `features/look/motion.ts` keeps track of whether Adam is on the keyboard or the pointer (`keyboardDriven()`): what
  he does from the keyboard happens at once. The generic enters (`animate-fade-in`,
  `animate-pop-in`, `animate-slide-up`) take the look's timing from one zero-weight rule in `styles.css`.
  - *Changing page*: `navigate()` (`lib/store.ts`) runs a page change from the pointer inside a View Transition
    (`features/look/viewTransition.ts`: the DOM API with `flushSync`, not React's `<ViewTransition>`, which never runs
    for zustand state). It fades through: the old page goes in 100 ms, then the new one fades up 4 px (280 ms in
    all), so the two pages' words never overlap. Only `<main data-page>` (and the side list, `[data-area-list]`, when the rail's area changes)
    takes part, named only while `<html data-vt>` is up; the document itself is left out, so the rest of the window
    stays live, and toasts (`[data-toaster]`) stay above it. The change itself lands on the next frame (the old page is
    pictured first): a later change of page or scene in between wins. Never for `write`, the same page (`pageKey`),
    the start screen, the keyboard, less motion or Classic.
  - *Keyboard surfaces* (the palette, story find, the shortcuts list, the find bar) appear and go at once.
  - *Exits*: Radix still removes a closing menu, popover or dialog at once (so focus goes back, shortcuts work and
    nothing stale can be pressed, as in Classic); `features/look/exitGhosts.ts` then puts that element back, inert and
    hidden from screen readers (`[data-exit-ghost]`), for `styles.css` to play out in 140 ms (menus shrink back toward
    where they opened, dialogs and their dim fade), and removes it. Not when a key closed it, with less motion or
    during a page change. Every "is a layer open?" check uses `lib/layers.ts`, which never counts one on its way out.
  - *Panels* slide in 220 ms on the drawer curve (`ease-drawer`). Before a slide, `ResizablePane` sends
    `aiwrite:panes-move` (how much narrower or wider the page gets) and `SceneView` holds the page's column at the
    narrower of its two widths for the slide, so a long scene re-wraps once instead of on every frame (measured on an
    8,000-word scene: layout work during six slides went from about 255 ms to about 105 ms, and the layouts of 1 ms or
    more from about 115 to 15). Classic keeps its 200 ms `ease-out` and never holds the column.
  - *The selection pill* (`GlidePill`) glides its position and size together (220 ms, `ease-glide`, no overshoot),
    placed by layout offsets so a row in motion can't mislead it; it jumps when the keyboard moved the selection or
    the new row is more than 240 px away.
  - *Toasts*: one that goes stays a moment where it was, lifeless, and drops back the way it came (`toast-out`,
    140 ms); the others glide into their new places (FLIP with WAAPI, 220 ms, carrying on from where an unfinished
    glide has got to), and the stack lifts over a bar with a transform. All in `Toaster` (`components/ui/Toast.tsx`):
    the store and its queue rules are untouched. Classic and less motion: as before.
  - *Presses* go in at `--dur-press` (90 ms, `active:duration-(--dur-press)`) and come back at the element's own
    speed (150 ms; Mark done 220 ms), on `ease-glide`; buttons 0.97, icon buttons 0.95. Tailwind 4's `scale-*` and
    `translate-*` are the CSS `scale` and `translate` properties, not `transform`: a transition list must name them
    (`transition-[transform,scale]`), or the press or hover lift snaps. Classic's presses (the read-aloud Play
    button, the Style cards in Settings) do the same: in at `--dur-press` (90 ms in both looks) on `ease-press` (the
    glide curve in both looks), back at 150 ms.
  - *The lamp* (AI words arriving): a draft's new words fade in (160 ms, opacity only), its paragraphs are in a warm
    ink while it writes with a thin amber line in the margin beside the one being written, and once it ends they settle
    into the page's ink (1 s). Decorations only (`features/editor/arrival.ts`): each chunk marks just the tail that is
    new, so italics made from asterisks never fade again, and marks are dropped once played (no replays). Continue's
    words fade in too, carrying on across its widget being drawn again (`features/edits/arrivalSpans.ts`), and
    settle once accepted. The page follows the words with a time-based glide (`1 − e^(−dt/90 ms)` a frame, the
    same at 60 and 120 Hz; `features/editor/scrollGlide.ts`) for Add below and Continue alike; Adam scrolling,
    clicking or using the keys stops it. Less motion: no fade or settle, and the page keeps up in one step.
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
  new page crossfades in with a View Transition (`features/look/viewTransition.ts`; instant from the keyboard and
  when coming back to the writing page).
- **Classic can't drift**: `tests/e2e/classic.spec.ts` compares the main screens in Classic, Light and Dark, on the
  sample world, with screenshots taken before the New look began (one set per platform).
- Contrast: `tests/unit/contrast.test.ts` checks the New look's colours and kind inks in every theme and accent.
- **The New look's two layouts** (UI overhaul, phase 2; spec notes/ui-overhaul-v2/desk-build-spec.md): Settings ›
  Appearance › Layout chooses the **desk** or the **panels** (the rail and side list above), kept as `arrangement` and
  painted as `<html data-arrangement>` (`features/look/look.ts`: `useDesk()`, the `desk:` variant; Classic ignores it).
  The desk is the New look's default (`DESK_READY` true in `src/shared/defaults.ts`, step D3.7, Adam 2026-10-08): the
  Layout choice shows for everyone in the New look, and `src/main/settings.ts` moves anyone on the New look who never
  chose a layout to the desk, with a one-time note offering the panels (`features/look/LookNote.tsx`; not for a fresh
  install). App tests pick a layout with `AIWRITE_ARRANGEMENT` (helpers: the panels) and a theme with `AIWRITE_THEME`
  (helpers: Match the system, as before Dark became the default).
  The desk places other pieces around the same `<main>` and `SceneView` (App.tsx's Workspace keeps the slots in the same
  order, so switching never remounts the editor): its top bar (`layout/desk/DeskTopBar.tsx`: rooms = the areas, the
  command bar, the status island), the story's spine (`features/desk/spine/`): full by default, the real binder on the
  spine's leather beside the page with the sheet centred in the room left (windows 1280px and wider,
  `layout/desk/deskFit.ts`), or slim with its rings and their flyout holding the binder, kept as `layout.deskStory`
  ('full' | 'slim', apart from the panels' `binderOpen`); every other page in its room's frame
  (`layout/desk/RoomFrame.tsx`, links from `layout/areaLinks.ts`), the page as a sheet with today's toolbar floating at
  its foot (the AI dock replaces it in phase 3), and the scene panel as a drawer over the page's edge
  (`layout/desk/SceneDrawer.tsx`; open = `layout.inspectorOpen`): full height down the right edge, beside the page
  while spine, sheet and drawer all fit (`deskFit`: the sheet centred between them, gliding as either comes or goes,
  `useSheetGlide`), making room for it in a smaller window (see The desk); shown and hidden from the top bar's Scene details
  (`layout/desk/DrawerToggle.tsx`), also from the page head's Scene details and a palette entry per tab. Its colours and materials are `layout/desk/desk.css` (contrast-tested), its app tests
  `tests/e2e/desk.spec.ts`. How the desk's writing room works is below, in "The desk".

## The desk (UI overhaul, phases 2 and 3)

The New look's desk layout (`arrangement: 'desk'`), the New look's default since Phase 6 (`DESK_READY` true), in Dark
by default (`theme: 'dark'` for anyone who never chose a theme; a theme already chosen is kept). The panels stay a
choice in Settings › Appearance › Layout; Classic is unchanged.

- **Where things go** is one pure function, `deskFit` (`layout/desk/deskFit.ts`, unit-tested), from the window's width,
  the page's measured column (Adam's page width) and whether the spine is full and the drawer open. The sheet is
  centred in the room between the spine and the drawer. The open drawer never lies over the page's words while room
  can be made for it: first the sheet narrows (to `SHEET_MIN`, 640 px), then the full spine shows slim for now
  (`spineYields`; Adam's `layout.deskStory` is untouched and the full spine comes back when the drawer closes), and only
  in a window too small for both (about 1100 px) does the drawer lie over the page, which dims under it (Esc anywhere or
  a click on the dimmed page closes it). The sheet's sides glide as the spine or drawer changes (`useSheetGlide`; at
  once from the keyboard, while resizing, or with less motion), and a narrowed sheet takes its new width at once so
  its words re-wrap once, not on every frame. The margin column needs the sheet within `MARGIN_SHIFT` (32 px) of the
  middle; without room it folds into tabs on the sheet's edge.
- **The AI dock** (`features/desk/dock/`) at the sheet's foot: the steer box (one-shot direction), Add below
  (Generate's `'add'`), Continue (the tracked-change Continue aimed at the scene's end, `continueAtEnd`;
  Ctrl+Shift+Enter, or Enter in the steer box) and the ⋯ menu. Its face follows `activityOf` (`dock/activity.ts`):
  idle, busy (words so far, the model, Stop) or review (Accept with Tab, Reject with Esc). On the desk these are the
  only Stop, Accept and Reject: the row under an AI change (`edits/SuggestionLayer.tsx`) keeps What the AI saw and
  Other versions. The next-beat chip sits over it (`NextBeatChip`, `src/shared/beats.ts`).
- **The margin** (`features/desk/margin/`) lives inside the page's own scroll area, so its notes scroll with the words
  and nothing syncs scrolling. `pickSlips` (pure, unit-tested) decides the notes: the scene card (pinned beside the
  title); entities named in the text (`mentions.ts` finds each one's first mention per paragraph, cached per
  ProseMirror node, a moment after typing stops), scored by point of view, the card, a fact from this chapter and lore
  rules, two to a paragraph and six in all; the scene's open issues found in the text by quote and occurrence
  (Rewrite = Fix the text, Keep = ignore; live-check underlines never become notes); and one memory note for 15 s after
  the memory reads the scene (`memoryRun.ts`, on `memory:changed`). `MarginLayer` measures each note's paragraph
  (`data-pid` anchors, `anchors.ts`) only when something could have moved it (sizes, paragraphs coming and going,
  fonts, at most four times a second while a draft streams) and `layoutNotes` pushes overlapping notes down in reading
  order (220 ms glide). An entity's slip grows into its card (`EntityCard`: Open their page, Show beside the page).
  Each note's × puts it away for the session (`marginStore`). The notes step away while the drawer is docked.
- **The lamp** (streaming): new AI words fade in and a lamp line runs beside the paragraph being written
  (`features/editor/arrival.ts`, decorations only, so the document and its undo are untouched); Continue's words fade
  in its widget (`features/edits/arrivalSpans.ts`); the page follows the draft by time-based easing. Guarded by
  `tests/e2e/desk-perf.spec.ts` (a 10,000-word scene).
- **Arrival** (`layout/desk/arrival.ts`): the first time a room shows in a session its pieces arrive (sheet, spine,
  notes one after another, the dock on the spring); later visits, the keyboard and less motion show them at once.
- **The first scene's guide** is a slip at the top of the sheet on the desk (`FirstSceneGuide slip`), never over the
  words; the panels keep the bar above the page.
- **Tests**: `desk.spec.ts` (frame, spine, drawer and its make-room rules, dock, chip, margin notes),
  `desk-perf.spec.ts`, and `desk.visual.spec.ts` (screenshots of the write room, flyout and drawer per theme; baselines
  per platform, taken where they exist).

### The first run, Settings and moving work in and out (UI overhaul)

The New look draws these its own way (both layouts); Classic keeps the pages it always had (a `look === 'classic'`
branch in each, never a change to Classic's markup).
- **First run**: `features/setup/SetupDesk.tsx` (the rail of steps, the step on a sheet, the finishing moment:
  `setupStore.finishing`, 900 ms, skipped with less motion) and `SetupScene.tsx` (the lighthouse picture, lit by `stage`;
  layers like the start screen's harbour, its colours `--sx-*` in `setupScene.css`). `ProviderMark.tsx` draws a service
  as a plain shape, never its logo.
- **Settings**: `settingsIndex.ts` (groups, one-line blurbs, what "Find a setting" finds; unit-tested), each page's
  picture in `settings/art/SectionArt.tsx`. Appearance's preview is `AppearancePreview.tsx`. The living pictures share the
  living art's watcher (`components/art/living.ts`: still while hidden or typing).
- **Usage**: `UsageReport` adds, without changing anything there, each bar's split by model (`UsageBar.models`) and each
  world's share (`byWorld`, from `buildReport`'s `named`); the charts are `features/usage/UsageCharts.tsx` (logic in
  `chartLogic.ts`), drawn with theme tokens, no chart library.
- **Backups**: `previewBackup(id)` reads a backup read-only and counts it beside the open world (`countWorld` in
  `services/backups.ts`); Restore works exactly as before.
- **Import**: a file dropped on the import page is read by `readDroppedManuscript(path)` (the preload's
  `pathForFile`, Electron's `webUtils`), as Choose a file reads a picked one.
- **Toasts** take an optional `progress` (0–1, or null while unknown) that `withProgress` fills for world files.
- **Tests**: `tests/e2e/settings-desk.spec.ts`.

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
  be in the scene exactly once, on one line; `propose_rewrite` takes a passage across paragraphs, from its `start`
  words to its `end` words) and tell the model nothing has changed yet. A mistake goes back to the
  model as the tool's answer, never as an error. Proposals are saved with the answer's record (`db/ask.ts`) and
  sent as `ask:proposals`; each step as `ask:step`.
- **Applying** happens in the window (`features/ask/applyProposal.ts`) through the usual APIs, each with its Undo:
  words go into the page as one step after `snapshotBefore`; a new character is made as the builder makes one, so
  it gets its read-aloud voice. The cards are `features/ask/Proposals.tsx`.
- **Honest about what is waiting.** A `propose_*` call that fails answers "Not proposed: nothing is waiting"; an
  edit that overlaps another waiting one is turned down (once one is applied the other's words would be gone), and
  `revises: N` replaces change N instead. Before the last request (no tools) the model is told what it proposed
  (`lastWords`). An answer with no proposals that clearly claims or hands over changes (`claimsChanges`), or that
  answers a request for edits (`asksForChanges`, both in `shared/askChanges.ts`), is sent back once (`nudge` in the task runner, `PROPOSE_NOW`), and its words are taken out of the reply; if it still
  proposes nothing, the chat says so under it. Earlier answers are sent again with the changes they proposed noted
  (`withProposals`, `ipc/ask.ts`), so the model sees itself using the tools.
- **A model that can't use tools** is said so in plain words (`ai/errors.ts`), pointing to Settings › Models.
- **Ask about this** on the selection bar opens Ask with the words quoted in the box (`features/ask/open.ts`).
- Tests: `tests/e2e/editorChat.spec.ts`; the fake provider's tool calls are in `tests/fake-provider/m4/ask.mjs`.

## Trap scores (story memory plan, step 6)

Adam's consistency plan (October 2026) is scored, not judged by impression: "A made-up test story is built with
continuity traps planted in it ... Every change is scored on DeepSeek Flash, before and after, by an automatic
checker." Built first and run after every step. It lives in `tests/traps/` (its README says how to run it and what
it costs) and never runs in `npm test` or CI: only `npm run traps`. Adam's choice (7 October 2026): DeepSeek's own API
with DeepSeek Flash for every role (writer, memory, judge), connected as the app's DeepSeek preset; the key is read
from `DEEPSEEK_API_KEY` only, and the run refuses to start without it (`--provider openrouter` is kept as an option;
`--fake` checks the harness with the fake provider instead).

- **Story version 3, the default** (Adam, 2026-10-07: version 2 was too short, every fact fitted in what the writer is
  shown, so every step scored 99%; "make the story much longer and have a live DeepSeek Flash write it"): "The Salt
  Road", 30 scenes in 7 chapters, written once by a live model through the app's own Generate from a hand-written
  outline (`story3.ts`; `npm run traps:write`, `write.ts`), each scene's planted events given as the draft's
  direction, never on the card, and verified before the scene is kept (a matching sentence, else a judge call; early
  events early; nothing undoing them; nothing breaking what earlier scenes made true), written again twice at most.
  Frozen in `story-v3.json` with the sentence where each trap became true, so every checkout is scored on the same
  words. Its probes sit in chapters 6 and 7, with every fact chapters back or early in a long scene, beyond what
  Continue is shown; most checks are deterministic (`patterns.ts`), the judge only asks what a pattern can't. A hard
  token budget (`budget.ts`, checked before every call) stops writing and scoring cleanly.
- **Story version 4, the book** (`--story book`; research report "Long story memory and consistency", change 6,
  2026-10-15: version 3 is too short to show forgetting): "The Winter Ledger", 40 scenes in 10 chapters (61,442
  words), invented and written by hand from a bible of facts (never by a model being scored), frozen in
  `story-v4.json`; what is tested lives in `book.ts`. Thirteen probes (one passage each, as probes v3) in the last 55%
  of the book, aimed at facts set early in words that never match the sentences that set them (the unit tests check
  it), and at facts that change (wrist, the secret, dogs, pigeons, watch, key, thaw bell) before and after the change;
  each check is one of ConStory-Bench's five kinds of error, and the report scores by kind and by kind of memory. Then
  18 planted passages (12 with one slip, 6 without, 4 of them decoys) are each checked by the app's own consistency
  checker on a fresh copy of the world after the last scene (`planted.ts`): slips caught, false alarms, decoys taken
  for slips. The probes' pages and the three scenes before each keep the tested facts out (unit tests).
- **Probes v4, chains, the default** (Adam, 2026-10-07: single passages were at the ceiling and not how he writes):
  after the whole story, a new scene is carried on in 12 steps of Add below and Continue in turn (`chain.ts`); the
  early steps' directions plant facts (boots off, Ash gone out, the door locked, the case put down, lying down, a cut
  hand) and every later step is checked against each one still in force, plus facts from chapters back. A change shown
  on the page ends a plant. `--rescore` scores a saved run again with today's checks, with no model.
- **The prose check** (Adam, 2026-10-08): how the AI writes, measured per passage with no extra model call
  (`prose.ts`: length against the words asked, recap, echoes of earlier steps, sample lines of dialogue copied from
  the writer's prompt, stock tics, closing the scene off, "and" density, a card beat done again), plus a 1 to 5 rubric
  folded into the judge's usual call (voices, subtext, direction, ending). A Prose section in the report, in
  `--compare` and in `--rescore`.
- **Probes v2** (Adam, 2026-10-07, after round 3 left most checks "not touched" and counted mentions as slips): each
  probe is aimed at its traps the way Adam would aim a draft (a direction, a beat's note, the card's beats for
  Continue) without saying what is true; a mention is no longer a slip (riding needs a riding verb with the horse as
  what is ridden; the compass must be in her hand or used); the judge decides the horse and the compass, the patterns
  stay as tripwires. `PROBES_VERSION` goes in the report. Each run saves the world before the first probe scene, and
  `--from-world` starts a later run of the same app code (git's id for `src`) and story there, without the memory build.
- **Story version 2** (`story.ts`, `--story v2`): "The Gannet", 9 short invented scenes in 3 chapters, with codex entries as Adam would
  make them. Traps, each with a known truth at a known point: clothes taken off partway through a scene (and a
  change of clothes later), a cut on the left palm, people moved between rooms, who knows what (a secret told to only
  one person, a cover story in front of a soldier), a promise made in the first scene and kept later, a hidden packet,
  a posture and a held knife set partway through a scene, and a horse two scenes back that the card never mentions.
  `STORY_VERSION` says when scores stop comparing: version 2 (7 October 2026) tightened the questions the step 1 run
  showed were misread and added the harder traps, so version 1's scores don't compare with it.
- **Probes** ask the app to write as Adam would, through the window's own entry points with the app's real
  settings, world, memory keeper and briefing (`run.ts`; Electron is a stand-in, `fakeElectron.ts`): Add below in a
  half-written scene, Generate a scene from its card, Continue at a cursor, and a beat of Beat by beat. Scenes are
  written in order and left (so the memory reads them, as it would for Adam); what the AI writes is scored and thrown
  away, and the story goes on with its own words. Several samples per probe (3 by default).
- **The checker** (`judge.ts`, `score.ts`): per passage, one judge call (the memory model unless told otherwise) is
  given only the passage, the facts true where it begins and yes/no questions, each with the answer that means
  "broken". A broken claim needs a quote the passage really has; a few deterministic tripwires (the cut put on the
  right hand) back the judge up. Consistency = kept / (kept + broken); the report gives it by trap and by probe,
  with what broke, the calls and the cost, the commit and the models (`traps-results/`, not committed).
- **Scoring another branch:** `--root` points the harness at another checkout's app code, so main and a step's
  branch are scored by the same harness and story; `--compare` puts two reports side by side.
- **Check and repair (step 3)**, when the checkout has it: each passage goes through `checkNewWords` as the page
  sends it, the fixes are made with the page's own code (`features/repair/apply.ts`, on a ProseMirror copy of the
  page, `page.ts`), and the passage is scored as written and after the fixes, with the fixes, the questions and the
  repair's own calls in the report. Older checkouts run exactly as before.

## The AI writer makes full use of the story memory (Adam, 2026-10-08)

A read-only audit of 122 real writer calls on DeepSeek Flash (an invented test story) found Add below given Generate's
"write a complete, polished scene… End on the scene's final beat" (it invented action to reach its length, 6 of the 7
remaining trap breaks; closed scenes off with sleep or silence; wrote card beats again), Continue given none of the
memory, a briefing padded with false or stale lines, sample lines and stock tics repeated word for word, and only 40% of
Add below's prompt reused by the provider's cache (Continue 25%). Adam chose six fixes (shipped in 0.6.35, with the
lab's winners in the next section):

- **Add below's own instructions** (`ai/prompts.ts` `writerInstructions(pov, true)`, `addBelowFinal`): carry the scene on
  from where it stands; the length is a ceiling, not a target; stop once what is asked has happened, mid-motion, without
  wrapping up or closing the scene unless asked; invent no events beyond the direction or the next beat; beats already
  on the page are done (`ai/repetition.ts` `beatsOnPage`: most of a beat's own words on the page, beats in order) and
  never written again. Adam's direction is the closing instruction's last words ("What happens now, as the author
  directs…"), not in the scene card; with none, the next beat not on the page. The planner gets the direction with the
  card (`plan/plan.ts`). Generate keeps its complete-scene prompt.
- **Order for the cache** (`ai/context.ts` `SEND_ORDER`): what stays the same from one step of a scene to the next comes
  first (instructions, world rules, themes, setting, the story so far, the previous scene's end, plot threads), then the
  people (the same unless the memory learns something), then what a step brings in (entries named, recalled, what was
  said, earlier passages; since long story memory fix 9, who knows what, and since fix 14 the continuity brief), and
  last the scene card, the scene so far, the stage and what must stay true. Block 9's
  entries and the recalled entries go in a steady order (kind, then name) under fixed titles (`MENTIONED_TITLE`). Claude's
  cache breakpoint ends before the people. Measured on an invented scene, two Add below steps in a row
  (`tests/unit/writerRound.test.ts`): the second step's prompt that the first already sent went from 29% to 69% with a
  short story so far, and from 11% to 71% with a long one (12,234 tokens down to 4,431, the timeline below included).
- **A cleaner briefing** (who knows what moved to its own block in long story memory fix 9, below, with the same
  rules): "X does not know" only for real secrets (`ai/mustStay.ts` `realSecrets`: what one person here
  knows and another here doesn't, never kept from someone it is about, at most 3); "What X knows" gives each fact once
  and drops plans that happened or whose time has passed (`ai/knows.ts` `cleanKnows`: a later note with most of the
  plan's words; "tonight", "tomorrow", "in the morning" with two or more later scenes since); deaths told later lose
  "this afternoon" (`pastDeathNote`) and say where; on the stage (`stageInScene`, with `previousSceneId` and `dead` in
  the scope) the dead are never a live state (left out unless this scene's words put the body somewhere), someone only
  named is in it only with words from this scene (or the one before, its time carrying on), and words from older scenes
  no longer hold except injuries and what people hold (no "out in the middle of the flood", no "hat on" from days
  before); what must stay true doesn't say again what the stage block right above it says at the same moment
  (`stageShown`, carrying on inside a scene: it keeps the dead, marks, changed looks, what someone no longer has and
  secrets), and says nothing twice (a piece of clothing a thing in the place already places, a piece under two names);
  sample lines are speech only (`speechSamples`), never narration, and the instructions say never to reuse one.
- **Continue's memory core** (`edits/index.ts` `continueCore`, `edits/briefing.ts` `core`): the timeline's short form
  (about 800 tokens), up to 3 entries recalled for the words near the cursor (step 5's search, found first), up to 4
  lines of what was said word for word, the point of view's facts to keep (marks), and Adam's optional "what happens
  next", said last. The timeline goes first (the same from one Continue to the next). It goes before the edit is
  refused on a small model, and adds at most a few thousand tokens. The "what happens next" field is a small optional
  box in the AI tools menu, above "Continue after these words" (`features/edits/AiTools.tsx`); the palette's Continue
  has none.
- **Phrases not to say again**: the round listed up to 8 in the closing instruction (sample lines on the page, stock
  tics, `ai/repetition.ts` `STOCK_TICS`, and runs said twice). Replaced before it shipped by "stock phrases said
  afresh" (next section): naming a phrase can prime it. No presence_penalty is sent (DeepSeek's docs say it does nothing).
- **The canon timeline** (`ai/timeline.ts`; Adam: "a clear outline of what has happened so far in the story and when and
  involving who"): in place of the prose summaries (8.8k tokens in Add below, none in Continue), "Canon: what has
  already happened… never contradict it, and never write it again as if it were new", oldest first, on this scene's own
  line only (the memory's StorySoFar): earlier stories a line each, this story's older chapters rolled up a line each,
  the last two chapters a line a scene with when (the card's When), where and who (the earlier cards, read in one query:
  `db/repo.ts` `sceneCards`, `memory/scene.ts` `withCards`), the last 5 scenes in the most detail, and deaths, departures
  and things changing hands marked on the scene they happened in (`timelineMarks`). Capped at about 2,500 tokens in
  full, 1,500 short, 800 smaller (Continue's), then only the most recent parts, the oldest detail going first. Its words
  depend only on scenes before this one, so it reads the same at every step. Ask the world, the checks and the
  interview keep the prose summaries (`storySoFarText`).

## The writer lab's winners, as defaults (0.6.35, 2026-10-08)

Each was tried first as a switch in a local lab (never pushed), on the trap harness's inn chain (K1: 12 steps of Add
below and Continue after a whole invented story) with DeepSeek Flash, Thinking off. Samples were small (2 to 5 chains a
variant), so nearly every 95% interval overlaps; these went in because they cost little, fixed real faults seen in the
prompts, and none did worse. Not taken: prefix completion, repeating key facts at the end, beat options, a thinking
planner, a scene contract (built since as long story memory fix 13, below, to be judged on the long test book),
quote-both-sides checks, logprobs, stop-string cuts, "coming later" and the loop guard.

- **Temperature 1.0 for the writer** (`shared/defaults.ts` `writerTemperature`): Generate, Add below, beats and Continue
  write Balanced (the default preset) at 1.0, not 0.85. 1.0 kept canon and the judge's marks, with fewer stock phrases
  and echoes of earlier steps; 1.3 and 1.5 fell apart. Steady, Adventurous and the edit tools keep their own; the
  planner, check and memory keep 0.2. Thinking off, as ever, is `reasoning_effort: "none"`, which DeepSeek honours.
- **Continue plays out what is under way** (`edits/prompts.ts` `continueTask`, `CARRY_ON_LAST`): with no "what happens
  next", whatever is under way in the last paragraphs plays out before the card's next beat, nothing new is brought in,
  and the ask ends "Carry on from the last paragraph…" (a knock at the door had been left for talk of the road ahead).
  Continue asks for 180 to 280 words (was 120 to 250; it wrote past 250 about half the time anyway), with reply room for
  twice the top in tokens (756).
- **A door locked with someone outside** (`ai/lockRule.ts`): when the stage has a door locked, barred or bolted from
  inside and someone out ("out in the yard", or gone out through it), Where things stand (Continue's, and Add below's
  block 3b) gets one line: "Ash Penrose is outside; the yard door is locked from inside and Wren Hollis has the key. If
  Ash comes back in, someone unlocks it on the page first." Round E's real slips were nearly all this: the Continue
  straight after the lock walked Ash in through it. With the line (round F, 4 chains each): door kept 71% → 100%, no slip
  in 4 of 4 chains (2 of 4 without).
- **Prompt bugs found in the lab's real prompts** (`ai/briefingFixes.ts`, read side only; the memory as kept is
  untouched): how someone is placed (posture, touching, sees) is left out once they moved after it was said
  (`clearStalePlacing`, in `stageInScene`); a profile's usual clothing or way of moving that the stage or a later note
  undoes is left out, and its "this day", "tomorrow" made past (`freshLooks`, `pastProfile`); people the scene's own
  words don't name get one line under "Not in this scene", and places not linked to the scene are left out (`offScene`,
  `linkedPlaces`; pinned entries and those the plan asked for stay whole); the plan tests only what a change makes new
  for a told secret (`plan/plan.ts` `newWordsOf`: the key into her pocket was dropped for "the survey case"); the check
  never lists someone as not knowing a fact about themselves (`namesPerson` in `repair/prompts.ts` and
  `checks/context.ts`). The two left open in the memory code then (`mergeState` keeping every field a reading leaves
  out; "finds Cinder has cast a shoe" read as a getting) are fixed in the next section.
- **Stock phrases said afresh** (`ai/prompts.ts`, `repair/slop.ts`): the writer prompt names no stock phrase (the list in
  "Write like a person" and the clichés by example are gone; the rule says to show feeling through what someone does or
  says; Adam's own "Words and phrases to avoid" stay). After the check, stock phrases in the AI's words (`STOCK_TICS`, the
  trap runs' others, the app's AI phrases but "not X but Y", sample lines copied whole) are rewritten by one memory-model
  call, one instruction per kind of tic, and come back as more amber fixes with Undo. Not when "Steer clear of common AI
  phrases" is off. Round E: passages with a stock phrase 21% → 4%, the one difference outside the noise.
- **A second opinion before repair** (`repair/second.ts`, after Adam's Holodeck critic): a slip whose line wasn't given,
  whose quote isn't in the new words, or that the model took back in its own last sentence is dropped with no call;
  the rest go to one call on the memory model at its 0.2 (reason first, then real or not), and those ruled not real are
  neither mended nor asked. It may never excuse clothes or position as "could have happened off the page".

## Memory fixes and cheaper prompts (0.6.35, lab round H, 2026-10-08)

Faults seen in round G's real prompts, fixed where the memory is kept or read; then the memory keeper, check and
repair, plan and Add below send the same words in an order a provider can reuse. Round H (DeepSeek Flash, 6 inn
chains): canon kept 100%, no slips in 6 of 6 chains, passages with a stock phrase 7%, judge 4.55 of 5, prompt
tokens served from the provider's cache 47%. Small samples: read these as "no worse, and the faults are gone".

- **The stage** (`shared/continuity.ts` `mergeState`): when where someone is changes, how they were placed (posture,
  touching, sees) goes unless the same change says it again, and anyone touching or watching them stops too. A thing
  new in a reply never near-matches another new one in it ("the stable door" no longer swallows "the door: barred
  and locked"), and a changed thing moves to the end so eviction drops the stalest (`shared/stageItems.ts`).
- **Which door** (`shared/continuity.ts` `readChanges`, `unnamed`; the tracker prompt in `continuity/tracker.ts`): "the door" with two or more doors named just
  before is kept as "the door (the yard door or the passage door?)", never the nearest name; "own", possessives and
  punctuation never say which one, and it looks back about a page.
- **Profiles and items**: a worn thing gone for good (lost, cut away, a bandage taken off) leaves the profile's
  Typical clothing (`memory/looks.ts`, in `memory/state.ts` `stateAt`); "finds Cinder has cast a shoe" is a discovery, not a getting
  (`memory/items.ts` `holdingsOf`). An animal (by its name, summary, tag or "it") neither knows nor has secrets kept
  from it (`ai/mustStay.ts` `isPerson`, and the check and repair prompts).
- **A door locked with someone outside** (`ai/lockRule.ts`): out is read from the place and the last action too
  ("across the yard to the stall", "out of the inn"), and the line says no one comes back in "by any door" until it
  is unlocked on the page.
- **Order for the cache** (only the order and id numbers change; the same lines are sent): the memory keeper gives
  entries fixed E ids by when each was made (`keeper/request.ts` `Ids`, `steadyIds`) and lists them in that order,
  relationships and who knows what before them; check and repair put the scenes before, the card, the dead and the
  facts ahead of where things stand and the new words (`repair/prompts.ts`); the plan puts what the writer is asked
  and the direction last (`plan/plan.ts`); Add below keeps "Also relevant" and "Also in mind" in the order last sent
  for the scene, new ones after (`ai/context.ts`, remembered for the last 20 scenes briefed).

## Beat markers and writing an earlier beat again (Adam, 2026-10-08)

Beat by beat used to forget which paragraphs each beat wrote at Finish, and Write it again only redid the last beat.
Owned by the Beat by beat part (`contracts/beats.ts`, `ipc/beats.ts`, `src/main/beats/`, `features/beats/`).

- **Kept with the scene.** `SceneBeatMarks` (contracts/beats.ts): per beat, the paragraph ids it wrote (every
  version's) and each version that went in (record id, when, and a fingerprint of its words then). One row per scene
  in the world's `meta` table (`beat_marks:<scene id>`, `src/main/beats/marks.ts`: tidied and capped; no migration);
  a new session on the scene takes the place of the last one's once it writes. The interface reads them once a scene
  and saves a moment after each change and before the window closes (`features/beats/marksStore.ts`). `flow.ts`
  notes each beat's paragraphs as they stream and a version as each beat ends.
  - **One session's markers per scene** (Adam's decision, 2026-10-08): starting a new Beat by beat session on a scene
    replaces the saved markers as soon as its first beat writes (`flow.ts` `sessionMarks`); the old beats' words stay
    on the page as Adam's own, with no markers or menu. Opening the bar without writing keeps the old markers.
  - **They go with the scene.** While a scene is in Recently deleted its markers stay, so restoring it brings them
    back; `purgeTrash` (db/trash.ts) clears the row of every scene gone for good (any `beat_marks:` key whose scene
    is no longer in `scenes`). Being in `meta`, they travel in world.db with Export world / Import world and Make a
    copy, and scene ids don't change there (transfer/worldFile.test.ts checks both).
- **Worked out from the page** (`features/beats/marks.ts`, pure): the beats with words on the page; the version
  showing is the one whose fingerprint the beat's words have (so undo puts an earlier version, and its record, back),
  else the newest; check and repair's fixes update the fingerprint (`withMended`). A beat whose version went in
  before an earlier beat's showing version is "written before beat N changed" until it is written again or kept as
  it is (`keptAt`). A paragraph split inside a beat gives the new half to the beat (the words before the change were
  exactly the two halves'); any other new paragraph stays Adam's own.
- **On the page**: a decoration (`beatMarks.ts`, like speaker labels): classes and `data-beat` on the beat's
  paragraphs, a band drawn by CSS (`beatMarks.css`, every size and colour a custom property, so the New look's
  layouts can restyle it). `BeatMarksLayer.tsx` (SceneView, in the scrolling area) puts a "Beat N" button in the
  left margin by each beat's first line (above it when the margin is narrow), shown on hover or keyboard focus (Tab
  reaches it), with the beat's menu: Redo this beat, Change and redo (a one-line note), What the AI saw (that beat's
  showing record), Keep it as it is, Redo the beats after this (the next, or all in order), Remove this beat, and
  Show beats after you finish. Shown during a session on the scene, and after Finish only with "Show beats"
  (`settings.editor.showBeats`: Settings › Editor, the palette's Show beats / Hide beats).
- **Writing a beat again** (`redo.ts`). The session's last beat, while it ends the scene, goes the bar's way
  (`writeAgainFromPage` → Write it again). Any other beat, and any beat after Finish, becomes a tracked change in its
  place (the AI edits' suggestion layer: `showReplacement` from outside, with `status: 'starting'`, `stop`, `onGone`,
  then `updateReplacement` as the beat's generation events arrive). It is a normal `beat` record (`startBeat`, one
  draft job per scene), with the scene so far up to the beat only (`soFarText(…, leaveOut)` now stops where the beat
  begins, so later beats aren't "so far") and the start of what follows it as `after`, quoted as "What comes after
  this beat" (`afterBlock`, ~400 words) with its own closing lines. Accept keeps the scene in History first ("Before
  beat N was written again"), goes in as one undo step, and makes the new words the beat's (paragraph ids, version,
  the session's paragraphs and owners); then check and repair checks them. The beats after it get their note, a
  message offers to redo them, and "all in order" writes each as its own tracked change after the last is accepted
  or rejected.
  - **Adam's words inside a beat** (Adam's decision, 2026-10-08). The change runs from the beat's first paragraph to
    its last, so a paragraph he typed or pasted between them goes too. It isn't left out (the beat would lose its
    shape); the change says so from the start, under its buttons: "This also replaces N paragraph(s) you wrote
    yourself. Reject keeps them." (`othersInBeat`, `alsoReplaces` in sessionLogic.ts), kept with any note at the end.
- **Remove this beat** keeps the scene in History ("Before beat N was taken out"), then takes the beat's paragraphs
  out as one undo step (Ctrl+Z puts them back, marker and all).

## The AI manages plot threads (2026-10-08)

Adam's choices: weave gently (an open thread comes in only where it fits; never forced), and the memory resolves a
thread on its own when the payoff is on the page, with the quote, which he can undo from the board. No migration: the
existing thread entries (`promise`, `clues`, `payoff`), `changes` of kind `thread` ({status, note}, open or resolved
only) with their source links, and the scene card's `setsUpIds` / `paysOffIds` in `card_json`.

- **What the memory reads** (`keeper/prompts.ts`, `keeper/apply.ts` `applyThread`, rules in `keeper/threads.ts`): a
  thread item's status is `open`, `clue`, `developing` or `resolved`, always with a quote. Open makes the thread (text
  origin) with its promise, or opens one already there (a planned thread of Adam's gets the promise only when the field
  is empty and not his), as a thread change pinned to the scene; an open thread "opened" again is only a note. A clue is
  one more line of `clues` (field origin text, with its link; field-set Undo with a suppression); on Adam's own clues
  it is an update note "Clue: …" in that scene instead. Developing is an open change with a note. Resolved needs the
  payoff on the page and is ignored (kept as a note that it moved on) while a later scene card in the story pays it off
  (`laterCardPaysOff`; a memory link for a resolve it read there doesn't count) or the thread's payoff says it comes
  later (`payoffLater`: a later chapter or book by number, a sequel, later/eventually, or the finale, climax, end or
  last chapter unless this is the last chapter). A verdict on edited words keeps the status (only the note follows).
  The keeper is shown each open thread with its promise, last clue and planned payoff (`keeper/request.ts`).
  `ThreadState.planned` marks a thread with no thread change on the line yet (`memory/state.ts`).
- **Scene card links** (`shared/threadLinks.ts`): an opening puts the thread on that scene's "Sets up", a resolve on
  "Pays off", marked in `card.threadLinks` (`setsUp:<id>` → `ai`; `removed` once Adam takes it off, never put back;
  `undone` when the memory takes it back). Unmarked links are Adam's and are never removed. The card shows an AI tag on
  the memory's chips (`CastPicker` `aiIds`); a save from the panel merges what the memory did since it read the card
  (`mergeThreadLinks`, in the `updateSceneCard` handler), and the panel picks the links up on each memory change.
  Undo of the opening or resolve (What changed or the board), or the words going, takes the memory's link back
  (`repo.setAiThreadLink`).
- **The board** (`worldViews/threads.ts`): "Found by AI" (text or AI origin, never edited by Adam) or "Yours"; a
  resolved thread shows the words that paid it off, "Resolved by AI" and Undo (the What changed line that added the
  resolve, `kdb.addedLines`), which reopens it and records a suppression.
- **The writer** (`ai/openThreads.ts`): "Open plot threads" — the threads open here (not planned, not on the card,
  not dropped), one line each (name — promise — last clue — when it is due), those due or overdue first, then those the
  card's words or people name, then the longest untouched (since the promises ledger, fix 10: before it, the card's
  first, then the most recently moved, at most 6); 6 to 22 by `memoryScale` (short: 3 to 6) for Generate and Add
  below, block `open-threads` at priority 9 in the steady part of `SEND_ORDER` (right
  after the card's `threads`, before the people, so it is cached); the planner gets the same block, in its steady part (after the
  world, before where things stand and the ask), and the rule to plan no payoff the card or direction doesn't ask for
  or the thread's line doesn't say is due now (`plan/plan.ts`); Continue gets at most 4, short, next to the
  timeline (`edits/briefing.ts`). The lead: "Keep these alive. Bring one in only where it fits naturally. Don't pay a
  thread off unless the scene card or the author's direction asks for it, or its line below says it is due." The card's
  own threads keep their block
  ("this scene pays it off").
- **Outlines** (`outline/prompts.ts`, `outline/interview.ts`, `features/outline/parse.ts`): each scene may give
  "Sets up:" and "Pays off:" lines (thread names, semicolons); the suggestions show them, and keeping a scene puts them
  on its card as the AI's (`outline/structure.ts` `withThreads`), finding a thread by name or other name, else making
  one (AI origin) once per keep. Undo of the keep takes the new threads to Recently deleted while nothing else uses them
  (`takeBackThreads`), and a reused first scene loses only the AI links.

## Chapter cards (Adam, 2026-10-08)

A chapter card holds the scene card parts a chapter's scenes share: point of view, characters present, location,
When, mood, length and notes for the AI. Goal, conflict, outcome, beats, plot threads and the summary stay the scene's.

- **Storage, no migration.** The data model is frozen, so a chapter card lives in the world's `meta` table, one row a
  chapter (`chapter_card:<chapter id>`, JSON of `ChapterCard`; no row for an empty card), as beat markers and map
  layouts do. It travels in world files and backups with the rest of `meta`. A chapter in Recently deleted keeps its
  card (a restore brings it back); `purgeTrash` and the outline helper's Undo drop the rows of chapters gone for good.
- **Copy through, not read through.** About twenty readers use `scenes.card_json` directly (the briefing, memory,
  tracker, retrieval, search, the views), so the chapter's values are *written into* each scene card that follows them,
  and every reader stays as it was. `SceneCard.inherits` marks each carried part: `true` follows the chapter, `false` is
  the scene's own, absent is unsettled (cards made before chapter cards). The rules are in `src/shared/chapterCard.ts`
  and used on both sides:
  - a new scene (`repo.createScene`, so every caller) follows every part of its chapter's card;
  - saving a chapter card (`repo.saveChapterCard`, one transaction) writes it into every scene that follows each part,
    and into a scene's *empty, unsettled* parts (which then follow); a scene's own parts never change. Each scene
    written gets a new `updated_at`, so the views, search and entry pages kept from cards are made again;
  - moving a scene to another chapter (`repo.moveScene`) does the same with the new chapter's card;
  - any scene card write (`repo.updateSceneCard`: the card on screen, the interview's fill, ideas, Ask proposals, the
    timeline's "Day 1") goes through `resolveCardWrite`: a followed part stays followed unless the write changed it to
    something that isn't the chapter's, which makes it the scene's own. "Use chapter's" is a write marking it followed.
- **Screens.** A click on a chapter in the binder, or "Chapter card" in its menu (the keyboard then carries on in the
  card), shows the card in the right-hand panel in place of the scene panel's tabs, laid out like the scene card and
  saving as Adam types (`features/chapterCard/`). Each save that changes scene cards shows "Updated N scenes that follow
  this chapter card" with one Undo (`restoreChapterCard`: the card, and only those scenes' carried parts and marks, as
  they were before the first change while the toast shows). On a scene card, a followed part the chapter has a value
  for is tagged "From chapter" (screen readers hear it in the label); a part of its own offers "Use chapter's". Open
  scene cards reload what they follow whenever a chapter card changes (`chapterCardsRev`).
- **The AI fills them.** The outline helper, a recipe's story and a chapter's plan ask for `Point of view:`,
  `Characters:`, `Location:`, `When:` and `Mood:` lines under each chapter, and the same lines under a scene only where
  it differs from its chapter (`outline/prompts.ts` `CHAPTER_CARD_FORM`, read by `features/outline/parse.ts`). Kept
  (`keepOutline`), names are matched to the world's characters and places (`outline/names.ts`; unknown names are left
  out) and go into the chapter card's empty parts; a new scene's differing parts are its own. A scene's When the same as
  its chapter's, or none while the chapter has one, follows the chapter's; another When is the scene's own, and
  `fallbackWhen` is only used when neither has one. Undo of a keep on the story's reused "Chapter 1" puts its card back
  unless Adam changed it since. A chapter's plan fills its card's empty parts when the reply ends, with Undo.
- **With plot threads (0.6.36).** A kept scene gets both: its chapter card parts (`ownParts`, `sceneWhen`) and the
  "Sets up" / "Pays off" links as the AI's (`withThreads`), all in one card write through `resolveCardWrite`, so
  `card_json` carries `inherits` and `threadLinks` side by side. `unkeepOutline` undoes both: the chapter cards it
  filled, the AI links on a reused first scene (`acts.takeBackKept`), then the threads it made (`takeBackThreads`).

## The scene and chapter critic (Adam, 2026-10-09)

Craft feedback on a scene or a whole chapter, only when Adam asks: never run by itself. It judges craft, never continuity
(that is the consistency checker's, and its report in the Issues tab stays as it is). Contract `contracts/critique.ts`,
main side `src/main/critique/`, handlers `ipc/critique.ts`, the tab `features/critique/`.

- **Where.** The scene panel's Critique tab, beside Issues (a speech mark when the panel is narrow), with This scene /
  This chapter (the open scene's chapter); Critique scene and Critique chapter there (Stop while it reads), and the
  palette's "Critique this scene", "Critique this chapter" and "Scene critique" (the tab).
- **The request** (`critique/run.ts`, `prompts.ts`): one 'critique' record through the task runner, with the writer
  model and its Thinking, `[AIWRITE-CRITIQUE v1] scene|chapter`. A lean briefing fitted with `outline/brief.ts`
  `fitBlocks`: how the story is written (genre and its feel, the author's take, tone, point of view, tense, prose style),
  the scene card or the chapter's goal and card, who is named (with how a character speaks and what they want), where it
  sits, the end of the scene or chapter before, and the words. A long scene goes as its opening and ending; a long
  chapter as each long scene's summary, opening and ending (three lengths), then summaries alone, rather than refused
  (`Critique.shortened`, said in the tab). A reply that can't be read is asked for once more.
- **The reply** (`critique/parse.ts`): a summary, up to three strengths and up to eight notes (category, title, weight
  high/medium/low, quote, suggestion), what matters most first. A quote counts only when it is in the words
  (`checks/quote.ts` `findSceneQuote`; for a chapter, in which scene, and which appearance); otherwise the note shows
  without it.
- **Kept** in `meta` as `critique:scene:<id>` and `critique:chapter:<id>` (the latest only), with a fingerprint of the
  words read (`textHash`), so reopening costs no AI call and `getCritique` says when they have changed since ("The scene
  changed since this critique", with Critique again). The tab checks it against the saved words every few seconds while
  it shows.
- **Notes.** A click on the words shows them in the page (opening their scene for a chapter's note). "Rewrite this"
  hands the words, widened to whole sentences, and the note to the AI tools' Rewrite (`startTool('rewrite')`, with
  `mustChange`), so the rewrite waits in the page as a tracked change like any other.

## Write the whole chapter (Adam, 2026-10-10)

One action writes a whole chapter from its scene cards and keeps working on it until it is right: in line with the
codex, Recall and the timeline, consistent from scene to scene, the critic's notes dealt with, and proofread. Adam's
choices: it is agentic (the AI decides what to look up and how to fix things), the AI corrects itself (its changes go
straight in, with the words before kept for Undo), every scene with a card is drafted, even ones with words, there is
no cap on rounds, and every critic note is weighed. Contract `contracts/chapterWriter.ts`, main side
`src/main/chapterWriter/`, handlers `ipc/chapterWriter.ts`, window `features/chapterWriter/`.

- **The agent thinks, the app holds the gate.** A cheap model left to itself declares victory early or goes round in
  circles, so the agent (a model with tools, through the task runner's `agent` loop, as the editor chat) decides what to
  do inside each session, and `run.ts` decides when the chapter is done: it runs the checks and the critic again itself.
- **The stages** (`run.ts` `ChapterRun`): *study* (one session reads the cards against the memory with the editor
  chat's look-ups and calls `write_brief`: per scene the facts to keep to, who knows what, where everyone starts, when,
  threads and traps; and `questions`, things in Adam's cards that don't fit the memory, which are never changed);
  *draft* (each scene in order through the normal writer path, `draftBriefing` with `fresh: true`, the card's length,
  the brief's notes as an extra block, and `startDraftJob`'s new `done` promise; the next scene's briefing catches the
  memory up first, so it is written knowing what the scene before now says); then *rounds*: the consistency checks
  (`checkScene`, every check, after the memory catches up as the checks do) and the critic (`runCritique`, each scene
  changed and the chapter) read what changed; each scene with findings gets a *review* session, then the chapter-wide
  findings a *chapter* session; a round that finds nothing gets a *proofread* session per scene, and is checked again
  if that changed anything. Done is a round that finds nothing after a proofread that changed nothing.
- **Findings** (`tools.ts` `Finding`): the scene's open issues (checks and the memory keeper's clashes, not live
  checks) and the critic's notes, numbered F1, F2... across the run. The critic after the first round is told it is
  reading again (`CritiqueRequest.again`, `critique/prompts.ts` `AGAIN_LINE`) and gives no notes when it is ready;
  without that it would never be clean.
- **The agent's own tools** (`prompts.ts`, `tools.ts` `ChapterSession`), beside the look-ups (`read_scene`, `outline`,
  `search`, `get_entry`, `style_guide`, `scene_state`, `story_so_far`, `chapter_card`, `list_threads`, `find_mentions`,
  seen from the scene being worked on): `timeline` (the canon timeline before a scene), `chapter_brief`, `revise` (a
  passage from its `start` to its `end` words, found tolerantly as the chat's are, `ask/anchor.ts`; at most about 600
  words; the whole paragraphs it touches are rebuilt from the marked words so italics stay whole; saved at once),
  `rewrite_scene` (the writer again, with a direction), `not_a_problem` (only with words in "double quotes" that are in
  the story's scenes, the codex or the timeline; the issue becomes Ignored, a critic note isn't raised again this run,
  and the report lists it with the reason), `check_again` and `done` (turned down twice while findings it was given are
  open, then let through: the gate checks again anyway). A mistake goes back to the model as the tool's answer.
- **Pages in main** (`page.ts`): prose to a TipTap page as the editor saves it (`importing/doc.ts` ids, `*italics*` with
  `shared/emphasis.ts`, moved from the editor's `streamText.ts`, which re-exports it). A paragraph whose words didn't
  change keeps its old node, id and marks, so source links, beat markers and speaker marks stay with it. Each save keeps
  the page before in History ("Before the chapter writer's change: …") and goes through `coreHandlers.saveSceneText`,
  so the memory keeper, search and History follow it.
- **Never stuck, never runaway** (`progress.ts`): no round cap; it stops when clean, on Stop, at the monthly spending
  limit (`pausedNote`), when a call fails, or when a round makes no progress: the same findings three rounds running
  (found, then two tries), or the chapter's words back to a version already checked with findings open ("The AI
  couldn't settle N things"). Each session has its own step limit (`STEPS`).
- **Kept** in `meta` (no migration): the latest report per chapter (`chapter_writer:<id>`) and every scene's page and
  text before that run (`chapter_writer_before:<id>`), which Undo puts back (with a History copy first); both go with
  their chapter in `purgeTrash`.
- **The job.** "Chapter writer model" in Settings › Models (`settings.models.chapter`; the chat and brainstorm model,
  then the writer model, until Adam picks one; it must use tools), its own Thinking (Off). Records use job `'chapter'`;
  the drafts are `draft` records with `params.chapterWriter`, which the critic after a draft leaves alone
  (`DraftActivity.chapterWriter`). The checks use the check model, the critic the writer model. `startChapterWriter` is
  in `ASKS_FIRST`. One run at a time; Generate, Beat by beat and Variants are turned down in its scenes
  (`chapterWriter/active.ts`).
- **The window.** The binder's chapter menu ("Write this chapter with AI…"), the palette ("Whole chapter with AI")
  and the chapter card's "Written with AI" group open the start dialog (`ChapterWriterDialog.tsx`, mounted once): the
  scenes, which have no card to write from (left out), and that words already there are replaced but kept for Undo.
  While it works, the top bar shows what it is doing with Stop and what it has spent (`ChapterWriterStatus.tsx`), and a
  scene of the chapter open in the page can be read but not typed in (`hold.ts`, dimmed, `chapter-held`); each change
  shows in the page at once (`chapterWriter:sceneChanged`, `replaceScene`). It ends in a toast with Show (the report on
  the chapter card, `ChapterWriterReport.tsx`) and Undo.
- **Tests.** `chapterWriter/chapterWriter.test.ts` (the fake provider scripts the agent's calls, `tests/fake-provider/
  chapter.mjs`; the critic's fake finds a re-read ready).

## Long story memory: the quick wins (2026-10-15)

Adam: "AI Write forgets a lot between scenes and chapters." A research pass (outside the repo, read at 8dc0dc27) found
the causes structural: a fixed ~1,850-word story so far whatever the model reads, one previous scene's end as the only
prose, a 16,000-token guess when the provider doesn't say how much the model reads (DeepSeek's own API among them),
summaries that keep their opening and lose their ending, late or missing summaries, and search finds given only what
was left over. These five changes are its quick wins. A model whose reading limit is 16,000 tokens (or the guess) gets
the same story so far and passages as before; what changes for it is the share for search, the summaries and the list.

- **A real reading limit** (`shared/readingLimits.ts`). Where a custom provider's model list says nothing, a limit the
  model's maker publishes stands in for the guess: DeepSeek's own API (api.deepseek.com), 1,000,000 tokens for
  `deepseek-flash` and the `deepseek-v4…` names (its Models & Pricing page, read 2026-10-15), 64,000 for any other name
  there (every model it has offered since V3 reads that much). Filled in when the list is read (`ai/models.ts`
  `parseModelList` with the provider's address; vLLM's `max_model_len` is read too) and when settings load or change
  (`settings.ts` `withPublishedLimits`), so a model chosen before works too; a limit the provider gave or Adam typed is
  kept. Settings › Models says "DeepSeek says this model reads up to 1M tokens, so AI Write uses that", and clearing
  the box goes back to it. When the app still guesses, the Context tab says so under the briefing size, with Set it
  (`ContextPanel.tsx` `GuessNotice`).
- **Memory that grows with the reading limit** (`ai/memoryRoom.ts`). `memoryScale`: 1 for 16,000 tokens or unknown, up
  to `MOST_SCALE` (3.6) at 60,000 or more (15% of the limit for the story so far, against the 2,500 tokens it had).
  The timeline's full and short caps grow by it, up to four chapters are told a scene at a time, and older chapter and
  story lines say up to twice as much (`timeline.ts` `timelineShape`; Continue's and the smallest forms unchanged). It
  depends on the reading limit only, so it reads the same at every step of a scene; with room (scale 2.25 or more)
  every recent scene is told as fully as the last five, so a new scene adds a line and changes none before it (the
  cache). A search offers up to 12 passages and the block shows up to 10 (`passagesFound`, `passagesShown`; short 5, 2,
  1). Step 5's candidates get `RECALL_SHARE` (a tenth) of the room, no more than they take in full, held while the
  rest is fitted (`finishContext` `held`, `reserve`, counted when Auto decides its length); room they don't use goes
  back (`giveBack`, step 8).
- **Summaries that lead with the ending, and are there when needed.** `SUMMARY_SYSTEM` asks every summary to begin "By
  the end," with where people end up, injuries, who now knows what, who holds what, decisions and promises, then tell
  what happened in order; chapter, story and series roll-ups begin with how things stand at their end (`keeper/prompts.ts`;
  a patched summary kept or gained that opening until fix 15 stopped patching, below). Before a draft, after the earlier scenes and the scene's
  own words are read, the keeper writes the summaries the briefing can't do without and the draft waits for them
  (`engine.ts` `summariesFirst`, `summaryNow`, waited on as `summary:<id>`): the scene just before when its summary is
  due, and any of the last `DUE_SUMMARY_SCENES` with none at all; other due summaries are queued after as before. All
  within the draft's usual wait (`CATCH_UP_LIMIT_MS`); "Write the whole chapter" waits up to three minutes
  (`ipc/chapterWriter.ts` `DRAFT_CATCH_UP_MS`, `draftBriefing`'s `catchUpMs`). The writer's story so far carries a
  scene of this story with `MIN_SUMMARY_WORDS` or more and no summary as `missing` (`memory/scene.ts` `withoutSummary`,
  one word-count query, `repo.sceneWordCounts`), and its timeline line says "no summary yet, so what happens in it
  isn't told here" (`NO_SUMMARY`), which the Context tab shows; checks, Ask and the rest see only the summaries there
  are.
- **The scenes before, word for word** (`ai/context.ts` `EARLIER_BLOCK`, "The scenes before, word for word", priority
  8, sent between the timeline and the end of the previous scene). The writer's scene memory has `earlier`: up to
  `EARLIER_SCENES` (2) scenes before the previous one, in its story, with their words (`memory/scene.ts`
  `earlierScenes`), and `previous.label`. The block holds them (the last 3,000 words of each at most) and the previous
  scene up to where block 3's end begins (`sceneHead`), oldest first; shorter forms leave out the oldest. It goes in
  only in room to spare, after everything else and step 5's candidates have theirs (`finishContext` step 9), and only
  beside block 3 in full, so nothing is missing between. The plan may take its room (`plan/plan.ts` `keepsRoom`). Its
  level can change from one step of a scene to the next when room is tight, which costs some of the cache; with a
  real reading limit there is room for it at every step.
- **What must stay true, never left out, and sharper** (`ai/mustStay.ts`). It opens with what the scene is most
  likely to break (`KEY_KINDS`: who is dead, what is kept from someone here, injuries, since fix 9 what someone here
  believes wrongly, and how much time has passed
  since the scene before, by both cards' When or a story's time gap: `ai/context.ts` `timeSince`; since fix 11 from the
  story calendar, below), one of each kind
  first, `MUST_KEY` (5) at most; the rest follow as before. Its short form keeps them, and a smallest form has
  `MUST_SMALLEST` (3) of them, said briefly. The block is priority 2 (`MUST_PRIORITY`): never left out, shortened only
  once every block from 3 to 11 is. On a 4,096-token model writing 600 words that leaves no room for the point of
  view's core, which the list used to give way to; the models AI Write suggests read far more.

- **Remembering what the checks found** (fix 7, `checks/lessons.ts`; no migration: it reads the `issues` rows the checks
  already keep). Two kinds of lesson from every scene before this one on its line: a *slip*, a finding about facts, who
  knows what or the timeline that was put right in the text (Fix the text, Ask, the chapter writer, check and repair as a
  draft lands), and a finding Adam *meant* (ignored). Not style, voice or continuity (about one moment), and not a
  finding settled by Update the memory (the text was right: `IssuePayload.fixedBy` 'memory', set by `setFixedByMemory`
  and cleared on Reopen; an older row counts as settled when the memory's value now is its text's). Who knows what and
  the timeline only from the last `RECENT_SCENES` (6) scenes; a fact however long ago. The newest once for the same
  entry and field or the same words. Slips go to the writer in "Must stay true" (`ContextInput.slips`, `ai/gather.ts`;
  `mustStay.ts` `MUST_SLIPS` (2), those about people in the scene first, then others in the briefing, never in the short
  or smallest form): "Slipped in Ch 2, Sc 3 and put right, so don't repeat it: …". What Adam meant goes to a later
  check of a scene that names the same entries (`SceneCheckContext.meant`, section "What the author has said is meant",
  `MOST_MEANT` (8), only for the check it belongs to; the system prompt says the same thing there is no issue). The
  same thing in the same scene was already never raised again (`sameThing`).

The book-length test story is the trap harness's story version 4 (`--story book`, see "Trap scores"). The research's
later steps each have a section below: spotting characters however they are named (fix 12), who knows what (fix 9),
promises (fix 10), a story calendar (fix 11), rule-based checks (fix 8), summaries rebuilt from the record (fix 15),
scene contracts (fix 13) and a continuity brief before each scene (fix 14). Who is absent (as opposed to dead) isn't
among the key facts yet: the "Not in this scene" lines
cover some of it.

## Long story memory: spotting characters however they are named (fix 12, 2026-10-15)

The research's fix 12: a character reached the writer in detail only when their exact name or alias was on the scene
card, in the beats, notes or direction, or at the previous scene's end. Someone named only in the scene so far, or by a
nickname, a title or "her brother", got one line or nothing (the scene so far was searched for items only).

- **The scene so far is read for people** (`ai/context.ts` `selectEntries`). A living character it names, by name,
  other name or what this scene's words call them, is brought in (`WHY.soFar`, "Named in the scene so far") and kept
  in `Selection.inSoFar`: in "Also relevant" in full, as block 5 sends those on the card (`formatProfile` whole, how
  they look now, everything that has happened to them), marked "named in the scene so far" (the words may have them
  there or only thought of, so the mark says no more than that). The dead are left to the scene card's list of who is
  dead by now (`deadBy`). Someone so named stays among block 11's ties: how they stand with those on the card is what
  the writer needs of them, and block 11 comes before what a step brings in. The block's forms: that, then everyone as
  before (who they are and how they look), then a line each; with no one in the scene so far the first two are the
  same and only one is kept, so other briefings are unchanged. Only "Also relevant" changes from step to step, as it
  already did; every block before it in `SEND_ORDER` stays word for word the same (the cache, tested).
- **How a name is read** (`shared/names.ts` `findName`, `namedInProse`): one rule for the briefing (`ai/context.ts`
  `mentions`, so the card, beats, notes, direction and the previous scene's end too), the keeper (`keeper/text.ts`
  `mentionAt`), what must stay true (`memory/items.ts` `nameIn`) and the page (`nameMatch.ts`, with the same
  `namePattern` and `NAME_AFTER`). A whole word or phrase, so "Mara's" names Mara and "Marabel" doesn't, nor a word
  joined on by a hyphen ("Will" isn't in "Will-o’-the-wisp", "Mara" isn't in "Mara-Jane"; "Jean-Luc" as a name is
  fine); any apostrophe for any ("O'Brien" is "O’Brien", as the keeper's quotes fold them); a dot must be there ("Dr.
  Hale", not "Dr Hale"); a single capitalised name only capitalised ("will" and "hope" are words); a phrase or
  lower-case name whatever its case. `askingAt`: "Will" or "May" opening a sentence as the verb is the word, not the
  name: with "you", "the", "not" and the like after it, or a verb as it comes after "will" (`BARE_VERBS`: "Will be
  there.", "May be the last time."), with "never", "still" and the like between or not ("Will never forget it.").
  Only verbs whose past is another word count, so "Will let her go" still names him; and not "can", "could", "would"
  or "must", which follow a name ("Will could see the shore"). A name at the start of a sentence otherwise counts
  ("Hope smiled"): "Hope was all she had" can't be told apart from it. Parts of a name ("Mara" for "Mara Venn") are not
  guessed at: the keeper offers them (below), so Adam decides. Known limit: scripts without capitals or spaces between
  words (Arabic, Chinese, Japanese) aren't read this way.
- **What the words call someone** (`keeper/names.ts`, `db/called.ts`). The memory keeper's reading reply gains a
  "name" item (`{"type": "name", "entry": "E1", "name": "the Captain", "quote": "..."}`; one rule line, no new call;
  with the wording tightened, the prompt is 5,875 characters, under the 6,000 the tests hold it to). `apply.ts`
  `noteName` keeps it only for a character who exists here and words that are in the scene (`cleanCalled`: no pronoun,
  no "the" alone, no single lower-case word, 60 characters and six words at most); `settleNames` drops words the reply
  gives for two people, words that are already anyone's name or alias, and words Adam ignored or dismissed in this
  scene before (their note is undone), so that sticks however often the scene is read again. What is left is kept
  for the scene in meta (`called:<scene id>`, the newest `MOST_CALLED` (30); the same words for someone else replace
  the old; words no longer in the scene's text go at its next read, `forgetCalledNotIn`; emptied with the scene from
  the Trash, `db/trash.ts`). `ai/gather.ts` gives the briefing this scene's (`ContextInput.called.here`: for its card,
  beats, notes, direction and the scene so far) and the previous scene's (`called.previous`: for its end, block 3's
  tail), and `getSceneNames` gives the page the scene's (`SceneNames.called`). The run reports the characters as
  changed, so the page underlines them at once.
- **Every one has a note; only a nickname or a title is offered** (the judgement call). Each binding gets one quiet note
  in What changed, once per scene, character and words; Dismiss takes it back in that scene for good (`undo.ts`). A
  nickname or a title (`aliasWorthy`: a capitalised word besides "the" and the like that isn't a family word: "the
  Captain", "Red", "Aunt Jo"), the first time it is found for that character, has the offer as its note, "Also called
  “the Captain” here" (op `note`, key `alias:<entry>:<words>`, `alias`), and a row in Worth a look under "Other names
  the story uses" (`checkQueue.ts`, group `alias`, fact `{ kind: 'alias', logId }`; counted in the badge; not shown
  while anyone goes by it). Anything else ("her brother", "Mother", "the old woman", or a name offered before) has a
  plain note, "Called “her brother” here" (key `called:<scene>:<entry>:<words>`, `called`). **Add name** (Keep) adds it
  to the character's aliases as Adam's own, and is refused in plain words when someone else goes by it by then
  ("“the Boss” is already Ana’s name, so it wasn’t added to Mara. …"). **Ignore** (Remove; a plain toast, nothing is
  deleted) means two things, as its button says: the name is never offered for that character again anywhere in the
  story, and it stops counting as them in the scene it was found in, for good. Other scenes keep their own reading,
  as they may mean someone else by "the Boss". Dismiss on the offer's note in What changed does the same. Both have
  Undo, and Add all is Keep all. "her brother" and the like depend on who is speaking or who "her" is, so nothing can
  promise they mean the same person in another scene: they are kept for their own scene (its end included, as the next
  scene's briefing reads it) and never offered as another name.
- **The page** already underlined known names (milestone 3: a faint dotted `aw-name` underline, theme tokens, no room
  taken, rebuilt only in the blocks a keystroke touches; Classic's screenshots have always shown it). It now underlines
  what the scene calls someone too, by the rule above (`nameMatch.ts`; the 300-word paragraph a keystroke rescans
  still takes under 0.1 ms with 500 entries). The hover card says how the words name them ("Character · “her
  brother” in this scene"). The sample world's scenes have no keeper reads, so Classic's screenshots are unchanged; no
  View setting was needed.

## Long story memory: keeping track of who knows what (fix 9, 2026-10-15)

The research's fix 9: characters acting on what they couldn't know yet is a named error type in story benchmarks
(ConStory-Bench's "knowledge contradictions") and the most asked-for missing feature in other writing tools. The memory
keeper already recorded what characters know, with quotes, but the writer was told the whole of it only for the point
of view, up to three secrets among those on the card, and nothing said since when or how anyone knew. Now there is a
ledger, built from what the memory already keeps (no new store, no migration, no new AI call).

- **The ledger** (`memory/ledger.ts`, worked out in `memory/state.ts` `stateAt` with everything else true at a point,
  so it is scene-scoped as every fact is: a redraft or a check of an earlier scene sees only what was known by then).
  Each knower of a fact has `FactState.since[entryId]` (`Learned`: where on the line, the place in plain words, the
  scene, and how): their first learning of it since they last forgot it (a forgetting, an end or a full description
  clears it). How comes from the knowledge change: its own `how` and `from` (`KnowledgePayload`, JSON in
  `changes.payload_json`), else something said (the speaker "said it", the rest heard it from the speaker), else an
  event seen ("saw it") (`learnedHow`). Something believed that isn't true is a knowledge change with `wrong`: it goes
  to `MemoryState.beliefs` / `SceneMemory.beliefs` (`BeliefState`), never into `facts`, so it is never a secret kept from
  anyone; for one character and fact the latest learning says whether they know it or believe it wrongly. One fact id is
  only ever one of the two, known or believed wrongly (decided in review: a belief is a fact that isn't true, so no one
  can know it): the keeper, verdicts and Adam's own changes keep it so (below). `Ledger`
  indexes a point so a question is one look-up: `couldKnow(character, fact)` (knows it since when and how, believes it
  wrongly, or neither), `knows`, `believes`, `whoKnows`; `ledgerForScene(db, sceneId)` (`memory/scene.ts`) builds it as
  a scene begins, for the rule-based checks (fix 8, below). Plain words for since and how are shared by the briefing, the
  checks and the page (`shared/knowWords.ts`: "since Ch 2, Sc 3; heard it from Ash", "from the start").
- **The memory keeper** (`keeper/prompts.ts`): the "knows" item gains `"how": "saw|told|overheard|read|guessed"`,
  `"from"` and `"wrong"`, one rule line ("Knows: give how and, if told or overheard, from whom; wrong: true if what
  they believe isn't true"), and "end" also ends a wrong belief they see through. Tighter wording elsewhere keeps the
  prompt at 5,942 characters, under the 6,000 the tests hold it to. `keeper/apply.ts` keeps `how` (`knowHow` reads the
  model's first word: "told by Ash" is told), `from` (a character other than themselves) and `wrong`. A K the reply
  names says which kind it is, whatever the reply's own "wrong" (`Ids.wrong` marks a belief's K lines): a "knows" naming a
  belief's K without "wrong" means they have learned the truth, so the belief ends there on its own id, as an "end"
  item ends it (`seeThrough`: with Undo, Adam's own kept with a note; one come to in that same scene is forgotten
  there); a "forgets" naming it forgets the belief; a known K stays known. The same words as something the character
  already believes wrongly, before the scene or in it, are that belief again (`beliefIn`); other words match only facts
  of the same kind (`listFacts` says which are beliefs). A verdict on a fact whose words changed never flips `wrong`;
  Adam's own change taking a fact id used for the other kind gets an id of its own (`db/memory.ts` `factIsBelief`,
  `cleanChangeInput`). The reading request lists beliefs first among the K lines, "wrongly believed by E2", with a seat of
  their own (`BELIEF_LINES` 12, `BELIEF_TOKENS` 400) ahead of the facts' `FACT_LINES` (40), so in a long series a belief
  can always be ended; should a fact id ever turn up as both, each still gets its own K (`Ids.knownFact`). `endTarget`
  finds them. What changed says "Wrongly believes …", and "No longer believes …".
- **The writer's briefing** (`ai/whoKnows.ts`, block `knowledge`, "Who knows what", priority 6). Everyone in the scene
  (`ai/context.ts` `sceneKnowers`: the point of view, the others on the card, those where things stand puts there, and
  the living characters the scene so far names, fix 12), point of view first, each with what they don't know yet that
  someone else here knows ("Doesn't know yet: … (Tobin knows it, since Ch 2, Sc 1; saw it)"), what they believe wrongly
  ("Wrongly believes: … It isn't true.") and what they know with since when and how ("Knows: …"; the point of view's
  only for what they learned during the story, as block 4 lists all they know). What matters most goes in first:
  every secret kept from someone here, then false beliefs, then what they know, the most lately learned first within
  each, except that each believer's latest belief keeps its seat before any secret (review: four people and three
  secrets filled the ten lines); a secret told as someone's "doesn't know yet" isn't told again as another's "knows".
  A crowd who know something is named only so far ("Mara, Ash, Tobin and 2 more know it", `namesUpTo`). The same rules as before
  for secrets (`cleanKnows`, only backed facts, never kept from someone it is about; `namesPerson` no longer takes "The"
  of "The Duke" for a first name). Caps (`LEDGER_GAPS` 3 and `LEDGER_WRONG` 2 a person, `LEDGER_LINES` 10, `LEDGER_PEOPLE`
  6) grow with `memoryScale`, at most twice; what they know (`LEDGER_KNOWS` 4, `LEDGER_POV_KNOWS` 2) comes only with more
  room than the smallest model's, growing to those at twice it, so on a 16,000-token model the block is what block 6
  used to give and doesn't push out the setting (the fitting shortens priority 7 before 6). Short form: only what they
  don't know or believe wrongly, without since when (`LEDGER_SHORT_LINES` 6). Block 6 is now "Relationships" alone.
  Who is in the scene can change from step to step (the stage, the scene so far), so the block is sent late
  (`SEND_ORDER`: after what a step brings in, before the scene card); every block before it stays word for word the
  same when someone new is named (tested). What must stay true keeps its key kind for secrets (`gap`, no second list):
  `MustInput.knowers` works them out among the same people, the block's own capped list (`ledgerPeople`, so both name
  the same people, and "Kept from" names at most `MUST_NAMES` (3) before "and 4 more"); what someone here believes
  wrongly is a key kind of its own after injuries (`belief`, `MUST_BELIEFS` (2) lines, never taken by the secrets: "Tobin
  wrongly believes: … (it isn't true). Tobin takes it as true here unless the scene card says otherwise"); AI edits and
  Continue pass the beliefs too.
- **The checks** (`checks/context.ts`): who knows what is the ledger as the scene begins, as before the memory as of
  its start, now with each knower's since when and how (`knowsLine`: "Known by: Tobin (since Book 1, Ch 3, Sc 1)") and
  "What some of them believe that isn't true" (`beliefLines`, `MOST_BELIEFS` 12). Check and repair's K lines are the
  same, beliefs among them (`repair/prompts.ts` `codexLines`, 8 at most). The knowledge check's instructions add a
  character "who acts on the truth of something the memory says they believe wrongly, with nothing showing them learn
  it". No new call.
- **The page**: an entry's view as of a scene (`AsOfView.tsx`, both looks) has "What they know" (it was "Knows at this
  point"; its empty state, "Nothing noted yet.", and list are as they were), in the order they were learned as "What has
  happened so far" is, each with since when and how in a quiet line beside it ("since Book 1, Ch 2, Sc 3 · heard it from
  Ash", `asOfViewLogic.ts` `asOfKnowing`), and "Believes wrongly" when there is any. The New look's card has "What they
  know" under "Where things stand", as of the scene Adam is in, the most lately learned first (`asOfKnowing`'s
  `newestFirst`; `Dossier.tsx` `KnowingRows`, six at most, "and 3 more,
  seen as of any scene"). "Changes over time" says how under a learning ("Heard it from Ash") and "Believes wrongly: …"
  for a belief (`memoryLogic.ts` `describeChange`); removing either is the usual remove with Undo. "Knows at the start"
  offers to add what was typed "as something {name} believes wrongly", and marks such a row. Classic's screens look as
  they did until a world has such knowledge (the sample world's is unchanged).

## Long story memory: a promises ledger with due dates (fix 10, 2026-10-15)

The research's fix 10: setups (a planted clue, a promise, a threat, a mystery) get quietly dropped in long books
(ConStory-Bench's "abandoned plot elements"). The memory already kept plot threads (open, clue, developing, resolved:
"The AI manages plot threads") and B4 knew where each was last touched, but the writer got at most 6 open threads with
no sense of timing, and nothing said when one was overdue. Now there is a ledger, built on the threads as they are (no
parallel store) and no new AI call.

- **Where each stands** (`memory/promises.ts` `promiseLedger`, pure). Open (set up, nothing since), advanced (touched
  again in a scene after the thread change that first opened it: a clue, a step on, its words there; `threadTouches`
  now gives `opened`; a story's start-of-story change has no scene, so it isn't a step on), paid off (resolved, as
  before), or dropped (Adam's call). The set-up scene, and the last scene after it that moved it on. Status changes come from what the memory keeper already reads (`open`, `clue`,
  `developing`, `close`), so its reading prompt is unchanged (5,942 characters; the 58 to spare are left for later
  fixes); dropped is never read from the text, only set by Adam.
- **When it is due** (`ThreadDue`). By the end of a chapter Adam chose ("Pay off by"), else the chapter of the first
  scene whose card has it under "Pays off" (at or after its set-up; the scene card is the plan the app already has).
  Scenes are read in the walk's order (`line.steps`: a side story's where it is added in its host, never after the
  host's whole story), then the story's own scenes past the point in story order.
  Told as of a point: `overdue` (the walk has passed that chapter's end and it is still open), `now` (the chapter being
  written; a card's plan later in this chapter is still `later`, as that scene's card will say "this scene pays it
  off"), or `later`. For the writer the point is the scene being drafted; for the board and Worth a look, the story's
  latest scene with words. A Pay off by chapter in Recently deleted is read as none of Adam's (the cards' plan holds,
  and a restore brings it back); one gone for good (`purgeTrash`, the outline helper's Undo, an imported story taking
  the empty first one's place) is cleared from every plan, with what Keep remembered for it
  (`db/threadPlans.ts` `clearGoneChapters`). The cards' plan is kept beside Adam's (`PromiseRow.cardDue`,
  `BoardThread.cardDue`), so "Pay off by" offers "As the cards plan (Ch 4, Sc 2)" and clearing the chapter says
  "will be paid off where the cards plan it: Ch 4, Sc 2".
- **Adam's plan, in meta** (`db/threadPlans.ts`, `thread_plan:<thread id>`, JSON of `ThreadPlan`: `payBy`, `dropped`,
  `kept`; no row for an empty plan; no migration). It travels with the world; `purgeTrash` drops the rows of threads
  gone for good (one in Recently deleted keeps its row). `planThread` (`keeper/checkQueue.ts`; `AppApi.planThread`,
  `ipc/worldViews.ts`, which emits `memory:changed`) sets the pay-off chapter or dropped, refused in plain words for a
  thread or chapter that is gone, and returns a `MemoryCheckUndo` (`undoMemoryCheck` puts the plan back).
- **The scene memory** (`memory/scene.ts` `withLedger`): each `ThreadState` gains `standing`, `setUpSceneId`,
  `advancedSceneId`/`advancedWhere` and `due`, as the scene is written.
- **The writer's briefing** (`ai/openThreads.ts`). Dropped threads are left out. Order: due by the end of this chapter
  or overdue first (overdue before due now); then those that involve the scene (the card's words name them, as before,
  or the thread's name, promise, clues, payoff or summary name the point of view, someone else on the card, the
  location, or an item those people hold as the scene begins: `holdingsOf`, `namesOf`, `nameIn`, the one name rule of
  fix 12); then the longest untouched (`quiet`, else the oldest last note); ties by when the thread was made, then its
  id, never by its last edit, so a write to a thread between two steps of a scene doesn't reorder the block (the
  cache). B4's two most quiet still always make the
  list. The cap grows with room: `openThreadsMost(memoryScale)` 6 to 22 (`OPEN_THREADS_MOST` × the scale, at most
  `MOST_SCALE`), short `openThreadsShort` 3 to 6; Continue keeps 4. Each line says when it is due (`dueWords`): "Pay
  this off by the end of this chapter.", "Overdue: it was to be paid off by the end of Ch 4. Pay it off soon, where it
  fits.", "to be paid off by the end of Ch 7, not yet", "its pay-off is planned for Ch 7, Sc 2, not yet". Only the
  card, Adam's plans and the memory before the scene decide it, never what a step adds (the scene so far, the
  direction), so the block stays in the steady part of `SEND_ORDER` and reads the same at every step (tested).
- **Worth a look** (`memory/promises.ts` `threadWarnings`; `memory/scene.ts` `overdueThreads`; `keeper/checkQueue.ts`
  group `promise`, "Plot threads left waiting"). An open or advanced thread (never dropped, paid off or only planned)
  that is overdue, unless Adam kept it for that due chapter; or untouched for a long stretch. A thread with any due date
  (Adam's Pay off by, or a scene card's plan, even one still to come) is never asked about as untouched: it is planned,
  and the overdue warning covers it once its chapter is over. One with no due date at all is asked about when untouched
  for `longQuiet(written)`: a quarter of the story's scenes with words and never fewer than `LONG_QUIET_MIN` (12, twice the
  `QUIET_SCENES` after which the writer is reminded, so Adam is asked only once the reminders haven't brought it back):
  12 up to 48 scenes, 25 at 100, 50 at 200 (`writtenUpTo`: only the story's scenes with words the line reaches, so as
  of an earlier scene, writing after it never changes the count). Like the writer's reminder, only a thread last touched
  in that story, or before any story began (a baseline change), which counts as this story's; one carried from an
  earlier book isn't asked about until the story touches it. Every story with words is looked at, each
  thread listed once (`promiseChecks`, kept while `changesMade` doesn't move). A row: "Still open, and due by the end of
  Ch 1" (or "…though its scene card planned the pay-off for Ch 4, Sc 2"), "Untouched for 14 scenes", and "Last touched
  in …". **Pay off later** (a menu of the chapters from the one being written to the story's end, `MemoryCheckItem.later`)
  calls `planThread`; **Keep** records `kept` (an overdue one: not asked again for that due chapter; a quiet one: not
  until something touches it, or another long stretch goes by); **Mark as dropped** is Remove; **Open** goes to the
  thread; Show me opens the scene that last touched it. Each has Undo, and the rows count in the badge.
- **`overdueThreads(db, storyId, asOfSceneId?)`** gives the same as a scene begins (told against its chapter) or as the
  story stands now, with names and where each was last touched (the rule-based checks of fix 8, below, leave these to Worth
  a look, so nothing is asked twice). What the story
  says is as of that point; Adam's plans (Pay off by, dropped, what he kept) and the cards' planned pay-offs are read as
  they stand now: they are his current plan, not facts of the story, so a check of an earlier scene uses today's plan.
- **The board** (`worldViews/threads.ts`, as of the story's latest scene with words). `BoardThread` gains `standing`,
  `advanced` (a place), `due` (none once resolved or dropped) and `warn`; a dropped thread has column `dropped`, shown
  only when there is one ("You decided not to pay these off"); `ThreadsBoard.chapters` is the story's chapters for the
  picker (`chapterChoice`: "Ch 6 · The Ferry", or "Ch 6" for a default title). In the panels (`ThreadsBoard.tsx`), the
  **Ledger** has Status (Open, Advanced, Resolved, Dropped, Planned; "Overdue" or "Untouched for a long stretch" as a
  calm amber badge; Mark as dropped or Pick up again), Set up in, Last moved on, **Pay off by** (the `Select`, with "No
  chapter" or "As the cards plan (Ch 4, Sc 2)" as none) and Quiet for. A Board card shows its due date only when Adam
  chose the chapter or it is due or overdue by a card's plan (`DueNote`), and a dropped one has Pick up again, so
  Classic's screenshots of the sample world are unchanged. On the desk (`DeskThreads.tsx`) each card has its status,
  "Moved on", "Pay off by" and the amber note, with Mark as dropped or Pick up again (`planActions.ts`, toasts with Undo
  in `planWords.ts`). The world gallery, the story home, the story board's legend and the series bible say "Dropped".

## Long story memory: a story calendar (fix 11, 2026-10-16)

The research's fix 11: time slips are among the commonest errors in ConStory-Bench and the hardest questions in NovelQA,
and models are bad at sums they must make for themselves ("three weeks since the siege", a character's age). The scene
card had a When, the timeline read it to order scenes, the stage tracker compared the raw words to decide what carries,
and fix 5's `timeSince` put both cards' When side by side; nothing did the sums. Now the app keeps a story calendar,
worked out from the scene cards (no store, no migration, no new AI call; the memory keeper's prompt is unchanged, its 58
characters to spare left for later fixes).

- **Each scene's date** (`memory/calendar.ts`, pure; `StoryDate`). Read from Adam's When as the timeline reads it
  (`worldViews/when.ts` `parseWhen`; `whenStates` gives `placeWhens`' reading of each text, with `WhenParts.time`, the
  time-of-day words, and `yearWord` kept): absolute dates ("12 March 1820", "Day 3, evening", "Year 2 of the reign,
  spring"), times of day, and steps from the dated scene before ("the next morning", "three weeks later", "that night").
  Scenes are read in the line's walk order (`memory/storyCalendar.ts` `calendarItems`, the timeline's own rules: a side
  story leans on its host where it starts, a book that follows on on the book before unless a time gap lies between,
  and a book that follows on counts its days afresh), as the promises ledger reads them. A scene with no When takes only
  a time of day from the memory's reading of its own words (`continuity/tracker.ts` `timeCues`: where things stand at
  its end, the time's words from that scene and the reading still matching its words; `withCues`), never a day. Nothing
  else is guessed: `reading` says how a When was read (`empty`, `read`, `unclear`, `unanchored`: a step with no dated
  day before it, `vague`: "days later"). A day its month doesn't have is no date and never rolls into the next month
  ("31 April 1820", "29 February 1821", or "29 February" after "1 January 1821": `monthLength`, leap-aware when the year
  is known; with no year 29 February may be in a leap year and stays itself). Years before Christ count through zero (1
  BC is year 0: `bc`), so "44 BC" to "AD 14" is 57 years, and a bare year 0 is no year (a world's own "Year 0" is).
  "Half a year later" is six months and "a year and a half later" eighteen; "half a day later" is later the same day;
  a half that can't be placed ("half a week later") is no date. After a step of months ("six months later") the day is
  only about right but the month is known ("December 1820").
- **Flashbacks** (review, 2026-10-16). The present carries on from the present: a When that doesn't go back leans on the
  last dated scene before it that isn't a flashback (`worldViews/when.ts` `placeWhens`, `goesBack`), so "12 March
  1820", "Flashback: 2 February 1810", "The next morning" is 13 March 1820, never 3 February 1810; a flashback leans on
  the dated scene before it, a flashback or not ("Flashback: the next day" after one). The timeline places them the same
  way.
- **Sums** (`elapsedBetween`, `elapsedWords`). A date that names its day sits on an axis with a day number (`axis`,
  `n`): real months with a year are one axis for every story (`daysFromCivil`: real month lengths and leap years, so "30
  January 1820" and "five days later" is 4 February), "Day 41" counts an axis per year and calendar, a month the app
  doesn't know ("the 3rd of Frostmoon") an axis of its own, so a world's own calendar still gets its sums from counted
  or stepped days. Dates on one axis are exactly so many days apart ("3 weeks and 2 days", "about 4 months (121 days)");
  a month or season and a year are about so many months apart, years alone about so many years (never for counted days,
  which may run across years); otherwise it isn't known. `day` is the day since the story began: Adam's own count where
  he counts days with a bare "Day 41" (day 41), else days since the first dated day of its calendar that isn't a
  flashback ("day 21 of the story"; no day count for a scene read before that day, such as a story opening on a
  flashback). Decided in review: "Day N" with a year or season ("Day 300, Year 1", "Day 3 of spring") is a day of that
  year or season: within it the sums work ("Day 300" to "Day 310, Year 1" is 10 days) and its day since the story began
  counts from the first day like any date; across years how far apart isn't known (no year length is assumed). A bare
  "Day N" runs on as the story's own count. `sameDay` and `sameMoment` (the same day and time of day) say null where
  they can't tell. A time of day has a span (`WhenParts.span`, `SPANS`: "night" is 20:00 to 03:00, "morning" 05:00 to
  12:00; a clock time is exact), and `timeOrder` orders two times the same day only when their spans don't meet: "night"
  after "11pm" may be the same hour, so it is "the same day as the scene before", never "earlier the same day".
- **Going back** (`goingBack`, `goesBack`). A scene whose date comes before the last dated scene before it in its own
  story that isn't a flashback (a side story read alongside is never compared; "5 March 1820" after "12 March 1820" and
  a flashback is held to 12 March), where that is certain, and whose When doesn't say so: a When saying it goes back on
  purpose starts "Flashback" or "Earlier" (the app had no other mark), or steps back itself ("three days earlier", "the
  night before"). A When that leans on the scenes before is never counted ("March" after "December, Year 2" may be the
  next year), nor an earlier time the same day unless both cards say the time and their spans don't meet (`timeOrder`:
  "night" after "11pm" isn't), nor a time in the small hours after a night scene (`BACK_FROM_MINUTE`).
- **Ages** (`readAge`, `ageFrom`, `memory/storyCalendar.ts` `ageHere`). From a character's "Age or birth date" as of the
  scene: a birth date or year ("born 12 March 1790", "b. 1790": exact with both full dates, else "29 or 30"), an age at a
  date ("17 in 1815", "34 at the start of the story"), or a bare age as of the scene the memory set it in
  (`changedWhere.age`, matched to a scene by its place in words), the story's start (its first day that isn't a
  flashback) for the starting setup. From an age at a real date, whole years by month and day as a birthday counts them
  (34 on 1 March 1820 is 36 or 37 on 28 February 1823, 37 on 1 March, 37 or 38 on 2 March; review); from a month or
  season, months / 12, about; from counted days, years of the Common Era's length. A guess
  ("mid-thirties", "about 40", "34 or 35") is left alone. Years told with a word ("Year 312") are compared only with each
  other.
- **For the rule-based checks** (fix 8, below; `memory/storyCalendar.ts`): `storyCalendar(db, storyId)`, `storyDateAt(db,
  sceneId)`, `elapsedBetweenScenes(db, a, b)`, `ageAt(db, characterId, sceneId)` and `scenesGoingBack(db, storyId)`.
- **Kept until a date can move** (review: the stage tracker writes `meta` as it reads, and a cache on every write rebuilt
  the calendar for every scene `stands()` looked at). `calendarVersion` counts only writes a date rests on: temp
  triggers (`aiwrite_calendar_*`, made on first use on the connection, never inside another's transaction, as search's
  are; nothing in the world file) on a scene's card, chapter, place or deletion, chapters, stories and answers; where they
  can't be made, every write counts (`changesMade`). A scene's story is one look-up (`Read.storyOf`), going back is
  worked out once per calendar (`backOf`), and the scene card's `getSceneDate` works out that one scene's view
  (`sceneDateView`, kept with the calendar; where things stand is read only for a scene with no When). Tested with 500
  scenes: built once, then the same calendar for each scene with `meta` written between.
- **The writer's briefing** (`ai/storyDate.ts`; `ContextInput.calendar`, `ai/gather.ts` `calendarFor` →
  `sceneCalendar`). The scene card (priority 2, late in `SEND_ORDER`) says, under When, "Story date: Day 41, evening (3
  weeks since the start of Ch 4: The Siege; 2 days since the scene before)": earlier days to count from are dated events
  that exist here, then the start of each chapter of the story so far, the latest first (`LANDMARKS_MOST` 4 worked out,
  `storyDateMarks(memoryScale)` 1 to 3 told), never the scene before twice; a flashback says "8 days before the scene
  before, a flashback". Then "Ages here: Mara 30 (born 12 March 1790); Tobin 37 or 38 (34 at the story's start)" for those
  on the card whose age the sums change (a birth date, or a year or more after an age at a date; `storyDateAges` 3 to 6),
  and the reminder to make the time that has passed fit. The story date is left out when it would only repeat the When
  ("Day 8" with no sums). Without a calendar (a test, or the world couldn't be read) the two cards' When alone are placed
  (`datesOf`). This replaces `timeSincePrevious` ("The previous scene was …"), which is said only when this scene's date
  isn't known. What must stay true's `elapsed` key (`timeSince`, now `elapsedNote`) comes from the same sums ("Time: 3
  weeks since the scene before (Day 4, morning); this scene is Day 25"), so there is one source of truth for elapsed time;
  where nothing can be placed it keeps both cards' words, as before. Only the cards decide it, never what a step adds, so
  every block before the scene card reads the same with or without it (tested).
- **What carries between scenes** (the carry rules under "What must stay true" and "A new time starts fresh"). `stageReach`
  reads the same day on the calendar ("That night" after "Day 3, dusk" is the same day; "The next day" twice is not;
  "Day 4, noon" after "The next morning" that was Day 4 is), and where it can't tell, both cards' "Day N" as before.
  The time of day, light and weather carry only at the same moment (`sameMoment`: the same day and time of day,
  "Later that evening" after "Day 3, evening"), else, where the calendar can't tell, both cards giving the same When as
  before: in the stage tracker (`startFrom`, `sameTime`) and for the writer (`timeCarries`, `stageScope`; AI edits pass the
  calendar too). A scene whose start this changes (the same words on two days, or one moment told in other words) is read
  again by the stage tracker once, as for any When changed on a card.
- **On the screen** (`AppApi.getSceneDate`, `SceneDateView`; `BoardSceneCard.date`; `features/inspector/sceneDate.ts`
  `useSceneDate`). The scene card (both looks) says under When, in the hint's own line, how it was read when that adds
  to the words ("Reads as Day 4 · morning.", "Reads as 1 April 1820 · day 21 of the story · dusk."), or gently what it
  couldn't tell ("AI Write can’t read a date in this.", "Nothing dated before this to count on from.", "Doesn’t say how
  many days, so the count stops.", "No date yet. By the scene’s end it’s evening."), or that it goes back without saying
  so ("Earlier than the scene before. A flashback?"); otherwise the usual hint. Each note is short and kept to one line
  (cut short if the panel is narrow), so nothing below moves; `detail` says it in full on hover and to a screen reader
  ("This comes before the scene before it (Day 6). If it’s a flashback, start the When with “Flashback” and AI Write
  will know."). The story board's cards and the desk's page head put the worked-out day beside a When that leans on the
  scenes before ("The next morning (Day 4)") in the line they already have (the page head reads it with the card, so
  the line is drawn once). A When such as "Day 1, dusk" reads as itself, so the sample world's scenes keep the usual
  hint and Classic's screenshots are unchanged; no View setting was needed.

## Long story memory: summaries rebuilt from the record (fix 15, 2026-10-16)

The research's fix 15: chapter, story and series summaries were summaries of summaries (a chapter's from its scenes', a
story's from its chapters'), and a small edit patched a scene's old summary from the changed paragraphs (World Memory
Overhaul A3), so summaries were built on summaries. Every round of re-summarising adds errors (FlawedFictions: the
plot-hole rate in LLM summaries rose by about half), while summaries built in layers stay more coherent (BooookScore).
So hard facts now come from the story record, summaries are signposts, and each is tied to what it is made from
(the Qvink and MemoryBooks pattern). No migration, and no new AI call: the keeper's summary calls get new inputs.

- **A scene's summary is never patched** (`keeper/summaries.ts` `writeSceneSummary`; the `scene-patch` ask, its prompt
  and `patchable` are gone). When it is due (as before: `sceneChange.ts` `summaryDue`), it is first marked out of date
  (`engine.ts` `markRebuilding`: `stale`, so the screen says so, and `memory:changed`), then written again from the
  scene's words (a long scene in parts, then joined, as before). It costs a whole scene's words each time where the
  patch sent only the changed paragraphs; the patch was what built summaries on summaries. Fix 3's "By the end, …"
  opening is as it was. A summary marked out of date is always due (`summaryDue` looks at `stale` before the words, so
  the mark is always cleared by a summary written again); one no longer needed (too short now, or Adam undid the one
  made from these words) just loses its mark (`sceneSummaryDue`).
- **A draft waits no longer than it waits for the memory at all** (review, 2026-10-16). Each summary a draft can't do
  without is now a call on a whole scene, so `summariesFirst` races its wait against what is left of the draft's own
  limit (`beforeDraft`'s `limitMs`, passed through the before-draft hook: `ai/gather.ts` `BeforeDraft`, `CATCH_UP_LIMIT_MS`
  60 s; "Write the whole chapter" `DRAFT_CATCH_UP_MS` 180 s; `SUMMARY_WAIT_MS` 60 s when none is given), and the summary
  goes on being written in the background.
- **End-of-chapter snapshots** (`memory/chapterRecord.ts` `chapterSnapshot`, the snapshot and its words in
  `memory/snapshot.ts`; no AI). As of the chapter's last scene with words, from what the memory keeps (as the writer is
  given it, `writerData`): what changed in its scenes (the memory's notes, and ties between characters made or ended
  there), who learned what in it and still knows it at its end, with how (`FactState.since`, fix 9; `how` "said" for the
  speaker left out), and who came to believe something that isn't true (`beliefs`), grouped by fact and scene; the plot
  threads it set up, moved on or paid off (thread changes and notes on threads in its scenes, set up where
  `ThreadState.setUp` is its scene; fix 10), all from its scenes with words only (a change pinned to a scene still to be
  written is what that scene should bring about, not something that has happened); when it runs (`span`, "Day 3, dusk to Day 5, morning (2 days)", and `days`,
  "Day 3 to Day 5", from the story calendar, flashbacks left out: `spanOf`, fix 11); and how each character in it (on its
  cards, in what changed or was learned) stands at its end: dead (`deathOf`), last at the place of the last scene whose
  card has them, looks a change set during the story (marks, build, face, hair, eyes, skin), what they now hold
  (`holdingsOf`), what they believe wrongly; and the threads still open, those it touched first. `SNAPSHOT_MOST` caps
  each (changed 12, learned 6, threads 6, people 10, open 8). Entries are kept by id and named when it is said
  (`entryNames`, the timeline's `name`), so a rename never makes one out of date.
- **Kept in meta** (`db/snapshots.ts`, `chapter_snapshot:<chapter id>`, JSON of `{ key, snapshot }`, null for a chapter
  with no words; `purgeTrash` drops those of chapters gone for good, `dropSnapshotsOfGoneChapters`). The memory keeper
  keeps them in step (`keeper/snapshots.ts` `refreshSnapshots`): a snapshot is worked out again only when its key
  changes, made of its chapter's scenes and every scene before them in the story, as one running hash (the version the
  memory last read, the cards' people, place and day on the calendar, whether they have words, the changes pinned to
  them or ended in them: `sceneStamps`), every change outside the story's own scenes and every entry's kind and whether
  it is deleted (`outsideStamp`: the starting setup, the books before; a rename changes nothing). Every earlier scene,
  not just how the chapter before ended (review: someone off every Ch 1 card given a key there and relieved of it again
  changes nothing Ch 1's snapshot says, but Ch 2's), so an edit early on works out every later chapter again; with no
  AI, and their summaries aren't tied to it. A few queries a story, however long; `SNAPSHOTS_AT_A_TIME` (3) worked out at a time, between `setImmediate` pauses,
  while the keeper has nothing to read (`engine.ts` `snapshotsOnce`, before the roll-ups; on no model too), and
  straight away when a world opens, so a world from before this has them soon after. In the speed test's big world (10
  books of 200 scenes, 3,000 changes, 500 entries) a batch of three takes about 50 ms, and looking again with nothing
  changed about 15 ms (`tests/unit/memoryPerf.test.ts`).
- **Roll-ups from the level below and the record** (`keeper/summaries.ts` `storySources`, `seriesSources`,
  `nextRollUp`; `keeper/prompts.ts`). A chapter's ask is its scenes' summaries, then "What the story record says
  changed in this chapter:" (`changedLines`), within `RECORD_SHARE` (0.4) of its room, the summaries fitted into the
  rest (so trimming them no longer loses facts). Decided in review: not how things stand at its end (`endLines`), which
  an edit in an earlier chapter can change without its own chapter changing; that is the snapshot's, shown in the
  timeline with no AI. Nor when it runs: an early When edit re-dates every later chapter, so the days are the
  timeline's alone (`days`; `span` is kept in the snapshot, never told to a roll-up), and re-dating costs no AI calls. A story's is its chapters' summaries and how things stand at the end of its last summarised chapter; a
  series', its books' and the end of the last book. Each is told "The story record below is fact: where a summary says
  otherwise, follow the record", and a chapter "Point to the scene where each big change happens, as (scene 2)". None
  is ever made from an older summary of itself. Default titles aren't repeated ("Scene 2", not Scene 2 "Scene 2").
- **Tied to what it is made from** (`sourceHash`). A chapter's: `ch2|` the hash of what changed in it (`localPart`:
  the changes, what was learned, the threads; not the days), then each scene by id with the revision of its summary (`<scene id>~<hash>`); a story's `st2|` and a series' `se2|`:
  how things stand at the end (`endPart`), then each chapter or book the same way. A chapter isn't tied to how things
  stand at its end, so an edit early in a book never has every later chapter summarised again (one AI call each): their
  snapshots follow, and the writer reads those. A roll-up written before this (its hash is of its summaries alone) counts
  as up to date until those summaries change (`upToDate`, the old hash), so no world has every roll-up written again at
  once; one Adam undid counts as up to date (`suppressed`), before this version too (an undo then left no source and a
  suppression of its summaries' hash: review).
- **Out of date, not patched** (`markOutOfDate`). After the snapshots of a story are brought up to date, and after each
  roll-up is written, every roll-up the memory wrote whose sources changed since is marked `stale`, and the mark is
  cleared from one made from what is there now (`db/keeper.ts` `setTextSummaryStale`); Adam's own are never marked. So a
  change to one scene makes its summary, its chapter's, the story's and the series' out of date, and nothing else, until
  each is written again from its parts. Roll-ups still run only when the keeper has nothing to read (`rollUpOnce`).
- **Hand edits too** (review, 2026-10-16). A read marks its story, but Adam's own edits to the record never came
  through a read, so `Keeper.recordEdited` (through `keeper/index.ts` `recordEdited`, by the stories of the scenes or
  stories touched, else every story) is called by the handlers that change it: a change added, edited, removed or
  brought back (`ipc/memory.ts`), where a story sits, a summary Adam edits; an undo or answer in What changed and Keep,
  Remove or Undo in Worth a look (`ipc/keeper.ts`); a scene card saved, a scene deleted or moved, a chapter deleted or
  moved, a story deleted, an entry edited, deleted or brought back (`ipc/core.ts`). Every story marked (`storyChanged`)
  brings the stories whose line goes through it along (`storiesReading`: a book that follows on, a side story in it;
  never a prequel, which only starts before it), as their record rests on its.
- **No mark left with nothing to clear it** (review). When a world opens, every scene summary the memory wrote that is
  marked out of date (a world from before this, a write that didn't happen before it closed) goes on a backlog
  (`db/keeper.ts` `staleSceneSummaries`), written again one at a time when there is nothing else to do and
  `BACKLOG_GAP_MS` (20 s) apart, so there is never a burst of calls (`backlogOnce`; Try again refills it). A summary or
  roll-up that can't be written is tried again after `RETRY_FIRST_MS` (a minute), then two, four… (`failed`, one timer,
  `wakeIn`), `RETRY_TRIES` (6) times in all; then it is given up for the session and its mark cleared (a scene summary's
  `stale`; a roll-up isn't marked again: `markOutOfDate`'s `givenUp`), until Try again or its sources change. The
  writer is still told a scene summary is out of date (`summaryDue`).
- **The writer's timeline** (`ai/timeline.ts`, `memory/scene.ts` `withRecords`, one query). An older chapter's line (one
  rolled up a line each) says the days it runs ("- Ch 3, Day 3 to Day 5: …") and, in its full form, up to `RECORD_FACTS`
  (2) of what its 60 words may have lost: who learned what, then threads paid off and set up (`timelineFacts`), after its
  marks; a summary out of date says "(This summary is being brought up to date: the chapter has changed since it was
  written.)". The snapshot is the one kept, never worked out for a briefing, so an older line reads the same from one
  scene to the next until its chapter changes (tested). The prose story so far (`storySoFarText`: checks, Ask, the
  interview) is as it was.
- **On the screen** (`features/inspector/summaryText.ts`, both looks): a summary the memory wrote that is out of date
  says, in the note under it on the scene card and in the Context tab's story so far, "Being brought up to date with the
  chapter's latest changes." (scene's, story's, series'), in place of "Written by AI Write. It catches up with the
  chapter's latest changes by itself.": shorter, in the note's own line, so nothing moves. The sample world's summaries
  are up to date, so Classic's screenshots are unchanged.
- The import estimate counts the record in each roll-up (`importing/estimate.ts` `RECORD_TOKENS`).

## Long story memory: free rule-based checks (fix 8, 2026-10-16)

The research's fix 8: some slips need no AI to spot, only the app's own records, and broad AI critics over-flag
(FlawedFictions); Story Skills runs rules like these over its story files. A rule is instant and free, and as long as the
record is right it never raises a false alarm. The earlier fixes left what the rules need (fix 9's ledger, fix 10's
promises, fix 11's calendar); the stage tracker knows who holds what, and the memory who is dead. No store, no migration,
no new AI call; the memory keeper's prompt is unchanged (its 58 characters to spare are still spare).

- **The rules** (`checks/rules.ts`, pure, each over a `RuleScene`; `ruleFindings` runs them all, and one that fails says
  nothing while the rest still run). Each says nothing when the record is unsure: the memory is read as the writer is
  given it (a fact whose words were edited and not confirmed is left out, `writerData`; guesses dropped), a stage only
  while it still stands (`storedState(...).current`), a date only where the calendar can tell, and the same day only
  where the times of day certainly don't meet (`timeOrder` over their spans: "night" and "11pm" may be the same hour).
  Nothing is said of a dream, a ghost, a memory or a vision (`DREAMLIKE`: in the paragraph a line or a value is in, on
  the card, or in the When; `dreamlikeCard`, `paragraphOf`), nor of a flashback (the When says so, fix 11).
  - `dead`: someone the memory has dead as the scene begins (`deaths.ts` `deathRecord`, and only a death it is sure of,
    `surelyDied`: never "presumed dead", "reported drowned", "left for dead") speaks a line (below), is up and about on
    the stage (a value of theirs from this scene's words that is something they do: last did, holding, sees, touching,
    mood; never a body, a ghost, a vision or a memory, `NOT_ALIVE`), is the card's point of view, or is on the card's
    list of who is there. Once a person, from the strongest sign, worded plainly: "Tobin died in Ch 1, Sc 2, but speaks
    here." ("Mara died in Ch 18, Sc 2; she speaks here." when the card gives pronouns). A line or the stage is a must-fix;
    the card alone is worth a look. A scene the calendar certainly dates before the death's is exempt. Decided in review:
    with no dates, reading order decides, so an undated scene after the death is flagged; a dream, a ghost, a memory or a
    flashback (in the line's paragraph, the card or the When) always exempts. Being remembered or spoken of is never
    flagged.
  - `gone-item`: something the memory has destroyed or lost, to no one (its own latest note, "smashed against the
    rocks", "lost in the river", not "lost to Bryn at cards", nor "lost … and found" in one note; or a character's own
    "smashed the brass compass"), with nothing since bringing it back (found, mended, someone getting it, a holding tie),
    is held on the stage from this scene's words, and the memory says nothing of it in this scene: "The brass compass was
    destroyed in Ch 3, Sc 2, but Tobin holds it here." Not in a flashback, nor in a scene dated before it went.
  - `two-hands`: the same codex item in two living people's holding at the end of the scene, both from this scene's
    words, unless either says it is held together ("both", "between them", the other's name). Never a body's grip (someone
    the memory has dead, or the stage has as a body), nor a holding in a dream or a memory. An item is found by its
    names and main word (`memory/items.ts`), but never by a bare word in small letters another item has in its name
    (`itemWords`: "letter" for "The letter" would find "Bryn's letter"; "key" "the cellar key"). Continuity, worth a look.
  - `pov-elsewhere`: the card's point of view is on another scene's card or stage (`onStage`: a value from that scene's
    words) at this very clock time somewhere else: both cards give their own day and the same exact time ("9pm"; a time
    of day such as "evening" lasts hours, so two evenings are never the same moment here), neither leans on the scene
    before ("Later that evening") nor goes back nor is a dream, and their places are apart (neither is the other or
    inside it, `parentChain`). At most `MEANWHILE_MOST` (6) such scenes are looked at.
  - `pov-unnamed`: a scene of `POV_NAMED_WORDS` (500) words or more never names its point of view (by name, other name
    or what the scene calls them, the one name rule), unless the style guide says first or second person or the
    narration says "I", "me" or "my" `FIRST_PERSON_I` (3) times. Minor.
  - `time-back`: `scenesGoingBack` (fix 11) lists the scene: "This scene is dated Day 4, 2 days before the scene before
    it (Ch 3, Sc 1: Day 6). If it’s a flashback, start its When with “Flashback”." The card's note under When (fix 11)
    says it too; the finding is what Ignore can settle for good.
  - `age`: an age the memory set in this scene (a bare age: the scene's words, "Mara, now twenty,") or the card gives
    someone on it ("Mara, 35,", "Mara (35)", "Mara is 35", "a 35-year-old Mara", `ageGiven`; never "Mara was 5 when…") a
    year or more from what the memory works out as the scene begins (`ageHere`; a year more either way when that is only
    about right, `ageClashes`): "Mara is 35 here, but the memory says 34 at the story’s start, so 39 or 40 by now."
  - `knows-early`: someone tells a secret here (the memory keeper's "said it": a `said` secret whose speaker they are, no
    `how` of their own), others knew it as the scene began (who knows it rests on who was there, `backed`), they didn't
    (`Ledger.couldKnow`), nor believed it wrongly, nor learned it earlier in the scene, nor in a scene told later that the
    calendar dates before this one (`RuleScene.learnedIn`, `db/memory.ts` `knowledgeScenes`), and it isn't about them:
    "Tobin says “Mara is the heir” here, but nothing in the memory shows Tobin learning it first. Ash knows it." A promise
    or a threat starts with whoever makes it, so it is never asked about; nor is anything in a flashback or a memory.
- **Who speaks a line** (`checks/speakers.ts`, pure). Quotations paragraph by paragraph (`quoteSpans`: “…” and "…", and
  ‘…’ or '…' where the marks aren't apostrophes; one of the same kind quoted inside counts as part of it, “She said
  “never” to me,”; one left open runs to its paragraph's end). A line is someone's only in the plain ways: `“…,” said
  Tobin.`, `“…,” Tobin said.`, `Tobin said, “…”` (opening a sentence or a paragraph), with one of the speech verbs (`SAY`)
  straight after or before the name. Verbs that also mean something else (`LOOSE`: began, went on, continued, added,
  called, told and the like) give a line after the name only when a pause follows (`PAUSE_AFTER`): "“I’ll go.” Mara began
  to walk away" isn't hers; "Tobin said nothing" isn't either. A name inside a quotation is someone spoken of or to;
  "Tobin had said", "She remembered how Tobin said", "said Tobin's sister" are never his line; the line before, in the
  paragraph before, is someone else's. Names by the one name rule (fix 12), longest first with no overlaps
  (`namedPlaces`: "said Mara Venn" is Mara Venn, never Mara), and words two people go by name neither. "He said" isn't
  read (no guessing who "he" is): a known limit.
- **Reading a scene** (`checks/ruleChecks.ts` `ruleScene`): a check passes the memory it has already read (`RuleOptions`
  `memory`, its `SceneMemory`); otherwise one reading of what is true as the scene begins without the story so far,
  threads or the scenes before (`memory/scene.ts` `sceneStart`, which `sceneMemory` now builds on), with its `bringAbout`,
  the ledger, this scene's called words (`db/called.ts`), the stage (`continuity/tracker.ts` `storedState`), the story
  calendar and, only when this scene gives a clock time and a place, the other scenes' cards
  (`memory/storyCalendar.ts` `calendarCards`, kept as long as the calendar is: `calendarVersion`). Tested on a 500-scene
  story.
- **When they run**: after the memory keeper reads a scene, once where things stand at its end is brought up to date
  (`keeper/index.ts` `standLater` → `rulesAfterRead`, which runs them even while the memory waits for this month's
  spending limit: they cost nothing), then over the later scenes on the line that still have a rule's finding open
  (`laterRuleScenes`, nearest first, `LATER_MOST` (12)), as one may rest on the scene just read (a death taken back, a
  learning added); and in every check of a scene, right after the AI's findings are kept (`checks/run.ts`; counted in
  the run's "Found 2 things to look at"). A deleted scene keeps none of their findings open (`scenesDeleted` →
  `rulesAfterDeleting` → `db/checks.ts` `clearDeletedRules`; what Adam ignored or fixed stays), and one brought back
  from Recently deleted is looked at again at once (`scenesRestored`). Never throws. A card changed on its own (a When,
  a point of view) is looked at again by the next read of the scene or the next check.
- **Where the findings go**: the `issues` rows the checks keep (`db/checks.ts`), so the Issues tab, the badges, the
  Check room, Fix the text (the quoted words, when there are any), Ignore and Undo work as for any finding. Payload
  `by: 'rule'`, `rule`, `sources`, `entryId` (and `field` for an age), `fix` and `memoryFix` null; key
  `rule:<rule>:<scene>:<what it is about>` (`ruleKey`), so a finding is never raised twice. Each run replaces what the
  rules found there before (`saveFound` now takes away open `rule` rows too, when the caller's `replaces` says so; the
  AI's `replaces` only ever names its own checks), and one found again just as it was isn't written or told to the
  window again, so the Issues tab doesn't reload after every reading. A rule's finding and the AI's or the keeper's are
  the same thing (`sameThing`) when both are about the same entry (and field, or neither) and about what is so (facts,
  who knows what, the timeline, continuity; never voice or style), whatever their kinds, unless both quote words, other
  words, under other kinds; with no entry on one side, by the same kind and overlapping words; two rules' findings only
  by their keys. A rule never raises what the AI or the keeper already raised; when the AI check finds what a rule found,
  the AI's finding takes its place in the same row (its words, rewrite and advice); when the memory keeper raises its
  clash about the same thing (it can update the memory), the rule's open finding gives way to it, and a rule's finding
  never stops the keeper's (`db/keeper.ts` `raiseIssue`). If the AI stops finding it, the rule brings it back at once.
  Fix 7's lessons work unchanged: an ignored rule finding is meant (never raised again, and told to later checks), a
  fixed one is a slip later scenes' writers are warned of (`fact`, `knowledge` and `timeline` kinds; two in hand and the
  point of view never named are `continuity`, about their moment).
- **On the screen**: the card's kind line says "Facts · Found by a rule, not the AI" (`issuesLogic.ts` `RULE_WORDS`; on
  hover "Found by a rule over the memory, at once and for free: no AI was asked.") in the Issues tab (both looks), the
  Check room's issues and Classic's Consistency page; the margin note keeps its head and has the same hover. Nothing
  else changes, so Classic's screens look as they did (the sample world raises nothing).
- **Not a rule: a promise long overdue.** Fix 10 already asks about it in Worth a look (with Pay off later, Keep and
  Mark as dropped), story-wide; as a rule finding it would be raised twice, in a scene it isn't about. So
  `overdueThreads` stays Worth a look's alone.

## Long story memory: each scene gets a contract (fix 13, 2026-10-16)

The research's fix 13 (after ConWriter, 2026): drift from the plan and contradictions of what is already so are caught
best by a narrow, planned checklist, not an open hunt for plot holes. ConWriter gives each scene a short transition
(what must already be true, what must change, what must not change), puts it in the prompt, checks the draft against it
item by item, rewrites only failing sentences, and cut contradictions 50–88%. The writer lab once tried "a scene
contract" without clear gains on small samples (see "The writer lab's winners"); the long test book (fix 6) is where to
judge it at length. No store, no migration, no new kind of AI call.

- **The contract** (`ai/contract.ts`, pure; `SceneContract`: items with codes C1..., each `start`, `change` or `keep`,
  the check a broken one belongs to, and the entries it is about). Three short lists, at most `CONTRACT_MOST` (4, 5, 4):
  - *Must be true at the start*: from what must stay true's own lines (`mustStay.ts` `mustLines`, now with each line's
    kind and entries; the full form, every stage line told): how much time has passed (fix 11), where people are, what
    they hold, a piece of clothing off or named, how they are placed; and up to two things everyone in the scene knows
    that the card or the change is about (fix 9's ledger, with since when). Carrying on inside a scene (Add below, a
    later beat, Continue) the stage at that same moment is told right above, so the start keeps only the time.
  - *Must change*: what the draft is asked to write (`ContractAsks`), strongest first, each left out when something
    before it already says it (`saysFact`): the author's direction (a whole scene's too, so the list defers to it; Add
    below's; Continue's "what happens next"), then what the plan before writing said must change (below), then the
    card: a whole scene's beats (Generate, Variants, the chapter writer); Add below the next beat not on the page
    (`beatsOnPage`) when there is no direction; a beat that beat with Adam's note for it (`beats/instructions.ts`
    `beatFocus`, "… (the author’s note for it: …)"). A whole scene's outcome ("By the end: …", taken before the beats, so a
    beat that only says it again is the one left out) and up to two plot threads it sets up or pays off (fix 10; left out
    only when the direction or the plan names them) keep their own places, so the beats never push them out.
  - *Must not change*: the dead stay dead, what is kept from someone here stays kept, injuries, what someone here believes
    wrongly, what someone gave away or got, things in the place, marks; in that order. Never a line the change list
    itself changes (`changedBy`, from what each line says, `MustLine.about`): the change names the item someone has or
    gave away (`memory/items.ts` `namesItem`) or the thing in the place (`shared/stageItems.ts` `namesItem`), or says the
    line's own words; a secret goes too when the one it's kept from learns, finds out or is told it (with a word of it, or
    "the truth"), and a wrong belief when the one who holds it does. The line stays in what must stay true.
- **The writer's briefing** (`ai/context.ts`, `ContextInput.contract`, set by `ai/draftFlow.ts` `contractFor`): block
  `scene-contract`, "This scene’s contract", priority 2 (never left out; its short form without the lead), sent late
  (`SEND_ORDER`: after where things stand, right above what must stay true), so every block before the scene card reads
  the same with or without it (the cache, tested). What must stay true leaves out every line the contract says word for
  word (`MustInput.leaveOut`, `contractSays`): nothing is said twice; with nothing left it goes. The planner is told
  those lines with what must stay true (`plan.ts` `planMaterial`). Continue's own briefing gets the same block, built by
  the app alone (`edits/briefing.ts`, `EditWorld.contract`). `PreparedContext.contract` and `DraftBriefing.contract` say
  what was sent. The Context tab and "What the AI saw" show it as they show every block.
- **The plan says what must change** (`plan/plan.ts`). With a contract the planner's instructions (`planSystem(true)`,
  `SYSTEM_WITH_CONTRACT`) ask for `"must"`: at most `PLAN_MOST.must` (5) short statements a reader could check, from the
  card's beats, goal and outcome, the direction, or a thread the card sets up or pays off. `checkPlan` keeps one only when
  the card, the beat or the direction calls for it (`calledFor`) and it lets out no secret; `MadePlan.must`. `withPlan`
  puts them in the contract (`ContractInput.planned`) and fits the briefing again; `keepsRoom` lets the contract's block
  change size. The plan's lines stand for the card's where they say the same; the card's beats they don't say stay
  (fix 13's review). Without a contract the plan's call is exactly as before.
- **The check as a draft lands** (`repair/contract.ts`, `repair/index.ts`): the contract is kept by record as the stage is
  (`noteContract`, beside `noteStage`: Generate, Add below, a beat, Continue). The same claims call gets the items as C
  lines (section `contract`, "The scene’s contract (C ids)", right before where things stand in `REPAIR_SEND_ORDER`) and
  `CONTRACT_RULES` after its own instructions; each item is answered kept, broken, not yet or untouched, with the
  sentence that shows it (`readContractAnswers`). The app keeps only what it can stand behind (`judgeContract`): a
  broken item only with words that are in the new words, and it goes on as a slip against its C line, through the second
  opinion (whose instructions name C lines when a note cites one, `secondSystem`) and `judgeClaims`; a C line is never on
  the stage, so it is never mended without asking: one question with the model's rewrite of that sentence to review
  (Fix the text). Not yet: only for something that must change, never for Continue, and not when most of its words
  (names aside) are in the new words (`mostlyIn`); then the same second opinion rules on it (a "Not shown" note with no
  quote, `MissingNote`, `NOT_SHOWN_RULE`: rejected when the words show it in other words, which then counts as kept);
  what stands is asked with no words to point at ("This scene was planned to show this, but the new words don’t yet: “…”
  Write it in, or leave it for later?", `notYetIssue`, key `contract:change:<words>`, `contract.missing`). Such a
  question goes only when the reply answered its item: for a whole new draft of the scene, answered at all; otherwise
  once the words show it. A reply that answers no item of the contract settles nothing and leaves the report as it was
  (`readClaims` no longer reads `{"contract": []}` as a check). Issues carry `IssuePayload.contract` (`Issue.byContract`;
  `confirmed` when the second opinion ruled on a broken item and kept it); a contract's "not yet" is never a lesson for
  later scenes (fix 7, `checks/lessons.ts`). How each item came out is kept with the scene's check report
  (`checks/report.ts` `saveContractCheck`, `CheckReport.contract`; the critic's report after the draft keeps it) and
  `RepairOutcome.contract` counts it. With "Check new words straight away" off, the contract is in the briefing but not
  checked (the critic after a draft doesn't go through it).
- **The chapter writer** (`ipc/chapterWriter.ts`, `checks/run.ts`): each scene's contract from its latest draft goes into
  `checkScene` (`CheckOptions.contract`), in the request about what is so (facts, timeline, continuity), with
  `CHECK_CONTRACT_RULES`. A long scene's first part gets every item, its later parts what must change and what must not
  (what must be true at the start is judged on the opening alone); the parts' answers are put together (`mergeAnswers`).
  A model with too little room for the contract checks the scene without it (the contract goes, never the check). Only a
  reply that answered an item counts as a check through the contract. What it finds goes through the second opinion on
  the check model (`contractRuling`, one call, only when something is broken or not shown; no room for it, a failed call
  or an unreadable reply: nothing dropped, nothing confirmed). Decided with Adam: the agent may put right a broken item
  like its other findings only once the second opinion agreed (`contract.confirmed`; `chapterWriter/run.ts`
  `issueFindings` sends no other contract issue to the review, "scene contract"), rewritten by its `revise` within the
  run's existing limit (`SAME_ROUNDS`); what isn't shown yet is never written in by itself and stays in the Issues tab
  for Adam. Only a check through the contract replaces what one found (the critic's check leaves those rows be; since
  "Findings that stay current", below, Mark done's and Check this scene go through the scene's latest contract, so they
  can settle them), unless contracts are switched off: then a whole check takes them away (`contractsOff`, from
  `RunDeps.contractsOff` and the chapter writer; `db/checks.ts` `dropContractIssues`) and the report's contract with them
  (`saveReport` with `contract: null`).
- **AI calls per scene.** None new. Plan before writing: the same one call, with about 120 more tokens of instructions and
  a few more lines back. The writer: the same call, the briefing a few dozen to a few hundred tokens longer (less what
  must stay true no longer repeats). Check and repair: the same one call, with about 350 more tokens of instructions, the
  C lines, and a short answer per item. Its second opinion, which already ran once when the check found a slip, now also
  runs when only a contract item is broken or not shown yet (still at most once per landing). The chapter writer: the
  contract rides in its first check request each round, and one second opinion follows a check that found something
  broken or not shown. Continue and Variants: none.
- **The switch** (Settings › Models, "Scene contracts", "Give each scene a contract", `settings.sceneContracts`, on by
  default; `features/contract/ContractSettings.tsx`, between Plan before writing and Check new words straight away).
  Off: no block, no `must` asked of the plan, no C lines in the check, as before. `AIWRITE_CONTRACT=off` always turns it
  off (`contractWanted`); app tests set it (tests/e2e/helpers.ts) and ask for it with `AIWRITE_CONTRACT=on`
  (`tests/e2e/contract.spec.ts`). The fake provider answers the plan's "must" (`tests/fake-provider/plan.mjs`), the
  check's contract (`repair.mjs`) and the chapter writer's (`m5/check.mjs`). The trap harness goes through it with the
  app's own code (contracts on unless `AIWRITE_CONTRACT=off`); its `--fake` run's stand-in check answers the contract
  (`tests/traps/app.ts` `standInRepair`), each passage's repair records the counts (`RepairResult.contract`), and
  passages.md says "Scene contract: 1 of 1 kept, 0 broken, 0 not shown yet" under each step. A real run of the long test
  book (fix 6, `--story book`) with and without (`AIWRITE_CONTRACT=off` on one) judges the contract at length.
- **On the screen**: the Issues tab's cards (both looks), the Check room and Classic's Consistency page say "… · Scene
  contract" beside the kind (`issuesLogic.ts` `CONTRACT_WORDS`, hover `CONTRACT_DETAIL`); the check report (Issues tab)
  has a "Scene contract" line with how many items were kept and each item's result ("Kept · Must change · …"), and says
  "Checked against the scene contract · 3 of 4 kept · 1 not shown yet" when that is all it has so far
  (`CheckReportCard.tsx`, `contractNote`). The sample world has no drafts, so Classic's screenshots are unchanged.
- **Fix 14** (below) adds its continuity brief to the same plan step in the same way: a field each (`PlanMaterial.brief`,
  `RawPlan.brief`).

## Long story memory: a continuity brief before each scene (fix 14, 2026-10-16)

The research's fix 14, the last of the series: the writer's briefing is put together by fixed rules and caps, so a fact
that matters for this particular scene can still miss the writer, while a big dump reads worse than a focused slice (NWM
2026: targeted records scored 0.89 against the full text; Chroma's "context rot"). Anthropic's advice for long work is a
helper that reads widely and hands back a short brief, and InkOS's planner writes one per chapter. AI Write's plan before
writing is already the memory model's call made before each draft, so it is that call that grows: no new AI call, no
store, no migration; the memory keeper's prompt is unchanged (its 58 characters to spare are still spare).

- **What the plan reads besides** (`plan/brief.ts` `briefMaterial`, pure; gathered on the open world by `plan/index.ts`
  `withBrief`). Besides what the plan always read (the scene card, what must stay true, where things stand, the words just
  before, the codex's names), in this order, the parts that stay the same from step to step first:
  - *the book so far, word for word* (`bookPart`), this story's scenes before this one on its line, in reading order,
    with where each is ("### Ch 2, Sc 3: The ferry"), only when the memory model reads at least `BOOK_READER` (200,000)
    tokens, and never more than `BOOK_MOST` (150,000 tokens, about 110,000 words) nor `BOOK_SHARE` (half) of what the
    model reads, all of the plan staying within nine tenths (`briefRoom`). A longer book leaves out its oldest chapters'
    words, whole chapters at a time (`bookWithin`), and says so in its heading ("…, from Ch 5 (how the chapters before it
    ended is in the record below)"): their story is in the record, how each chapter ended. Decided in review: the book
    is sent with every plan that writes a brief, so it is held to what a provider's cache makes cheap;
  - *how each chapter so far ended* (fix 15's kept snapshots, `db/snapshots.ts`, never worked out for a plan), each change
    citing its scene the way the rest of the record does ("Wren: broke her left arm (Ch 1, Sc 2)", "At its end: …");
  - *everyone and everything in the scene, in full*: the people in it (`sceneKnowers`: the card, the stage, the scene so
    far), the place, the card's plot threads and the other entries the briefing names, each with all that has happened
    to them (the writer gets the last few); one too long for the room left gives its most recent 12 changes, then 4, then
    none (`fitParts` tries an item's shorter forms rather than stopping its part);
  - *who knows what among everyone here*, uncapped: each fact someone here knows with since when and how, who here
    doesn't (never someone it is about, nor where who knows it doesn't rest on who was there, as the writer's block), and
    what someone believes wrongly (fix 9's ledger);
  - *the story calendar*: this scene's date, how long since the scene before and since each earlier day worth counting
    from, and ages (fix 11; the writer's card says at most three);
  - *the slips put right in earlier scenes* (fix 7, all of them; the writer's list says two) and *the rule checks'
    findings still open in this scene* (fix 8, `db/checks.ts` `openRuleFindings`), for a draft written again;
  - the *open plot threads*, due or overdue first (fix 10: `planThreads`), as many as the memory model's room allows
    (`openThreadsMost` of its `memoryScale`: 6 to 22), in place of the writer's list;
  - *what Adam kept out*: the names of what a 'hide' pin keeps out of the scene's briefing, "Never name these in the
    brief" (below);
  - after the words just before, as they change from step to step: *every earlier passage the search found* (up to 12;
    the writer gets 5 to 10) and *the scene's contract* (fix 13, never cut).
  The record (all but the book) is fitted to `RECORD_SHARE` (half) of what the memory model reads, less the plan and its
  reply, at most `RECORD_MOST` (40,000 tokens) (`fitParts`: each part first to its share of the room, whole lines or
  entries from the first, then what is left by rank: who knows what, the calendar, the slips, the findings, the people,
  the passages, the chapters). On the 16,000-token guess that is a few thousand tokens; a part that can't be read is left
  out, and a brief that can't be put together at all leaves the plan as it was (`safely`). With no room for the plan
  and a brief together (a memory model reading a few thousand tokens), no brief: the plan as it was.
- **What Adam kept out stays out** (review). Someone or something kept out of the scene's briefing (a 'hide' pin) is
  never in the record: not as an entry, nor a knower (`sceneKnowers` leaves them out, wherever they are on the stage or
  named in the scene so far, so the writer's own who knows what does too), nor a thread (`openThreadsAt`'s `hidden`, the
  writer's list too), nor in a line of the record naming them (chapters, who knows what, the calendar, slips, findings).
  The book so far is the story's own words and keeps them; the planner is told their names and asked never to put them
  in the brief, and `checkBrief` leaves out any line of the brief that names one (`BriefMaterial.hidden`).
- **The request, for the cache** (`plan.ts` `planMessages`). The book goes first, after the instructions (which are the
  same every time: how long the brief may be is said in the request's last line), under the same heading at every scene
  (`BOOK_TITLE`; where it runs is said after its last scene, `BOOK_END`), so at the next scene a provider that reuses the
  start of a prompt it has seen (DeepSeek, OpenAI) reads all of it but the newest scene from its cache, and every step of
  a scene all of it; when a chapter drops out of a long book the start changes once. For Claude through OpenRouter the
  user message's `cacheUpTo` marks the book up to its last scene, never its last line, which says where it ends and is
  new every scene. Then the record that stays the same through a scene, the plan's own parts as before, the passages and
  the contract, and last what the writer is asked. The record kept in the world has the book as a note ("Ch 1, Sc 1 to
  Ch 10, Sc 3, 61,190 words, read whole. Not kept here…": `planMessages(m, false)`, `keeper/model.ts`
  `CallOptions.kept`), as it is the scenes' own words and each scene keeps its newest 10 planning prompts; its size is
  still counted as sent.
- **The brief** (`planSystem(contract, true)`, `BRIEF_RULE`, `BRIEF_SHAPE`): one more field in the plan's reply,
  `"brief"`, five short lists: what matters for this scene (`matters`), what must not be contradicted, each with where it
  was set or last changed (`keep`), who knows what among the people here (`knows`), the promises due or in play
  (`promises`), and how long since the events that matter, with ages (`time`); only what it was given, about the whole
  scene even for a beat, nothing of what happens in it (the plan's), not the card again, nothing kept out. Its size
  (`ai/brief.ts` `briefSize`): about as much as the parts going short beside it free (`briefFrees`, below), between
  `BRIEF_LEAST` (1,000 tokens) and what the writer's room allows (`briefTokens`: 1,000 at the smallest `memoryScale`,
  2,000 at `MOST_SCALE`); asked in words (tokens / 1.35) in the request's last line (`briefAsk`), so the instructions,
  and the book after them, read the same every time. The reply's room grows by 1.3 times that (`BRIEF_REPLY_SHARE`), and
  the draft waits longer for it (`BRIEF_LIMIT_MS`: 90 s, 120 s with the book; the plan alone keeps its 30 s). The app
  checks it (`readBrief`, `checkBrief`): each line cleaned and at most 320 characters, said once, left out when it cites
  a chapter or scene the planner wasn't given (`placesCited`: "Ch 9, Sc 9", "chapter 4, scene 1"; a chapter counts when
  any of its scenes was given) or names something kept out, each list capped (`BRIEF_MOST`: 8, 12, 10, 6, 6), and the
  whole kept to 1.2 times its size, lines going from promises, time, matters, then who knows what, what must not be
  contradicted last; a brief with nothing on who knows what is held to what goes short without who knows what
  (`tokensNoKnows`), as who knows what then stays whole beside it. The plan's own check is exactly as before: its facts
  are taken only from its own parts, never from the book or the record (a scene long ago may say what no longer holds).
  `MadePlan.brief`; a reply with only a brief is still a plan. Without a brief asked for, a brief in the reply is never
  used.
- **The writer's briefing** (`ai/brief.ts`, `ai/context.ts`; `ContextInput.brief`). Block `continuity-brief`, "Continuity
  brief" (`BRIEF_BLOCK`), priority 2, never left out (it goes in only where there is room: `withPlan`), short form only
  what matters and what must not be contradicted, shortened before the contract and what must stay true. It is written for
  each step, so it is sent late (`SEND_ORDER`: after who knows what, right before the scene card), and every block before
  it reads the same from one step to the next (tested). Its lead says whether the book was read. **Not said twice**
  (`briefShortens`, `PreparedContext.briefShortens`, `finishContext`): with a brief, the story so far (its older detail),
  the earlier passages found by searching (the planner read every one) and, when the brief says who knows what, block 6's
  who knows what (its short form keeps who doesn't know and who believes wrongly) start in their short form unless Adam
  chose Full in the Context tab (`ContextBlock.shortFor` 'brief'). The story so far stays whole for a story with earlier
  books (or side stories) on its line (`hasEarlierBooks`): the brief's reader read only this book word for word, and the
  story so far is where the writer hears of the books before (review). What must stay true, the scene's contract, the
  scene card and the stage stay word for word. The brief is asked to be about the size of what that frees (`briefFrees`:
  never counting a part Adam wants in full, a later book's story so far, or a part already short), so in a long book the
  briefing doesn't grow; only a story so short that little goes short gets a brief longer than what it frees, by 1,000
  tokens at most. `keepsRoom` lets those parts go short for it, and nothing else; `withPlan` tries the plan with its
  entries and the brief, without the entries, then without the brief, each only if it says anything. Without a brief the
  briefing is exactly as before (tested). Decided in review: a redraft whose plan brings no brief (it timed out, failed,
  or had no room) has the story so far in full again, so the writer's cached prefix changes there, and for the redraft
  after; one cache miss, accepted rather than holding the story so far short without a brief to stand for it.
- **Where it goes**: wherever the plan before writing goes: Generate, Add below, Beat by beat, and each scene of "Write
  the whole chapter" (`ipc/chapterWriter.ts` drafts through `draftBriefing`; its study notes stay their own block, "Notes
  for this scene, from studying the chapter"; its review sessions and look-up tools, `chapterWriter/tools.ts`, don't use
  the plan step, so they get none). **Beat by beat writes one brief a scene** (review, `plan/index.ts`): its first beat's
  plan writes it, about the whole scene; each later beat's plan reads no more than it always did (no book, no record) and
  the writer gets the scene's brief, while the scene card and the record it was made from read the same (`briefKey`: the
  card, the record's parts and where the book ends; kept in memory for the 20 scenes planned most recently). A later beat
  that finds them changed (someone new named in the scene so far, a new reading by the memory) writes a new one. Not
  Continue, which has no plan step (it carries on a paragraph or two from the page, with its own small memory core), nor
  Variants or the AI edits.
- **AI calls and size per scene.** No new call. The plan's call reads more and writes more. Measured with the fake provider
  on the test book (`--story book`, 30 plans from scene 18 to the end, the memory model reading 1,000,000 tokens): each
  plan read about 2,200 tokens before and about 66,000 with the brief (the book so far, 30,000 to 61,000 words, is most
  of it); the writer's own prompt came down by about 8% (10,700 tokens a draft against 11,600; the fake planner's brief
  is short, a real one is about the size of what goes short); the number of calls was the same. A memory model that reads
  less than 200,000 tokens never gets the book: its plan grows by the record only (a few thousand tokens on the 16,000
  guess, at most 40,000). On DeepSeek's prices ($0.28 a million tokens read, $0.028 when read from its cache, $0.42
  written), a plan with a brief reads at most 150,000 tokens of book: at the end of a 60,000-word book (about 82,000
  tokens) the first plan after an early edit costs about $0.025 and then about half a cent a scene with the book read
  from the cache (the record and the newest scene are new each time); at the ceiling, about $0.045 and then about $0.01,
  however long the book (a chapter dropping out costs one miss); under $0.001 for the brief written; without the book
  about $0.002 to $0.005. Before: about $0.001. Every plan that writes a brief sends the book: each draft of Generate or
  Add below, each scene of Write the whole chapter (so a chapter's run grows with its scenes, not their square), the
  first beat of a scene, and a call tried again after a provider's error (the retry sends it all again; tested in
  `plan/brief.test.ts`). DeepSeek says what came from its cache (`prompt_cache_hit_tokens`, `client.ts` `cachedOf`), kept
  with each call's record, so Settings › Usage and cost shows it. A draft starts later by the time the brief takes to
  write (1,000 to 2,000 tokens).
- **On the screen** (both looks): Settings › Models, "Continuity brief", "Write a continuity brief before each scene"
  (`settings.continuityBrief`, on by default; `features/brief/BriefSettings.tsx`, right after the scene contract), with
  one line on cost ("usually under a cent a scene on DeepSeek"), and when Plan before writing is off, that it needs it.
  What the AI saw shows the brief as a part like any other, and the planner's call as a memory record titled "Planning
  the scene and writing its continuity brief". The Context tab shows the last brief written for the scene, where it
  would go, with the parts that go short beside it (`ai/draftFlow.ts` `previewBriefing`: from its newest draft that had
  one, `db/generations.ts` `lastSentBlock`, read back by `readBriefText`, only where there is room), its note saying "The
  memory model writes a new one just before each draft. This is the last one it wrote." and the shortened parts' "Short,
  as the continuity brief says what of it matters for this scene." (`contextLogic.ts` `blockStateNote`). No new screen;
  the sample world has no drafts, so Classic's screenshots are unchanged.
- **The switch and the tests.** Off: no brief asked for, the plan's call and the briefing exactly as before (fix 13's
  contract works as it did). `AIWRITE_BRIEF=off` always turns it off (`briefWanted`); app tests set it
  (tests/e2e/helpers.ts) and ask for it with `AIWRITE_BRIEF=on` (`tests/e2e/brief.spec.ts`). The fake provider writes a
  brief from what it was given, with a line citing a scene it never was (`tests/fake-provider/plan.mjs` `briefOf`). The
  trap harness goes through it with the app's own code (on unless `AIWRITE_BRIEF=off`): passages.md says under each
  passage (and each planned chain step) "Continuity brief: 9 lines (about 310 tokens); the plan read 66,000 tokens, the
  book so far whole." (`score.ts` `briefNote`, `briefLine`); a fake run of the book gives the memory model 1,000,000
  tokens to read (`FAKE_BOOK_READER`), so the book goes in as on DeepSeek, and a fake run's budget is 40 million tokens
  in (`FAKE_BUDGET`: it costs nothing). A real run of the book with and without (`AIWRITE_BRIEF=off` on one) is what will
  tell whether it pays off at length.

## Findings that stay current (2026-10-16)

Adam: "when the user changes something or accepts an edit, the checks and critic don't update, and often show outdated
suggestions and fixes." A review traced it to eight causes: only listing or counting issues ever put one away, nothing
followed an issue's own words, accepting a fix didn't save first, Undo left issues wrong, contract questions and
memory clashes were never withdrawn, and the check report's counts never moved. No migration and no new AI call; the
critic's notes (`critique/`) and what the checks send to the model are unchanged.

- **Every save sweeps the scene** (`ipc/core.ts` `saveSceneText` → `db/checks.ts` `sweepGone` with the doc and text just
  saved; listing a scene's issues does the same from the stored scene). Cheap: nothing is read when the scene has no
  quoted issue open or put away; the paragraphs are made plain once (`sweepPage`), and a 10,000-word scene with 30 issues
  sweeps in a few milliseconds, in the main process after the save, never per keystroke. What changed is told to the
  window as `issues:changed`, so the Issues tab, its count and the binder's badges follow. Coming back to a scene reads
  its issues again too (`issuesStore.ts`: leaving a scene forgets when it was read). A story's list and the badges still
  sweep by the text alone (`sweepGone` with a story), as a safety net.
- **An issue follows its own words** (`placeNow`). One found at a place (`occurrence`) is about that appearance of its
  words: the sweep pins it to the editor's paragraph id and its place there (`IssuePayload.at`), keeps `occurrence`
  right when text before it changes (Fix the text then works on the right copy), and puts it away when that paragraph
  no longer has its words, even though another copy is still in the scene. With no paragraph ids it is put away when
  the scene has fewer appearances than its place needs. Other issues' words count anywhere in the scene, as before; one
  whose quote runs across two paragraphs stays as it is.
- **Accepting a fix saves first** (`features/issues/actions.ts` `settleFix`, also the editor chat's issue fix,
  `ask/applyProposal.ts`): the page is saved (so its sweep puts away the scene's other issues on the same words), then
  the issue is marked fixed, then the issues are read again.
- **Undo** (`features/issues/fixHistory.ts`, a plugin in the editor's list, kept out of the document as the repair marks
  are): an accepted fix is followed in the page; Ctrl+Z taking it back reopens its issue, Ctrl+Y marks it fixed again; a
  fix Adam edits by hand is no longer followed. And a row the sweep put away comes back open when its words are back in
  the paragraph it was in (Ctrl+Z after rewriting them by hand; anywhere, for an issue never pinned), never one Adam
  ignored or fixed, and never beside one about the same thing.
- **Contract questions** (fix 13's "not shown yet", which point at no words): Check this scene and Mark done (`runs.ts`)
  go through the scene's latest contract as its latest draft was checked against it, as the chapter writer does
  (`CheckOptions.contract`; `checks/report.ts` `savedContract`, read from the report's contract, whose items now keep
  their code, check and entries: `ContractCheckItem.code`, `check`, `entryIds`, written by `repair/contract.ts`
  `contractResults`), so a check through it settles them. Not the critic after a draft, and not with contracts switched
  off. Cost: those checks' first request carries the contract's rules and C lines (about 350 tokens more), and when an
  item is broken or not shown, one second opinion follows, as in the chapter writer.
- **Memory clashes and Worth a look.** Saving an entry by hand (`keeper/index.ts` `entryEditedByHand` →
  `db/checks.ts` `settleByEntry`) fixes, by the memory (`fixedBy`, never a slip later scenes are warned of), each open
  clash whose field now says what the scene says (the keeper's `text`, or the value Update the memory would set). A "no
  longer says this" note leaves the memory check list once a read rests the fact on words in that scene again (a link
  of it there that is 'ok': `checkQueue.ts` `saidAgain`), and stands again if those words are edited away.
- **The check report** (`CheckReportCard.tsx`): its count is the scene's open issues as they are now ("Checked after the
  latest draft · 6 checks · 1 issue open", "none left open" once all are settled; what the check found until the issues
  are read), and under it when it ran ("5 minutes ago"). Each report keeps a fingerprint of the words its checks read
  (`CheckReport.textHash`, `reportHash`); `getCheckReport` says `changed` when the scene's words differ, and the card
  then says "The scene changed since this check" (checked every few seconds while it shows, as the critique is; a report
  from before, or one with only the contract checked as a draft landed, never says so).
- **Later**, beside Ignore (the Issues tab in both looks, Classic's Consistency page and the desk's Check room): the
  issue stays open but is hidden, and not counted on the badges or the tab, until the paragraph its words are in changes
  (`IssuePayload.later.words`, a fingerprint of that paragraph) or the next check of the scene (`checks/run.ts` →
  `clearLater`; the rules finding it again after a read keep it). One with no words to point at waits for the next check.
  Unlike Ignore it is never taken as meant (fix 7's lessons read only fixed and ignored rows). Toast: "Saved for later.
  It comes back when you change that part of the scene, or when the scene is checked again." with Undo (Reopen, which
  ends Later). The Issues tab folds them under "Show for later (n)" with Show now; the story's lists leave them out and
  say "· 1 saved for later". The sample world raises nothing, so Classic's screenshots are unchanged.
- **Tests**: `checks/staysCurrent.test.ts` (the sweep, places, rows coming back, Later, clashes, the report and the
  saved contract), `checks/run.test.ts` (Check this scene and Mark done through the contract, the fingerprint, Later after a
  check), `keeper/memoryChecks.test.ts` (the note), `features/issues/fixHistory.test.ts` (Ctrl+Z and Ctrl+Y),
  `features/issues/issuesStore.test.ts` (read again on coming back),
  `ask/applyStory.test.ts` (saved before marked fixed), and the app test "findings stay current" in
  `tests/e2e/issues.spec.ts` (Later, words rewritten by hand, Ctrl+Z, the report's count and its "changed" line).

## Milestone 1 scope

Installer and auto-update; library, worlds and stories; binder; editor with autosave
and backups; providers and model choice; simple forms for characters, places and lore;
style guide; scene cards; context assembly with fixed priorities; Generate draft with
streaming and Stop; "What the AI saw". Anything from a later milestone waits.
