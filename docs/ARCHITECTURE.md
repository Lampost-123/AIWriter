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
  storyIndex/    The story index (overhaul phase 1): who is where, with what, and what changed, scene by scene, as dated
                 facts built with no AI call; look-ups and free checks over it (SQL in db/storyIndex.ts)
  director/      Directed writing (an option): a draft written a stretch at a time, with a director's notes between
  planHub/       The Plan hub's facts (where the writing has got to, open threads, where the plan has drifted) and its
                 Update the plan / Fill in the empty cards requests (see "The Plan hub")
  retrieval/     Story memory step 5: sticky entries, what was said, and searching the story so far by
                 keyword and by meaning (its own file, search-index.db, and the search model in model/:
                 onnxruntime-node, or a TypeScript reader where that can't start)
  index.ts       Window, lifecycle, flush-on-close
  world.ts       The open world (one folder: world.db, images/, backups/)
  db/            migrations.ts (append-only), repo.ts and other modules holding all SQL (no Electron imports)
  settings.ts    App settings (userData/settings.json) and writing preferences (library folder)
  secrets.ts     API keys, encrypted with safeStorage, kept out of worlds and backups
  ipc/           One handler object per area; ipc/index.ts checks every AppApi method is implemented
  ai/            Providers, context assembly, generation records; ai/lookups/ the look-up tools an AI job may ask for
                 (the story index, codex entries as they stand, the search, earlier scenes' words), answered here;
                 ai/packs/ the instruction packs an agent loads by name (load_instructions) only for the job at hand
  services/      backups.ts, updater.ts
src/preload/     Exposes window.aiwrite (invoke + events). Nothing else.
src/renderer/src/
  lib/           api client, zustand store (navigation + open world), flush registry, editor bridge, theme
  components/ui  The design system. Use these, not raw elements, for buttons, fields, tabs, dialogs, selects
  layout/        Top bar, resizable side panes, inspector, update banner
  features/      binder, editor, inspector, world, style, settings, generate, welcome; planHub (Build with AI: every AI
                 building tool for a story in one area, zoomed in on a chapter or a scene) over outline (the suggestions' store and parts), storyBuilder
                 (the idea, cast and world), chapterWriter (Write the chapter) and worldBuilder (from a summary)
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
  (Windows' Animation effects off) makes every change instant, View Transitions too. See "The New look (Classic
  retired)", Motion.
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
  A malformed reply is repaired or retried once (the same request, the reply not sent back: "One reading of a scene");
  if that fails the scene shows "Memory not updated"
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
  a line plus the narrow padding and the sheet's 8 px margins, `SHEET_MARGINS`; App takes the area rail off
  the window's width first); the page gets 40 px padding only from `widePageFrom()` (measured
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
- Where an event goes (Adam, 2026-10-17: "at the correct place ALWAYS"): one rule, `worldViews/eventPlace.ts`, for every
  event whatever made it (a build, the memory keeper, Adam, a recipe), used by the timeline (`placedOrder`) and the
  writer's brief (`ai/context.ts` `datedAfter`). A date that can be placed decides: after the last scene of the story's
  present (flashbacks skipped) not later than it; with no time of day after the last scene of its day, with one among
  that day's scenes by time. The scene it first exists at (planned for it, or found in its text) keeps it only when that
  scene is on its day, or is undated and sits where its date belongs. Before every scene of the present: backstory
  dated by a year stays before the story, a count of the story's own days ("Day 0") goes just after its opening scene.
  No date: after the scene it is tied to, else the scene read before it, else the opening scene. After one scene: those
  before the story's first day, then those with no date, then the rest by date. Existing events are never rewritten; a
  build ties a new one only to a scene that agrees with its date, else the first scene on or after its day
  (`worldBuilder/save.ts` `eventScene`, `sceneOnDay`). The brief leaves out an event on a later day, or later the same
  day when both say a time, unless it first exists at the scene being written. Events earlier builds left at the story's
  start go to their scene on keeping an outline, or with "Put events in their place" (see "Events in the scene they
  happen in").
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
- **MCreader's faster, steadier Breeze (Adam, 16 October 2026).** The worker decodes each line once at its end
  (`decode_once`, `bounded_decode` in `speech-server/app/workers/breeze.py`) instead of through Breeze's streaming codec,
  whose cache was scrambled on CUDA; caps each line's frames by its length (`frame_cap`); and compiles the depth decoder
  with Triton when it can (`triton-windows<3.6`, `BREEZE_WINDOWS_PACKAGES` in `speech/plan.ts`, Windows only; compiled,
  then uncompiled CUDA graph, then none; caches in `models/breeze/compile-cache`; `AIWRITE_BREEZE_COMPILE=off` skips
  it). MCreader measured about 0.63 to 0.44 of real time. A line that ends without Breeze's end-of-speech token is
  tried once on another seed, then fails rather than being kept cut short. A worker that gives no answer in 180 s plus
  0.3 s a character is stopped (`worker_engine.py`), and one with a CUDA error, or a second out-of-memory in a row,
  exits (`_gpu_trouble`); the next line starts it fresh. The clip key (`readAloud/speak.ts`, v2) carries Breeze's
  commit and switches (`engineFingerprint`) and what a studio voice has now (`studioKeyParts`, `readAloud/clipFacts.ts`:
  gone, or no acted clip of the feeling), and only a WAV reply is kept (`isWav`). Audio kept before v2 is made again
  as it is read; "Redo this line" choices made before it are let go. `python tests/worker_checks.py` (from
  `speech-server/`) checks the safety nets without a graphics card.
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
  laid out that came back thin, pages Adam didn't make himself of the build's story, such as a character
  the memory found, and pages that are still only a name; since 2026-10-17 never another story's
  AI-drafted pages), and the memory keeper,
  which hands the entries a run made from scene text (`newEntryIds`) to `fillFound` on the memory model
  after the run, so it never slows or breaks the memory. Then the build gives each character it made a
  read-aloud voice description, as Suggest would (job `speech`, `readAloud/voiceStore.ts`), unless one
  is set, all of them in one request (each told as Suggest tells one; one the reply leaves out is asked about
  alone); it is saved even when read aloud isn't set up. Since 2026-10-07 the memory keeper's fill is from
  the story alone (see "Things are items" under milestone 2).
- **Cheaper builds (2026-10-17).** Every request of a World build, its filling in among them, opens word for word
  the same: one system message (`worldBuilder/prompts.ts` `worldSystem`), then the author's summary, so providers
  that cache prompt prefixes (DeepSeek, OpenAI) read it again for a tenth of the price, and Claude through OpenRouter
  is told where it ends (`cacheUpTo`). The job's marker line and rules follow the summary, then the plan, the world
  and what to lay out; a reply that can't be used is asked about again after it. A story build copies the story's
  own themes and tone (the "Themes:"/"Tone:" lines of its summary) instead of asking the AI, and the check against
  the world runs only when the summary names pages Adam wrote or read from his scenes. A character or place that
  keeping this story's outline made with only its name (`addMissing`), untouched since, is laid out with the full
  request into that same page (`save.ts` `saveInto`: only empty fields, its id and name kept, one line that Undo
  takes back to the name alone). The cost estimate (`estimate.ts`) counts the filling in and the voices, leaves out
  what is no longer asked, and takes the cache off only at a price the provider gives.
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
  with a continuity brief (fix 14) it also reads the earlier chapters in short, the scene before and the scene so far word
  for word and what the story record says of the scene (until 2026-10-20 the whole book so far: see "The plan reads less"
  below) and writes a short brief for the writer, with longer to do it (90 s: `BRIEF_LIMIT_MS`).
  Settings › Models, "Plan before writing" (`settings.planFirst`, on by default; beside "Check new words
  straight away"; `features/plan/PlanSettings.tsx`): off, no call, and the list still goes in. `AIWRITE_PLAN=off`
  always turns it off: app tests set it (tests/e2e/helpers.ts) and ask for planning with `AIWRITE_PLAN=on`; the fake
  provider answers in `tests/fake-provider/plan.mjs`. Since 2026-10-19 the plan is made properly, on every writing path
  ("Plan before writing, done properly", below).
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
  - **Searching the story so far** (`recall.ts`): the scene card's parts, each beat, Adam's direction and the end of the
    scene so far (or of the scene before) are each searched for, over the passages of earlier scenes (a few paragraphs
    each, `text.ts` `scenePassages`), the codex facts as of this scene (profiles, what happened, ties, things said;
    names of those on the card are left out of this search) and the scene and chapter summaries on the line: the other
    stories', and since 2026-10-19 this story's own (summary-level recall, below). Only what comes before the scene on
    its story's line is searched (`buildLine`, as the memory does), so later scenes, what-ifs and prequels never leak
    in; the end of the previous scene already sent in block 3 isn't offered again. Keyword search uses SQLite's
    full-text search (FTS5, already in better-sqlite3) for passages and BM25 in memory for the rest; meaning search
    compares the search model's vectors; every list is joined by reciprocal rank fusion (`rank.ts`). Entries found join
    "Also in mind" ("Found by searching for what the scene is about"); the best passages and summaries are the block
    "Earlier passages that may matter" (priority 9, word for word, oldest first; short: the best two, then one; a
    summary is marked "(in short)"). No re-ranking model and no AI call: a draft costs nothing more than the extra words
    in its briefing.
  - **Summary-level recall** (2026-10-19, measured first: `tests/recall-eval/`): each scene's and chapter's summary is a
    searchable item in the search index (`store.ts` tables `summaries` and `summary_words`, added to version 1 in place:
    an older AI Write checks only its own tables, so going back never sets the file aside), kept current with the
    summaries by the hash of their words just before each search and in the background (`indexing.ts`
    `syncSummaries`; a deleted scene's or chapter's, or an emptied one, goes), searched by keyword (FTS5) and by meaning
    (their vectors read in the background before passages', kept as kind `summary`, tidied once their words are gone).
    A find is its own kind (`RecalledPassage.kind` 'summary', with `sceneId` or `chapterId`, as a passage has its
    `sceneId`): the best three are joined with the passages by rank (`SUMMARIES_MOST`), so up to half of what is
    offered is summaries. Only chapters that ended before the scene, and never the previous scene's (its end is sent
    already and the story so far tells its opening). The planner's own search (`findPassages`) still finds passages
    only. Why: a fact is one sentence in a 70 to 220 word passage, and a search in other words than the page's rarely
    finds that passage, while a summary says the fact plainly. The offline measure (no AI: the trap stories, each
    probe's search as the app forms it, a fact counted found when a passage holds its sentence or a summary of its
    scene or chapter holds its words; stand-in summaries written once from the text with the keeper's prompt):
    among the six offered, the book (story-v4, 28 facts asked late in other words) 11% by keyword and 11% with the
    search model before, 50% and 46% after; story version 3 (20 facts) 0% and 0% before, 45% and 40% after.
    A re-ranker (cross-encoder/ms-marco-MiniLM-L6-v2, 23 MB, on the first 30 finds) was tried and left out: 11% to 18%
    without summaries, and with them at best 46% to 50% on the book and 40% to 45% on version 3, for 0.5 to 3.5
    seconds more a search; re-ranking everything put summaries out and lost (39%, 15%).
  - **The search's own words and the model's queue** (`vectors.ts`): a search's own words are read at the front of the
    model's queue and stopped with the search: after `MEANING_WAIT_MS` (6 seconds) it goes ahead by keyword alone and
    its words are taken out of the queue (`withLimit`, `pool.ts`). Facts' and summaries' vectors are read in the
    background, behind any search's words, waited for while there is time and kept (memory and the index) for the next
    search; passages' vectors come only from the background indexing. A text being read is never read twice, however
    many searches (the Context tab, a draft, the cost estimate) ask for it at once.
  - **The search index** (`store.ts`; Adam's go, 2026-10-07): one file in each world folder, `search-index.db`, beside
    world.db and history.db. It holds the passages with a full-text index, the scenes' and chapters' summaries with one
    of their own (2026-10-19), and the search model's vectors by the hash of their words. Everything in it can be made
    again from the world, so it never stops a world opening: a missing file is made; a damaged one is moved aside as
    `search-index.db.damaged-<time>` (never deleted, as history.db's) and started afresh; one locked by another program
    or from a newer AI Write is left as it is, and an index in memory stands in for that session. It is brought up to
    date by the hash of each scene's words (`indexing.ts`), so a backup brought back or a copied world is caught: in the
    background 4 seconds after a world opens (a few scenes at a time, each batch's words read again just before they go
    in, stopped when the world closes: `world.ts`), and for the scenes changed since, just before each search; when that
    catch-up fails, the search goes without earlier passages rather than send words that may be gone. Exports, world
    copies and backups leave it out (it is made again where the world lands); deleting a world moves it with the folder.
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
  Thinking (`settings.thinking.check`, Off). Generation records use job `'check'`; a scene's checks share the system
  prompt `[AIWRITE-CHECK v2] scene` and name their checks in their task, `[AIWRITE-CHECK-TASK v1] <checks>` (see "The
  checks' cost" below); comparing stories starts `[AIWRITE-CHECK v1] story`.
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
  on the Consistency page, and ends in a toast. Since the calm overhaul every run, whoever started it, is in this one
  store, and every way to ask for a check is the one Check (see "The calm overhaul").

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
  tracked change, no AI call), or starts Rewrite on the sentence; `onAccepted` marks the issue fixed (Rewrite's words
  only once they pass check and repair: "The critic knows the story and remembers").

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
  the story's, series' or world's tone), since models follow what comes last most closely. Since the writing instructions
  overhaul (below) the drafting writer gets the rules against AI phrasing merged into its own rules, and only jobs with
  instructions of their own (a sample, the polish pass, the AI edits) get the "Write like a person" list.
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
- **A chapter** (the binder's chapter menu "Interview me about this chapter", and the palette): since 2026-10-20 Plan this
  chapter, inline in its row of Build with AI's story line (`planHub/ChapterPlanPanel.tsx`; the outline view with a
  `chapterId` and its page `ChapterPlanner.tsx` before), showing the chapter's goal (editable, saved to the chapter) and the
  interview. When it ends, `startChapterPlan` streams the outline helper's form with no chapter heading; it is a
  helper session of its own (`helperStore.suggestChapter`, key `<story>#<chapter>`) whose `lead` is the chapter's
  heading and whose chapter node starts out kept, so `Suggestions` (with `chapterId`) lists the scene cards and Keep,
  Edit, Discard and their Undo work as on the outline helper's page. A goal in the reply goes to the chapter only
  while it has none, with Undo; when it has one, a toast says it was kept (quoting the plan's goal when short). A
  scene fill that is stopped says nothing on the card changed, and a failed card or goal save shows its error. The first scene kept into a chapter whose only scene is an untouched "Scene 1"
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
  Since 2026-10-17: names are also all-caps words of 3 letters or more that aren't common acronyms, numerals or
  shouted ordinary words; a name is found in the recipe in any case when it is plainly made up (capitalised twice,
  never in lower case, no ordinary word), and a name that is also an ordinary word ("Will") only where it is
  capitalised mid-sentence.
- **Fixes of 2026-10-17.** A chapter's notes count only with two of `Moves:`, `Roles:`, `Style:` and when they aren't
  a refusal (`shared/refusal.ts`); else asked once more, then the chapter is "couldn't read" (`unread`, said on the
  recipe page and in the finished toast; none read at all pauses). The recipe's reply room is
  `min(maxOutput, 3500 + 40 × chapters)`, counted in the estimate; a cut-off reply is said in `finished.note`. The
  combine room leaves out the pacing table and headings, and each chapter gets only its share. The fix call's room
  follows the leaking parts. Changing the library folder stops the make there (left to carry on) and the new
  library's recipes carry on. Hand-edited `recipe.json` parts are read as text; a `version` over 1 is never made or
  written ("This recipe was made by a newer AI Write; update to open it"). Cancel refuses a finished recipe;
  `startRecipeStory` refuses an unfinished one. Read the story again's toast says the cost, with Cancel. Plan sessions
  are kept in `<id>/plans/<storyId>.json` (the recipe page lists them, "Go on planning"). `unapplyRecipe` puts a value
  back only while it is still what the recipe set.
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
- Each character and place its kept cards name becomes a page and is built out, as with the outline helper ("A new
  story's world", below). Not yet: "Interview me" for a recipe.

| Part | Owns |
|---|---|
| Story recipes | `contracts/recipes.ts`, `ipc/recipes.ts`, `src/main/recipes/`, `features/recipes/`, the `recipe` job (types, defaults, `jobModel`, providers, Settings › Models), `tests/fake-provider/recipes.mjs`, `tests/e2e/recipes.spec.ts` |

## The New look (Classic retired)

(Code comments still call this section "The two looks".) **Classic is retired** (Adam, 2026-10-19: "retire classic
gui and no longer update it from now on"): the **New look** ("Lamplight") is the only look, and Classic is no longer
updated. Settings › Appearance has no Style choice any more, only the Layout (desk or panels, below). The setting `look`
is still kept in settings.json and painted as `<html data-look>` (`features/look/look.ts`; the window opens in it,
`--aiwrite-look=…`, `window.aiwrite.initialLook`), but it is always `'new'`: `lookOf` (`contracts/look.ts`) answers the
New look whatever is kept, `getSettings` (`src/main/settings.ts`) moves a kept `'classic'` to `'new'` keeping every
other setting, and `updateSettings` never keeps anything else.
- **One-time notes** (`features/look/LookNote.tsx`, one at a time): someone whose settings still kept Classic is told
  once that it has been retired and that their stories and settings are unchanged (`classicNote`, `classicNoteDue`);
  someone updating from before the New look (a settings.json with no `look`) is told about the New look once, offered
  the panels on the desk, never Classic (`lookNote`, `lookNoteDue`); someone already on the New look moved to the desk
  gets the desk's note (`arrangementNote`, below). A fresh install gets none.
- **App tests** run in the New look, on the panels unless they ask for the desk (`AIWRITE_LOOK=new` and
  `AIWRITE_ARRANGEMENT=panels` in `tests/e2e/helpers.ts`); `AIWRITE_LOOK=new` only keeps the one-time notes away (a
  leftover `'classic'` means the same), and `AIWRITE_LOOK: ''` gives what Adam gets. `tests/e2e/look.spec.ts` covers
  the move from Classic and the notes. Specs reach the panels' places with the helpers in `tests/e2e/helpers.ts`:
  `openPage` (a page Classic's binder listed: its area on the rail, then its row), `openWrite` / `showTree` (back to
  the story's tree, which only the Write area's list holds), `areaButton`, `areaRow` and `sceneTitle`.
- **Classic-only code awaits removal** (a later tidy-up): the `look === 'classic'` branches and the components and
  CSS only they reach (`ClassicSettings`, `ClassicAppearance`, Classic's binder, map, timeline table and Consistency
  page, the `look-classic:` variant, Classic's Literata and Lucide icons, the `classic` background colours in
  `main/index.ts`). Nothing in the interface can reach them; don't change or fix them, and don't add to them.

What follows is how the New look was built over Classic; read "Classic's values" as the tokens' fallbacks.

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
  - *Folding sections* (`components/ui/Fold.tsx`): a section's contents open by growing the row's height from nothing
    (a grid row, 0fr to 1fr) as they fade in, 220 ms, and close in 140 ms before they go (inert meanwhile). Clipped
    only while they move. At once from the keyboard, with less motion, or when the section is already open as the
    screen arrives. World page sections, the check report, world cards on the start screen, earlier suggestions, and
    the story line's chapters and scenes (`as="li"` where the contents are a list item). "Show me" on the story line
    scrolls once the fold has grown.
  - *A story board card let go somewhere new*: it and its pin glide from where they were let go into the new place,
    and the cards that made room glide too (FLIP with WAAPI's `translate`, 220 ms; the dropped card keeps its z-index
    and loses its lift as it lands). Not from the keyboard (Alt+arrows) or with less motion.
  - *The floating binder* closed from the pointer leaves toward its edge (8 px, fading, 140 ms) before it hides.
  - *The tour* fades in when opened from the pointer; its light and card glide between steps (280 ms, the drawer's
    curve: left, top and size, since the light is a cut-out in a shadow), and each step's words fade in. Keyboard
    steps move at once.
  - *Finished moments*: import done, and a chapter just written with AI (only when watched, and only on the new
    report), get the tick that draws itself.
  - Code that waits on a motion token reads it with `tokenMs` (`features/look/motion.ts`): the built CSS writes
    220ms as .22s.
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
- **Classic's screenshot guard is retired** with Classic (`tests/e2e/classic.spec.ts` and its baselines are gone);
  `desk.visual.spec.ts` keeps the New look's pictures.
- Contrast: `tests/unit/contrast.test.ts` checks the New look's colours and kind inks in every theme and accent.
- **The New look's two layouts** (UI overhaul, phase 2; spec notes/ui-overhaul-v2/desk-build-spec.md): Settings ›
  Appearance › Layout chooses the **desk** or the **panels** (the rail and side list above), kept as `arrangement` and
  painted as `<html data-arrangement>` (`features/look/look.ts`: `useDesk()`, the `desk:` variant).
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
choice in Settings › Appearance › Layout.

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

The New look draws these its own way (both layouts). The pages Classic had stay behind a `look === 'classic'` branch
in each until the tidy-up removes them (Classic is retired, so nothing reaches them).
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
  proposes nothing, the claim is put right in plain words (since 2026-10-19: see "The chat never claims a change it
  didn't make"). Earlier answers are sent again with the changes they proposed noted
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
  Since the writing instructions overhaul (2026-10-19, below) the previous scene's end goes right above the scene card
  instead, after how the people in the scene sound: 56% of that short-story step is sent again, not 69%.
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

## The writing instructions overhaul (Phase 3, 2026-10-19)

Drafts read as mediocre. A review of the writer's prompts found a system prompt of about 890 words with 27 bullets, the
same rule said two or three times ("show feeling, not stock body reactions" three times), plain-word rules talking down
presets that ask for lush prose, and a closing instruction mostly saying again what the system prompt says.

- **About ten rules, each said once** (`ai/prompts.ts` `writerInstructions`, `craftRules`): the format; the scene card
  (wants and pushing against each other within the planned events, never new ones); point of view; specific detail; voice
  and subtext; feeling shown, not explained; rhythm; plain words; the ending; the briefing (canon, aims, names). The two
  rules only about AI habits ("it wasn't X, it was Y", plain words) go with "Steer clear of common AI phrases"; the "Write
  like a person" list (`shared/slop.ts` `SLOP_RULES`, `aiPhrasesText`) is only for jobs with instructions of their own.
  Add below keeps its lab-tested rules first, then the same craft. Measured (epic fantasy, close third, past, UK, no
  sample, two phrases to avoid): 892 words to 826, 18 rules to 10 (27 bullets to 19 with the style guide and the rest).
- **The style guide outranks the plain-word rules**: the list opens "Where the style guide or the sample passage below
  asks for a different style, follow it over these rules."; `PLAIN_RULE` ends "unless the style guide asks for richer
  prose" and is left out where the prose style asks for rich prose (`asksForRichProse`: Lyrical literary, Steamy romance,
  Spicy romantasy, or Adam's own words). The polish pass's "Purple prose" check says the same (`style/prompts.ts`).
- **Generate's closing instruction is about craft** (`finalInstruction`, `ScenePoint`): it opens with the scene's point
  (what the point-of-view character wants, what stands against it, how it turns: the card's goal, conflict and outcome,
  each at most `POINT_WORDS`), then two craft priorities, then "Hit every beat on the scene card, in order, and let them
  carry the goal, the conflict and the outcome". The format, point-of-view and "never contradict" lines are gone: the
  system prompt and what must stay true, right above, carry them. Add below's and Beat by beat's closings are unchanged.
- **Late in the briefing** (`ai/context.ts` `SEND_ORDER`): the previous scene's end goes right above the scene card
  (about 1k tokens a step no longer come from the cache), after "How they sound" (`VOICES_BLOCK`, priority 3, no short
  form): one line each for those in the scene whose profile says how they speak, their tics or what they never say
  (`VOICE_WORDS`; never sample lines), sent only when someone has one.
- Not changed: the epic fantasy preset's prose style still says much of the fantasy genre's guidance again; rewording a
  preset would stop stories that use it matching it (`presetOf`).

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
  reaches it), with the beat's menu: Redo this beat, Change it… (the change box: a note and sentences to keep; "Keep this, change that"), What the AI saw (that beat's
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
- **A new story's world (Adam, 2026-10-17).** A keep first makes a page, drafted by AI, for each character or place a
  kept card names that the world doesn't have (`addMissing` in `outline/chapterCard.ts`; stand-ins such as "none",
  "everyone" or a lower-case description are skipped), so the cards point at them. A room or spot inside a bigger place
  comes as "Kitchen, Venn House" (or "Kitchen – Venn House"; `CHAPTER_CARD_FORM` asks for it): `findPlace` means the
  kitchen inside that house, never another house's, and `addMissing` makes the house if needed and the room inside it
  (`parentId`). Their ids are `KeptItem.entryIds`,
  and the keep's Undo takes them back with its plot threads (`takeBackThreads`: never one Adam has edited, one on
  another card, one the memory holds anything about, or a place something left is still inside). When a keep made pages or threads, or started a fresh
  story (it took the place of the story's empty first chapter: 0.7.5, since a recipe's plan often names its cast only in
  its premise and summaries), the window asks `buildStoryWorld` four seconds after the last keep (`features/worldBuilder/storyBuild.ts`; one asked while a build
  runs waits for it): a World build from a summary written from the story (`worldBuilder/storySummary.ts`: premise,
  themes, tone, and each act, chapter and scene card with who, where, when and its threads), never kept as the page's
  `world_summary`. The build leaves what is in the world as it is and its last steps fill in the thin pages (looks,
  personality, voice...) and give the characters voices, so the story starts with its cast, places, groups, items, lore
  and threads. A toast follows it ("Building your story's world: ...", then what it made, with "See it").
- **With plot threads (0.6.36).** A kept scene gets both: its chapter card parts (`ownParts`, `sceneWhen`) and the
  "Sets up" / "Pays off" links as the AI's (`withThreads`), all in one card write through `resolveCardWrite`, so
  `card_json` carries `inherits` and `threadLinks` side by side. `unkeepOutline` undoes both: the chapter cards it
  filled, the AI links on a reused first scene (`acts.takeBackKept`), then the threads it made (`takeBackThreads`).

## The scene and chapter critic (Adam, 2026-10-09)

Craft feedback on a scene or a whole chapter, only when Adam asks: never run by itself. It judges craft, never continuity
(that is the consistency checker's, and its report in the Issues tab stays as it is). Contract `contracts/critique.ts`,
main side `src/main/critique/`, handlers `ipc/critique.ts`, the tab `features/critique/`.

- **Where.** The scene's Issues list › Craft notes since the calm overhaul (below; the scene panel's Critique tab before), with This scene /
  This chapter (the open scene's chapter); Critique scene and Critique chapter there (Stop while it reads), and the
  palette's "Critique this scene", "Critique this chapter" and "Scene critique" (the tab).
- **The request** (`critique/run.ts`, `prompts.ts`): one 'critique' record through the task runner, with the writer
  model and its Thinking, `[AIWRITE-CRITIQUE v1] scene|chapter`. A lean briefing fitted with `outline/briefing.ts`
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

## The critic knows the story and remembers (2026-10-16)

Adam: the critic should work with the story. Its notes went stale (a note acted on still offered Rewrite), it had no
Dismiss, each run hunted afresh and could reverse itself ("drags", then "rushed"), it knew little of the story, and a
rewrite it suggested skipped every consistency check. No migration; everything new is in `meta`.

- **Facts to respect** (`critique/prompts.ts` `factsForms`, gathered by `run.ts`): the premise, the themes (the story's,
  else its series', else the world's), the content level (`intensityLines`) and limits, what the card plans (goal,
  conflict, outcome, beats, notes, the threads it sets up or pays off; for a chapter, the chapter card's notes and a line
  per scene's card), the chapter's goal, plot threads with when each is due (`dueForCritic`, from the promises ledger:
  "later: not a missing pay-off here"; those on the card first, then `openThreadsAt`), the scene's contract from its
  latest checked draft (`checks/report.ts` `checkReport`), and the open must-fix problems whose words are still there.
  Three forms; the block is priority 3 with `BlockDraft.keep` (outline/briefing.ts `fitBlocks`: shortened to its last form,
  never left out), so it shortens before the words and is never dropped first. The card block keeps only who, where,
  when and mood. "How the story is written" adds the style guide's notes; the scene before is about 350 words (then
  120). New rules: never suggest cutting what the card, the contract or a due thread requires; a set-up paid off later
  isn't missing; never ask to tone down content the level allows; never repeat the open problems.
- **What Adam did about a note** (`CritiqueNote.status`, kept in the critique: `critique/store.ts` `settleNote`,
  `AppApi.settleCritiqueNote`): **Done** when its rewrite is accepted (with `newWords`, the words put in; `at` guards a
  critique replaced since), **Not needed** (this scene or chapter), **Not for this story** (also kept per story,
  `critique_wants:<story id>`, a list of `CritiqueWant`, `critique/memory.ts`, SQL in `db/critiques.ts`). Each has Undo
  (a toast) or "Not done yet" / "Bring back" on the card; the tab lists the story's kinds under the notes with Allow
  again (`dropCritiqueWant`). Notes acted on or not needed carry to the next critique of the target
  (`Critique.earlier`, `carryEarlier`, at most 12). Critiques and the story's list go in `purgeTrash`
  (`dropCritiquesOfGone`).
- **Told to the critic** as "What the author has said he wants" (`saidForms`: the story's kinds, at most 12; notes not
  needed here and those acted on, at most 8 each), keep. **Critique again** (the tab sends `again` whenever a critique
  is kept; the chapter writer passes `by: 'chapter-writer'`, keeping its lenient `AGAIN_LINE`) sends "Your notes last
  time" (`earlierForms`: P1… with what became of each, "its words have changed since" included) and `SECOND_LINE`; the
  reply may say `"settled": ["P1"]` and a note `"earlier": "P2"`. **The guard** (`guardNotes`), whatever the model says:
  a note like one set aside, of a kind not for the story (same title), giving again one set aside, or the same kind on
  the words of one acted on (unless it says it is that note still standing) is left out. `Critique.reread`,
  `settledSince` ("Since last time, 2 notes are settled."), `repeated` ("Still stands from last time").
- **Stale notes** (`SavedCritique.gone`, `goneNotes`: still-to-do notes whose quote `findSceneQuote` no longer finds): the
  card dims its body (opacity, `critique.css`) and its tag says "These words have changed"; Rewrite this and Show stay,
  disabled, so nothing moves. The tab keeps checking while any note still to do has words, not only until the banner.
- **A critic rewrite is checked** (`features/critique/actions.ts`): on Accept, the note is marked done and the new words
  go through check and repair as a landing draft's do (`repairLanded`, with the edit's record from
  `OnAccepted(words, recordId)`, `edits/session.ts`). **Fix the text's Rewrite** (no ready-made fix) does the same
  through `repair/checkedFix.ts` `fixedOnceChecked`: the issue leaves the list at once, and is marked fixed only when the
  check ran and asked nothing (`checkLanded`, `LandedCheck`); otherwise the list is read again and the issue, its words
  gone, is put away as gone, so an unchecked fix is never taught as a slip (fix 7).
- **The chapter writer's critiques** keep `by: 'chapter-writer'`; the tab says "Re-read after the chapter writer’s
  changes." (or "Read during the chapter writer’s run.") under the summary.
- **Tests**: `critique/memory.test.ts`, `features/critique/critiqueLogic.test.ts`, `repair/checkedFix.test.ts`,
  `tests/e2e/critique.spec.ts` (the fake answers Critique again: `tests/fake-provider/critique.mjs` `earlierNotes`).

## Write the whole chapter (Adam, 2026-10-10)

Reworked on 2026-10-19 (see "Write the chapter, reworked" below): the study, the agent's sessions and the proofread are
gone; what follows is how it was built, and what still holds (the pages, Undo, the hold, the job, the window).

One action writes a whole chapter from its scene cards and keeps working on it until it is right: in line with the
codex, Recall and the timeline, consistent from scene to scene, the critic's notes dealt with, and proofread. Adam's
choices: it is agentic (the AI decides what to look up and how to fix things), the AI corrects itself (its changes go
straight in, with the words before kept for Undo), every scene with a card is drafted, even ones with words, there is
no cap on rounds (since 2026-10-16 there is: see "Write the whole chapter settles" below), and every critic note is
weighed. Contract `contracts/chapterWriter.ts`, main side
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
  checks) and the critic's notes, numbered F1, F2... across the run. The critic reads in the first round only, and once
  more at the end for Adam (told it is reading again, `CritiqueRequest.again`, `critique/prompts.ts` `AGAIN_LINE`): read
  again every round, it still found new things to say (see "Write the whole chapter settles" below).
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
- **Never stuck, never runaway** (`progress.ts`; the limits since 2026-10-16 are in the section below): it stops when clean, on Stop, at the monthly spending
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
- **The window.** (Since 2026-10-20 every way in opens Build with AI at the chapter, Write this chapter open in its row:
  see "Build with AI"; the start dialog and the plan's dialog below are gone.) The binder's chapter menu ("Write this chapter with AI…"), the palette ("Whole chapter with AI")
  and the chapter card's "Written with AI" group open the start dialog (`ChapterWriterDialog.tsx`, mounted once): the
  scenes, which have no card to write from (left out), and that words already there are replaced but kept for Undo.
  While it works, the top bar shows what it is doing with Stop and what it has spent (`ChapterWriterStatus.tsx`), and a
  scene of the chapter open in the page can be read but not typed in (`hold.ts`, dimmed, `chapter-held`); each change
  shows in the page at once (`chapterWriter:sceneChanged`, `replaceScene`). It ends in a toast with Show (the report on
  the chapter card, `ChapterWriterReport.tsx`) and Undo.
- **Tests.** `chapterWriter/chapterWriter.test.ts` (the fake provider scripts the agent's calls, `tests/fake-provider/
  chapter.mjs`; the critic's fake finds a re-read ready).

## Write the whole chapter settles (2026-10-16)

A live test on DeepSeek Flash (a 30,000-word book, 0.7.2 at d05d4f00) spent about 2 hours on one five-scene chapter: 14
rounds, about 280 changes and 93 set-asides, and it ended stuck with 10 things open, one a sentence printed twice in a
row. Its review sessions used about 50 of the run's 60 million input tokens, and its scenes were judged no better than
plain Generate's. The test's own records said why: the critic, read again with `again`, still gave 5 to 7 notes every
time (new ones: its re-read never ran dry); review sessions spent their 28 requests reading every scene of the story
(about a million tokens each) and many fixed nothing; revise told the agent to read the scene again after every change;
and revise can't name one copy of words that are in the scene twice. What changed (no migration, no new kind of AI call,
fewer calls):

- **The critic reads once** (`run.ts` `gather`): every scene and the chapter in the first round, never `again` in later
  rounds. Its notes carry from round to round (`carried`) until the agent fixes one or sets it aside, or its words are no
  longer in the scene. `check_again` in a session runs the checks only, with the carried notes. At the end (clean, or at a
  limit) **the critic's last read** (`lastRead`) reads once more each scene changed since and the chapter, with `again`,
  so the Critique tab shows the chapter as it now is; its notes are for Adam (the report's "Worth a look" says how many,
  by scene), never acted on, and a read that fails is passed over.
- **A finding that keeps coming back is left for Adam** (`progress.ts` `Tries`, `sameFinding`): the same finding is the
  same scene and source with the same words said of it, or the same aspect (a check's kind without its severity, a
  note's category without its weight) of overlapping words (`wordsOverlap`: one inside the other, or 6 words in a row
  in both), as the checks reword what they find each time. Each is given to the agent at most `MAX_TRIES` (2) times, and
  only once when it is found again on words the agent itself wrote this run (`written`, from revise and rewrite_scene:
  the agent arguing with its own fix). One set aside (checks too, now: `SessionDeps.setAside`) is never given again, and
  a check's row for it found again is set aside too. What is left goes in the report's Still open and stays open in the
  Issues and Critique tabs; a run that ends with only those left says "The AI fixed what it could, but 2 things came back
  after it had tried, so it left them for you: …" (status `stuck`).
- **Limits** (`contracts/chapterWriter.ts` `CHAPTER_WRITER_LIMITS`): at most 3 rounds of fixing, and none started after
  60 minutes (`RunDeps.clock` for tests); the checks after the last round still run, and what they find is listed: "The
  AI stopped after 3 rounds of fixes, as it always does, so it never runs on for hours. 2 things are still open: …". The
  start dialog says so (`chapterWriterLogic.ts` `LIMIT_WORDS`), and the top bar's panel says "for at most 3 rounds of
  fixes". The guard (`ProgressGuard`) still stops a run going round in circles before that.
- **Sessions that act** (`tools.ts`, `prompts.ts`): each session has `LOOKUPS_ALLOWED` look-ups (review 10, chapter 14,
  study 40, the timeline and the brief counted too); past them a look-up answers "No more look-ups in this session: you
  have what you need. Deal with each finding now…". A read of a scene of the chapter whose words haven't changed since
  the model was last shown them (the scene in the session's opening, a full read, or after its own revise) answers that
  its words are above, uncounted. revise says to go on without reading the scene again. The review prompt says the
  scene's words are below, to look up only what a finding needs and not to read other scenes unless a finding is about
  them. A look-up naming a scene of the chapter as the session names them ("Sc 2") is passed on as the editor chat's
  look-ups name it ("Ch 4, Sc 2"): the chapter session's read_scene of "Sc 2" found no such scene before.
- **A sentence printed twice in a row** (`page.ts` `dropRepeats`, `run.ts` `tidy`): before a changed scene is checked
  (and in `check_again`), an exact copy of the sentence before it, of 6 words or more, within a paragraph or at the start
  of the next, is taken out (curly quotes and italics don't hide a copy; never when it would leave italics half open).
  Saved like any change, with History, and listed in the report as fixed: "A sentence was printed twice in a row: the
  second copy is taken out."
- **Tests**: `chapterWriter/chapterWriter.test.ts` (the critic asked in round 1 and at the end only, with a critic never
  satisfied; three rounds of fixes; an hour; a finding back on the agent's own words; a sentence printed twice; the
  look-ups and unchanged reads; `Tries`, `sameFinding`, `dropRepeats`). The fake agent's chapter session now reads Sc 1
  and sets its findings aside, quoting it (`tests/fake-provider/chapter.mjs`), as a chapter-wide note nobody deals with
  is now left for Adam rather than forgotten by a re-read.

## Write the chapter, reworked (Adam's spec, 2026-10-19)

Adam: "Write this chapter with AI" was limited, basic and gave poor results. The spec ("Write the chapter, reworked"):
plan the whole chapter first, then write every scene against that plan; make fixes from a short list of real problems,
not repeated full read-throughs. The study, the review, chapter and proofread sessions and the critic's last read are
gone (`ChapterSession`, `write_brief`, `revise`, `not_a_problem`, `check_again`); the drafts, the checks, the critic,
Undo, History, the hold on the page, Stop, the hour and `ProgressGuard` stay. No migration (the report and the words
before are in `meta`, as before; `ChapterWriterReport.plan` is new and optional).

- **1. The chapter plan** (`chapterWriter/plan.ts` `makeChapterPlan`, prompts `planSystem`, `WRITE_CHAPTER_PLAN`): one
  agent session (the chapter writer model, job 'chapter', `[AIWRITE-CHAPTER v1] plan`) reads the chapter card and each
  scene card, with what the story index gives at no cost as the chapter begins (`chapterCore`: everyone on the cards,
  `stateOf`; the scenes of the last two chapters, a line each; the open threads; the index's free checks on this
  chapter's cards, `indexChecks`, which go straight into the questions), looks up what else it needs with the look-up
  tools (`ai/lookups/`, at the chapter's first scene as it begins; `LOOKUPS_MOST` a round, `PLAN_LOOKUPS` 16 in all,
  `PLAN_STEPS` 4 requests) and calls `write_chapter_plan` (or, at its last request, which has no tools, replies with the
  same JSON). For each scene: `does`, `threads` moved on, `changes` ({who, change}: where they end up, what they learn),
  `keep` (facts from the look-ups), and `questions` for Adam. `checkChapterPlan`: a part for every scene in order (one
  left out is planned from its card's goal and outcome; asked once to cover every scene), only people the codex has under
  changes, lists kept short; `partText` makes each part the words the writer is given and Adam reads. A plan never
  written is made from the cards, with a question saying so; a call that fails stops the run as before.
- **The plan is shown to Adam before writing** (since 2026-10-20 inline at its chapter in Build with AI, built to the
  mock-up: see "Build with AI"; `RunDeps.review`; ipc: progress stage 'review' carries
  `ChapterWriterProgress.plan`, and the run waits, with no time limit, for `answerChapterPlan` or Stop). The window
  (`features/chapterWriter/ChapterPlanReview.tsx`, mounted beside the start dialog, which is unchanged): the overview and
  each scene's part, with Write, Change the plan (each part, and the overview, as text boxes) and Cancel. Escape only hides
  it: the top bar says "The chapter plan is ready for you" and opens it again. A part Adam changes is his words from then
  on (`withAnswer`, `changed`); Cancel (or Stop while planning) ends the run as `cancelled`, "Cancelled before writing:
  nothing in the chapter changed." The time spent over the plan isn't counted against the hour.
- **2. Each scene in order** (`draftAll`, as before: the memory catches up on the scene before first). Its part of the plan
  (with the overview, and `LATER_START` for a later scene) goes to the draft: as the writer's block "This scene's part of
  the chapter plan (keep to it)" and, through `draftBriefing({ chapterPlan })` → `withPlan` → `planBeforeWriting({
  chapter })` → `planMaterial`, to the scene plan, which reads it right after the scene card (`CHAPTER_PART_TITLE`: build
  the scene plan on it) and makes its own round of look-ups. Plan before writing off: the writer still gets the part.
- **3. The state check** (`gather`): for each scene written or changed, plain matching first: someone the plan has change
  in the scene whom the words never name (`planMisses`; never the card's point of view, who may tell the scene unnamed),
  a stock AI phrase or two in a fresh draft (`phraseFindings`, `PHRASES_MOST` 2, first round only: the proofread's part
  that stays), the free rule checks (with the check, as always); then one short AI call, `checkScene` with
  `STATE_CHECKS` (facts, timeline, continuity, knowledge) and the new `CheckOptions.together` (one request, not
  `CHECK_GROUPS`' two), through the scene's contract made from its plan, so what the plan says must change is checked
  item by item. Voice and style are left to the critic. The scene after each changed one is checked for what is so
  (`FOLLOW_ON_CHECKS`), the next chapter's first scene noted for Adam, as before. **The critic reads the chapter once**
  (scope chapter, never `again`), in the first round; its notes of some weight on words in a scene are fixed, the rest
  (small ones, ones about the whole chapter) are one line for Adam under Worth a look.
- **4. Fix only what was flagged** (`fixAll`, `chapterWriter/fix.ts`): a scene that misses its plan (a plain miss, or what
  its contract says must change and the words don't show: `contractMisses`, the contract's "not yet") is written again
  whole, once (`REWRITES_MOST`), with a direction naming what it missed (`missedDirection`); what it still misses then is
  Adam's. Everything else, one problem at a time: the words it points at are found in the scene (`passageFor`, ask/anchor
  tolerant matching), widened to their whole paragraphs (at most `MAX_FIX_WORDS`), and the writer model rewrites only
  that passage (`[AIWRITE-CHAPTER v1] fix`, `fixSystem`: the job, then `instructionsText` with the writer's own rules,
  style guide and whole sample passage; at the writer's temperature, `writerTemperature`, and the preset's top_p and min_p;
  given the scene card, its part of the plan, about 160 words before and 90 after, and the problem with its advice).
  Before, the agent's revise wrote at 0.3 without the style guide. A reply that isn't a passage (empty, the same, far
  longer or shorter) changes nothing; one whose words have gone is dropped; a fixed check issue is marked fixed, a
  fixed critic note done in the Critique tab (`settleNote`, with the new words). Words found but not in the scene, or
  with no words, are left for Adam untried.
- **Limits** (`CHAPTER_WRITER_LIMITS` `{ fixRounds: 2, minutes: 60 }`; each problem at most `MAX_TRIES` 2 tries,
  `Tries`, once only on words the run wrote): the checks after the last round still run and what they find is listed.
  `ProgressGuard` still stops a run going round in circles, but only after a round that changed words (a round whose
  fixes changed nothing is tried again within the tries).
- **5. Hand over**: the report's fixes in plain words ("The critic: The middle slows", or what the check said), scenes
  written again with why, Still open, Worth a look, and "The chapter plan the scenes were written to" (`report.brief`, the
  plan as text; `report.plan`). The start dialog's words and the top bar's say the new flow.
- **Measured** (`chapterWriter/requests.test.ts`, three scenes after a chapter of long ones, fake provider, the drafts
  and their scene plans stood in for as before): with a planner that looks things up until stopped, 61 requests and
  2,669,425 characters before, 15 and 139,611 after (plan 4 / 17,181, state checks 8 / 95,742, critic 1 / 16,244, fixes
  2 / 10,444); with one that goes straight to work, 35 and 328,615 before, 13 and 127,690 after.
- **Tests**: `chapterWriter/chapterWriter.test.ts` (the plan first, read and checked; the plan reaches each draft; Adam's
  changes and Cancel; the state check once a scene in one request; the critic once; targeted fixes in the writer's voice
  and settings; a plan miss written again once; two rounds; two tries; an hour; Stop), `plan/paths.test.ts` (the scene
  plan builds on its part), `tests/e2e/chapterWriter.spec.ts` (the New look: the plan view, Change the plan, Cancel,
  Stop). The fake (`tests/fake-provider/chapter.mjs`) looks Mara up, then plans a part for each "### Sc N", and fixes a
  passage by adding "The rain went on.".
- **Not done here**: the fix doesn't say which appearance of words found twice in a scene it means (it takes the first);
  the critic's notes about the chapter as a whole are left for Adam, never acted on.

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
  draft lands), and a finding Adam *meant* (ignored; since "The checker catches more", below, never the chapter writer's
  set-aside, and voice and style too). Not style, voice or continuity (about one moment), and not a
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
  `withBrief`). *Until 2026-10-20; since then it reads far less, never the book: see "The plan reads less" below.* Besides what the plan always read (the scene card, what must stay true, where things stand, the words just
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
  each step, so it is sent late (`SEND_ORDER`: after who knows what; since the writing instructions overhaul only how they
  sound and the previous scene's end come between it and the scene card), and every block before
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
  the issue is marked fixed, then the issues are read again. The writer model's rewrite (no ready-made fix) goes through
  the critic's `fixedOnceChecked` first (its check saves the page too): marked fixed, in the same way, only once its new
  words pass, and not when Ctrl+Z took it back meanwhile (`fixHistory.ts` `fixUndone`).
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
  Unlike Ignore it is never taken as meant (fix 7's lessons read only fixed and ignored rows), and like any choice of
  Adam's it ends the chapter writer's set-aside tag (`setLater` drops `setAsideBy`; one it set aside becomes open and
  put off). Toast: "Saved for later.
  It comes back when you change that part of the scene, or when the scene is checked again." with Undo (Reopen, which
  ends Later). The Issues tab folds them under "Show for later (n)" with Show now; the story's lists leave them out and
  say "· 1 saved for later". The sample world raises nothing, so Classic's screenshots are unchanged.
- **Tests**: `checks/staysCurrent.test.ts` (the sweep, places, rows coming back, Later, clashes, the report and the
  saved contract), `checks/run.test.ts` (Check this scene and Mark done through the contract, the fingerprint, Later after a
  check), `keeper/memoryChecks.test.ts` (the note), `features/issues/fixHistory.test.ts` (Ctrl+Z and Ctrl+Y),
  `features/issues/issuesStore.test.ts` (read again on coming back),
  `ask/applyStory.test.ts` (saved before marked fixed), and the app test "findings stay current" in
  `tests/e2e/issues.spec.ts` (Later, words rewritten by hand, Ctrl+Z, the report's count and its "changed" line).

## The checker catches more (2026-10-16)

A live run of the long test book's planted slips (fix 6) found "Check this scene" caught about 6 or 7 of 12. A replay of
its real prompts and replies said why; each cause has a fix. No migration, no new kind of AI call; one more call per check,
and only when the checks found something (the second opinion below).

- **Continuity findings are kept** (`checks/parse.ts` `checkOf`): "continuity" (and "staging", "where things stand",
  "clothing"…) had no reading, so with more than one check asked every continuity finding was thrown away; it is read
  before the timeline, as "stage" has "age" in it. The X6 reply's two findings: none kept before, both now.
- **The facts a scene touches, however old** (`checks/context.ts` `factRelevance`, `factsThatMatter`'s `rank`). Who knows
  what was cut to the 40 most lately learned facts. Each fact is now scored by the scene's own words (keyword search,
  `retrieval/rank.ts`, without the names of the people here) and, when the search model is on, by meaning
  (`checks/run.ts` `rankByMeaning` → `RunDeps.byMeaning` → `retrieval/index.ts` `meaningForCheck` → `recall.ts`
  `meaningScores`, the scene's passages against the facts, within the usual wait; off, slow or failing: keyword alone).
  That counts for more than naming something there (`RANK_WEIGHT`: on the live run's world, facts naming the clock-house
  crowded out "Leckie's heart is failing" from the scene about it), before recency; entries only tied to the scene
  (below) don't count as named. The facts check, in its own request, now gets the ten facts the words touch most
  (`factsTheWordsTouch`, "What people here know that this scene touches").
- **Entries tied to the scene though it doesn't name them** (`relatedEntries`, `MOST_RELATED` 8): the point of view's
  family the words speak of ("her father": a relationship or a summary that says so), then, scored, what people here
  hold, entries an entry already told names (one step: the town a named person lives in; most when the scene names that
  entry), entries sharing the scene's distinctive words, and entries whose own words name someone here (half for naming
  only the point of view unless it is an item, an event half again). Each says why ("tied to someone here"). Never a plot
  thread; check and repair leaves them out unless its new words name them. On the live run's world the X3 scene now gets
  the Long Patience and the X8 scene Hollin.
- **The author's plan and records** (`checkSections`). The card's goal, conflict, beats, outcome and notes, and the threads
  it sets up or pays off, as "The author's plan for this scene" (`planText`; the instructions: what the plan asks for, a
  lie or a mistake, is not a slip); under When, the story calendar's "Story date: … (2 days since the scene before)" and
  ages (fix 11, `storyDateLines`; with a rule that where things stood need not carry over hours or days); and "Plot
  threads still open" with when each is due (fix 10, `openThreadsAt`, `threadDueWords`, 6 at most), for the checks of
  what is so.
- **What a scene says about the past** (`checks/prompts.ts`): the facts check also compares names, numbers, which way a
  place lies, how long a journey took, how someone died and who heard or saw what, in the narration, a memory or a line,
  unless the scene shows the character is mistaken or lying.
- **A second opinion before keeping** (`checks/run.ts` `findingsRuling`, `CHECK_SECOND_MARKER`): what a whole check (Check
  this scene, Mark done, the critic, the chapter writer) found about facts, who knows what, the timeline and continuity
  goes through check and repair's second opinion (`repair/second.ts`, with its own instructions for a whole scene and its
  material, each note citing its E or S line and what the memory and the scene say). One call, only when something was
  found; what it rules not real goes. A failed call, a reply it can't read, no room or a stop keeps every finding. Voice,
  style and the contract's own findings (`contractRuling`) aren't put to it.
- **The chapter writer's set-asides are its own** (`db/checks.ts` `setAsideByChapter`, `IssuePayload.setAsideBy`):
  ignored as before, but never told to later checks as what the author meant (`checks/lessons.ts`); any status change
  after clears the mark. The Issues tab says "The chapter writer set this aside" in place of "Ignored"
  (`issuesLogic.ts` `ignoredWords`, `Issue.setAsideBy`).
- **What the author meant travels** (`checks/lessons.ts` `MEANT_ONLY_KINDS`): an ignored voice finding about its character
  however long ago, a style finding from the last `RECENT_SCENES` (about its character, or about the telling when it
  names no one), told to later voice and style checks; check and repair is told what was meant about what is so
  (`repair/prompts.ts`, "What the author has said is meant", `MOST_MEANT` 6, in the steady part of `REPAIR_SEND_ORDER`).
- **The harness** (`tests/traps`): X2 no longer puts the ledger handed over at the Guildhall on Tamsin's desk, nor Kit
  on a pallet (both real slips the checker rightly raised); a catch needs the issue's message to name the planted fact
  (`Planted.reason`; one on the slip's sentence for another reason is a false alarm, "for another reason"), so X7 is no
  longer counted for the wrong one.

## Scenes that hand off to each other (review, 2026-10-16)

Adam writes long books with "Write the whole chapter" and wants each scene to start exactly where the last ended (time,
place, who is there, clothes, positions). A code review found these gaps in the hand-off; each is fixed and tested
(`ai/handOff.test.ts`, `memory/soFar.test.ts`, `chapterWriter/chapterWriter.test.ts`, `ai/contract.test.ts`).

- **The scene after a changed one is checked** (`chapterWriter/run.ts` `gather`). A scene's checks look back at the stage
  before it, never forward, so a review that changed a scene's ending (her dress back on) left the next scene's opening
  (the dress on the floor) unchecked. Each round now also checks the scene after each one changed (`sceneAfter`: the next
  scene in the story with words). One of the chapter's goes to its review like any other; one the run doesn't write (the
  next chapter's first scene, or a scene of the chapter with no card) is checked but never changed, and what its check
  finds that wasn't open before the run looked is noted for Adam: `ChapterWriterReport.notes`, "Worth a look" in the
  report (`ChapterWriterReport.tsx`).
- **Where things stand is read alongside the catch-up** (`ai/gather.ts` `withStageRead`, registered by `keeper/index.ts`).
  It ran after the keeper's catch-up inside the same wait, and the summaries a draft needs first (fix 15) could take it
  all. Since 2026-10-19 it waits for the reads of the scenes just before, whose reading says it too ("One reading of a
  scene"), and still goes alongside the scene's own read and those summaries. It is looked up again once the plan is made (`draftFlow.ts` `withStageNow`: one that came in during the plan's wait
  is told after all). A draft that still goes without it tells Adam (`gather.ts` `stageNote`, `STAGE_LATE`,
  `STAGE_LATE_SO_FAR`): `startDraft` returns `note`, shown as a toast (`draftRun.ts`); the chapter writer's report lists
  it. Not when nothing comes before the scene in its story, or the memory can't work (`keeper/index.ts` `memoryReady`).
- **Add below without a stage for the scene so far** (`gather.ts` `carryOnFrom`). When where things stand at the end of
  the scene so far times out or fails, nothing of where the previous scene ended is told, and the contract has nothing
  for the start (`ContractInput.noStart`; Continue's too, `edits/briefing.ts`), so the check as the draft lands no longer
  holds the new words to an old "blue dress, on".
- **Carrying on, the memory includes the scene so far** (`memory/scene.ts` `SceneMemoryOptions.soFar`, `soFarState`;
  `gatherContextInput`'s `soFar`, Continue's `input.before`). The scene's own changes read from its words count when their
  words (a source link still standing) are in the scene so far: a secret told is no longer "kept from" the one told, a
  thing handed over no longer "still has", a thread paid off no longer open. Never Adam's own changes for the scene
  (aims), nor a change read from words after Continue's cursor. Who first appears in the scene stays as at its start.
- **Smaller ones.** The study gives where everyone starts for the chapter's first scene only; a later scene's notes end
  with `LATER_START` (its start is where the scene before ends, as written). Each scene's contract is made again before
  each of the chapter writer's checks (`ai/contractAgain.ts`, `draftFlow.ts` `contractNow`, from what its draft was
  asked for and the plan's "must"), so an earlier scene's change reaches it. A draft cut off at the reply limit or a
  refusal sent back as words (`DraftEnd.cutOff`, `DraftEnd.refused`) stops the run instead of being saved as the scene.
  An empty scene (not written yet) is passed over when looking back (`memory/line.ts` `previousSceneStep`'s `take`,
  `memory/scene.ts` `previousScene`, `continuity/tracker.ts` `wordedBefore`), only within the story of the scene just
  before. A direction that only says how the words should read ("make it darker": `ai/contract.ts` `toneOnly`) is
  nothing that must change, and never a "not shown yet" question (`repair/contract.ts` `judgeContract`).

## Clothes, positions and typical clothing from one scene to the next (code review, 2026-10-16)

A review with live DeepSeek Flash runs of an undressing scene followed by a "Day 2, morning, kitchen" scene found the
morning scene told "lying on her side under the quilt… dress off, trousers off, keep to this", and every later scene told
"Mara Venn, typical clothing: nothing (since Ch 1, Sc 2)" as something that must stay true. No migration: the stage stays
in `meta` and the fixes are where it is read and laid over.

- **Typical clothing is who someone is, not this moment.** A Looks value from the text that says only that someone is
  undressed for now ("none", "nothing", "naked but for her locket", "dress off, stockings off"; for other Looks fields,
  "naked") is never kept (`memory/looks.ts` `passingLook`): the memory keeper leaves it out of a change, a verdict's new
  value, a detail and a new entry (`keeper/apply.ts` `keptLook`), and reading the memory skips one already kept, in a
  change or on the entry, so older worlds are put right too (`memory/state.ts`); Adam's own words always stand. The
  reading prompt's rule says a change ends a field's value "for good … not clothes off for a while" (5,971 characters,
  under the 6,000 its tests hold it to). What must stay true never states Typical clothing as a fact of now
  (`ai/mustStay.ts` `mustLines`): what someone has on now is the stage's, piece by piece.
- **What the scene before left is told only as far as it carries here** (`StageScope.carried` and `began`,
  `ai/mustStay.ts` `stageInScene`; `ai/context.ts` `carriedFrom`, `toldStage`). At the same moment (`timeCarries`): all
  of it. Later the same day: how people are, what they hold, the pieces still on and the things in the place; not where
  they are, how they are placed, who they touch or see, their mood or last action, nor a piece taken off. A later day, or
  a gap not known: how people are and anything in hand. Past the same moment, how people are keeps only what lasts
  (`lastingCondition`: "breath ragged, came" from a night scene is not told the next morning; a wound is). So the stage
  block (block 3, with a lead for each: `STAND_LEADS`), what must stay true, the scene's contract, the plan, the
  continuity brief and repair's W lines all follow the same reach; the brief is also asked never to keep to what people
  wore, where they were or how they lay as an earlier scene ended unless where things stand says it still holds
  (`plan/brief.ts` `BRIEF_ASK.keep`: the first live run's brief still said "Mara undressed to grey stockings and locket").
  Carrying on inside a scene (Add below, a later beat, Continue), a value whose words are another scene's, or kept
  without words and as it was when the scene began (`ContextInput.continuityAtStart`, set in `ai/gather.ts` `carryOnFrom`),
  holds only as far as that; what this scene's words said is always told. Without a stage for the scene so far nothing
  of it is told, as `carryOnFrom` has it.
- **Everything off at once** (`shared/stageItems.ts` `isAllClothes`, `allOff`; `shared/continuity.ts` `allTakenOff`). A
  piece that means everything someone has on, said off ("everything", "clothes", "all her clothes"), or that says nothing
  is worn ("nothing", "naked"), takes every piece listed for them off, with where they went and the words; with none
  listed, one piece says it ("clothes off"), and it goes once something is put on again. "Naked" given the old way, as
  one line, does the same. The tracker's prompt asks for `"item": "everything", "state": "off"`.
- **A move is a change of place.** Where someone is said more or less fully ("on the bed", "on the bed, on her back",
  "on her back on the bed") is no move, so who touches whom and how they are placed stay (`movedOn`: the same place
  before any words on where in it, or one's words ending with the other's); "the inn" to "the inn's yard" is a move.
- **One garment, other words.** Pieces of clothing are compared with one word for each garment (`pieceName`: knickers,
  panties, briefs and underwear; trousers and breeches; gown and dress; a dressing gown is a robe), so "knickers" taken
  off is the "panties" that were on. "Pants" is left alone (trousers to some, underwear to others).
- **Clothes are never things in the place.** A thing the tracker gives that is a piece someone has (`sameGarment`), said
  worn or off, is dropped (`garmentsAsPieces`): "her dress: on, unlaced" no longer reads as a dress put somewhere and
  taken off her. One put somewhere ("Ash's coat: on the peg") is still a thing, as one place for each thing has it. The
  prompt says clothing, on or off, goes under its person's clothes.
- **Every piece told.** The stage block tells every piece someone wears; when they don't fit in about 400 characters,
  those changed longest ago are told short ("grey coat on") rather than left out (`wornLines`).
- **The tracker's cast** (`continuity/tracker.ts` `castFor`): those on the scene card first, then those the words name
  (by name, other name, or what this scene calls them), then the rest A to Z, at most `MOST_CAST` (80), one a line with
  their other names ("Zara Quill (also the Captain)"). It was the first 80 names A to Z, with no other names. The fake
  provider reads the list one a line.

## The long live test's slips (2026-10-16)

A live test wrote an invented 20-scene, 39,417-word story through the app on DeepSeek Flash. A strict judge found 16
major and 28 minor slips, mostly time, and the app's own checks raised 26 issues, 12 of them false alarms from one
rule. No migration, no new AI call; the memory keeper's prompt is unchanged.

- **A point of view named by first name is named** (`checks/rules.ts` `povHere`; `shared/names.ts` `firstNameOf`,
  `soleFirstName`). 12 of 20 scenes were flagged "Nell Harrow is this scene's point of view, but the scene never names
  Nell Harrow" though they called her "Nell". Her first name counts when no other character in the codex goes by it
  (another's first name, name or other name), as `namesFor`'s first-name rule in `ai/mustStay.ts`.
- **Counted days on the real calendar** (`memory/calendar.ts` `feastsAsDates`, `splitCount`, `StoryDate.real`). The
  cards said "Day 1" to "Day 25"; only "Day 25, Christmas Eve" said the month, and nothing read it. A fixed feast day
  ("Christmas Eve", "Boxing Day", "Michaelmas"; not Easter, which moves) reads as its date, and a card that names a real
  day beside its count ("Day 25, Christmas Eve", "Day 1, 28 November 1923", "Day 1, late November") is counted as the
  count alone (so "28" is no longer read as a year), its real day placing every day of that bare count: Day 3 is "2
  December", "Friday 30 November 1923" with a year (the day of the week too), "about early December" from a month alone.
  The first such card in reading order decides. "Day 3 of spring" is a day of that season, as before. The writer's scene
  card says it ("Story date: Day 3, evening, which falls on 2 December (2 days since the scene before)": `ai/storyDate.ts`),
  and so does the When hint ("Reads as Day 3 · 2 December.": `memory/storyCalendar.ts`).
- **Places the card names in part** (`ai/context.ts` `selectEntries`, `WHY.inPart`, `PLACES_IN_PART` 4;
  `ai/briefingFixes.ts` `placeWords`, `peopleWords`). "Ashby" in the beats never brought in "The train to Ashby" ("Ashby
  is most of a day away"; the writer made it "an hour in a cart") nor "St Anne's church, Ashby" (the writer named it St
  Chad's, and the memory then kept that). A place whose name has a word that picks it out (capitalised, three letters or
  more, not a word for a kind of place such as "Church" or "House", and no part of any character's name, so "Crane" of
  "The Crane House library" isn't brought in by Victor Crane) is brought in when the card's own words (beats, notes,
  direction, goal and the rest) or the name of where the scene happens name that word, in full under "Also relevant"
  (never left out as a place away from the scene). Only from the card, so every step of a scene reads the same.
- **The card's name for the place.** The scene card says "Where: St Anne's church, Ashby (call it by this name,
  whatever the story so far has called it)". Kept short: those words are in every briefing. (`retrieval/recall.test.ts`
  now compares a briefing with and without step 5 word for word only where what step 5 took fits in the room left
  spare; past that, its share comes from the least important blocks by design, and a few more words on the card had put
  one model size there.)
- **Who heard it** (`keeper/presence.ts`, `keeper/apply.ts`). Theo's confession named Victor Crane ("his father wrote a
  letter") and his dead son, and both were kept as having heard it. A name in someone's spoken words is talked of, not
  there, unless spoken to ("‘Anna, sit down.’", "‘Sit down, Anna.’"; "‘Edmund Crane,’ he said" is an answer, not a
  call: `speechAround`, `spokenTo`), and so is one talked or written of in the telling ("told him about Anna", "a letter
  from Anna", "wrote to Anna"). The memory model's own list of who heard something is kept to those on stage at the
  words.
- **No animal knows anything** (`keeper/kinds.ts` `ANIMALS`, `keeper/apply.ts` `addChange`). "Nell's grey lurcher" was
  a person, so the dog Bramble knew every secret said in front of her. Breeds and more animals are animals now, and the
  keeper never keeps a knowledge change for anyone who isn't a person (`isPerson`), whatever the reply says; the checks
  never tell one as knowing (`checks/context.ts` `knowsLine`).
- **A planned payoff resolves its thread** (`keeper/apply.ts` `applyThread`, `cardPaysOffHere`). "Iris's wedding … on
  Christmas Eve" stayed open after the wedding: the memory model read the wedding as a step on. Where this scene's card
  lists the thread under "Pays off" and the words move it on (a step on or opening with a note, linked to its quote), it
  is resolved, as a resolve read there would be (a later card's plan, or the thread's own "How it should pay off", still
  keeps it open); read again in the same scene it stays resolved.
- **Typical clothing is what they usually wear** (`memory/looks.ts` `usualLook`). On a cold train Nell's Typical
  clothing became "…coat buttoned to the chin, the red wool scarf up round her jaw…". A piece told as worn just then
  (done up or undone, pulled up or round, wet or muddy, for the cold or the journey) is left out of a Typical clothing
  value from the text, unless it says it is usual ("always buttoned to the chin"); with nothing else new, the field
  isn't changed at all. The keeper does this for a change, a verdict, a detail and a new entry (`keptLook`), and reading
  the memory does it for a change already kept, so older worlds are put right too; Adam's own words always stand.

Known limits: the judge's other time slips (a deed year, "twenty-nine next birthday" for a 29-year-old) were the writer's
own inventions against facts it was given; nothing here can stop a model making those up. The judge's "late November"
for Days 1 to 3 was its own: by the cards (Day 25 is Christmas Eve), Day 3 is 2 December.

## The Story builder (Adam, 2026-10-17; 0.8.0)

Adam: "one place to build from"; "it should build out the codex fully and then set out an outline"; "take into account
recipes when they are used"; "a way to interact with the chat when building a plan … and regen specific spots". The
Story builder (View `storyBuilder`, `features/storyBuilder/`, contract `contracts/storyBuilder.ts`, main
`src/main/storyBuilder/` and `ipc/storyBuilder.ts`) is one page per story, in steps shown across the top of each:

1. **Your idea** (`IdeaStep.tsx`): the plot (as long as he likes), setting, must happen, must never happen, length (its
   hint says what each lays out at first, `sizeForLength`; "Not sure yet" is the outline helper's usual start), his
   own characters and places (kept exactly, marked **Yours**), questions (the World builder's interview, asked of the
   brief), the story's style (presets, how far it goes, tone; "Fine-tune" opens the style guide's This story tab) and a
   recipe. It is the story's **brief**, kept in the world's meta as `story_brief:<storyId>` (no migration;
   `storyBuilder/brief.ts` cleans it on every read and write).
2. **Cast and world** (`CodexStep.tsx`): `planStoryCodex` asks the chat model for everything the story needs in the
   World builder's first-look JSON shape (plus a recipe `role` on characters), inventing what the idea leaves open;
   `codex.ts settleList` puts his own entries first, as written, and marks what the world has already. Each item can be
   unticked, edited, redone (`redoCodexItem`) or taken off; the list can be talked over (`storyCodexChat`). **Build**
   (`buildStoryCodex`) runs the World builder with `WorldBuildInput.plan` (no first look; `sortOut` still leaves what the
   world has) and a summary written from the brief, the style and one line per item (`buildSummary`). One Undo
   (`undoWorldBuild`) takes it back; the brief keeps the run (`built`).
3. **Plan** (was Outline; since 2026-10-20 the Plan hub, see "The Plan hub"): the hub under the steps. When the brief has an idea (`hasIdea`), `startOutline`
   is the Story builder's request (`startStoryOutline`: the idea, style, recipe, story, plan so far, threads, cast and
   the world's events, marker `[AIWRITE-STORY v1] outline`), with a `Premise:` line first when the story has none (a
   card keeps it). Once the codex is built, a keep starts the World build only for pages it made (`setKeepBuild`).
   A story made from a recipe opens the recipe's plan page here (`RecipeStoryPlan`), and follows the recipe from then on.
4. **Done**: what was made and kept, and where to go next. It says only what is true: "Your story is built" once the
   codex is built and something of the outline kept, else what is built so far (or "Nothing is built yet").

**What wins:** the idea and his own entries, then the recipe (with the story's own changes, `brief.recipe.tweaks`; Save
back puts them in the library), then the AI's own ideas. Every prompt says so.

**Talking it over** (`features/planning/talkStore.ts`, `TalkPanel.tsx`): one talk per thing (the outline's suggestions,
the codex list, a recipe), kept while the app is open, never saved. A revision waits as a preview for Apply or Decline;
Apply has Undo. The outline's talk (`startPlanChat`) streams; its revised plan follows a line `=== Revised plan ===`
and replaces the open suggestions (`helperStore.applyRevision`, `features/outline/revision.ts`, 2026-10-19): each revised
part is matched to the one it was by the trail the revision keeps (`PlanRevision.from`: the talk's tags, through
`openKeys` to the suggestions' own keys), else by its title in the same act or chapter. What was kept stays kept, back in
its place, and is never offered to keep twice; what Adam discarded since stays discarded; his edits stay where the talk
didn't change that part. A revision made for suggestions since moved under Earlier suggestions isn't applied.
**Redo** on an open act, chapter or scene (`startPlanRedo`) streams a new version beside it; Use this swaps it in
(`applyRedo`). That works because `features/outline/outlineText.ts` writes the suggestions back out in the outline form
so that reading them again gives every other suggestion the same key (unit-tested round trip). Recipes: `recipeChat` and
`redoRecipePart`, on the recipe page too.

**The outline helper's suggestions (2026-10-19).** Edit shows and edits every part a suggestion goes into the story with
(`SuggestionParts.tsx`): a chapter's point of view, characters, location, When and mood, where a scene differs from its
chapter, and a scene's plot threads, picked from the codex with the scene card's `CastPicker` or typed in (a name the
codex doesn't have stands for itself, `codexNames.ts`, and gets a page when kept); `NodeEdit.card`, `setsUp` and
`paysOff` go into `keepPlan`. **Suggest again** never drops what Adam hadn't decided on: the batch moves to
`HelperSession.earlier` (newest first) and shows folded under the new ones as "Earlier suggestions"
(`EarlierSuggestions.tsx`, on the outline helper's page, a chapter's plan and a recipe's plan), each batch with its own
Keep, Edit, Discard and Undo (by its task id: `KeepOptions.runId`) and "Put these away" (`putAwayEarlier`, with Undo).

**Writing style presets** (`src/shared/stylePresets.ts`, `features/style/StylePresets.tsx`): one click sets genres,
content levels, point of view, tense and prose style (and the tone, in the Story builder), with Undo; those marked
`adult` sit under "For adult readers". Never rename an id.

**Since 2026-10-20 the Story builder is Build with AI's first two sections** (Your idea, Cast and world: see "Build with
AI"); its page, its steps bar and its Done step are gone, and a `storyBuilder` view lands in the matching section.
Before that, **where it was:** the Plan area's "The idea, cast and world", the hub's header link of the same name and the command
palette ("The idea, cast and world"); the board's blank story opens the Plan hub's start; the
New story dialog's "Build it with the AI next"; the start screen's **Build a story with AI…** tile (picks a world,
then opens the New story dialog with that box ticked: `newStoryIn(worldId, { withAi: true })`, `useApp.newStoryWithAi`). The World builder page stays for a world built from a summary apart
from any story, and points to the Story builder while a story is open.

## The outline in stages, Keep where Adam chooses, and no dead ends (overhaul phase 5, items 2, 5 and 6, 2026-10-19)

Adam found the outline helper "extremely poor and hard to use": "A full novel" came as up to 96 scene cards in one reply,
often cut off, every chapter with the same number of scenes; Keep always went at the end of the binder; keeping a chapter
started a cast build he never saw until Generate asked "Write now / Wait".

- **In stages** (`features/outline/stages.ts`, `src/main/outline/stages.ts`, `OutlineApi.startOutlineStage`, marker
  `[AIWRITE-OUTLINE v1] stage acts|chapters|scenes|scene`). The outline helper's page (and so the Story builder's Outline
  step) has **How to plan**: In stages, the default past `WHOLE_MOST_CHAPTERS` (12) chapters (`defaultMode`), or All at
  once (as before, at most 12 chapters). In stages the first request asks only for the acts (each with a `Chapters:` line,
  read into `SuggestedAct.chapterCount` and written back by `outlineText`), or, with no new acts, only the chapters. Each act
  card then offers **Plan its chapters** (about its own number) and each chapter card **Plan its scenes** (as many as it
  needs, at most 8) while it holds nothing (`StageParts.tsx` `StageRow`). A stage is `HelperRun.stage`: it streams under its
  act or chapter (`treeOf` splices it in, its last part not complete yet, so it has the caret and no buttons; that subtree,
  Keep all, the talk and Redo wait for it, `runBusy`, `stageHolds`), and when it ends its parts join the run's own text
  there (`spliceStage`), so every other suggestion keeps its key, decision and edits. Each stage is told the story, what it
  has (`planText`, and a kept chapter's place from the story, `chapterAroundText`), the outline being planned
  (`planSoFar`: Adam's changes in, discarded parts out, "(in the story)" and "(plan this one)" marks; headings only when it
  must be cut), open threads and the cast, cut to fit; replies are small (`stageReplyTokens`: six acts about 900 tokens, a
  chapter's scenes 1,660). A story with an idea in the Story builder is planned from it (`startStoryStage`: idea, style
  and recipe first, events after, `storyStageRules`, a `Premise:` line on the first stage of a story with none). A chapter's
  plan page keeps its own request (`startChapterPlan`: it already asks for one chapter's scenes, as many as it needs).
- **Keep where Adam chooses** (`tree.ts` `placeKeep`, `KeepOptions.place`, `StageParts.tsx` `KeepPlaceMenu`): beside Keep on
  an act or chapter, a menu: where the outline puts it (named first: after the one it follows that is kept, else at the
  end), first in an act or at the start, after any act or chapter of the binder, or at the end. A chapter put in the
  story's own act leaves its suggested act a suggestion; `KeepRef` with neither id nor key means "among the chapters with
  no act" (`keepOutline`). The toast says where ("…, after “The Docks”.").
- **The cast build shows** (`helperStore` `BUILD_NOTE`, `worldBuilder/storyBuild.ts` `useStoryBuild`, `StoryBuildLine.tsx`):
  a Keep that starts building the story's characters and places says so on its toast, and the outline helper's page and a
  chapter's plan show it waiting and then what it is doing, with See progress and Stop.
- **No dead ends.** An empty scene card offers **Plan this scene** (the scene card panel beside Interview me, and the
  desk's margin card; `scenePlanStore.ts`): the stage job's `scene` level plans that one card, which fills only the card's
  empty parts (`scenePlanLogic.planOnCard`: goal, beats, When, point of view, characters and place matched to the codex,
  mood) with Undo, naming a scene still called "Scene N". Beat by beat with no beats offers **Suggest beats**
  (`outline/suggestBeats.ts`: `fillSceneCard` with no answers, only its beats used) and then Write beat by beat. A kept
  chapter whose scenes are kept offers **Write this chapter** (on its card, and on a chapter's plan), opening Write the
  whole chapter for it; that dialog names scenes with nothing on their cards and offers **Plan these scenes** (one after
  another, Stop, one Undo) instead of leaving them out.
- Tests: `src/main/outline/stages.test.ts`, `features/outline/stages.test.ts`, `scenePlanLogic.test.ts`, the staged part of
  `helperStore.test.ts`, and `tests/e2e/outlineStages.spec.ts` (the New look's desk). `AIWRITE_E2E_LOOK=new` runs specs that
  don't choose a look in the New look.

## The story index (overhaul phase 1, items 2 and 3, 2026-10-19)

A look-up table that says, scene by scene, who is where, with what, and what changed, kept as dated facts, so a question
such as "what is Mara wearing as Ch 12, Sc 3 begins" or "who knows the seal was stolen" is a database read rather than a
walk over the memory or an AI call. The free part needs no AI call to build or read; the physical details come from
where things stand, filled in where Adam chose (below).

**Migration 5: the story index.** The written reason: answering those questions today means building the line and the
state for a scene (`memory/scene.ts`), reading the stage tracker's store and the calendar, every time, and nothing keeps
when a value stopped being true; a long story's briefing, checks and Ask need it per scene, fast. The tables hold only
what can be built again from the world (scene cards, words, the memory's changes, where things stand, summaries), so
nothing in them is ever the only copy, and older worlds open unchanged with them empty. `index_scenes` (one row a
scene: its place in its story and its "Ch 3, Sc 2", the gist, who is there, who is only named, the card's place and When,
the source hash, how it was filled), `index_facts` (kind where, wearing, carrying, condition, knows, relationship,
thread or status; `slot` tells facts of a kind apart; from a scene until a scene, null while still true; the words; the
origin: card, memory, tracker or hand) and `index_threads` (a plot thread opened, moved on or closed in a scene). Rows
go with their scene when it is emptied from Recently deleted (foreign keys). All SQL is in `db/storyIndex.ts`.

- **Building** (`storyIndex/build.ts`, pure; `storyIndex/index.ts` reads the world): who is there is the card's point of
  view and people, anyone the words name as there by the keeper's own rule (`keeper/presence.ts` `namedIn`: not when only
  thought of, talked of or far away; by name, other name, a first name no one else goes by, or what the scene's words
  call them, `db/called.ts`), whoever the memory saw there (a knowledge change's `there`, a speaker and who heard) and
  whoever the stage has values for from the scene's own words. Facts: where, each piece worn, what is carried and the
  condition from where things stand, only where a scene changes them from the last scene before it with a stage, and
  only from values its own words gave (`said`) or Adam set in Recall, so a value carried on in a state built on an
  earlier scene's older reading never starts a fact (`continuity/tracker.ts` `keptStates`: read from the words as they
  are now; not `storedState`'s `current`, which would drop every later scene's facts after one early edit); the card's
  place for its people (slot `card`; a look-up prefers the words unless the card moved them on since); and from the
  memory's changes, as the writer is given them (unconfirmed facts left out): what someone learns or forgets (never a
  wrong belief), relationships, threads, a death the memory is sure of (`ai/deaths.ts` `surelyDied`, undone by a note
  that they live) and any other note of what is different, each stopped at its "true until".
- **Never patched.** A scene's rows are rebuilt whole when its source hash changes (its words, card, called names,
  changes and their words, its stage and the one before, its summary, the world's names, `INDEX_RULES`). Where each fact
  stops is then worked out for the whole story (`storyIndex/link.ts`): a fact stops at the next row of its chain (one
  person's place, one piece, one fact known, one pair) that says something else, an end included.
- **Entry points**: `buildStoryIndex(db, storyId)` (every scene checked, only changed ones built; 50 scenes of 1,500
  words: about 140 ms the first time, 15 ms with nothing changed; 300 scenes: 400 ms and 60 ms) and
  `refreshSceneIndex(db, sceneId)` (that scene and the next scene with a stage; drops a deleted scene).
- **Look-ups** (`storyIndex/lookup.ts`, a query or two each, under 3 ms on 300 scenes), each with plain data and short
  lines for a prompt: `stateOf` ("Mara Venn: wearing grey coat (since Ch 1, Sc 1)"), `lastSeen`, `whoKnows` (a fact's
  words, or a thread's name or main word), `openThreads` (with how long each has been quiet), `sceneGists`, `presentAt`
  and `timeline` (the card's When and the story calendar's date). At a scene means as it ends; `asItBegins` as it begins.
- **Free checks** (`storyIndex/checks.ts` `indexChecks`, plain findings with scene ids, nothing stored): `same-moment`,
  someone in two scenes the cards put at the very same moment (same day, same clock time, neither leaning on the scene
  before nor going back) in places apart, with a card having them there; `after-death`, someone on a scene card after
  the memory is sure they died, never in a dream, memory or flashback, nor a scene the calendar dates before the death;
  `too-fast`, someone somewhere sooner than the road between allows (below, "Free rules for time and places").
- **Kept current** (`storyIndex/upkeep.ts`, wired for the open world in `keeper/indexing.ts`; never throws into the
  caller, never holds it up: changes are gathered for 400 ms, then taken in a story at a time between other work). When a
  world opens, 3 seconds after (the window comes up first), every story is built and the stories gone dropped. A scene
  is refreshed after the memory reads it (`keeper/index.ts` `standLater`, beside `rulesAfterRead`), whenever where things
  stand is kept anew for it (`continuity/tracker.ts` `onStageKept`: a read, a draft's catch-up, Recall, a fill), and when
  the keeper says a scene changed (a summary written). Its stories are built again after `recordEdited` (a card saved,
  scenes or chapters moved, the memory or an entry edited by hand), after an outline is kept, and every story after
  scenes are deleted or brought back (beside `rulesAfterDeleting`). The free part is built for every story.
- **The physical details** (what people wear, carry and suffer, and where they end up) come from where things stand,
  which costs a memory-model call a scene (`storyIndex/fill.ts`; a row says `filled: 'ai'` once it has them, INDEX_RULES 2; 3: someone the stage
  lists whom the words name only as thought of, talked of or far away is named, not there).
  Adam, 2026-10-19: only for the last chapters of an existing story by themselves. After the opening build, the scenes with
  words of the last two chapters with words of each story being written (changed within 60 days, and always the latest)
  not yet read for their words are queued (`recentScenesToFill`) in the `StageFiller`, which works one scene at a time
  and, before each, gives way while the keeper reads or has scenes waiting, a draft waits for the memory (counted around
  the before-draft catch-up) or where things stand is being brought up to date after a read: never in front of a draft.
  An older scene is filled the first time a look-up needs it: `fillSceneForLookup(db, sceneId, model)` (stateBefore, as a
  draft brings the scenes before up to date, then stateAfter, then the story is built again). New scenes get theirs as
  part of the memory's usual work (`standLater`).
- **Fill in the whole story** (the What changed page in the New look only, Classic being retired; the desk has it under
  how the memory is doing): an
  estimate first (`estimateStoryFill`: the scenes with words not yet filled, one call each, about 1.4 tokens a word plus
  the instructions, at the memory model's prices; free with a model on this computer; "about N AI calls" when its price
  isn't known), then `startStoryFill` (asks first under the spending limit) runs the story's scenes through the same
  StageFiller ahead of the recent chapters, with `MemoryStatus.filling` ("Filling in scene 3 of 42…" in the top bar and
  on the card), Stop (`stopStoryFill`: what was filled stays), and a quiet note when done (`storyFill:done`). It gives up
  after three calls in a row fail. Drafts still wait for the memory as usual; the fill waits for them.

## Plan before writing, done properly (overhaul, 2026-10-19)

Adam's spec, "Plan before writing, done properly": gather the core for free, let the AI look up what else the scene
needs, plan the scene's structure in the same exchange, write against the plan with the looked-up facts beside it, and
check against it. A stand-in test (Claude as the writer, fake memory) had found the plan's starting facts mostly dropped
before they reached the writer, Adam's direction said three or four times in one request, the planner given no recent
chapters (it planned as still to come what had happened), Continue given no plan and no previous scene, and Beat by beat
planning every beat. Plan before writing (`settings.planFirst`) stays a switch, on by default; off, nothing plans.

- **The look-up tools** (`ai/lookups/`, pure but for the database reads): ten ToolSpecs with short descriptions:
  `state_of`, `last_seen`, `who_knows`, `open_threads`, `what_happened`, `who_was_there`, `timeline` (the story index's
  look-ups), `get_entry` (an entry as the memory has it at this scene, with what it knows and its ties), `find_in_story`
  (earlier passages on the scene's line, by keyword and by meaning: `retrieval/recall.ts` `findPassages`, through
  `retrieval findInStory`) and `read_passage` (an earlier scene's own words, around some words or at its start or end).
  Answers are compact plain text, short unless `full` is asked (`ANSWER_MOST` 2,400 characters); only what comes before
  the scene; nothing Adam kept out; a look-up that finds nothing says what to try next ("There's no Ch 9, Sc 2 before this
  scene… name one as "Ch 2, Sc 1"."). At most `LOOKUPS_MOST` (8) in a round. Scenes are named "Ch 2, Sc 3" however
  written, by title, or "previous".
- **The gathered core** (`plan/core.ts`, on the open world): the story index brought up to date first (`buildStoryIndex`,
  hash-guarded), then everyone in the scene (the card, the stage) as the index has them (`stateOf`, a few lines each, as
  the scene begins, or as the scene so far ends carrying on), what happens in the scenes of this chapter and the one
  before ("Already happened … never plan any of it again", `sceneGists`), and the open threads (the writer's list when it
  has one, else the index's). Plus, from the briefing as before: the scene card, what must stay true, the codex, where
  things stand, the end of the previous scene or the scene so far, and the beats already on the page.
- **One round of look-ups** (`plan/plan.ts` `makePlan`, through the agent loop `ai/tasks.ts` `runTask`, job 'memory', the
  memory model): the first request offers the tools; their answers come back and the second request, without tools, asks
  for the plan (`maxSteps` 2). A planner that needs nothing plans in the first. The record (What the AI saw) keeps each
  request and each look-up (`params.steps`, `params.requests`); the scene before and the scene so far, read word for word
  with a brief, are kept as notes (`TaskRequest.kept`, since 2026-10-20; the book so far before).
  `[AIWRITE-PLAN v2]`; `PLAN_LIMIT_MS` 60 s for both requests (the brief's limits as before). The story's content note goes
  with it as with every memory job; a refusal is noted for the top bar.
- **The plan** (reply JSON): `wants`, `against`, `turn`, `beats` (in order), `who_where`, `relies`, `changes` (place,
  clothes, things held, what someone learns: `what` "knows"), `must_stay`, `closing_image`, `needs`, and `must` with a
  contract and `brief` with a continuity brief, as before. What is being written is said in a line or two
  (`askText`): a whole scene and its length; a stretch carried on, with Adam's direction (once); or, Beat by beat, the
  whole scene with one plan beat for each card beat not yet on the page.
- **The check** (`checkPlan`): as before (the stage's own words where it holds; no event the card or direction doesn't
  call for; no secret let out; nothing by the dead), and now: where the stage says nothing of someone (not known, or
  empty), what they wear, hold and suffer is taken from the story index in its own words (`CheckWith.known`), else kept
  when its words are in what the planner was given or looked up; where people are and how they are placed at a new
  scene still only from the card. A beat or the closing image that brings in someone the card never has (`strangerIn`:
  words of arriving), or lets out a secret, is left out; a beat already on the page too; who is where only for those in
  the scene and alive; what must stay true only when most of its words were given. Entries it read with `get_entry` come
  into the briefing as those it asked for do.
- **For the writer**: the plan as its own notes, last of all after the closing instruction ("My notes before I write…":
  the point, who is where, what the scene rests on, the beats, what changes, what must stay true, "It ends on: …", then
  "Now the prose…"; `plan/echo.ts` knows every part, so notes said again never reach the page). What it looked up goes in
  the briefing beside it (block `looked-up`, "Looked up before writing", priority 3, sent late after the continuity
  brief; short: the facts without the passages; `lookedUpText`: at most 14 facts and 2 passages of 180 words). It goes in
  only where there is room (`withPlan` tries with all of it, without what it looked up, without what it asked for).
- **Said once** (`ai/contract.ts` `contractText` `said`, `SAID`): the contract points to Adam's direction where the
  writer reads it in full: last of all for a whole scene too since "Adam's direction, said last" below (on the scene card
  only for Beat by beat), and for a beat ("This beat, as given last of all, below."); Continue's "what happens next" too.
  The check still reads every item in full (`codes`). The planner reads the direction once, under what is being written
  (its copy of the contract points there).
- **Every writing path**: Generate and Add below (a plan before each draft, `draftBriefing`); Variants (`ipc/variants.ts`
  no longer turns the plan off: the set is briefed once, so its drafts share one plan); Write the whole chapter (its drafts
  through `draftBriefing`, with a continuity brief as every other path since 2026-10-20, the scene plan built on the scene's part of the chapter plan); Beat by beat (`beats/index.ts`, `withPlan` with `beat`): one plan for
  the scene, made with its first beat (or the first after the card or the direction changed, or beat 1 started afresh),
  kept in memory (`plan/index.ts` scene plans, the 20 most recent) and given to the later beats with no call, the notes
  saying "(I write only beat 2 of 3 now…)", its brief with it, no scene-level "must" in a beat's contract; Continue
  (`edits/index.ts` `continueExtras`): no call; the scene's last plan made for the whole of it (`planForContinueOf`: the
  point, the beats still to come, what must stay true, the closing image) while the card is the same, and the end of the
  previous scene (about 200 words, `CONTINUE_PREVIOUS`) while the scene's own words are short (below).
- **Measured** with the trap harness's fake run (`npm run traps -- --fake --samples 1 --measure`, chain K1: six Add
  below steps and six Continues; the harness no longer answers the planner's or the memory's requests with its stand-in
  writer, which had made every fake plan prose): the writer's request 13,066 to 13,177 tokens on average (+0.8%: the
  notes and what was looked up, less the direction said again); the plan 5,399 tokens in one request to about 13,100 in
  two (6,900 with the tools, 6,150 answering), so about 2.4 times the plan's tokens read, about $0.004 a plan
  on DeepSeek before its cache; Continue 2,911 to 3,165 (+9%: the previous scene's end and the plan).
- **Tests**: `ai/lookups/lookups.test.ts`, `plan/core.test.ts`, `plan/plan.test.ts` (the format, the check, the round of
  look-ups), `plan/index.test.ts` (one plan a scene for Beat by beat, Continue's reuse) and `plan/paths.test.ts`: every
  path end to end against the fake provider, planning while the switch is on with the plan in the writer's request, and
  none off. The fake planner (`tests/fake-provider/plan.mjs`) looks the point of view up first (`planToolCalls`), then
  plans in the new format.
- **What a second stand-in test found, put right (2026-10-19)** (Claude as planner and writer through the trap harness,
  fake memory):
  - *What the plan rests on* (`checkPlan`, `saysIn`, `latestSaysOtherwise`): a relies line is kept when what the planner
    read or looked up backs it in so many words, or in other words (within a sentence and the next, every word that
    matters, and for one such word the person's name or the word saying how it is), or when the whole scene so far
    (`PlanMaterial.page`, never sent to the planner) or the previous scene's end does (that one for what people wear, hold
    and suffer, things in the place and facts), and the scene so far's latest word on it doesn't say otherwise. Never a
    secret kept from someone here; where people are at a new scene's start still only from the card. "On the hearth"
    says where, not how ("boots on the hearth" is no clash with boots off).
  - *What changes* (`changeLine`): each line whole in itself, who, what, from → to, and how when it adds something
    ("Wren, holding: the key → nothing. She sets it down on the table."; "Osric learns: …"; a thing named once).
  - *Continue* (`edits/index.ts` `continueExtras`, `continuePeople`; `plan/index.ts` `planForContinueOf`): the scene's last
    plan made for the whole of it (`wholePlans`; never a stretch planned for Add below, whose beats are on the page), its
    beats marked done (their words in the scene so far, `beatsOnPage`, or by position, a beat to spare) and the next marked;
    every beat done: the plan is complete, carry on towards the card's outcome and the closing image. With no such plan,
    the card's beats are marked the same way in Continue's scene card. Everyone in the scene as the story index has them
    (block `people-now`, right before where things stand). The previous scene's end only while the scene's words before
    the cursor are under 300 (`CONTINUE_PREVIOUS_UNDER`).
  - *Present, not mentioned* (`ai/mustStay.ts` `namedThere`, keeper/presence.ts `namedIn`): someone the stage lists but
    the words only think of, talk of or tell as far away is never told as in the scene (`stageInScene`), nor in the plan
    core's "everyone in the scene", nor present in the story index (INDEX_RULES 3); Continue lists them under "Named
    nearby, not in the scene", never among its characters.
  - *Each passage once* (`ai/repeats.ts`, `finishContext`): once the briefing is fitted, a passage of what a search found
    or of what the plan looked up is left out when the words already sent carry it (the scene so far, the previous
    scene's end, the scenes before) or a part before it did; the search keeps its passages, what the plan looked up gives
    way (`keepsRoom`). Beside a plan the scenes before word for word are not sent at all: the plan, what it looked up and
    the gists carry them.
  - *Look-ups*: `what_happened` gives each scene's gist in whole sentences (`wholeSentences`), "no summary yet" for a
    scene with none; `state_of` gives everything the index has and says what it has nothing on yet ("Not recorded yet for
    Mara: what they carry, …"); with nothing of what someone wears, carries or suffers, the scene it would come from is
    filled in first (`plan/index.ts` `fillQuickly`: `fillSceneForLookup` only when that is one memory call, within
    `LOOKUP_FILL_MS` 8 s, else stopped).
  - *The cache*: the answering request keeps the tools listed with `tool_choice` "none" (`ai/tasks.ts` agent
    `lastKeepsTools`, the planner only), so it starts exactly as the first did; a provider that turns "none" down is
    asked without the tools (nothing remembered for the model), and one that calls a tool all the same is asked again
    without them.
  - *Measured* (`npm run traps -- --fake --samples 1 --measure`, chain K1): the writer's request 13,177 to 8,019 tokens on
    average (the scenes before word for word gone beside the plan, passages said once); Continue 3,165 to 2,961; the
    plan's answering request 6,037 to about 6,950 tokens, all but about 150 of them the first request again (the cache).
- **Not done here**: the continuity brief's length (750 to 800 words) is as fix 14 set it.

## One reading of a scene (overhaul phase 1, item 1, 2026-10-19)

Measured with the trap harness's fake run, memory upkeep was about four fifths of the tokens sent: the memory keeper, where
things stand (the tracker) and the scene's summary each sent the same scene to the memory model on its own. Now the
keeper's reading of a scene says all three in one call when it can (`keeper/oneReading.ts`), and the others ask only
when it can't. No migration; the stores, hashes and rules are the tracker's and the summaries' own.

- **When** (`oneReadingFor`, in `keeper/run.ts`): the scene is read in one request (one chunk), and
  - **where things stand** is asked when the paragraphs read are exactly the words the tracker would read next
    (`continuity/tracker.ts` `stageToRead`: the whole scene from its start, or everything after its latest checkpoint
    that still matches, as `readUpTo` would; compared without spacing) and the last `CATCH_UP` (3) scenes before have
    theirs kept from their words as they are now, built on the one before (`startsKept`; else the tracker would work them
    out first and change this scene's start). Not when it is kept already for these words, nor for words this model
    turned the tracker down on (`continuity-refused`). So a new scene and words added at the end (Generate, Add below,
    Continue, a beat) are read once; an edit in the middle, a scene read in parts or a stale start go to the tracker as
    before.
  - **the summary** is asked when every paragraph is read and it is due as the engine reckons it after the read
    (`RunOptions.oneReading.summaryDue`: summaries on, `sceneSummaryDue` with the scene marked done or not; never for
    Adam's own, one he undid, or words turned down for a summary).
  - Only when the request with them fits the reading's window as the reading alone would, the memory it is told never cut
    for them, and the reply room (the reading's, plus `STAGE_REPLY` 3,000 and `SCENE_SUMMARY_REPLY` 700) is within the
    model's reply limit (`request.ts` `oneReadingParts`).
- **The request**: the reading's instructions as they are (`READING_SYSTEM`, so every reading shares the start of its
  prompt), then `[AIWRITE-ONE-READING v1]` with the tracker's own shape and rules (`continuity/stagePrompt.ts`, one copy
  for both; "the scene" is the P paragraphs, quotes only from them, someone new goes by the name of their new entry) and
  the summary's own rules (`SUMMARY_RULES`, shared with `SUMMARY_SYSTEM`); after the scene, "Where things stand before
  the P paragraphs" (the checkpoint's or the scene's start, as the tracker would say it) with the cast list (`castFor`),
  and the summary's length. The reply adds `"stage"` and `"summary"` to the reading's JSON.
- **Kept by the same rules** (`keepStageRead`): each value only with words from what was read (`readChanges`), laid over
  the state before (`mergeState`), kept as a checkpoint and as the scene's end (`Kept.hash` of the words read, `base` of
  the start), Adam's Recall edits staying while the words are those he edited against, the story index told
  (`onStageKept`). Nothing is kept when the start changed since it was asked (no ghosts); the end only while the scene's
  words are still those read (else just the checkpoint, which the tracker reads on from); one worked out meanwhile for
  the same words stays. The summary (`summaries.ts` `keepSceneSummary`) is kept as one written on its own would be
  (What changed with Undo, its `sourceHash`), only while the scene's words are those it was written from, never over
  Adam's own; tidied by `cleanSummary`, and a refusal in it is never kept (the summary's own call follows). Its call is the
  reading's, counted with that run.
- **After the read** (`engine.ts` `after`, `keeper/index.ts` `standUp`): the follow-on finds where things stand already
  kept (`onSceneRead`'s `staged`: Recall reloads) and the summary is kept from the read, else written as before.
- **Before a draft** where things stand as the scenes before end is worked out once their reads are done
  (`Keeper.whenReadBefore`, the last `CATCH_UP` scenes with words), still alongside the scene's own read and the summaries
  a draft needs: side by side, the tracker read the scene just written while the keeper was reading it.
- **A reply that can't be used** (`run.ts`): asked once more with the same request, without the reply that couldn't be
  used (a provider's cache serves it), and what was wrong said at the end of the last message (`withCorrection`,
  `retryMessage`). A reading that also asked where things stand or for the summary is asked again for the reading alone,
  the request that has always worked (a summary's prose in JSON is the likelier slip), and one cut off by its reply limit
  is read again alone rather than in halves; where things stand and the summary then make their own calls.
- **JSON mode** (DeepSeek's `response_format: {"type": "json_object"}`) is not sent. DeepSeek says it may answer an empty
  reply in JSON mode, which the client counts as a failed call (a read marked "Memory not updated" rather than one more
  try); servers turn it down in their own words (LM Studio wants `json_schema`), which the client's guesses about an
  unexplained 400 (min_p, thinking, usage) would have to learn too, for every job; and the lenient reader already forgives
  fences, comments and trailing commas, with a retry now served from the cache.
- **Measured** (`npm run traps -- --fake --samples 1 --measure`, chain K1, the fake answering a one reading with the
  stage and summary its own requests would get: `tests/fake-provider/server.mjs` `oneReadingReply`): the keeper 43 calls,
  165,077 tokens in, to 43 calls, 232,992; where things stand 43 calls, 136,233, to none; summaries 74 calls, 162,794
  (43 scene summaries, 150,573), to 43, 97,572 (12 scene summaries, 85,351: the chain's own scene, written again whole after
  each step). Upkeep 160 calls and 464,104 tokens to 86 and 330,564 (−29%); every job 215 calls and 729,733 tokens to 141
  and 596,226 (−18%). The chain's outcomes are the same. The reading's added instructions (about 5,800 characters) are the
  same for every reading, so a provider's cache serves them.
- **Not done here**: a scene summary is still written again whole for each Add below or Continue (its words changed by
  more than `DUE_WORDS`), the largest upkeep left in the chain; the import estimate (`importing/estimate.ts`) still counts a
  summary call for each scene, so it now says a little more than it costs. (The other JSON jobs' retries send the failed
  reply back no more: "The checks' cost", below.)
- **Tests**: `keeper/oneReading.test.ts` (a new scene; words added at the end; an edit in the middle, a stale start and a
  summary not due or Adam's going to their own calls; a small reply limit; the summary kept, and only for the words it was
  written from; refusals; no ghosts; values only from what was read; Recall edits kept; the index told; a cut-off or broken
  reply read again alone), `keeper/oneReadingWorld.test.ts` (before a draft, in the open world: one call for the scene
  just written), `keeper/keeper.test.ts` (the retry), `keeper/prompts.test.ts`.

## The checks' cost: one opening for every request about a scene (overhaul, 2026-10-19)

An audit found the consistency checks were about 15-20% of a chapter run's tokens, and none of it reused: the two groups of
checks had different system prompts, the second opinion wrapped the same material its own way, and a format retry sent
everything again with the failed reply on top. No migration, no new call; what the checks catch is unchanged.

- **One opening** (`checks/prompts.ts` `CHECK_SYSTEM`, `checks/context.ts` `checkOpening`, `checks/run.ts` `checkLayout`):
  every request about a scene (both groups of checks, the contract's ruling `contractRuling`, the second opinion
  `findingsRuling`) sends the same system prompt (what all six checks look for, the rules and the reply's shape; the same
  for every scene), then the same material and the scene's words, byte for byte, and only then its own task (`## Your
  task`: `checkTask`, the checks it makes and, in the request about what is so, the contract's rules and C lines;
  `CHECK_SECOND_TASK`; `contractRulingTask`, the second opinion's own instructions with the whole scene as its new words).
  The user message's `cacheUpTo` marks the opening for a model that caches only where asked. The second opinion takes it
  through `repair/second.ts` `SharedOpening`.
- **The material** is what every check asked was told (`checkSections` for all of them), so each group now reads a little
  more than its own: the facts check the 40 facts of who knows what and the style guide, the knowledge check where things
  stood and the scenes before. Nothing either group had is lost (tested): the facts the words touch are added to the list
  of who knows what, "About this story" goes to every check but style, and what the author said is meant keeps
  `MOST_MEANT` for each group (`CHECK_GROUPS`, now in `context.ts`). One split of a long scene serves every request (the
  room left by the largest task); the contract is left out, never the check, when it doesn't fit.
- **Two requests still**: a live run found one request for all six spread the model thin and missed plain contradictions;
  the fake run can't tell (it answers by rule, whatever it is asked: merged, the book's planted slips came out the same),
  so merging waits for a real A/B. Write the whole chapter keeps its one request (`together`). Since checkfix (2026-10-20)
  both requests ask facts and who knows what too ("Check this scene catches again", below).
- **Asking again** (`repair/retry.ts` `withCorrection`, as the memory keeper's own): a reply that can't be used is asked for
  with the same request and a short line at the end of its last message ("Your last reply to this couldn't be used: ..."),
  never the reply itself, in the checks, story comparisons (`checks/stories.ts`), the story flows (`storyFlows/call.ts`),
  the builders (`builder/jobs.ts`, `retryLine`) and the critic (`critique/run.ts`). The World builder keeps its own.
- **The fake provider** (`tests/fake-provider/m5/check.mjs`) reads the checks asked from the task's line and the scene up to
  the task; a request with another task (a second opinion) isn't the checks'.
- **Measured** (fake provider; "cached" is the tokens a request shares with the start of the one before it, which DeepSeek
  bills at a tenth). A check of one scene (four entries, 1,500 words): Mark done 9,070 tokens in, none cached, to 12,320,
  64% cached (as billed, 9,058 to 5,246: −42%); through its contract, four requests, 11,998 to 17,194, 69% cached (11,983 to
  6,586: −45%). The trap harness's book (`npm run traps -- --fake --story book --samples 1 --measure`), its 43 check
  requests: 166,560 tokens in, 37% shared with one of the 40 before, to 208,821, 73% (as billed 111,820 to 72,338: −35%);
  the whole run 2.03 to 2.08 million in, as billed −6%. Write the whole chapter (`chapterWriter/requests.test.ts`): 140,819
  to 151,216 characters with the greedy agent, 128,235 to 138,632 with the other; its 8 check requests, 16% to 54% shared
  with the one before (as billed −34%). Without a cache the checks send about a quarter more. The book's planted slips: 2
  of 13 caught and 5 false alarms on the fake, before and after, the same issues.
- **Tests**: `checks/run.test.ts` ("every request about a scene opens alike": the four requests' openings byte for byte,
  the retry without the reply), `checks/checks.test.ts` (the shared material holds all each group had; the task last),
  `repair/retry.test.ts`, and the retries in `builder/jobs.test.ts`, `storyFlows/flows.test.ts`, `critique/critique.test.ts`.

## Pay-offs read for sure, leaner dead, and what the reader knows (overhaul, 2026-10-19)

Live (16 Oct, DeepSeek Flash): threads stayed open after their payoff was on the page, and the dead crowded what must
stay true. No migration, no new AI call.

- **A verdict on each pay-off due here** (`keeper/oneReading.ts` `payoffAsks`, `keeper/request.ts`, `keeper/apply.ts`
  `readPayoffs`/`settlePayoffs`). Each reading of a scene (the one reading too) ends with "## Pay-offs to judge"
  (`prompts.ts` `PAYOFF_RULE`): every open thread this scene's card pays off (planned ones too), then those overdue or
  due by the end of this chapter (not dropped, not resolved in this scene), `PAYOFF_ASKS` (4) at most, by E id. The reply's
  `"payoffs"` says paid, moved or untouched with the quote (about 107 tokens for one thread, 16 a line more; nothing
  when none is due). **Paid** (words found in the scene) resolves it, even while a later card plans the payoff or its
  "How it should pay off" says later: the words win, and the later card is flagged (`laterCardPayingOff`, a note keyed
  `payoff:later:<later scene>:<thread>`); a step on that the verdict calls paid is the payoff. **Moved** is a step on
  with its note, unless the reply touched the thread already (on this card's own plan a step on is still the payoff, as
  before). **Untouched** on this card's plan, when every paragraph was read, is a note keyed `payoff:ask:<scene>:<thread>`,
  asked once per scene and thread and settled by a later paid or moved.
- **Worth a look** (`keeper/checkQueue.ts` `payoffChecks`, under "Plot threads left waiting", `MemoryCheckFact` promise
  `why` 'payoff' or 'paid-before' with `logId`): "Did Ch 1, Sc 2 pay this off? Its scene card plans the pay-off there,
  but the memory didn't find it in the words." only while the thread is open, that card still plans it, Adam hasn't
  dropped it or chosen a later Pay off by, and the scene is marked done or a later scene of its story has words (never
  about the scene being written); Keep leaves it open, Pay off later, Mark as dropped. "Paid off in …, though the scene
  card of … still plans its pay-off" while that resolve and that card stand; Keep dismisses it (no Remove).
- **What must stay true** (`ai/mustStay.ts` `deadNearby`): a full "X is dead: …" line only for the dead on the card, on
  the stage, named in the card's words, the direction or the scene so far, or tied to someone here (`MustInput.ties`,
  the relationships, or either entry naming the other); the rest on one key line, "Also dead: A, B and C"
  (`MUST_DEAD_NAMES` 8 names, then "and 4 more"). One alone keeps its own line. `ai/context.ts` can pass
  `ties: input.memory.relationships` (not wired here).
- **The reader ledger** (`ai/readerKnows.ts`, not in the briefing yet): `readerKnows(db, storyId, atSceneId, presentIds)`
  and the pure `readerLines`: what the reader was shown (the first scene on the line where someone learned it on the
  page) that someone present doesn't know, "The reader knows … (Ch 1, Sc 2); Mara doesn't: don't explain it again, or
  let her learn or guess it without cause.", secrets someone here holds first, `READER_LINES` (4). The block's safety
  rules (backed facts, cleanKnows, never of someone it is about) and never of a point of view of a scene it was learned
  in. To wire: a late block beside `knowledge` in `ai/context.ts`, with the same people (`ledgerPeople(sceneKnowers(…))`).
- **Tests**: `keeper/payoffs.test.ts`, `ai/mustStayDead.test.ts`, `ai/readerKnows.test.ts`; the fake provider answers
  `"payoffs"` (`tests/fake-provider/server.mjs` `payoffVerdicts`; "In the end, …" is a payoff read as a step on).

## Place memory, and can each beat happen (2026-10-19)

A live finding: a letter's hiding place drifted across chapters. Where things stand keeps a place's things only while the
story stays there (`shared/continuity.ts` `newSceneStage`: a scene somewhere else starts without them), and nothing brought
them back when the story returned. The tracker's own rules are unchanged: nothing is put back into where things stand.

- **Placed facts** (`storyIndex/placed.ts`, story index kind `placed`, no migration: `kind` is free text; `INDEX_RULES` 4):
  built for free from where things stand per scene: each thing in the card's place whose words are the scene's own (or
  Adam's Recall), when it can be left somewhere (`leftable`: said where it is; never part of the place, such as a door, a
  lamp or the fire; never on someone: held, worn, in a hand or a pocket). The fact's entry is the place, its slot the thing
  as compared, its value "the letter: under the loose hearthstone", with the words. It stops (`placedEnds`, asked by
  `link.ts` `factEnds`) when someone holds it by a later scene's words (an end `taken:<thing>` whose entry is who took it,
  wherever they are), when the same thing is put somewhere else or said otherwise in the same place, or when the scene right
  before, at the same place, had it and this one doesn't (never with the list full).
- **Left here before** (`leftHere`): for a scene whose card is at the place, a room inside it, or the house its room is in,
  "Left here before: the letter under the loose hearthstone (since Ch 2, Sc 3)" (", in the study" when it is another of those
  places), without what where things stand as told already has there (`leftHereLines`). In the plan's gathered core
  (`plan/core.ts` `left`, the planner's part "Left in this place on an earlier visit") and the writer's briefing (block
  `left-here`, priority 3, right before where things stand; `ai/gather.ts` reads the index as it stands, and a plan passes
  its own reading, made with the index just brought up to date, through `MadePlan.leftHere`, in place of it: `keepsRoom`
  lets that part change), and Continue's briefing
  (`edits/briefing.ts`, the same part, after `continuePeople` brings the index up to date).
- **where_is** (`ai/lookups`, `whereIs`): where a thing was left and since when, who carries it, or, with neither, where it
  was last left and what became of it ("taken by Mara Venn in Ch 3, Sc 1").
- **Can each beat happen?** (`plan/preconditions.ts` `beatsCanHappen`, no AI call, `PlanCall.preconditions`): after the plan
  is checked, a beat that has someone use a particular thing ("reads the letter"; never "a letter", nor things there are
  many of) that the index has elsewhere, or has someone act who isn't in the scene and whom the index last had in another
  place. A thing in another room of the same house, or one someone here has, gets a note after that beat in the writer's
  plan (`ScenePlan.first`: "2. Mara reads the letter to Ash. First Mara Venn must fetch the letter from the study, where it
  was left under the loose hearthstone (Ch 1, Sc 1)."). What can't be put right is left as planned and noted for Adam on the
  plan's record in What the AI saw ("Steps it took", `BEATS_CHECK_LABEL`, `generations.addSteps`). Never when the stage,
  the words so far, a beat so far (fetching it, or someone arriving), a change, the card or the direction bring it.
- **Tests**: `storyIndex/placed.test.ts` (across visits, taken, moved, gone, nested rooms, where_is),
  `plan/preconditions.test.ts` (a thing elsewhere, a person elsewhere, controls with no false alarm, the notes, and the
  hidden-letter trap end to end on the briefing), `plan/plan.test.ts` (the core's part; the check's notes and record),
  `ai/lookups/lookups.test.ts` (where_is), `edits/briefing.test.ts` (Continue's part).
- **Not done here**: the trap harness (`tests/traps`) has no hidden-letter probe yet; the check doesn't look at the
  plan's changes or closing image, only its beats.

## Free rules for time and places (overhaul, 2026-10-19)

A 30,000-word live test on DeepSeek Flash (16 October) found the commonest big slips were the timeline: months, years
and travel times the writer made up; and a church named otherwise than the scene card's place. Reading dates by rule
beats asking an AI judge, so three checks were added that cost no tokens. No migration: routes are story index facts of
a new kind (`index_facts.kind` is text).

- **Time claims** (`checks/timeClaims.ts`, pure; the world read by `checks/freeContext.ts`). In the words: a month, a day of
  the month, a year, a weekday or a season the narration gives as now, in plain frames only ("It was a raw March
  morning", "It was the third of June", "It was 1823", "It was a Tuesday", "It was deep winter", a dateline "Linmouth,
  March 1847"), held to what is sure of the scene's date (`dateFacts`: a real date and its weekday, a counted day the
  cards place on the real calendar, or a month or season the card's own When names; a season carried 50 days on a count
  is no month). Never in dialogue, nor "last March", "in March they would sail", "It was March when…" (a memory), "not
  March yet". A season only when it can't be so (spring in June may be late spring; a month either side of a season
  fits). In a story that only counts its days (`storyCounts`: no card names a real month or year) a month or year given
  as now is new, worth a look ("minor"), unless the codex or a card names it. A month or year beside a dated event (an
  event entry's When) that dates it otherwise, in dialogue too. A length since something ("three weeks since the mill
  fire", "four days since they left Linmouth", "the fire, a month ago", "in 1815, eight years ago") against the calendar:
  a dated event, the last scene at the place left (`lastAt`), or a year; a quarter either way (at least a day; twice as
  much "nearly", "about"); never "it feels like", "or so". How the scene's first sentence opens ("The next morning",
  "That night", "Three days later") against the cards' distance from the scene before (only the first sentence: "That
  afternoon" later on is the scene's own day; not after a scene in the small hours, nor in a flashback). A journey's
  length between two codex places against what the codex's place entries say, by the same means or one not said, when
  one is at least twice the other. Each finding quotes its sentence (`checks/freeRules.ts` `sentenceAround`) with the
  sentence put right as its fix where that is obvious: the right month, day, year, weekday, season, or length in days
  ("four days"), or the opening ("Later that morning", "Three days later").
- **The card place's name** (`checks/placeNames.ts`, pure). Named places of a kind in the narration ("St Chad's", "the
  Red Lion Inn", "Mill Lane", a kind from `KINDS`) held to the scene card's place and the places it is in: when one of
  those has a name of that kind and the words' name is no codex place, person, thing or group ("Tobin's Mill", "Venn
  Lane" are someone's), the words name it wrong. Never in dialogue, never with the codex's name in the same paragraph
  ("from St Anne's she could see St Chad's"), never a feast, a plant or something of a saint's ("St John's Day", "St
  John's wort", "St Anthony's medal"), nor a saint named bare ("prayed to St Anthony"). A street, bridge, hill, market
  and the like (`PASSED`: another is often passed) only against the card's own place, never one it is in, and only
  asked. `safe` (a building or a saint's, one card place of that kind, at most three words each way, the codex's name
  nowhere else in the scene): mended in place; else asked with the swap to review.
- **Where they run.** As rules (`checks/rules.ts` `time-claim` and `place-name`, over the scene's words: after every reading
  and in every check, as fix 8's rules; `RuleScene.free`, `RuleFinding.fix`, which `ruleIssue` keeps as the issue's fix),
  never in a flashback, a dream or a memory. And as new words land (`repair/free.ts`, called from `checkNewWords` before
  the memory model's call and whatever comes of it, and by `freeCheckNewWords` when there is no memory model or AI
  spending is paused; not with "Check new words straight away" off): over the AI's new words alone, the time claims and
  any place-name slip that isn't safe are asked at once; a safe one in a paragraph that is all the AI's own is one more of
  check and repair's small fixes (amber, Undo; `why` "This scene is at St Anne's church, Ashby, so it is St Anne's, not
  St Chad's."). Both are kept under the rule's own key (`ruleKey`), so the rules after the reading find the same row, a
  mend the page made is kept fixed (a slip later writers are warned of), and one Adam took back with Undo (ignored) is
  never mended or asked again. On screen: "Found by a rule, not the AI", as fix 8's.
- **Routes** (`storyIndex/routes.ts`). `readJourneys` reads how long and how ("a day's ride", "three days by cart", "half a
  day's walk", "it took them four days to reach", "the ride from X to Y took three days", "a day east of X"); `routesIn`
  joins two codex places (both named, or one named and the place the words are about); none from somewhere not in the
  codex ("from the coast") or with three places in one sentence. Story index facts of kind `route` (`IndexFactKind`;
  `IndexOrigin` 'words' added): from the place entries' words at the story's first scene (Adam's 'hand' when he made or
  edited the entry, else 'memory'; `INDEX_RULES` 3, so every scene is built once more) and from narration, never
  dialogue (`build.ts` `routeFacts`); `routeSlot` keeps means and length in the slot, so routes never stop each other.
  `db/storyIndex.ts` `storyRouteFacts` reads them.
- **Too fast** (`storyIndex/checks.ts` `tooFast`, in `indexChecks`, so the chapter writer's plan asks it too): someone on
  two scene cards at places apart (neither inside the other), the later card's day known on the same count as the earlier
  (neither going back nor a dream), with the most time the cards allow (from the start of one's time of day to the end
  of the other's; whole days when none is given) less than the quickest known route needs (`travelNeeds`: a day's journey
  8 hours, three days 56, three quarters of hours told; a quarter less hedged): "Mara is at Linmouth in Ch 1, Sc 1 (Day 3
  · morning) and at The Wheatsheaf in Ch 1, Sc 2 (Day 4 · evening), but Linmouth to Carrow is about 3 days by cart."
- **For the planner** (not wired here): `gettingHere(db, storyId, sceneId)` (exported from `storyIndex`) gives "Getting
  here: Linmouth to Carrow is about 3 days by cart." for each person on the card who comes from a place apart with a
  known route (Adam's first, then the quickest); `routeLine` says one.
- **The trap book** (`tests/traps/book.ts`, `BOOK_PROBES_VERSION` 2): planted passage X13, a month made up in a book that
  counts its days, caught by the rule; the time rule raises nothing in the other passages (`checks/timeClaims.test.ts`).
- **Tests**: `checks/timeClaims.test.ts`, `checks/placeNames.test.ts`, `storyIndex/routes.test.ts` (each kind with its
  controls: remembered dates in dialogue, a second real codex place, a person's name, a story with a real calendar, a
  length about right), `checks/freeRules.test.ts` (in a world: the rules after a reading with their fixes; check and
  repair mending the church's name with the model's call failing, the month asked under the rule's key, no memory model,
  Undo), `storyIndex/checks.test.ts` (too fast, from an entry and from narration, and what it never says).
- **Known limits**: time claims read plain English frames only; a weekday only on a real date with a year; seasons are
  the northern hemisphere's; place kinds are a fixed list; "since the fire" needs an event entry with a When.

## One set of look-ups, and instruction packs (overhaul phase 2, 2026-10-19)

Every agent uses one set of look-up tools, and each job's detailed instructions live in a short named pack the agent
loads only when it does that job (the "skills" pattern: a name and a few words always listed, the text on request),
instead of every rule riding in every prompt. Both are chat lab switches, on by default: `LOOKUPS` and `PACKS`
(`shared/askIntent.ts`); off, the chat sends exactly what it sent before (the fake eval's requests are byte for byte the
same size).

- **The shared look-ups in Ask the world** (`ask/agent.ts` `askLookupTools`): state_of, last_seen, where_is, who_knows,
  who_was_there, timeline and read_passage from `ai/lookups`, so "what is Mara wearing now?" or "where is the letter?" is
  a story index read at no cost. One get_entry and one search: the chat's own (its get_entry shows the field keys entry
  changes use and labels what comes later; its search covers entries, notes and summaries), never find_in_story or the
  shared get_entry; what_happened and open_threads only where story_so_far and list_threads aren't offered. They are
  answered in `runAll` (`lookUp`; a look-up may wait), as things stand at the open scene as its words so far end (with no
  scene open, the story's last scene as it ends), from the memory as the chat sees it there and never about anyone Adam
  kept out (`lookupContext`); only scenes before the point are ever told. No fill (an AI call) from the chat. What a
  look-up says to try next names the chat's own tool (`inChatWords`). The instructions say it in one line
  (`ask/prompts.ts` `LOOKUPS_LINE`). Rows: kind `lookup` ("Checked where “the letter” is"), read_passage as `read`
  (`shared/toolActivity.ts`, `features/ask/toolView.ts`).
- **Instruction packs** (`ai/packs/`): plan-a-scene, write-dialogue, revise-for-voice, fix-a-slip, check-continuity and
  explain-memory, each a name, the job in a few words, a title for its row and its text, written from the app's own
  prompts and rules (no new rules): the writer's craft rules with the rules against AI phrasing merged in, each
  said once (`ai/prompts.ts` `craftRules`, `SPOKEN_LINE`, `SLOP_RULES`' ending rule), the checks' own words (`checks/prompts.ts` `CHECK_WHAT`), the planners' rules, the chapter writer's fix
  and this file on the memory. `packList(names)` is the list for an agent's system prompt; `loadInstructionsTool(names)`
  offers `load_instructions(name)`; `loadInstructions` answers it (a pack once an answer; an unknown one says which there
  are; `extra` adds the agent's own lines).
- **In the chat** (`ASK_PACKS`: all six): the list goes after the instructions' intro, in the block that stays the same
  from question to question; a pack's text comes back as a tool result, after everything a provider caches. With
  PACKS, propose_changes says issue_fix, chapter_card, thread, the card's names and replace_all in a line each, and their
  full lines come with fix-a-slip and plan-a-scene (`askPackExtra`). What an edit needs is still always sent: an edit's
  first request is often made to call propose_changes (TOOLCHOICE), before it could load anything. Row: kind
  `instructions` ("Read the instructions for fixing a slip").
- **In the chapter writer** (`chapterWriter/prompts.ts` `PLAN_PACKS`): the planner is offered check-continuity, listed at
  the end of its system prompt (which stays the same); a load is answered beside its look-ups and never counted as one.
  Its flow is unchanged.
- **Measured** (tokens by the app's own counter, `ai/tokens.ts` `countRaw`; the fake eval in characters / 4, all 86
  turns): the chat's instructions 1,169 to 1,355 tokens (1,613 to 1,799 with the epic fantasy preset and a sample: the
  pack list 150, the look-ups line 36); its tools 4,555 to 4,891 (15 to 23 tools: the seven look-ups 535,
  load_instructions 98, propose_changes 2,293 to 2,000), so the packs save 45 tokens a request while 2,143 tokens of
  guidance wait in them, and the look-ups cost 571. The fake eval: the first request of a story A turn 7,516 to 8,101,
  its system message 2,618 to 2,816, every request in all 1,988,180 to 2,105,765 (+5.9%; messages alone, as the fake's
  usage counts them, 1,043,776 to 1,083,881); 201 requests and every score the same. The chapter run
  (`chapterWriter/requests.test.ts`): 139,847 to 140,819 characters with the greedy planner, 127,749 to 128,235 with
  the one that goes straight to work. The chat eval now records each turn's whole request bodies, tools included
  (`bodyChars`, `firstBodyChars`).
- **Tests**: `ai/packs/packs.test.ts` (the registry, the list, the tool, the words taken from the app's rules),
  `ask/agent.lookups.test.ts` (an invented indexed world: what someone wears now, where a thing is, who knows, last seen,
  who was there, dates, a passage, never a later scene nor anyone kept out, no story open, the chat's own tool names; the
  packs listed, loaded once with the chat's lines, propose_changes shorter and still proposing),
  `chapterWriter/chapterWriter.test.ts` (the planner loads check-continuity beside a look-up; `fake/agent-packs`),
  `tests/e2e/editorChat.spec.ts` (where_is and a pack, each a row in plain words); the fake chat model calls where_is,
  who_knows and load_instructions on set words (`tests/fake-provider/m4/ask.mjs`).

## Adam's own words as the voice sample (overhaul, 2026-10-19)

The sample passage is empty unless Adam fills it, and "Write a sample for me" has the model write it, so the writer
copied its own voice; the previous scene's end and the scenes before are mostly AI drafts too, so the voice drifted
towards the average. Few-shot examples from the author's own writing beat none (EMNLP 2025).

- **Which words are his** (`style/ownWords.ts` `readParagraphs`, SQL in `db/ownWords.ts`): every text an AI wrote for a
  scene is kept: the replies of its `draft`, `beat`, `edit`, `polish` and `chapter` records (`PROSE_JOBS`; never the
  memory's or the checks', which quote his words) and the editor chat's text and passage proposals for it not turned
  down (`chatTexts`, from `params.proposals`). A paragraph of the scene as it stands is his when under a quarter of its
  four-word runs are found in them and no sentence of six words or more is 60% found (so one AI sentence left as it was
  rules the paragraph out); under four words, when its words don't stand together in them. A scene with no AI record is
  all his (typed, dictated, imported). Limits: text pasted from elsewhere or written with another AI counts as his; an AI
  rewrite he turned down that kept many of his words can rule his paragraph out (the safe way round); the sample world's
  scenes never count (`isSampleWorld`).
- **The scenes read** (`style/ownWriting.ts`): those before the scene on its line, nearest first, then its story's later
  scenes, at most `MOST_SCENES` (40) or `MOST_WORDS`; never the scene being written (its words are in the briefing, and
  the sample, in the system message, stays the same while he works on it, for the cache). Each scene's reading is kept
  (per world, `MOST_KEPT`) until its words' hash or its AI records' mark (`proseMarks`, `chatTexts`) change.
- **The sample** (`pickOwnSample`, `OWN_SAMPLE` in `shared/ownSample.ts`): about 400 words (never over 500) in stretches
  of at most 220 from one scene, one stretch a scene first, nearest first, each the run of his paragraphs with both
  dialogue and narration where there is one, a long paragraph cut at a sentence end; then more while short; then a line
  of dialogue or a paragraph of narration if it has none. Under 150 words of his own: null, and the writer goes on as
  before. Block 1's "Sample passage" then says "These passages are the author's own writing, from the story so far",
  each stretch in its own quotes (`ai/prompts.ts` `ownSampleText`; short form: the first, trimmed), in place of the style
  guide's. About 120 words of it (`echoOf`: the first stretch with dialogue and narration) come again as the last part
  before the closing instruction, "Sound like this" (`SOUND_BLOCK`, priority 2, `soundLikeText`, after what must stay
  true in `SEND_ORDER` and `prepareContext`).
- **The switch** (`WritingPrefs.ownSample`, `ownSampleOn`, `ownSamplePref`): "Use my own writing as the sample". Left
  out: on while the sample passage in effect is empty; true: also over a sample passage; false: never. On the Style
  guide screen under the sample passage (`style/OwnSampleSwitch.tsx`: shows what applies to the sample there; turned on
  under a filled one it saves true) and in Settings › My writing preferences (on or never), and in Find a setting.
- **What the AI saw** (`ContextBlock.ownWriting`: words and where from; `ownWritingNote`): the instructions part is
  tagged "Your own writing" and says "The sample passage is your own writing: 412 words from Ch 3, Sc 2 and Ch 1, Sc 4.
  Nothing the AI wrote unchanged is in it."; Sound like this says it is his words again. The Context tab says the same.
- **How they sound, from their lines** (`style/voiceMarks.ts`, `ContextInput.voiceMarks`): each character's lines in the
  scenes read (`checks/speakers.ts` `spokenLines`, with the rest of the same speech in that paragraph; and the memory
  keeper's sample lines the scenes read lack, his own when he set them), his own lines alone when he wrote at least 3
  lines and 20 words of theirs, else all. Cheap marks: sentence length (short ≤ 6, long ≥ 16 words), line length, no
  contractions, a dropped g, what they call people (a word set off by a comma at a sentence's start or end: "girl", "my
  lord", "Captain", another's other name), swearing, up to two words or pairs they use three (four) times as often as
  everyone else, questions, exclamations, trailing or breaking off, please never or often; at most five. One line each
  for those in the scene, under the profiles' lines in "How they sound": "How their lines so far read (the author's own
  lines where there are enough):" then "- Bryn: short sentences (about 4 words); calls people "girl"; often says "aye"."
  The lines themselves are never sent.
- **Tests**: `style/ownWords.test.ts`, `style/voiceMarks.test.ts`, `style/ownWriting.test.ts` (in a world: records,
  chat proposals, the cache, the briefing and the switch), `ai/ownVoice.test.ts`, `shared/ownSample.test.ts`, and the
  Style guide e2e (`genres.spec.ts`).

## Adam's direction, said last and checked ask by ask (overhaul, 2026-10-19)

The app's main job is writing what Adam tells it. A review found a whole scene's direction in the middle of the scene card
("followed loosely", as Add below's had been), the team's own tests had DeepSeek follow events it carried on from and
ignore them as rules, the contract kept the direction as one item cut at 320 characters with how-it-reads asks ("more
dialogue") dropped, and the check's answer folded away in the Issues tab.

- **Last of all** (`ai/prompts.ts` `finalInstruction`, `DIRECTION_LEAD`): Generate's closing ends "The author's direction
  for this draft (make every part of it happen on the page):" and the direction word for word, as Add below's "What happens
  now" does; the line "Follow the author's direction" is gone. The scene card leaves it out (`context.ts` `sceneCardText`,
  `buildBriefing` `directionOnCard`) unless the closing is a draft's own (Beat by beat, `ContextExtras.final`). Said once:
  the contract points to it (`SAID.below`); the planner reads it under what is being written for a whole scene too
  (`plan.ts` `askText`, `calls`; the brief's copy of the contract `SAID_PLAN`). Measured: the writer's request for a whole
  scene with a direction is the same size to a token (4,950 to 4,951 with a contract); the trap harness's fake run
  (`--measure`, chain K1) unchanged (writer 8,019, Continue 2,919, check 3,604 tokens on average).
- **Ask by ask** (`ai/contract.ts` `directionAsks`, `AskKind`): sentences, lines and parts between semicolons, and inside
  a sentence a clause that bids something of its own ("…, end on the knock"), says how it reads ("…, more dialogue") or has
  someone act next ("…, then Tobin leaves"); a comma or "and" inside one happening never splits it; each whole, at most
  `ASKS_MOST` (6). Each is a "must change" item with its kind (`ContractItem.ask`: event, reads, length), with places of
  their own (the card and the plan share what is left, the direction counting as one); the writer reads one pointer line
  for all of them. Continue keeps only what happens. How it reads and how long go into the plan's notes as their last line
  ("How it reads, as the author asks: …", `PLAN_PARTS.reads`, `PlanMaterial.reads`).
- **Checked in the same call** (`repair/contract.ts`): each ask is a C line (about 100 tokens in per ask); an ask of length
  ("keep it under 800 words", `lengthAsk`, `keepsLength`) is never sent: the app counts the new words. How it reads and
  how long are never a "not shown yet" question. The report keeps each ask's kind and result (`ContractCheckItem.ask`, a
  model's "not yet" kept as such) and the record checked (`ContractCheck.recordId`, set only as words land).
- **The receipt** (`features/receipt/`, `receiptOf`): over the AI dock after a draft (Generate, Add below) written with a
  direction, once its check is in (in the panels, at the foot of the page: `DirectionReceipt place="panels"`, a pill of
  the panels' own with Write it in in the AI's amber): "✓ Mira lies about the key · ○ More dialogue" with Write it in (`continueAtEnd` steered
  by what didn't land, never a length) and Dismiss; every ask landed, one quiet ✓ line that fades (4.5 s). From the scene's
  check report, refreshed on `issues:changed`, for 15 minutes, once per draft; gone while the next draft or Beat by beat
  runs. What the AI saw shows the same under the direction for the draft it was checked for (`ReceiptInSaw`).
- **The stale direction** (`generate/draftOptions.ts` `draftDirection`, `useGenerate.ts`): on the desk, Add below with the
  steer box empty has no direction (it took the Draft options' one, kept from a whole draft, as "what happens now");
  asked from the Draft options themselves, theirs.
- **Tests**: `ai/contract.test.ts` (the split, length, the contract and the briefing: said once, last), `context.test.ts`,
  `plan.test.ts`, `echo.test.ts`, `repair/contract.test.ts` (asks in the check and the report), `receipt/receipt.test.ts`,
  `draftOptions.test.ts`, `tests/unit/writerRound.test.ts`; app test `tests/e2e/directionReceipt.spec.ts` (the desk, the
  fake writer leaving "More dialogue" out; Write it in; What the AI saw; the stale direction; the panels: the receipt at
  the foot of the page, Write it in, at 1024 px, and written in by itself).

## The direction composer (overhaul, 2026-10-19)

Telling the AI what to write is Adam's main act, and he did it in five boxes that each forgot it differently. They are
now one box, `features/direction/DirectionComposer.tsx`, in Generate's draft options (`GeneratePanels`), the desk's steer
box (`desk/dock/Dock.tsx`), a beat's note (`beats/BeatBar.tsx`), Variants (`variants/StartPanel.tsx`) and the AI edits'
Rewrite and Continue boxes (`edits/AiTools.tsx`). No migration; the box's words still go where they always went.
- **Keys**: Enter writes (Shift+Enter a new line; Ctrl+Enter where it did before); ↑ in the empty box brings back the last
  direction given, ↑ again the one before, ↓ back (`logic.ts` `historyStep`; from a box's first or last line only, and
  only when it has something to step to, so the AI edits' menu keeps its arrow keys otherwise). Listed in the shortcuts
  list (`lastDirection`). Dictation types into it as into any box.
- **Quick asks** (`QuickAsks.tsx`, `logic.ts` `CHIPS`): Shorter, Longer, More dialogue, Less description, Slower, Faster,
  Inner thoughts, Tenser, End on a hook. Each puts a short ask in the box as a sentence of its own, and takes it out when
  pressed again; Shorter/Longer and Slower/Faster take each other's place. As many as the row has room for show (at most
  four, measured before it is drawn), the rest behind More. With the pointer an ask goes in as typing does
  (`typeInto.ts`), so Ctrl+Z in the box takes it back. The desk's dock has no room for the row: its clock button holds
  every quick ask and Recent.
- **Recent** (`RecentList.tsx`): the directions given before in the open story, searchable, newest first, the same words
  once (`shared/directions.ts` `directionKey`: case, spacing, quotes' shapes and a closing full stop don't count), with
  where and when ("Draft · 2 days ago · 3 times"). Read by `recentDirections(storyId?, limit?, kind?)`
  (`contracts/direction.ts`, `ipc/direction.ts`, SQL in `db/directions.ts`), read-only over the generation records: Generate's
  drafts and Variants (and each variant's own note), Beat by beat's records ("<direction>. For this beat: <note>" read as
  both), Continue's, and (kind `rewrite`, the Rewrite box's own list) Rewrite's. Never Write the whole chapter's, Change
  tone's tone name, or the app's own jobs. Directions given this session are offered at once (`store.ts` `noteUsed`), before
  their record exists (a draft waits for the memory before it is recorded).
- **Starred** directions are Adam's for every world: `favouriteDirections` in his writing preferences file
  (`settings.ts` `setDirectionFavourite`, at most 60, cut at 600 characters); `setWritingPrefs` keeps the file's list
  whatever the page sends, so a preferences page opened earlier never takes a star back.
- **Used once, never unseen.** On the panels, a direction in the draft options shows beside Generate as "Direction: …" (in
  the model's place, as wide as the toolbar has room for; × clears it with Undo; a dot on the options button in a narrow
  toolbar) and clears once a draft has started with it (`store.ts` `watchDraftDirections`: the draft's record says what it
  was given). On the desk the draft options' direction and Variants' are the steer box itself (one box, in sight). Once the AI
  starts with it the box empties and stays empty however the writing ends (`deskStore.ts` `steerTaken`: it used to give
  the words back when the dock saw no words arrive, which a fast writer's draft could finish before, leaving a used
  direction in the box); ↑ and Recent bring it back. Variants clear theirs once the set has started. Beat by beat
  still reads the draft options' direction for every beat of a session (the label shows it meanwhile).
- **A direction for each variant** ("Draft three: tense / tender / funny"): Variants' "Give each variant its own direction"
  (`variantNotes.ts`). `StartVariantsInput.notes`; the set is still briefed and planned once, and each note is said to its
  variant alone, last before the plan the set shares (`variants/index.ts` `withVariantNote`, so the briefing's start stays
  the same and the later variants still read it from the cache); kept as `params.variant.note`, shown in its column's head.
- **Tests**: `features/direction/logic.test.ts`, `db/directions.test.ts`, `tests/unit/directionComposer.test.ts` (the calls
  and the preferences file), `variants/variants.test.ts` (own notes), `tests/e2e/direction.spec.ts` (panels and desk).

## Directed writing (an option) (Adam's spec, 2026-10-19)

With Directed writing on, a director watches the writer while it writes and steers it between stretches, like a film
director giving notes between takes; it never writes prose. Off by default; on for every draft (Settings › Models,
"Direct every draft", `settings.directedWriting`) or for one draft (the draft options' "Directed writing",
`DraftOptions.directed`, which wins either way). It applies to Generate, Add below and Write the chapter's drafts; Continue,
Beat by beat and Variants stay as they are. No migration: the record keeps it in `params`.

- **One draft, written in stretches** (`director/run.ts`, a `DraftStream`): `ai/drafts.ts` `startDraftJob` takes
  `stream`, which stands in for the one `streamChat` call with the same options and the page (`DraftPage`: the words so
  far, `settle` for the filters between stretches, `takeBack` for a paragraph). So a directed draft is one record, one
  stream into the page, one Stop, and the same speaker tags, plan-echo filter, saving, refusal handling, watchers and
  `generation:done` as any draft; its params get `directed` (stretches, retakes, director calls, Adam's notes) and `steps`
  (each stretch's note and why: "Steps it took" in What the AI saw).
- **Stretches** (`director/stretch.ts`, pure): one beat of the scene plan (`DraftBriefing.scenePlan`, set by `withPlan`
  when the plan's notes went in), else the card's (Add below: those not on the page yet), short beats written together,
  at most `MOST_STRETCHES` (12); no beats: about `STRETCH_WORDS` (250) each; Auto about 280 words a beat. Each stretch
  is asked with a reply limit sized to its words (`stretchTokens`, 1.7 times over) and stops cleanly (`StretchCutter`):
  at the first paragraph's end past 1.15 times its words (the request is stopped there); past 0.9 times, a sentence still
  being written waits for its end, so one cut off by the limit never reaches the page (one cut off sooner, by a model
  that writes less in one go, comes back off the page).
- **The writer's requests** (`stretchMessages`, `stretchAsk`): the briefing's messages exactly as built (its start is
  what the provider's cache keeps), then the draft so far as the writer's own words (an assistant message), then the ask:
  Adam's notes, the director's note, "Write stretch 2 of 3, about 220 words: “…”", the last ending on the plan's closing
  image. The first stretch has no words yet: its ask follows the briefing's closing words in the same message.
- **The free checks first** (`director/checks.ts`, no AI call; the world read once a draft): over the stretch's words,
  the card place's name and time claims (`checks/freeRules.ts`, as check and repair runs them), the dead speaking
  (`checks/rules.ts` `deadHere`, through `ruleScene` with `RuleOptions.text`), a piece of clothing already off used as
  worn (`director/clothes.ts`: where things stand as told, `toldStage`, with the draft's own taking off and putting on
  since; narration only; "her" only when the sentence opens with that person, or with "She" and one person here goes by
  it), and a thing the story index has elsewhere or someone it has in another place (`plan/preconditions.ts`
  `beatsCanHappen`, each sentence read as a beat). Each finding says whether it is in the stretch's last paragraph.
- **The director, only when needed** (`director/decide.ts`, `director/prompts.ts`): asked when a check found something,
  a beat the stretches so far were asked for isn't on the page (`shared/beats.ts` `beatsOnPage`), an ask of the checklist
  isn't (the scene contract's "must change" items, `ai/contract.ts`, the list the receipt uses too; `mostlyIn`) once the
  plan's stretches are written or 80% of the words are, Adam gave a note, or the plan's stretches are written and the
  closing image isn't on the page yet. One short call (`[AIWRITE-DIRECTOR v1]`, `DIRECTOR_REPLY_TOKENS` 300, through the
  task runner: its own record, job `director`, stopped with the draft) answers `{"verdict": "continue" | "retake" |
  "done", "note", "reason"}`. Otherwise, and when the call fails or can't be read, `freeDecision`: a must-fix slip in the
  last paragraph is taken again; once the plan's stretches are written the scene is done when everything landed, or after
  one stretch more to land what didn't; else carry on with what is overdue as the note.
- **A retake** replaces only the last paragraph: it goes from the record and the speaker tags
  (`SpeakerTagFilter.takeBack`) and, by `generation:takeBack`, from the page (`streamDoc.ts` `takeBackStream`: the
  paragraph emptied, nothing recorded, so the draft is still one Ctrl+Z; the editor's `takeBackStream`, a scene kept for
  the draft too), and is written anew from the paragraph before with the reason and the note. At most `MOST_RETAKES` (2)
  a paragraph; then the decision is made as if none were left.
- **Limits**: 12 stretches a scene, 2 retakes a paragraph, no longer than 1.6 times the draft's words (`LONGEST`); Stop
  works at any time (the draft's own: the words so far are kept). Drafts still wait for the memory first.
- **Adam's notes** (`director/live.ts`; `directorNote(generationId, note)`, `shared/contracts/director.ts`): typed (or
  dictated) while it writes, they go in at the next pause: to the director as a reason to be asked, and to the writer's
  next ask.
- **The director model**: its own job in Settings › Models ("Director model", `models.director`, `thinking.director`),
  the memory model until Adam picks one (`jobModel` `director`: director, memory, writer), so a stronger model can direct
  while DeepSeek Flash writes; with none, decisions are made for free.
- **On the screen** (`features/director/`): `DirectorBar` over the foot of the page (on the desk above the AI dock): the
  director's line ("Writing: the knock at the door", "Carry on — next, the knock at the door", "Taking the last paragraph
  again — …", "That's the scene."), the stretch, the note for the next stretch, and a box for Adam's note ("Your note goes
  in at the next pause."); `director:progress` events, the last line kept a moment after the draft ends. `DirectedToggle`
  in the draft options (for one draft: `store.ts` `withDirected`, used by `draftRun.ts`); `DirectorSettings` in Settings ›
  Models after the continuity brief. The settings carry test names the new settings (`NEW_SINCE_081`).
- **Write the chapter**: its scene drafts are directed when the switch is on (`ipc/chapterWriter.ts`), quietly (no line
  in the window; the run says how it goes).
- **The cost**: each stretch sends the briefing again (mostly from the provider's cache) plus the draft so far and a short
  ask; the director's call is about 1,400 tokens and is made only when needed. Measured with the fake trap runs
  (`npm run traps -- --fake --samples 1 --measure <file> --directed off|on`; `--directed` sets `AIWRITE_DIRECTED`):
  probes v3 (two Generates of 600 words, three Add belows of 400): the writer's requests 5 to 12 (2.4 a draft), their
  tokens in 27,190 to 67,947 (about 5,440 to 5,660 a request: the same briefing, plus the draft so far), and 4 director
  calls, 5,577 tokens; every job 108 calls and 357,164 tokens to 118 and 406,879 (+14%; the fake writes at most 220
  words a request, so the undirected drafts were shorter). Chain K1 (six one-beat Add belows written whole by the
  stand-in): one stretch each and one director call each (the closing image), 128 calls and 484,006 tokens to 134 and
  493,411 (+1.9%). On DeepSeek Flash's prices, with its cache, a three-stretch scene's writing costs about 1.5 times as
  much (the later stretches read the briefing from the cache), and takes a request's first-word wait more per stretch,
  plus a few seconds for each director call.
- **Tests**: `director/stretch.test.ts`, `decide.test.ts` (with the clothes rule and the director's request and reply),
  `checks.test.ts` (the free checks in a world), `run.test.ts` (the loop through a draft against a scripted provider:
  sizing, the clean stop, a free check's retake with and without a director model, the director only when needed, the
  limits, Stop, Adam's notes, an unreadable reply), `paths.test.ts` (Generate and Add below through `ipc/ai.ts` against
  the fake provider, its director's retake, off), `index.test.ts` (the switch, the job, the fake director),
  `features/director/takeBack.test.ts` (the page), `tests/unit/settingsCarry.test.ts`, and `tests/e2e/director.spec.ts`.
  The fake provider (`tests/fake-provider/director.mjs`) answers the director (a retake for `[[fake: director retake]]`, a
  finding in the last paragraph, or a "wouldn't" note) and writes each stretch with its beat.
- **Not done here**: the free checks read plain English only (the clothes rule's verbs are a short list); a beat or ask
  said in other words is left to the director to judge; a real-model run (trap book) with and without it would judge it
  at length.

## Show me the plan first, the card check, and writing in what a draft missed (overhaul, 2026-10-19)

Three parts that help the AI write what Adam tells it, consistently. No migration: two settings (`NEW_SINCE_081` in the
settings carry test), one draft option, and steps on records.

- **Show me the plan first** (`plan/review.ts`, contract `shared/contracts/planReview.ts`, handlers `ipc/planReview.ts`):
  the draft options' "Show me the plan first" (`DraftOptions.showPlan`, for one draft: `features/planReview/store.ts`
  `takeShowPlan`, read in `useGenerate`) or Settings › Models › Planning, "Show me the plan before writing"
  (`settings.showPlanFirst`, off by default). Generate and Add below (`ipc/ai.ts` `startDraft`, `reviewWanted`; never with
  Plan before writing off) stop once the scene is planned: `ai/draftFlow.ts` `withPlan` calls `review` with the plan
  (`MadePlan`, or null when none could be made) and what the card check noted, after the memory has caught up (drafts
  still wait for it). The plan waits with no time limit (`waitForReview`, events `scenePlan:review` / `scenePlan:closed`,
  `scenePlansWaiting` for a window opened meanwhile) until `answerScenePlan`: Write (as made, or with Adam's parts), Cancel
  (`UserError` 'cancelled', "Cancelled before writing", which the window says nothing more about), Stop
  (`cancelDraftStart`), or the world closing. Costs no tokens: the plan is made anyway. Adam's changes (`changedPlan`, pure:
  the point, the beats, who is where, what changes, the closing image; empty lines out; what must happen first kept with its
  beat while its words are the same) are what the writer gets: the notes are written again by `MadePlan.writeAgain` (the
  same point of view, stretch and asks of how it reads), and the scene's kept plan becomes his (`plan/index.ts`
  `keepChangedPlan`), so Continue and later beats follow it. Directed writing writes by the changed beats.
  The window (`features/planReview/ScenePlanReview.tsx`, mounted beside the chapter's plan; parts shared with
  `ChapterPlanReview` in `planReview/parts.tsx`): "Worth knowing before it writes" (the card check's notes and the beats
  that can't happen), the point, what happens (with what must come first under its beat), who is where, what changes, it
  ends on, what it keeps to; Change the plan (a box a beat, the lists a line each), Write, Cancel; closing it is Cancel.
- **The card check** (`plan/cardCheck.ts`, no AI call): before planning (`planBeforeWriting`, with the story index just
  brought up to date), the scene card is held to the index, saying something only when the index is sure: someone on the
  card there sooner than the road from where they were allows (the index's too-fast check for this scene, unless the
  words have moved them on since), or the card's beats have them at the place the story last had them, apart from the
  card's Where (never a sentence of going, coming or remembering); someone on the card the memory is sure died, or who is
  elsewhere at that very moment; something the beats or the direction have someone use that the index has left or carried
  elsewhere (`beatsCanHappen`'s findings that can't be put right) or that the memory says they gave up (`holdingsOf`); a
  When earlier than the scene before (`scenesGoingBack`); an age a year or more from the entry (`ageGiven`, `ageHere`; with
  no dates, the entry's age two years either way). Place and time only as a scene begins. At most 8; never names what Adam
  kept out. The findings go (a) into the planner's request as "Before writing, note: …" lines under their own heading
  (`PlanCore.notes`, `CARD_NOTES_TITLE`), so the plan resolves them, and (b) to Adam: in the plan-first window and on the
  plan's record in What the AI saw ("Steps it took", `CARD_CHECK_LABEL`).
- **Write in what a draft missed** (`features/receipt/autoWriteIn.ts`; Settings › Models, "Write in what a draft missed",
  `settings.autoWriteIn`, off by default): when the direction receipt shows an ask that didn't land (○, never one of
  length), the app writes it in once by itself with the steered Continue Write it in uses (`continueAtEnd`), only when
  nothing else is being written in the scene and only for a draft this window started; the receipt then says what was
  written in ("+", `data-direction-receipt="written"`, "Written in below"), and What the AI saw notes it. At most once a
  draft (`claimAutoWriteIn`). Wherever the receipt shows: on the desk, and at the foot of the panels' page.
- **Tests**: `plan/cardCheck.test.ts` (each finding with its controls), `plan/review.test.ts` (end to end against the
  fake provider: the plan waits with no call of its own, the changed beat reaches the writer and Continue, Cancel and Stop
  write nothing, the card's notes reach the planner and the record; the pure parts), `features/receipt/autoWriteIn.test.ts`
  (once only), `features/planReview/logic.test.ts`, `tests/unit/settingsCarry.test.ts`; app test `tests/e2e/planFirst.spec.ts`
  (the desk: a beat changed, Write; Cancel; written in once by itself).
- **Not done here**: the card check reads plain English and doesn't look at the card's mood or notes for things used.

## Keep this, change that (Change it…, 2026-10-19)

No writing tool lets a writer say "closer, but shorter": Write it again on a beat wrote from scratch without seeing the
version it replaced, and an AI edit could only be accepted or rejected. Change it… revises a passage as Adam says,
keeping the sentences he marks word for word.

- **Where he sees it.** Under the draft just written (`edits/JustWritten.tsx`: "Draft written · 640 words", Change it…,
  What the AI saw, Undo while nothing else has changed the page; it goes once he types, opens another scene or closes it,
  and steps aside while the AI is busy or a change waits). In the AI tools over selected words (Change it…, "Keep this,
  change that"). Beside Accept and Reject on any AI change waiting in the page (`SuggestionLayer.tsx`; Change again… on
  one made this way). On a beat's menu (`beats/BeatMarksLayer.tsx`: "Change it…" in place of "Change and redo…").
- **The change box** (`edits/ChangeBox.tsx`, what it is about in `edits/changeStore.ts`): over the foot of the page (over
  the AI dock on the desk), the passage's sentences to click to keep (`shared/revise.ts` `sentencesOf`; marked as a quick
  ask that is on; arrow keys move between them, Space keeps), the direction composer for the note (kind `rewrite`: ↑, the
  quick asks and Recent as everywhere; Enter changes it), Change it. Esc or × closes it. The words it is about are marked
  softly in the page while it is open; a change inside them closes it with a word about why. A beat may be written again
  with no note (the button says Write it again).
- **The tool** (`EditTool` `'revise'`, `EditInput.keep`; `main/edits`): an `edit` record like the other AI tools, the
  writer model, `steady` creativity. Its system prompt says the passage is to be revised, not rewritten (`REVISION_RULE`),
  and with kept sentences `KEEP_RULE`; the briefing has the passage as it is now (`PASSAGE_LEAD`), the kept sentences listed
  right after it (`KEEP_LEAD`; `edits/input.ts` keeps only those the passage has, in its order, at most `KEEP_MOST`), the
  scene card in full, the scene's plan with no call (`planForContinueOf`), where things stand before the passage when it
  is kept (`STAND_LEAD_PASSAGE`), Adam's own writing as the sample when that is on (`ownWritingFor`), and the ask last
  ("Revise the passage as the author asked (“…”), keeping everything else as it is. Keep the 2 marked sentences word for
  word."). On a waiting change, the passage is the AI's words and the change takes its place (`session.ts`
  `changeWaiting`, `takeOver`: what its Accept was to do, a beat's say, and History's label carry over).
- **Kept means kept** (`shared/revise.ts` `restoreKeeps`): once the words are in, each kept sentence is found word for word
  (spacing and quotation marks' shapes aside); one the AI reworded goes back in place of the sentence most like it
  (`LIKENESS_TO_SWAP`), one it left out goes back after the kept sentence before it (or before the one after); one with
  nowhere to go is said to be missing ("Change again, or reject the change"). The change's note says which (`keptNote`).
- **Only what moved** (`Suggestion.diff`; `edits/reviseDiff.ts` over Ask's `wordDiff`; `suggestions.ts` `diffShape`,
  `renderDiff`): the old words make way (hidden, still the scene's text until Accept) and the passage shows once, cut words
  struck through and added ones marked in amber, paragraph by paragraph with italics and bold; words cut from a
  paragraph's end stay at its end. While it is written, the old words it hasn't reached are faint after the caret, so the
  passage reads whole as it changes. A change that starts part-way through one paragraph and runs into the next shows
  the old way. Accept is one undo step, kept in History first ("Before Change it"); the change is named by the note
  ("Change it: “Closer, but shorter”").
- **Beats written again see the old version** (`BeatStart.old`, `keep`; `beats/instructions.ts` `oldBlock`, `keepBlock`,
  `oldNote`): Write it again in the bar, Redo this beat and Change it… send the beat's words on the page as "This beat as
  it is now"; with a note the AI changes that version and keeps the rest close, with none it writes a fresh take, not the
  same sentences again. Change it… on a beat is a tracked change of only what moved, its kept sentences checked as above
  (`beats/redo.ts`).
- **Cost**: about 220 tokens more than a Rewrite of the same words (the two rules, the card in full, the kept sentences):
  a 400-word beat about 1,850 tokens in and 600 out, a 1,500-word draft about 3,500 in and 2,300 out (about $0.002 at
  DeepSeek's prices), plus about 550 when Adam's own writing is the sample.
- **Tests**: `shared/revise.test.ts`, `main/edits/revise.test.ts`, `main/beats/instructions.test.ts` and `start.test.ts`
  (the old version and kept sentences sent), `edits/reviseDiff.test.ts`, `edits/suggestions.test.ts` (`diffShape`); app
  test `tests/e2e/revise.spec.ts` (selected words: keep, note, only what moved, Change again with a sentence put back,
  Accept, Ctrl+Z; the draft just written: the row, the box, Esc, Reject) and `beats.spec.ts` (Change it… on a beat);
  the fake answers `revise` (`tests/fake-provider/m4/edits.mjs`).

## Events in the scene they happen in (Adam, 2026-10-19)

Adam: "before, all the events being added by the AI went right after the first chapter's scene as a long line, and not
actually where they were supposed to be added in the timeline". 0.7.7 put the World builder's events for a story's plan
in their scene; events made before that, and the Story builder's (laid out before the outline has scenes for them),
still first exist at the story's start, so the timeline could place them only by a date, and with none (or one it can't
read) they sat just after the opening scene. One module, `worldViews/eventHomes.ts`, finds each such event's scene from
the record alone (no AI call) and moves it there; Undo puts it back.

- **Which events.** Made by a World build for this story (`db/worldViews.ts` `builtEvents`: its line in What changed,
  not undone; the Story builder's and a recipe story's builds are World builds), never one Adam made himself; one
  first-exists point, not set by hand, at the world's or the story's start; not before the story (the timeline shows it
  ahead of the story's scenes, `eventPlace.ts`, or its When says long ago, `longAgo`); and not when its scene would be the
  opening one (it shows there already).
- **Its scene**, strongest first: `text`, the memory keeper read something of it in that scene's words (a source link,
  `history.entryLinkScenes`, or a text change there about it or tying someone to it, `textChangeScenes`); `plan`, the
  build line's words are that scene's line of the story's plan ("- Scene The Wreck: ...", old and new forms, matched by
  title); `card`, the scene card's title, goal or beats name it (whole words); `date`, its When on the story calendar: the
  first scene of the story's present on or after its day (the build's `sceneOnDay` rule), on the day itself when an
  outline is kept. A scene its date disagrees with is passed over for the next reason.
- **Moving** sets the point to that scene and the entry's `originSceneId`, as a build that knew the scene makes it, so
  `refreshDefaultExistsPoints` keeps it there (`EventMove` records what it was; `unmoveEvents` puts back only what is
  still where it was moved to, never a point Adam has set by hand since). The characters involved in it are involved from
  there, as the memory reads a relationship only while both exist.
- **Keeping an outline** (`outline/structure.ts` `keepOutline`, every keep: the outline helper, its stages, a chapter's
  plan, the Story builder, a recipe's plan) puts the story's waiting events in the kept scenes (`within`, `exactDay`),
  each listed on its scene's `KeptItem.events`; the keep's toast says so (`tree.ts` `placedEventsNote`) and its Undo
  (`unkeepOutline`) puts them back first.
- **Put events in their place** (timeline, `features/timeline/EventPlaces.tsx`, `eventPlacesLogic.ts`): the timeline asks
  `getEventHomes` with the river (one load, no shift); when anything can move, a line under the header says how many
  ("12 events from the World builder can go to the scenes they belong to."), Show which lists each with its scene and why
  and a tick to leave it, Move them calls `placeEvents` (worked out again in main) and its toast's Undo `unplaceEvents`.
  Not now hides it on this computer (localStorage `aiwrite.timeline.eventPlaces`) until another event can move.
- **Made from a scene.** `createEntry(kind, input, at)`: an event made with Add to memory on a scene's words, or an Ask
  the world proposal, first exists at that scene (`makingAt`). Ask's new event names its `scene` (the open one when left
  out; "before the story" for none) and `when`; the proposal shows "Happens in".
- **Already right**: the World builder from a story's plan (0.7.7) and a recipe story's build (the same summary with the
  recipe's lines after it); the memory keeper (an event found in a scene first exists there); filling in the gaps never
  touches an event (`fillTargets`); Build from a summary keeps an event true from where Adam said, and the timeline shows
  a dated one on its day; the Plan hub and chapter plans make no events (their keeps go through `keepOutline`).
- **Tests**: `worldViews/eventHomes.test.ts` (each reason, what stays: placed by hand, Adam's own, before the story, the
  opening scene, another story; one Undo; keeping an outline), `worldViews/eventPaths.test.ts` (each path against the fake
  provider: an event for Ch 2, Sc 3 shows right after it), `features/timeline/eventPlacesLogic.test.ts`, the toast note in
  `features/outline/tree.test.ts`, and `tests/e2e/timelineEvents.spec.ts` (the New look: after a World build, and the
  tidy-up with its Undo). Fixture: `tests/unit/eventWorld.ts`.
- **Not done here**: an event the memory keeper reads in a scene but the world already has from a build (it records
  nothing new for it) waits for its date, a card or the build's own words; no AI is asked where an event goes.

## The chat never claims a change it didn't make (Adam, 2026-10-19)

Since 2026-10-20 the check matches claims by target, covers every chat and every ending, and the app writes the
outcome under each answer: see "Every chat tells the truth about changes".

Adam: "I was still getting responses from the chat claiming it had edited or proposed a change while it did nothing",
and "an error with the chat saying it could not access something to edit".

- **How a false claim got through** (each reproduced in `ask/agent.truth.test.ts` with a scripted model, and as fake
  models): a claim with no tool call on a question routed as an answer or ideas (never nudged); a proposal its check
  turned down, the model carrying on as if it worked; a provider that turns tool_choice down; the last request (at
  `MAX_STEPS`, the room cap or the runaway guard) is asked without tools and was never looked at; a model still claiming
  after its nudges (the claim stayed, with only a note under it); the claim patterns caught only some wordings ("I've
  updated Mara's entry", "Done.", "the change is ready" slipped through).
- **The truth check** (`shared/askTruth.ts`, pure, no AI call): `changeClaims` reads an answer's own words for claims (I've
  edited / changed / updated / added / removed / proposed / applied / renamed / moved…, "X's entry has been updated",
  "Done.", "the change is ready", the old hand-overs), never words in quotation marks, questions, offers ("I'd…", "I
  can…"), conditions ("once I've…"), what the story's people did, or an earlier answer; `unbackedClaims` compares them
  with the proposals recorded this answer (all, when none; else the ones naming a kind of change none of them is: an
  entry, a card, a title, something new, words). Every answer goes through it (`ask/loop.ts` gives the agent's hooks to
  `ai/tasks.ts`): `recheck` sends a claim back once ("Your answer gives a change as made that wasn't…", with why the
  last proposal was turned down), with propose_changes forced on the next request (not before a change to words was
  read; never for a question or ideas, which are told to take the claim back instead); after the last request it buys
  up to three more requests, once. `settle` puts any claim still standing right before Adam sees it (`honestReply`):
  "No change was made, so there's nothing to apply. Here's what I'd suggest:" (or "No change was made: I couldn't make
  it because <the check's reason in plain words, `writerReason`>"), a first-person claim turned into an offer ("I'd
  update…"), a "Done." or hand-over left out; with some changes proposed, "Only change 1 is ready to apply; nothing
  else was changed." Proposal cards come only from tool results (`ask:proposals`), never from the answer's words.
- **Tool errors say what to fix**: an entry's field given by its label is taken as its key ("Eye colour" → eyes,
  `fieldKey`), one it hasn't got lists the fields by key and label; a name no entry has suggests names like it; a kind
  given by its tool's name is taken as that kind (`KIND_ALIASES`); an unknown propose tool names propose_changes; a
  kind whose guidance waits in a pack (issue_fix, chapter_card, thread, replace_all) brings its full line with its
  mistake while the pack isn't loaded (the full schema is always in the tool). The last words carry the last refusal and
  no longer give "the scene you couldn't read" as an example reason (models echoed it as "I couldn't access the scene").
  When nothing came of an answer, the chat says why under it in plain words (`notProposedNote`, `data-not-proposed`).
- **Refusals about reaching something**: read_passage of the open scene or a later one is answered with read_scene
  (the shared look-up reads only earlier scenes); an entry known here only by name says from which story, and to ask
  there; a card naming one says so, never "there is no character called…". Apply: a scene Write the chapter holds is
  turned down before the page moves to it (`sceneInPage.ts` `HELD_APPLY`; the page's hold used to drop the edit while
  Apply said "Change applied"), a page that drops a change is never said as applied (`PAGE_REFUSED`), a scene that
  doesn't open says whether it was deleted (Settings › Recently deleted) or is slow (the wait is 10 s, not 4), words
  that now stand in several places with their anchor gone are never guessed at (`AMBIGUOUS`; the first was taken), and a
  card's mark says "Not found" only when its words are gone, else "Not applied".
- **Measured** (`npm run chat-eval -- --model fake/<sloppy one>`, core set, 44 turns; the report's "Truth check" rows):
  answers claiming a change never made, before → after: fake/claims-stubborn, fake/bad-proposal and
  fake/claims-no-toolchoice 31 → 0 each, fake/bad-field 14 → 0, fake/claims 2 → 0, fake/sloppy 1 → 0, fake/chat 0 → 0;
  edit turns ending with a real proposal unchanged (the fakes recover on the old nudge, or never, by design); false
  proposals on questions 0 of 8 throughout; requests only where a claim was caught (fake/claims 96 → 98, bad-proposal
  192 → 196, bad-field 118 → 160, fake/chat 106 → 106). No stand-in run: the stand-in kit has no mixed mode for the
  chat, and the sloppy fakes reproduce each case deterministically.
- **Tests**: `shared/askTruth.test.ts` (claims and their controls, the rewrite, plain reasons), `ask/agent.truth.test.ts`
  (each way a false claim got through, the forced retry, the fallback text, errors that say what to fix, pack-free
  kinds), `ask/agent.access.test.ts`, `ai/tasks.agent.test.ts` (recheck and settle in the loop), the window's
  `applyProposal.test.ts`, `applyDraft.test.ts`, `askEdits.test.ts`, `askWords.test.ts`, and `tests/e2e/editorChat.spec.ts`
  (fake/claims-stubborn and fake/bad-proposal: the honest result on screen).

## The foot of the writing page (UI pass, 2026-10-19)

The writing page's foot had grown five things that each found their own place: the direction receipt, the director's
line, the next-beat chip and the dock on the desk, with messages in the corner over their buttons, and on the panels the
director's line and the pointer to a draft written out of sight, over the words. They now share one place and take turns.
- **The desk** (`SceneView`'s foot column over the dock; `features/desk/dock/foot.ts`): one thing over the dock at a time,
  in this order: the director's line (while a directed draft writes, and its last line a moment after), the direction
  receipt, the next-beat chip. The receipt says when it shows (`setReceiptShown`), the dock says what it is doing
  (`setDockKind`), so the chip's "mark it done?" waits while the AI writes or a change waits (one thing to press); the
  receipt waits while the AI writes, and while a change waits shows only with nothing to press (written in below, or all
  landed). The receipt's quiet "all landed" line starts its fade only once in sight. The page's fade reaches as high as the column does
  (`--desk-foot`, measured), and messages show above all of it (`features/desk/dock/ToastsAbove.tsx`: the column, the
  change box, the director's line, and a small panel opened over the dock, Beat by beat's question or "where should the
  draft go?", measured once placed; a panel reaching into the window's top half, the draft options, leaves them be; while
  the drawer lies over the page in a small window they keep their corner). The
  director's line is of the dock's material (`.desk-foot-card`, desk.css).
- **The panels**: the direction receipt, the director's line and "Writing the new draft below" share one band at the
  page's foot (`[data-page-foot]`), on the page's own colour, only while one of them shows (`empty:hidden`), lifted clear
  of read aloud's bar (`--read-aloud-lift`). They take the desk's turns: with no dock, `FootActivity` (`desk/dock/Dock.tsx`,
  `activity.ts` `dockKindOf`) says what the AI is doing in the scene, so the receipt waits while the AI writes and, while
  a change waits for Accept or Reject in the page, shows only with nothing to press.
- Unchanged: the just-written row stays under the draft's last line (it steps aside while the AI is busy, a change waits,
  the change box is open or Beat by beat runs); the change box and Beat by beat's bar each take the whole foot while open.
- Also in the pass: the draft options' choices scroll between the direction and Generate in a short window (the panel never
  runs off the window); the scene plan's body scrolls with Write in sight (`Dialog` `bodyScrolls`); each variant's own
  direction has a line of its own in its column's head; the card's quiet actions keep one order (Plan this scene, Ideas for
  this scene, Interview me: `SceneIdeas` `lead`); Beat by beat's "no beats" answers share a row; under 1200 px the desk's
  rooms not showing are their icons alone and the top bar's right-hand buttons keep the room they need, so nothing runs
  under them.
- Variants (polish, 2026-10-19): the columns share the width, 240 to 560 px each (`VariantsView` `COLUMN_MIN`), so all
  three show whole side by side down to the smallest window (960 px, the desk with its spine); only a row narrower still
  scrolls sideways. In a column under 320 px a variant being written says so with its pulsing dot (the page's head says
  "Writing…"), so its words and Stop stay whole.
- Tests: `features/desk/dock/foot.test.ts`, `activity.test.ts` (`dockKindOf`); the app tests of the parts (desk, director,
  directionReceipt, planFirst, revise, beats, variants (the desk at 1024 by 700, 1440 by 900 and 960), direction).

## The calm overhaul: one Check, one Issues list, one note per draft (Adam, 2026-10-19)

Adam found the app "annoying and frustrating": nine kinds of checking each reached its own way (the claim check after a
draft, the critic after a draft, the check on marking a scene done, Check this scene, the Critique tab, the chapter
critic, the memory check list, live checks, AI-phrase underlining), one draft could bring three or four messages,
"Getting ready…" said nothing for a minute, a scene the memory model turned down was left unread without a word, and a
check could wait two minutes in silence. Nothing Adam could do is gone; how each is reached is one way now. Automatic
checks are still governed by Automatic AI (`shared/automaticAi.ts`) and never go through the one Check.

- **One Check** (`features/check/`): the top bar's Check on both layouts (`CheckButton.tsx`, beside Scene details on the
  desk; its word goes under 1,680 px there, under 1,280 px on the panels): Check this scene, Check this chapter, Check the
  whole story, "Craft notes too" (kept on this computer, `useCheckPrefs`: the critic reads the scene or chapter as well; for
  the story it adds voice and style), and Show the issues. While a check runs it says how (calmly) and has Stop, and Check
  now while it waits for the memory. Every other way in goes through the same `runCheck` (`runCheck.ts`): the Issues
  list's "Check this scene", the binder's row menus, the palette's check-scene / chapter / story. A scene's check opens
  its Issues list (`showIssues(sceneId, section)`); a chapter's or the story's runs while Adam carries on and ends in one
  note with Show (the Check room). The Check room keeps its own "Check this story" with its menu (`CheckControls`).
- **Every run in one store** (`features/consistency/checkStore.ts`, its pure part `runsLogic.ts`): every run from the
  `checks:*` events whoever started it (`runs`, insertion order = the order they check in), the one Adam asked for (`run`,
  with Stop before it went out), what went wrong per scene (`failed`) and for the Check room (`failure`), the badges, and
  `onCheckEnded` for the Issues list and the draft's note. `issuesStore.ts` keeps only the scenes' issues. `runLine` says
  what a run is doing: "Waiting for the check of Ch 1, Sc 1 to finish…" (behind another), "Waiting for the memory to catch
  up: scene 2 of 4", "Checking Ch 3, Sc 2 · 2 of 5". A scene's own check, in its list, is "Checking this scene…".
- **One Issues list, in sections** (`features/issues/sections.ts`, `IssuesPanel.tsx`, `SectionFilter.tsx`): Slips (words
  that disagree with the record or the rules), Questions (`sectionOf`: asked of Adam, ending in "?", as check and repair's
  are; the scene's contract; no words to point at; a `memoryFix`, where his note may be the one that's wrong; voice, style,
  other stories), Craft notes (the critic, `CritiquePanel` as the Critique tab was; in "All" a line with how many notes are
  still to do and Show), Plot threads (thread issues, and the memory check list's plot threads left waiting for this
  scene) and Memory (the memory check list's other rows for this scene, `CheckQueue bare`; a scene its model turned down;
  "Memory not updated"). Filters: All or one section, two even rows of three in a narrow panel (`@min-[560px]` one row);
  the section shown is kept while the app runs (`useIssuesView`). The head says "2 slips · 1 question". The scene panel
  has no Critique tab: `inspectorTab 'critique'` (the palette's "Scene critique", a critique's ready note) shows Issues ›
  Craft notes. The Check room's story-wide list has the same filters for its sections (Slips, Questions, Plot threads).
- **A scene the memory model turned down** (`keeper/refusals.ts` `refusedKind`, `keeper/index.ts` `memoryRefusalOf`,
  `AppApi.memoryRefusal`, `contracts/calm.ts`): Issues › Memory says so in plain words, with Try again (`updateMemoryNow`)
  and "Use <model> for the memory": another model Adam has set up (`draftNote/compose.ts` `anotherModel`: the writer's,
  chat's, the memory's…, never the one that refused), which becomes the memory model, with Undo.
- **One note per draft** (`features/draftNote/`): `compose.ts` (pure) makes one line of everything a Generate draft has to
  say: "Draft written · 2 small slips fixed in amber · 1 question in Issues · 2 common AI phrases underlined"; `draftNote.ts`
  keeps each scene's note and shows it once, changed in place as more comes (each change gives it its full time again); a
  note that went is shown again only with news, and only the news. Its buttons, the one that matters most first: Try with
  another model (a refusal), the fix for a problem (`draftEndActions`), Undo (the amber fixes), Show (Issues), Show (the
  first phrase), Show (the scene). A draft written in the scene on screen with nothing found says nothing. Fed by
  `generate/draftRun.ts` (how it ended; the briefing note as it starts), `repair/repairRun.ts` (`noteDraftRepair`, when the
  words are its draft's record), `liveChecks/liveActions.ts` (`noteDraftPhrases`, within 30 s of its end) and the check
  after the draft (`issuesStore.ts` → `noteDraftCheck`). Other landings (Continue, a beat, a rewrite accepted) keep their
  own messages. The corner messages keep clear of the panels' foot of the page while it shows (the receipt, the
  director's line: `SceneView.tsx`, `ToastsAbove` on `data-page-foot`), as they do of the desk's dock.
- **A refused draft** (`generation:done` `refused`, set in `ai/drafts.ts` for a content filter, a refusal, a 403, or words
  that are plainly a refusal): the note says so and offers "Try with <model>", another model Adam has set up, for that one
  draft (`DraftOptions.model`, honoured by `ai/draftFlow.ts` `writerModel` only for one of his own models); the writer
  model stays as he chose. A refusal that came back as words, in a scene that had none before, is replaced; another refusal
  offers yet another model (`triedModels`). Check and repair doesn't check a refusal's words.
- **Plain waits** (`main/ai/steps.ts`, `features/waits/`): `draftFlow.ts` says each step as it begins ('memory',
  'gathering', 'plan'), the look-ups say how many things they look up (`ai/lookups` `answerLookups`, then 'plan' again)
  and `ipc/ai.ts` 'writing'; `ipc/calm.ts` sends them as `draft:step`. The memory keeper says how far a wait on it has got
  (`MemoryStatus.catchingUp`: the scene waited for, earlier scenes read so far of how many, or its own latest words; engine
  `catchingUp`). The status line (Generate's status in `useGenerate.ts`, the desk dock's `activityLine` through `waitLine`)
  says "Catching up the memory: scene 3 of 5", "Gathering what the scene needs…", "Planning the scene…", "Looking up 3
  things…", "Writing…". Calm (`waitWords.ts` `calmStep`, `useCalmLine`): a step over in less than 300 ms is never shown.
- **A Check that starts at once** (`ipc/checksIssues.ts`): each run's latest progress is noted by the scene it is at (the
  runs' `emit` is wrapped); a wait on the memory before a scene that lasts 300 ms is said (`checks:progress` with
  `waiting: 'memory'`), and `checkWithoutWaiting(runId)` ends that wait alone (the run checks with what the memory has).
  The waits' limits (a minute each) are as before; the window shows them, with Check now.
- **Tests**: `consistency/runsLogic.test.ts`, `checkStore.test.ts` (one store), `issues/sections.test.ts`,
  `draftNote/compose.test.ts`, `draftNote.test.ts`, `waits/waitWords.test.ts`, `desk/dock/activity.test.ts`,
  `main/keeper/catchingUp.test.ts`, `main/ai/steps.test.ts`; `tests/e2e/calm.spec.ts` (Check from the top bar → the list in
  sections, on both layouts; one note after a draft; the wait steps; a check waiting for the memory and Check now; a
  refused memory scene's buttons; a refused draft's Try with), and the specs that used the Critique tab and the old
  messages (`critique.spec.ts`, `issues.spec.ts`, `repair.spec.ts`, `contract.spec.ts`, `live-checks.spec.ts`,
  `ai.spec.ts`, `manuscript.spec.ts`).

## Build with AI: one area to build every part of a story (Adam, 2026-10-20)

Adam, after seeing the Plan hub: "I told you I wanted a unified area to build all parts of the story using AI." The hub
covered only the outline; the idea, cast and world, chapter plans, scene cards, threads, the world builder, recipes and
Write the chapter were separate pages or pop-ups. **Build with AI** (View `planHub`, `features/planHub/`) is now the one
page per story that holds them all: "Build “<story title>” with AI", the Plan area's first item and the Plan room's first
link, the same on the desk and in the panels. The Plan hub's own parts (below) are its story line.

- **Four sections, one at a time under tabs** (`buildLogic.ts` `SECTIONS`, `PlanHub.tsx`, `BuildTabs.tsx`; until the
  cleanup below they ran down one page), each tab with how its section stands
  (`ideaStatus`, `castStatus`, `lineStatus`, `threadsStatus`: "Your idea · written", "Cast and world · 6 people, 4 places",
  "Story line · Ch 1–2 written, Ch 3–4 planned", "Threads · 3 open, 1 overdue"):
  1. **Your idea** (`storyBuilder/IdeaStep.tsx`): the one idea field (the brief's plot, showing the premise while there is
     none), where and when, length, must and must never happen, his own characters, questions, the story's style, and
     **Start from a recipe** (pick or follow one, talk it over for this story; the recipe library stays its own page).
  2. **Cast and world** (`CastSection.tsx`): "Build it from your idea" (`storyBuilder/CodexStep.tsx`: plan, tick, edit,
     redo, build into the codex, Undo) or "from a summary" (`worldBuilder/WorldBuilderView.tsx` `SummaryBuilder`, the
     World builder's form and results without its page), then **In your world**: each kind with its count and names (a
     click opens one), **Add someone with AI** (the character builder) and Open the codex.
  3. **The story line**: the Plan hub (below). Since "Zoom in" (below) each chapter's row has its name and one next step,
     each scene its name, and what follows is on a chapter's or a scene's own page. Before that, in each chapter's row
     (the chapter being written, and each planned chapter), **Plan this chapter** (`ChapterPlanPanel.tsx`: the chapter's goal, Interview me or Just suggest scenes,
     its scene cards as suggestions in its own session, `LineSuggestions` with `chapterId`, Keep all, then Write this
     chapter) and **Write this chapter** (`WritePanel.tsx`, below). Each planned scene (`SceneRow.tsx`) has **Ideas**
     (next scene ideas inline: what Adam has in mind, three ideas, Use this, Dismiss), **Interview me** (the scene
     interview inline; its row closes when it ends), **Fill the card** (`scenePlanStore.planScene`: only its empty parts,
     Undo) and **Write it** (`writeScene`: the scene on the writing page, then Generate as its shortcut does). Beat by
     beat stays on the writing page. One chapter panel and one scene tool open at a time (`hubStore` `panel`, `tool`).
  4. **Threads** (`ThreadsSection.tsx`, from `getThreadsBoard`): the open threads, overdue first, then due now, then quiet
     ones (`openThreadsInOrder`, the board's `dueWords`/`quietWords`), each with **Plan its payoff** (`seedPayoff`: the
     story line's box says "Move toward paying off the plot thread …", the thread is ticked among the threads waiting,
     put there when the facts didn't list it, `HubState.seeded`) and the way to the Plot threads board.
- **The tabs** (cleanup, 2026-10-20, below): a strip along the top that stays as the page scrolls, on the desk and in the
  panels, zoomed in or not. Its height is `--nav-h` (measured), so a row brought into view and the talk keep clear of it.
- **Talk it over beside everything, about the chosen tab** (`TalkBeside`): Cast and world with a list, the list's own
  talk (`CodexTalk`, its changes shown first); otherwise the plan's talk, its title saying the section ("Talk it over ·
  Threads"), its intro and quick asks the section's, and told what Adam is looking at (`PlanChatRequest.looking`, a block
  "What the author is looking at now" in `storyBuilder/jobs.ts startPlanChat`) for Your idea, Cast and world and Threads.
- **Where it opens**: a story with nothing yet at Your idea, one planned or under way at the story line's "What happens
  next?" (`defaultSection`). The view says more (`View.planHub`): `section`, `chapterId` with `open` ('plan' | 'write'),
  `sceneId` with `tool` ('ideas' | 'interview'), `summary`, `recipeId`, `at`, `back`; the area opens the rows that hold a
  chapter or scene (`hubLogic.rowsToOpen`), opens its panel or tool, and brings it into view (held there a moment while
  what is above settles, unless Adam scrolls or clicks first).
- **Every older way in lands in its section** (`buildLogic.buildRoute`, applied in `navigate()` and in App's pages): a
  `storyBuilder` view (idea → Your idea, codex → Cast and world, outline → the story line, done or none → where the
  story stands), `outline` (with a chapter: its row, Plan this chapter open), `recipePlan` (the story line, following
  that recipe, the recipe plan's guidance as the idea while there is none; a kept premise builds the world with the
  recipe's roles), `worldBuilder` with a story open (Cast and world, from a summary; with no story the World builder
  page stays). `openPlanHub(storyId, BuildAt)`, `openChapterPlan`, `openChapterInterview`, `openSceneTool`
  (`features/outline/open.ts`) and `openChapterWriter` (Write this chapter open at that chapter) are the openers: the
  story menu ("Build with AI"), the Plan area and room (Build with AI, Next scene ideas and Interview me: the open
  planned scene's tool, else the story line at the next scene; Plan a chapter), the palette ("Build with AI", "Your
  idea, cast and world"; its "Ideas for this scene" and "Interview me about this scene" stay the writing page's own,
  on the scene's card), the binder's
  chapter menu, the trail's chapter, the board's chapter, the New story dialog's "Build it with the AI next" (Your
  idea), Story settings' premise, the chapter card's report, the top bar's "The chapter plan is ready for you".
- **Removed**: the Story builder's page (`StoryBuilderView.tsx`, its steps bar and `DoneStep.tsx`), the chapter's plan
  page (`ChapterPlanner.tsx`), a recipe story's plan page (`RecipePlan.tsx`), Write the chapter's start dialog
  (`ChapterWriterDialog.tsx`) and the plan's dialog. The views stay in `View` so saved links land somewhere sensible.
  Nothing Adam made changes: the brief, outline sessions (the story's and each chapter's), kept suggestions, the codex
  plan and its build, chapter interviews and recipe plans are the same stores, shown here.
- **Write this chapter, inline** (`WritePanel.tsx`): before, which scenes it writes (and that words there are kept for
  Undo), "Plan these scenes" for scenes with nothing on their cards, and **Plan the chapter** (starts the run); then
  step 1 of 3, the plan: what it is doing, then the plan to read, `chapterWriter/ChapterPlanReview.tsx`, built to the
  mock-up: "Write this chapter · step 1 of 3: the plan", the chapter's name, **What the chapter does** (three tiles:
  "Wren wants", "Against Wren", "How it turns"; the overview for a plan made before them), **Scene by scene** (each
  scene's line and "Ends with: …"), **Kept true from the memory** (`ChapterWritingPlan.kept`, else the scenes' Keep to
  lines), the cards' questions, **Write the chapter / Change the plan / Cancel**, and **"About 6 minutes · about 9
  cents"** (`buildLogic.estimateWords`; "cost not known" when a model has no price, "free" when all are); then steps 2
  and 3 (writing, checking and fixing) with Stop and the report so far; after, how it ended with See the report and
  Undo. The chapter's row says how it goes ("Writing · 2 of 3: writing").
- **The chapter plan says more** (`src/main/chapterWriter/`): the planner is asked for `lead`, `wants`, `against` and
  `turn` and each scene's `ends` (`prompts.ts`; `readChapterPlan` reads them and their other spellings, `checkChapterPlan`
  keeps a `lead` only when the codex has that person); `partText` adds "Ends with:" and the drafts are told what the
  chapter does in its parts (`chapterLine`); a plan without them reads as before. `keptFacts` (no AI call): the story
  index's lines for everyone on the cards as the chapter begins (`ChapterCore.people`) that say where they were set, the
  plain facts first and at most 3 a person, then the scenes' Keep to lines, at most 8. `estimate.ts` `chapterEstimate`:
  each scene's draft, the memory's read, its plan before writing, its check and about one fix, and the critic once, at
  the writer's, memory's and check models' prices (`RunDeps.estimate`, sent with the review stage as
  `ChapterWriterProgress.estimate`). The fake provider answers the new parts (`tests/fake-provider/chapter.mjs`).
- **From a plan to a written chapter** (Adam, 2026-10-20: "Start writing" did nothing he could see, there was no way to say
  how many scenes or how long a chapter's plan is, and he could only write one scene at a time):
  - *A batch all decided* (`LineSuggestions.tsx` `BatchHead`) offers **Write this chapter** (primary; "Write Ch N" when
    the scenes kept span chapters) for the chapter of the first scene kept, opening its row's Write this chapter
    (`openWriteChapter`, the view's `chapterId` with `open: 'write'`), and **Write the first scene** (`writeScene`: the
    scene on the writing page, its draft started). "Start writing" only opened an empty page. A chapter with words already
    gets no Write this chapter here (`hubLogic.chapterToWrite`): writing it whole would write its written scenes again.
  - *The planned stretch's row* had **Write Ch N** for its first chapter with scenes; since the cleanup (below) the
    planned chapters are listed straight in the line and each one's own Write it does that.
  - *Plan this chapter* has **How many scenes** (Auto, or 1 to 12: `CHAPTER_PLAN_SCENES`; the chapter session's
    `size.scenes`, `helperStore.setChapterSceneCount`) and **Length of the chapter** (Auto, or words: the chapter card's
    `totalWords`, saved as typed, so its scenes on Auto share it out and Write this chapter's drafts go by it;
    `shared/lengths.ts`). The count reaches the request (`ChapterPlanRequest.scenes`; `interview.ts` `chapterPlanSystem`
    "Suggest exactly N scenes", `chapterSizeAsk` with the length and about how long each scene is, from the card's target
    or Settings › Writing's default; `chapterReply` gives room for more than six); a reply with more is cut to that many
    (`HelperRun.most`, `treeOf`), so the extra are never shown or kept. Write this chapter's estimate counts each scene at
    the length its draft will aim for (`gather.ts` `sceneLengthFor`).
  - The chapter writer does not move on to the next chapter by itself: each chapter is written from its own row.
  - Tests: `main/outline/interview.test.ts`, `outline/helperStore.test.ts`, `planHub/hubLogic.test.ts`
    (`chapterToWrite`), `tests/e2e/chapterFlow.spec.ts` (pictures to `CHAPTERFLOW_SHOTS`).
- **Zoom in** (Adam's choice, "Option A: Zoom in", 2026-10-20: an open planned chapter with 4 scenes showed about 25
  buttons, and there was no easy way to build just one chapter or one scene with the AI):
  - *Which page* (`zoomLogic.ts` `zoomOf`): the view's `sceneId` is that scene's own page, else `chapterId` that chapter's
    own page, else the whole story (the sections). One the story no longer has falls back to its chapter, then to the
    whole story. `PlanHub.tsx` shows the page (`ZoomPages.tsx`) under the Story line tab, with Talk it over and Plan
    before writing beside it as before; the header and Back link stay. `near` (a chapter) brings
    that chapter's row into view on the whole story. Every view with a `chapterId` (the outline with a chapter,
    `openChapterPlan`, `openChapterInterview`, `openChapterWriter`, Write this chapter from a batch) lands on the
    chapter's page: `open: 'write'` opens Write this chapter there, `open: 'plan'` brings it to its plan; a `sceneId`
    with `tool` (`openSceneTool`) the scene's page with its ideas or interview open. The page starts at its top (or at
    what was asked for; `useLayoutEffect`).
  - *The trail* (`trailOf`): "Whole story › Ch 14 · The ford" on a chapter's page, "Whole story › Ch 14 › Sc 2" on a
    scene's; Whole story goes back with `near`; the view's `back` (where Build with AI was opened from) is kept as Adam
    zooms in and out.
  - *The whole story, quieter* (`StoryLine.tsx`): each chapter (written, being written, planned) shows its name (a click
    opens its page, `data-chapter-zoom`) and ONE next step (`ChapterStepButton`, `chapterStep`): **Plan it** (no scenes,
    or a scene whose card is empty: `PlanHubFacts.emptyCards`), **Write it** (every card says something, no words yet)
    or **Open** (it has words); while the AI writes it, "Writing · 2 of 3". Each opens the chapter's page (Plan it at
    its plan, Write it with Write this chapter open). Scenes show their names only (`SceneLink`; a click opens the
    scene's page). No panels, no scene tools, no Add scenes or Fill in buttons on the overview. Batches (Keep, Change,
    Discard), What happens next? with YOU ARE HERE, Show me are as before.
  - *A chapter's page* (`ChapterPage`): the trail, how it stands (`chapterMeta`: "Planned · 4 scenes", "Being written ·
    2 of 4 scenes written · 3,100 words"), **Write this chapter** (the one primary button, `data-write-chapter-btn`;
    `WritePanel` opens under it, `hubStore` `panel`), Chapter card, What the chapter achieves (`ChapterGoal`) and How
    many scenes / Length of the chapter (`ChapterSize`), **Scenes** (`SceneRow`: its name opens its page, one action by
    `sceneStep`: Open once written, Fill the card while its card is empty, else Write it; the rest in a ⋯ menu: Ideas,
    Interview me, Fill the card, Write it, Open; Ideas and the interview open under the row), the story line's batch
    for this chapter (Add scenes, Fill in: `RunPlace` at this chapter; What the AI saw comes back to the page), and
    **Plan with AI** (`ChapterPlanPanel`: Interview me, Suggest scenes, plus the page's Add scenes, which takes How many
    scenes as its count, and Fill in N empty cards; its own suggestions, Keep all, then Write this chapter).
  - *A scene's page* (`ScenePage`): the trail, where it is and whether it is written, **Write it** (`writeScene`: the
    scene on the writing page, its draft started; for a written scene Generate asks Replace or Add below as ever), Open
    the scene, its card in short (When, Where, Who, What happens, What stands in the way, How it ends, Beats; read again
    as the outline, the briefing or the codex change), then **Ideas**, **Interview me**, **Fill the card**
    (`useSceneTools`, shared with `SceneRow`), for written or unwritten scenes.
  - *Ways in*: the binder's right-click "Build this chapter with AI" and "Build this scene with AI", the chapter card's
    and the scene card's "Build this … with AI" links, the palette's "Build this chapter with AI" and "Build this scene
    with AI" (`openChapterPage`, `openScenePage` in `outline/open.ts`), and every older chapter route above.
  - Tests: `planHub/zoomLogic.test.ts`; `tests/e2e/zoom.spec.ts` (the desk: the quiet story line, a chapter's page, its
    scenes' one action and ⋯, Fill the card, Add scenes and What the AI saw and back, a scene's page, the trail back;
    the panels: the binder's right-clicks, the card links, the palette, Write this chapter with AI… and Interview me
    about this chapter; pictures to `ZOOM_SHOTS`). `buildWithAi`, `chapterFlow`, `planHub`, `buildLook`, `storyBuilder`,
    `ai-planning-desk`, `newlook` and `interview` follow the pages.
- **Cleanup: tabs, nothing locked behind another section** (Adam, 2026-10-20: "kind of confusing with stuff locked behind
  other sections and it's hard to navigate"; spec `docs/superpowers/specs/2026-10-20-build-with-ai-cleanup-design.md`):
  - *Tabs* (`BuildTabs.tsx`): Your idea, Cast and world, Story line, Threads, each with its number and status; a real tab
    list (`role="tablist"`, roving tabindex; arrows, Home and End move, Enter or Space picks). Only the chosen section
    shows: all four stay in the page, the others `hidden` (`role="tabpanel"`, `data-build-section`), so a draft half
    typed in one (an Ask me questions answer, an open Change form) survives a look at another; the scroll-spy and each
    section's own head are gone. Both idea boxes show `buildLogic.shownIdea` with one typed flag (the builder store's
    `ideaTyped`, `writeIdea`). What a way in brings to the top keeps clear of the tabs (`scroll-margin-top`). The tab
    is the view's `section` (`buildLogic.tabFor`): on a chapter's or a scene's page always Story line; else the view's
    section, else the tab last chosen for that story while the app runs (`hubStore` `section`, `setSection`), else
    `defaultSection`. A tab click (`goTo`) navigates to that section (from a chapter's page Story line goes back with
    `near`, its row in view); a tab starts at the top of the page. Buttons that pointed at another section (Write your
    idea, Plan the cast and world, Plan its payoff) switch tab, then focus what they meant to (`whenShown`).
  - *Zoomed in*: the chapter's and the scene's pages show under the tabs, Story line chosen.
  - *Planned chapters in plain sight* (`StoryLine.tsx`): the planned chapters are listed straight in the story line, one
    row each (`data-planned-chapters`, `.hub-row-kids.is-flat`), with no "Ch 5 to Ch 9 · planned, not written" row, no
    Open the plan / Pick up from here / Fold away and no second Write Ch N (each chapter's own step does that).
  - *How it all connects* (`worldInterviews/topicLogic.connectionsOpen`) opens once a topic has kept something or the
    world has a character, place or lore (`useEntryCounts`); shut, it says "Add a character, place or lore first".
  - *Plan your story* (`HubCards.tsx` `StartCard`) has the idea box itself (`data-start-idea`, the brief's plot, the same
    idea as Your idea's); Plan it with no idea says so under the box and puts the cursor in it, staying on Story line.
  - *Plan before writing* shows only beside Story line (and the zoomed pages), where drafts start.
- **Tests**: `features/planHub/buildLogic.test.ts` (the statuses, the default section, the routes, the rows to open, the
  threads' order and Plan its payoff's words, the step, the estimate's words, Kept true, the review's heads),
  `main/chapterWriter/chapterWriter.test.ts` (the three parts and endings read, an old plan as before, Kept true, the
  review's estimate and Kept true reach the window, the drafts told the parts), `main/chapterWriter/estimate.test.ts`;
  `tests/e2e/storyBuilder.spec.ts` (a new story built end to end in one place: idea, cast and world planned, talked over
  and built, the story line planned and kept, a chapter planned in its row, its plan read with its parts, written with
  the fake), `tests/e2e/buildWithAi.spec.ts` (the desk mid-story: the statuses, Plan this chapter with its interview, a
  scene's Ideas and Fill the card, Plan its payoff, Write it; the panels: every older way in), `tests/e2e/buildLook.spec.ts`
  (pictures, desk Dark and panels Light, 1366×768 and full screen, to `BUILD_SHOTS`).

## The Plan hub: one place to plan with AI (Adam, 2026-10-20)

(Since the same day this is Build with AI's story line: see above. The header's "The idea, cast and world" link is gone; the sections are on the same page.)

Adam: "the one place to plan with AI", and "we should also be able to return after we have already written part of a
story and plan the next part of it"; then, trying the outline helper on a story with chapters, "carrying on the outline
of a story that already has chapters". The outline helper's page (`OutlineHelper.tsx`, deleted) is now the **Plan hub**
(View `planHub { storyId, at?, back? }`, room Plan; `features/planHub/`, contract `contracts/planHub.ts`, main
`src/main/planHub/` and `ipc/planHub.ts`). It is one page per story, the same on the desk and in the panels, built to the
mid-story mock-up. Nothing goes into the story without a click.

- **The header**: Plan, the story's title, what is written ("Written: Ch 1 to Ch 4, Sc 2 · 31,400 words",
  `hubLogic.writtenLine`), and **The idea, cast and world** (the Story builder's first steps; Back comes here).
- **Three ways it opens** (`hubLogic.hubMode`): *writing* (a scene has words), *planned* (chapters or scene cards, nothing
  written) and *start* (a blank story). Mid-story the card is **What happens next?**: YOU ARE HERE, the last scene written
  and its gist (the story index's, else its summary; no AI call), a box "Tell it in your own words, or leave it to the AI",
  what to plan (`scopesFor`: the next scene, the rest of Ch N, the next chapter, the rest of Act N, more of the story),
  **Threads waiting:** (open threads quietest first, ticked to be worked in), and **Plan it**. A new story's card is
  **What is your story?**: one idea box, which *is* the Story builder's plot (`brief.plot`, showing the premise while there
  is no plot; Story settings' premise points here instead of asking twice), the cast and world's state, and the size (In
  stages or All at once, acts, chapters, scenes; "Let the AI choose" is `sizeForLength` of the brief's length).
- **Adam's words reach the request.** `OutlineRequest.direction` and `OutlineStageRequest.direction` carry the box and the
  ticked threads (`hubLogic.directionText`); the prompts put them under "What the author wants (make it happen)" with
  `DIRECTION_RULE` (`outline/prompts.ts`, `stages.ts`, `outline/jobs.ts`, `storyBuilder/jobs.ts`), so What the AI saw
  shows them. A stage request can be anchored: `afterSceneId` (the next scene, or the rest of a chapter, after its last
  scene; told how the last scene written ends, and the latest When up to there, `latestUpTo`), `count` ("exactly 1
  scene") and `afterChapterId` (chapters after this one, to the end of the act).
- **The story line** (`StoryLine.tsx`, rows from `hubLogic.storyLine`): written acts or chapters folded with Open, the
  chapter being written and its scenes, YOU ARE HERE, then what is planned but not written (Pick up from here opens it
  chapter by chapter) and acts with no chapters (Plan its chapters). The AI's suggestions arrive **in their place**
  (`LineSuggestions.tsx`; `HelperRun.place` `here | chapter | act | end`, `tree.anchorItems`; Keep lands there, after the
  last written scene for the next scene), each with Keep, Change, Redo and Discard, its beats and card a click away, under
  a batch head (what it is doing with Stop; then "N suggestions to keep, change or discard", Keep all, What the AI saw; a
  settled batch folds to its head). Earlier batches stay under Earlier suggestions, as before.
- **Carrying an outline on** (any chapter, written or planned, `ChapterActions`): **Add scenes to Ch N** (after its last
  scene), **Plan its scenes** (a chapter with none), **Plan its chapters** (an act with none) and **Fill in N empty
  cards** (scenes with a title and nothing else, `PlanHubFacts.emptyCards`): `startPlanUpdate` with `mode: 'fill'`
  (`planHub/update.ts`, marker `[AIWRITE-OUTLINE v1] update fill`), shown as suggestions; Keep puts each on its card only
  where the card is empty (`scenePlanLogic.planOnCard`), with Undo. A card Adam wrote is never overwritten.
- **The story has moved on from the plan** (`planHub/facts.ts` `planDrift`): the free card check (`cardCheck`, no AI
  call) of the planned scenes after the last one written, against the memory at the end of what is written. **Show me**
  lights them in the story line; **Update the plan** (`startPlanUpdate`, marker `[AIWRITE-OUTLINE v1] update`, at most 6
  cards) writes them again to follow what was written, shown first, kept or discarded as one (with Undo).
- **Talk it over** beside the story line (`PlanTalk` with "Make this change"; it works with no suggestions open:
  `applyRevision` makes a run) never claims a change it didn't make: a revision it can't apply says so and is declined.
  Under it, the **Plan before writing** switch (the writing page's own), and the writing page now says what that plan is
  doing ("Planning the scene: looking up where everyone is…", `draft:step` `about`, `waitWords.lookupWords`).
- **Where it is:** the Plan area's first link "Plan with AI" (the desk's Plan room too), the rail, the story menu, the
  binder's "Plan it with AI" / "Plan what happens next with AI", the board's blank story, the palette ("Plan with AI"), the
  Story builder's Plan step (with Back to the Story builder) and Next scene ideas / Interview me with no scene open (the
  hub at the next scene). `openPlanHub(storyId, { at, back })` (`features/outline/open.ts`); `openOutlineHelper` is its
  alias. A chapter's plan page stays as it was. Back goes where Adam came from.
- **State**: what Adam wrote, the threads ticked, the chosen part and the open rows are kept while the app runs
  (`hubStore.ts`, one per story); the suggestions and a request still arriving are the outline helper's session, as before.
- **Tests**: `features/planHub/hubLogic.test.ts`, `main/planHub/facts.test.ts`, `update.test.ts`, the hub requests in
  `main/outline/stages.test.ts`, `tree.test.ts` (`anchorItems`), `helperStore.test.ts`; `tests/e2e/planHub.spec.ts` (desk
  mid-story; panels mid-story and a new story's start; desk start and the Story builder's way in and back; carrying an
  outline on: Add scenes to a written chapter, Fill in an empty card). The fake provider answers the hub's requests
  (`tests/fake-provider/m4/outline.mjs`: `update`, `update fill`, exactly N scenes after a scene). Specs that used the
  outline helper's page moved to the hub (`outline`, `outlineStages`, `chapterCards`, `storyWorld`, `storyBuilder`,
  `ai-planning-desk`, `desk`, `newlook`).

## The plan reads less: no whole book (Adam, 2026-10-20)

A live run of the trap story on DeepSeek Flash (30 scenes, about 60,000 words, the overhaul's code) found Plan before
writing's continuity brief (fix 14) reading the whole book so far word for word with every plan, plus a story record of up
to 40,000 tokens: about 85,000 tokens a request ("the plan read 97,692 tokens, the book so far whole"), and its six plans
were a third of all the run's tokens (507,000 of 1.52 million). Most of the record was who knows what among everyone named
in the scene (19,600 characters), everyone and everything in it with all their history, and how each chapter ended. Adam:
"Trim the plan's whole-book reading (use the story index, summaries and look-ups instead)".

- **What the plan reads now with a brief** (`plan/brief.ts` `briefMaterial`, from the briefing's own input; `plan/index.ts`
  `withBrief` adds only the rule checks' findings from the world). Besides the plan's own parts (the scene card, what must
  stay true, where things stand, everyone here as the story index has them, "Already happened" for this chapter and the one
  before, the open threads, the codex's names), in the order sent:
  - *the story so far, chapter by chapter, in short* (`CHAPTERS_TITLE`): each earlier chapter's summary
    (`storySoFar.chapters`, its "scene 2" cited as "Ch 3, Sc 2"), a chapter not summed up yet its scenes' gists, never a
    chapter "Already happened" tells scene by scene (`BriefSources.covered`); when room is short the oldest go first
    (a shorter form of a summary first), and it says how many were left out and that what_happened tells them. Its lead
    says the earlier scenes' own words aren't here and read_passage reads them;
  - *the scene before, word for word* (`PREVIOUS_TITLE`, with where it is: "(Ch 7, Sc 4: The road out of Carrow)"), a long
    one from where its last 2,000 words start, then 800, then 300 (`SCENE_WORDS`, at a paragraph, `sceneTail`), saying
    its earlier part is a look-up away;
  - *everyone and everything in this scene* (`PEOPLE_TITLE`): the people here (`sceneKnowers`) with who they are, how they
    look and what they want (fields `basics`, `looks`, `arc`; not their voice or past), the place, the card's threads and at
    most `OTHER_ENTRIES_MOST` (6) entries the scene itself names (its card, Adam's direction, the scene so far, the end of
    the scene before, a pin, the plan), each with its last 6 changes, then 3, then none (`ENTRY_HISTORY`), and "(25
    earlier changes left out here: get_entry has them.)";
  - *who knows what, among everyone here* (`KNOWS_TITLE`): only a fact someone here doesn't know (never one everyone here
    knows or that is about them), the newest first, at most 12, each fact at most 180 characters, then wrong beliefs (at
    most 6), and "(Not listed: 57 more facts known here, by everyone here or older: who_knows has them.)" (`KNOWS_MOST`);
  - the story calendar, the slips put right and the rule checks' findings, as before;
  - after the plan's own parts, as they change from step to step: *the scene so far, word for word* (`SO_FAR_TITLE`, up to
    3,000 words, then 1,200, then 400), the first `PASSAGES_MOST` (6) earlier passages the search found (12 before), and
    the scene's contract.
  The words just before ("The end of the scene so far", "The end of the previous scene") aren't said again when the record
  has their scene word for word (`planMessages`). The record is fitted to `RECORD_MOST` (11,000 tokens; 40,000 before), or
  half of what the memory model reads less the plan and its reply when that is less (`briefRoom`): each part first to its
  share, then what is left by rank (the scene so far, who knows what, the calendar, the scene before, everyone here, the
  chapters, the slips, the findings, the passages; `fitParts`, whose parts may now list newest first and say what they
  left out). No more `BOOK_READER`, `BOOK_SHARE`, `BOOK_MOST`, `bookWithin`, `bookPart` or the chapter ends (fix 15's
  snapshots still go to the writer).
- **Also in the world (not in the briefing)** (`plan.ts` `othersFor`, with or without a brief): at most 40 names
  (`MOST_NAMED.others`, 150 before), those named in what has just happened or tied to someone on the card first, events
  last, in name order, then "(and 61 more: get_entry finds any by name)".
- **Look-ups for the rest**: the plan's one round (unchanged), and its instructions say plainly that it has what happened
  earlier only in short, and that read_passage reads an earlier scene word for word (find_in_story finds where:
  `LOOKUP_RULE`). `BRIEF_RULE` names what it now reads, "given or looked up". `checkBrief` counts what it looked up as given
  (`makePlan` passes the answers with the request), and a chapter told only in short counts (its "### Ch 3" heading, and its
  scenes as its summary cites them), so a line citing them is kept; one citing a scene it never saw is still left out.
- **The cache**: the chapters in short and the scene before lead the request (the same at every step of a scene, and the
  chapters at every scene of a chapter); Claude through OpenRouter is asked to cache up to the end of them
  (`BriefPartText.steady`, `cacheUpTo`). The answering request still keeps the tools listed with tool_choice 'none', so it
  starts as the first did. The record kept in the world has the scene before and the scene so far as notes ("(1,986
  words, read word for word. Not kept here…)": `partText(p, false)`); `BRIEF_LIMIT_MS` is 90 s (no 120 s for the book).
- **The writer's side** (`ai/brief.ts`): `ContinuityBrief.book` and the book's lead are gone; the lead says "a reader of
  the story record". A brief written before reads back the same (`readBriefText`). Settings › Models' help says what the
  plan reads now ("the chapters so far in short, the scene before and what the story record says of everyone here").
- **Every path**: Generate, Add below, Variants and Beat by beat's first beat as before; Directed writing writes by the same
  plan; Write the whole chapter plans with a brief too now (Adam, 2026-10-20: left out while the plan read the whole
  book, `brief: false`; turned back on once it no longer did).
- **Measured** (offline, free): the trap harness's fake provider from the live run's saved world, with its real DeepSeek
  memory (`--fake --samples 1 --from-world <live run> --writer deepseek-flash --memory deepseek-flash --judge
  deepseek-flash --measure …`, chain K1; a fake run that names a real model now reads as much as it does live, DeepSeek
  Flash's 1,000,000 tokens: `tests/traps/app.ts` `choose`): each plan request 81,210 to 82,830 tokens before (the book so
  far whole, as live), 13,150 to 17,014 after (the answering request, with the look-ups' answers, about 1,100 more than the
  first; the later scenes 15,800 to 17,000, about 80% less); the six plans' twelve requests 984,782 to 190,744 tokens, and
  the whole run 1,403,038 to 608,850. With Directed writing on (`--directed on`) the plans the same, the run 1,412,451 to
  618,261. Of the 54,000 characters asked after, the scene so far is 15,600, the scene before 6,600, the chapters in short
  4,700, everyone here 3,800, who knows what 2,800, the passages 2,900. The trap checks came out the same on both runs
  (the fake writer). A live re-test on DeepSeek Flash comes after merging.
- **Tests**: `plan/brief.test.ts` (the room, the parts and their caps, the order and the cache, a long story within
  RECORD_MOST, a chapter told in short counted as given, the scene's words kept as notes, a retry counted under a cent),
  `plan/withBrief.test.ts` (never the book from the world, the covered chapters), `plan/plan.test.ts` ("Also in the world"
  capped, the look-up rule, a brief line backed by a look-up kept), `plan/index.test.ts`, `ai/brief.test.ts`.

## Check this scene catches again (checkfix, 2026-10-20)

A live DeepSeek Flash run of the trap harness's book (61,000 words, 1 sample, 19 planted passages checked after the book
ends) caught **10 of 12** planted slips on the released app (0.8.1) and **6 of 13** on the overhaul (1 false alarm each).
Missed by the overhaul only: X4 (Pim reads), X5 (how her father died), X6 (what Kit could know), X9 (how long the road is)
and X13 (a made-up month). Four causes, each fixed; no migration, no new kind of call.

- **Issues found, then dropped (X6)** (`checks/run.ts` `findingsRuling`). Both requests flagged Kit's "I heard her" (facts
  and who knows what), and the second opinion ruled both not real ("the memory lists Kit as knowing it, so it is
  consistent": how he learned it was the slip). Since the requests share their opening (2026-10-19) the second opinion also
  runs under the checks' own instructions ("when unsure, leave it out"). Now **what two requests find on their own is kept
  without asking** (`corroborated`): a fact or who-knows-what finding whose words overlap such a finding of the other
  request (`BOTH_KINDS`; never two of one request, never continuity or the timeline, asked once). Measured on the live
  replies: 8 such pairs over both runs' 37 checked passages, every one a planted slip, none on a control. The second opinion
  still rules on everything else (on X6 it rightly dropped the continuity note), and its task now says how someone learned
  something is a fact like any other and that "leave it out when unsure" is for finding issues, not ruling on them
  (unmeasured offline). Fewer notes to rule on, and no call when none is left.
- **Half the checking** (`checks/context.ts` `checkRequests`, `ASKED_IN_BOTH`). The released app's two requests each
  answered all six checks (its instructions said "one item for each check above" right under the line naming all six), so
  every slip had two looks. Since the shared opening each request asked its own three. Now both ask **facts and who knows
  what** too, each its own checks first ("facts, timeline, continuity, knowledge" and "knowledge, voice, style, facts";
  `checkTask` keeps the order given). One request (one group's checks alone, or `together`) asks each check once. The same
  slip found twice is one issue (`saveFound`'s `sameThing`); what the scene's contract found comes first, so the request
  without the contract finding the same words plainly adds nothing.
- **What the facts check is given** (`checkSections`, `entryText`). Released, the facts request had its own short list
  "What people here know that this scene touches" (`factsTheWordsTouch`, 10); since 2026-10-19 those were only added to the
  end of who knows what, or left among its 40 lines. On the released world's memory the decisive fact sat 9th, 5th, 9th and
  10th in that short list for X4, X5, X6, X9 (released code), but 33rd, 36th, 11th and 38th of 42 in who knows what
  (overhaul code). The list is its own section again (`TOUCHED_TITLE`, before who knows what, which no longer repeats it): with
  the fix they are back at 9th, 5th, 9th and 10th. And an entry told in full now shows its **backstory** (key past events,
  origin, secrets; a place's geography and history), which the check never saw (`formatProfile` short form since milestone
  5), never the arc's planned start and end (`PLAN_FIELDS`): on the overhaul's own world Tamsin's "her father drowned
  eleven winters ago below Corran Weir" (X5) and on the released one Hollin's "four days north of Callowmere" (X9) were
  only there.
- **X13, the made-up month** (`checks/freeContext.ts` `fromThisScene`). Caught offline, passed live: reading the scene before
  its check, the memory keeper makes its events in the scene's words ("Frost again: on a raw March morning…"), and the
  time rule then read March as a month the codex names. An entry the memory made from this scene's own words no longer
  counts (one from an earlier scene, or Adam's, still does).
- **Not the checker**: on the overhaul's live world the memory never recorded that Pim can't read (only "Orla will read to
  Pim anything that comes to the loft") nor how long the road to Hollin is; no check can catch X4 or X9 from that memory.
  The released run's memory had both. Reading earlier passages for the facts check (the planner's `findInStory`) would
  cover such gaps; not done here.
- **Measured offline** (fake provider, `--fake --story book --probes X4,X5,X6,X9,X13,N1-N6`, from the live runs' worlds
  as the book left them; the fake answers by rule, so catches aren't measured): 22 check requests either way, two a scene;
  the overhaul's world 350,948 tokens in before, 358,766 after (+2.2%, 16,308 a request: the touched list moves facts, it
  doesn't add them; the backstory adds about 380 tokens); every request about a scene still opens alike, byte for byte, so
  the second is read from the cache. Replies grow by one "checked" note (live, about 210 characters) and a slip found
  twice; second opinions fall when both requests agree. A live re-run is what shows the catch rate.
- **Tests**: `checks/bothRequests.test.ts` (X6's live replies word for word: kept now, and dropped as before without
  `corroborated`; which requests ask what; what counts as found by both; the touched list and the backstory),
  `checks/freeRules.test.ts` (the month in an entry made from the scene itself), and the request shapes in
  `checks/run.test.ts` and `checks/checks.test.ts`.

## Interviews by topic (Adam, 2026-10-20)

Adam: separate interviews for building a story or a world, instead of one broad one. **Interview me, topic by topic**
(`features/worldInterviews/TopicInterviews.tsx`, contract `contracts/worldInterviews.ts`, main `src/main/worldInterviews/`
and `ipc/worldInterviews.ts`) is in Build with AI's Cast and world (`CastSection.tsx`, under the two ways to build, for the
story) and on the World builder page (`WorldBuilderView.tsx`, both layouts, `storyId` null: the world on its own). Four
topics, any order: **Characters**, **Places**, **Lore and history**, and **How it all connects**, offered once a page
topic has kept something (`topicLogic.connectionsOpen`). Each says how it stands: "Not started", "Under way", "Done · 3 kept".

- **Questions** (`askTopicQuestions`, marker `[AIWRITE-WORLD v1] topic-questions <topic>`): a few at a time (`ROUND_MOST`,
  3), told the idea (a story's brief and style with the world's summary, or the world's summary, themes and tone:
  `context.ts ideaText`), what the world has (the topic's own kind in full, the rest by name; for the connections every
  character, place, lore, event and group with its empty parts, and the relationships it has) and the interview so far,
  so it never asks what is known. Adam answers in a box under each question (an empty box skips it), **Skip these** or
  **Stop asking** (what is typed counts). A round that only repeats is sent back once (`parse.newQuestions`); `{"done": true}`,
  nothing new or `MOST_QUESTIONS` (12) asked means it has enough, and the suggestions come by themselves.
- **Suggestions** (`suggestFromTopic`, marker `topic-suggest <topic>`): pages of the topic's kind (`TOPIC_FIELDS`: the
  parts each may fill; a place's `in`, lore's `rule`), settled against the world (`settle.ts`): a page the world has is
  offered only for its empty parts ("Adds to your page"), or not at all; parts word for word in his answers are his
  (`hisWordsIn`). The connections suggest links (`TopicLink`): a relationship ("lives at", "older sister of", feelings
  only between two characters), a place inside another (only one inside none, never a loop) or words for an empty part of
  one page; links to pages that aren't there, or that the world has already, are left out. Each is a `'world'` record (the
  World builder model and its Thinking) with its parts, so **What the AI saw** shows them; a reply that can't be read, or is
  plainly a refusal (`looksLikeRefusalReply`), says so in plain words.
- **Keep, Change, Discard, Undo** (the story line's way, `wi-*` in `topicInterviews.css`): Change edits the page or link
  (what he changes becomes his, `topicLogic.changedEntry`); Keep (`keepTopicSuggestion`, `keep.ts`) saves through the World
  builder's writer (`worldBuilder/save.ts`: `saveEntry`, `saveInto` for a page the world has, `saveRelationship`,
  `saveInside`, `fillField`), true from the world's beginning or the story's start, his words his and the rest drafted by
  AI; never a page twice. Each Keep is one memory run with one line, marked `via: 'interview'` with its topic and where
  (`WorldUndo`), shown in What changed as "Kept from an interview"; such runs are never the World builder's "last build"
  (`db/worldBuilder.ts buildRunIds`). Undo (the row's, the toast's) is `undoWorldBuild(runId)`; Keep all has one Undo.
  Discard has Undo in its toast. Nothing goes into the world without a click.
- **What is kept**: the questions, answers and suggestions live in the window while the app runs (`topicStore.ts`, one
  set per story and one for the world); what each topic kept is read back from those lines (`getInterviewProgress`,
  `keep.ts interviewProgress`: not undone, page not deleted), so the topics stay marked done after a restart. No migration.
- **Tests**: `src/main/worldInterviews/worldInterviews.test.ts` (prompts, reading replies, settling, Keep and its Undo, the
  progress, the calls against the fake), `features/worldInterviews/topicLogic.test.ts`, `tests/e2e/worldInterviews.spec.ts`
  (Cast and world: characters with Change, Keep and Undo; places stopped early with Keep all and a place put inside
  another; How it all connects; the World builder page with no story). The fake provider answers them in
  `tests/fake-provider/m4/worldTopics.mjs`.

## Write this chapter names the chapter (Adam, 2026-10-20)

Adam: the chapter writer wrote the text "but not picking a name that fits the story's other chapters also". No migration
(the name and the title before go in `meta`).

- **The brief** (`chapterWriter/plan.ts` `chapterNames`, `planOpening`): "## The story's chapters, in order" lists the
  story's chapters by their own titles (`ownTitle`: "Chapter 3" or none counts as no name), "Ch 2" for one with none,
  this chapter marked, the `CHAPTER_NAMES_MOST` (12) nearest it. When this chapter has no name of its own, "What to do"
  asks for one in `title`: in the other chapters' style when any has a name (`styled`), else a few words that fit the
  story and the chapter. `planSystem` and `WRITE_CHAPTER_PLAN` gain `title` (the house rule: a few words, no numbers).
- **Kept** (`readChapterPlan`, `planName`, `checkChapterPlan({ nameWanted })`): one line, no quotes, no "Chapter 3:" before
  it or full stop after, at most `NAME_MOST` (80) characters; dropped when not asked for or only a number.
  `ChapterWritingPlan.title`.
- **The review** (`ChapterPlanReview.tsx`): "Chapter name", a one-line box under the heading, with "Picked to fit your story
  and its other chapters. Change it, or clear it to keep the chapter as it is." (`buildLogic.ts` `NAME_HINT`,
  `nameAnswer`: sent as `ChapterPlanAnswer.title` only when changed; '' keeps the title). `withAnswer` applies it.
- **Saved** when Adam says write, before any scene is written (`ChapterRun.nameChapter`, through `RunDeps.rename`, the
  binder's `updateChapter`), never over a name the chapter has by then; the run's label takes it. The name and the title
  before are kept (`store.ts` `chapter_writer_named:<chapter id>`, cleared as each run starts; gone with the chapter in
  `trash.ts`) and in `ChapterWriterReport.named`; the report says "Named the chapter “…”." (`namedWords`). The window
  reads the outline again once the run moves past the plan, and when it ends.
- **Undo** (`ipc/chapterWriter.ts`, `titleToPutBack`) puts the title back only while the chapter still has the run's name
  (`renamed` in its answer; "Put back 2 scenes and the chapter’s name as they were before the AI wrote the chapter.",
  `undoWords`).
- **Tests**: `chapterWriter/chapterWriter.test.ts` (the brief's list and ask, the cap, what is kept, Adam's change and
  clear, saved before the first draft, the report, Undo and Adam's own rename, a chapter with its own name, one named
  while the plan waited, a story's only chapter named too), `planHub/buildLogic.test.ts` (`nameAnswer`),
  `chapterWriter/chapterWriterLogic.test.ts` (the report's and Undo's words), `tests/e2e/chapterWriter.spec.ts` (the box,
  changed, saved, put back). The fake planner (`tests/fake-provider/chapter.mjs`) answers "The Far Bank" when asked.

## Writing progress in the top bar (Adam, 2026-10-20)

Adam: "when the AI is writing a chapter or a scene there is no way to see its progress other than this" (a pill cut off
at "Writing Sc 1 “Morning Confrontation” (…"); then "also show what model is being used when a task is active". No
migration; the progress event only gains fields.

- **The pill** (`features/progress/WritingStatus.tsx`, in both top bars, in place of `ChapterWriterStatus.tsx`): while
  Write this chapter runs or Generate drafts, "Writing Ch 3 · scene 2 of 4 · 1,240 words" or "Writing “Morning
  Confrontation” · 640 of ~1,500 words": the title gives way (cut with "…"), the numbers never do; a thin bar under it;
  the hover has the whole title, what it is doing and the model. "The chapter plan is ready for you" is as before. The
  older "Writing…" button stays for drafts that aren't Generate's (Beat by beat).
- **The card** (a click): the steps with the current one marked (a chapter: The plan › Writing › Checking and fixing, as
  `writeStep`; a scene: The memory › The plan, when Plan before writing is on › Writing › Checking, the check of new words
  after it), each step's model when they differ, else one "Model: …" line; each scene of a chapter (written with its
  words, being written with its live words against its aim, waiting); what it is doing right now in plain words, with
  its model ("Looking up where everyone is", "Waiting for the story’s memory to catch up", "Fixing problem 2 of 5, in Sc 2
  “The ferry”" and the problem, "Trying again: OpenRouter is busy"); the bar and what it measures; the time so far (not
  the time the plan waited for Adam), about how long is left (`secondsLeft`: from how far it has got once 8% is done and
  20 s have passed, else from the plan's estimate while it has time to run; hidden otherwise); the cost so far (a
  chapter's); Go to the scene, Stop, and for a chapter See the plan and The report so far. Left open when it ends, it
  says how it ended and what was kept (See the report and Undo for a chapter). The words are `progressLogic.ts`'s (pure).
- **What main adds** (`ChapterWriterProgress`, all optional): `doing` (plan, review, memory, draft, check, follow,
  critic, rewrite, fix), `scenes` (each scene's state, words and aim: `RunDeps.target`, `sceneLengthFor`), `startedMs`,
  `writingMs`, `waitedMs`, `retrying` and `fixAt`; `estimate` is kept past the review. A chapter draft's own events are
  heard for it (`chapterWriter/progress.ts` `draftEvents`: its words counted at most every 500 ms, a retake's words taken
  back, a retry), passed on at most every 700 ms (`run.ts` `onWords`); the run's own calls' retries too (`taskEmit`).
  A Generate draft's words, aim, start and models are kept in `useDraft` (`live`, `last`, `checking`; `draftRun.ts`).
- **Models** (`shared/modelJobs.ts`): `MODEL_FALLBACKS` (Settings › Models' "Same as …", which `ai/jobModel.ts` now uses
  too), `jobModelName`. The memory's reading, filling in and re-reading (`KeeperStatus`) and the top bar's Check name their
  model on hover too.
- **Tests**: `features/progress/progressLogic.test.ts`, `chapterWriter/progressCard.test.ts`, `chapterWriter.test.ts`
  ("says how it goes for the progress card"), `tests/e2e/progress.spec.ts` (pictures to `PROGRESS_SHOTS`); `ai.spec.ts`
  follows the pill.

## Writing temperature (Adam, 2026-10-20)

Adam asked for a way to set the temperature when writing with DeepSeek (DeepSeek suggests about 1.5 for creative
writing). Settings › Models › Writing temperature (`features/settings/WritingTemperature.tsx`, under Default creativity):
Auto (the creativity's own temperature, as before) or Custom, a slider and a number box from 0 to 2 in steps of 0.05
(`Settings.writingTemperature`, null for Auto; settings saved before it read as Auto).

- **What uses it: writing only.** Every request that writes the story's words: Generate and Add below, Variants, Beat by
  beat, directed stretches (they take the draft's request), Write the chapter's drafts and its fixes, Continue, Change it
  and the other AI edits. The memory, checks, plan, critic, director's notes, interviews, outline, polish pass and sample
  passages keep their fixed temperatures; `ai/writingTemperature.test.ts` lists the only modules that read the setting.
- **The rule** (`shared/temperature.ts` `writingTemperatureFor`): a custom temperature takes the place of the creativity's
  (the default or a draft's own), which still sets top_p and min_p as before. It goes in through the draft's briefing
  (`DraftBriefing.writingTemperature` to `DraftRequest`), `edits/index.ts` and `ipc/chapterWriter.ts` (the fixes).
- **Each provider's range.** Claude (Anthropic's API, or a Claude model anywhere) takes 0 to 1: a higher value is sent as
  1 and the setting says so; every other model 0 to 2. A model that sets its own creativity is still sent none
  (ai/client.ts). Under the control, in plain words: a model that sets its own temperature, a DeepSeek reasoner (always
  thinks) or a DeepSeek model with the writer's Thinking on ignores it (`temperatureIgnored`). DeepSeek is known by its
  API address or a model id with "deepseek" in it.
- **What the AI saw.** The record keeps the temperature as sent and `ownTemperature: true`; the Creativity cell then
  says "Temperature 1.5 (your setting)" (or, for an edit, "Temperature 1.5 / Your writing temperature").

## Every chat tells the truth about changes (Adam, 2026-10-20)

Adam: the chats "are still saying they did things when they did not", e.g. an edit to a scene or a chapter plan that
never happened. Spec and plan: `.planning/specs/chat-truth.md`, `.planning/plans/chat-truth.md`. Builds on "The editor
chat" and "The chat never claims a change it didn't make" above.

- **Why it still happened.** Only Ask had a truth check, and it asked only whether *some* change of the claim's kind
  existed: one card change backed "I've updated the cards for scenes 4 and 5", and a change merely waiting for Apply
  backed "Done — I've updated the chapter card." Many wordings slipped past ("Plan updated.", "## Changes made", "The
  goal now reads…", reworked/overhauled/drafted…). Stop and an answer ending with a question skipped the check. The Plan
  talk, recipe talk and cast talk had none: when their change couldn't be made, the AI's words were shown as written.
  No chat could change a chapter's goal or length, and the Plan hub's talk invited changes to chapters it can only make
  to suggestions. And some changes really were lost: the scene card panel never re-read its card after Apply, so it
  showed the old card and its next autosave wrote it back over the change (the chapter card panel did the same to
  Interview me's fills).
- **The app says what changed** (`shared/askOutcome.ts` `outcomeOf`, `features/ask/OutcomeLine.tsx`). Under every
  chat answer one line built only from what was recorded, never from the AI's words: "Nothing was changed." (with the
  plain reason when a change was tried and turned down), "1 change is waiting for you: press Apply." (amber), "1 change
  has started.", "Applied." / "2 of 3 applied." (green), "Not applied: you turned it down."; red only when an Apply
  failed. `data-outcome="<state>"`. Its space is kept while the answer streams. Waiting cards say "Waiting: press
  Apply" and the bar says "Nothing changes until you apply." The talks reuse it (`planning/talkTruth.ts`
  `talkOutcome`): "The plan below has 2 changes waiting: press Apply."
- **One truth check, by target** (`shared/askTruth.ts` `checkClaims` / `settleAnswer`). A claim carries the scenes,
  chapters, titles and entries it names (the agent gives each scene its number in the story) and is backed only by a
  change to those; scene card, beats, chapter card and thread are separate kinds. The chat never applies anything
  itself, so a backed claim of a change *made* is reworded as waiting ("Change 1 is ready to apply: tighten the
  opening."), and the chat's instructions say to word changes that way. "Earlier" exempts only words pointing back to
  an earlier answer; a claim about an earlier change stands only if that change was applied (earlier answers go to the
  model with each change's real status, `withProposals` in `ipc/ask.ts`). The check runs on every ending: finished, a
  question to Adam, Stop, and the half-second saves while streaming. The talks use the same check (`settleTalk`), with
  the Plan hub's button named ("…until you press Make this change."). What is never read as a claim: prose the chat
  hands over ("Here's a tighter version:" and the paragraphs after it, up to the chat speaking again), block quotes,
  fenced and indented blocks, quotes (also after `*`, `_` or a comma), and reported speech ("Mara says I changed the
  locks"). An unbacked summary line ("Changes made: tightened the opening.") is kept as a suggestion ("Tighten the
  opening."), never deleted; "Done." goes. In a list where one change backs every line, only the first line says
  "Change 1 is ready to apply"; with some claims unbacked, the lead line says what is ready and the rest read "I'd …".
- **Changes stay applied** (`features/inspector/cardMerge.ts`). The scene card, chapter card and chapter plan panels
  re-read on `briefingRev` / `chapterCardsRev` / the outline, and merge field by field with unsaved typing: Adam's
  typed fields win (a toast says when the chat's change to that same field wasn't kept), every other field takes the
  re-read, so an old copy is never saved back. Update the plan pairs each card with the scene id main sent
  (`planHub/update.ts` returns `sceneIds`) and says "4 of 6 scenes got new cards."
- **Apply tells the truth** (`features/ask/applyProposal.ts`, `applyDraft.ts`). `ProposalStatus` has `'started'`: a
  draft or in-page fix shows Started until it lands, then Applied, or goes back to waiting with the reason; one that
  leaves the page before it is accepted (another scene or story opened; `changeAlive` in `edits/session.ts`) goes back
  to waiting ("It went from the page before you accepted it…"), while one accepted or turned down just before the
  scene changed reads as applied or turned down (`changeEnded`, the last 50); a started change saved when the app closed reads back
  as waiting. Undo puts back only the parts the chat changed, and only those still saying the chat's words ("Mood or
  tone was changed since, so Undo left it as it is"); a goal and length written together are put back together if the
  second write fails. An apply with no reason says "That change couldn't be made."
  Card, title and chapter card changes record what they change (`before`); if it changed since, the first Apply shows
  what it says now and a second Apply goes through. A chapter card change for a chapter Write the chapter holds is
  turned down ("Write the chapter is working on this chapter. Apply it when it's done.") in the window only: a main
  guard would also refuse Adam's own saves.
- **Chapter plans from the chat.** `chapter_card` takes `goal` (written with `updateChapter`) and `length` (the
  chapter card's `totalWords`, 500–200,000 words); its card reads "Chapter plan · Ch 3". A "chapter plan" in Adam's
  words is the chapter's goal, length and card. Moving, reordering or deleting scenes and Write the chapter's own plan
  get "I can't do that from here" with where to do it.
- **The talks.** Plan talk's nudges use the shared claim check; nothing changed says why ("the parts it named aren't
  in the plan", "its reply didn't read as a plan", "it didn't send the change"). On the Plan hub with no suggestions
  waiting, the intro asks for new scenes or chapters, and a request about chapters or scenes already in the story gets
  "This talk changes suggestions only." with **Make this change in the story**, which opens Ask with the request sent
  (`features/ask/open.ts` `askInStory`). Recipe and cast talks: an unreadable or unchanged reply says "Nothing was
  changed: …" instead of showing the raw reply. The talks' instructions (`storyBuilder/prompts.ts` `talkLimits`) say
  what each can change and never to say a change was made.
- **Measured** (`npm run chat-eval`, fakes only, judged by this checkout's check with a waiting change said as made
  counted as false; before = `--root` on main 0.8.6). Answers claiming a change never made, core set of 44: new
  fake/claims-wordy 31 → 0, fake/bad-field 17 → 0, fake/claims 1 → 0, fake/sloppy 1 → 0, the rest 0 → 0. New plan set
  (`--scenarios plan`: scene card, chapter goal, chapter length, chapter card, move, reorder): fake/chat as expected
  4/6 → 6/6, claims-wordy 4/6 → 6/6 with false claims 6 → 0. Edit turns ending with a real proposal unchanged; requests
  only where a claim was caught (claims-wordy 88 → 98). The score's "real proposal" ignores the kind of change, so read
  the plan set's "as expected" row. **Live** (Adam's go, 2026-10-20; `deepseek-v4.1-flash` through an OpenAI-compatible
  address, `CHAT_EVAL_DEEPSEEK_URL`; core + plan, 50 turns, about $0.28): answers claiming a change never made 0 of 50,
  proposals that apply 26 of 26, plan set 6 of 6, false proposals on questions 0 of 8, every turn completed. A Claude
  stand-in through the file bridge (plan + subset, 20 turns) found the crash a chapter card's own `scenes` count caused
  in the check (fixed), and then gave 20 of 20 as expected, with 0 claims never made.
- **Tests**: `shared/askOutcome.test.ts`, `askTruth.wider.test.ts`, `inspector/cardMerge.test.ts`,
  `planHub/hubStore.test.ts`, `ipc/ask.history.test.ts`, `ipc/ask.status.test.ts`, `planning/talkTruth.test.ts`,
  `outline/planTalk.test.ts`, `ask/open.test.ts`, the apply tests, `tests/unit/chatEvalScore.test.ts`; e2e
  `editorChat.spec.ts` (the outcome line through Apply and Undo; an applied card change stays in the open scene card)
  and `planTalk.spec.ts` (fake/plan-wrong-tags, fake/talk-unreadable).

## What the story sets carries on (memory review, 2026-10-20)

Adam: in Ch 3, Sc 2 Mary was told to wear only a green jumper, and Ch 4 and 5 forgot it. A review of the whole story
memory (`docs/STORY_MEMORY_PIPELINE.md`: what is kept, and what the writer sees) found these, each fixed and tested. No
migration.

- **Clothes put on scenes ago, earlier the same day, are still on** (`ai/mustStay.ts` `stageInScene`). A piece whose
  words were older than the scene before was dropped even at the same moment or later the same day (since 0.6.35). Now a
  piece whose words are from a scene on the same story day is kept (`StageScope.today`, from `SceneCalendar.today`: the
  scenes before in the story going back while the calendar says they are on the same day, stopping at one it can't tell:
  `memory/storyCalendar.ts` `sceneCalendar`), and later the same day only what is still on carries (`carriesPiece`). The
  stage carries pieces on whatever the day, so a hat from days before still never comes back; with cards whose When
  can't be read as days, nothing changes from before.
- **What someone wears from now on** (`keeper/prompts.ts`): a change that sets a field for good ("to wear only X from now
  on") gives its new value, as one that ends it does (5,979 characters, under the 6,000 its tests hold it to). The
  clothing filters (`memory/looks.ts`) keep it: "nothing but X" (or "none but X") with words that it lasts in the value
  or the change's note is X (`NOTHING_BUT`, `LASTING`: "from now on", "from then on", "henceforth", "for good" ending a
  clause, never "for good luck"; not "always" or "ever", which turn up in a love scene's note); the keeper and reading
  the memory both pass the note. Those words are then left out of the value kept (they say when, not what is worn).
  "Bare-headed" is no undress, though a piece that is only a bare-word ("bare-chested") or "stripped to the waist" is
  worn for the moment (`BARE_PIECE`, `MOMENT_PIECE`); "borrowed" and "lent" no longer are. "Nothing but the silver
  locket" with no such words is still undressed for now.
- **Told to the writer.** What must stay true says "Mary usually wears: … (since Ch 3, Sc 2)" for a Typical clothing the
  story changed (rank `usual`, after marks; the short form keeps it), while the stage tells nothing of what they have on;
  never for one set at the start or a passing undress. In a profile it is a fact to keep to, not a detail to show now and
  then (`ai/context.ts` `lastingLooks`). The planner and the continuity brief are told it still holds on a later day
  (`plan/plan.ts` `STAND_NOTE.later`, `plan/brief.ts` `BRIEF_ASK.keep`).
- **Orders and bans said** are a "said" kind of their own, `rule` ("Ana’s order or rule to Mara …": `retrieval/said.ts`,
  `shared/types.ts` `SaidKind`; read back by `db/memory.ts` through `isSaidKind`). They were thrown away before. What each
  kind is called is said once, `SAID_KIND_WORDS` in `shared/knowWords.ts` (the memory's log, the entry page, the briefing).
- **What someone is to follow.** A `rule` is any order, ban or suggestion someone must follow, spoken or told in the
  narration; the reading asks for its fact to say who must do what and until when, its quote being the words that say it
  (5,972 characters, shorter than before, so the smallest models still read paragraphs whole). Reading the memory (`memory/state.ts`) keeps who is bound by each on its fact, `FactState.rule`: those it was
  said to that its fact names ("Mary must…", by name, other name, or a first name no other hearer has; not everyone in
  the room who heard it), else all of them, the giver apart. It holds until a change of it ends ("end": "an order lifted
  or over", so one "until morning" ends when the memory reads that morning; a count of scenes is no count of time),
  though they may forget it (a fact no one knows any more stays while someone is bound). The scene's contract keeps to
  it as well (`ai/contract.ts` `KEEP_ORDER`).
- **Where and when an order holds.** Its cue is read from its fact (`ai/mustStay.ts` `cueOf`: "whenever she hears the
  bell", "when she is at home", "at home" said with no when). The line says it is in this scene only for being at home,
  at a place here that is theirs (`placesHere`, `homeHere`: its "Who rules or lives there" names them, or its name names
  them beside home, house, flat or room; never only "home", as in "the nursing home"). Any other cue is told as "if … in
  this scene, show them follow it", and comes first when every word of it, whole, is in the card's words, Adam's
  direction, the scene so far or the names of where the scene happens (`cueIn`; not "bell" in "belly"). It never says a
  cue is met by chance ("sleep" in the card for "whenever Tom says sleep"), nor that an order doesn't apply. The
  line also says when they don't remember being told. Who is bound is the one it is about: the hearers named just before
  its order word ("must", "is to", "will"…: `memory/items.ts` `orderAbout`; Mary in "Whenever Tom says sleep, Mary must
  kneel", not Tom), else any it names outside its cue, else all who heard it but the one its cue names (the strong order words first: "must", "is to"; then "will", "never"…). An order about clothes that holds only somewhere or on a cue is never what they usually wear
  (`memory/looks.ts` `ORDERED`, `ONLY_THEN`); the reading asks for one tied to a place or cue as a rule only.
- **Given from afar.** An order said by letter, telephone or a recording binds the one its fact names though they aren't
  there (`keeper/apply.ts` `'said'`); a promise or secret is still heard only by those there.
- **Replaced.** "end" lifts an order the scene lifts, replaces or whose time is up (the reading's own words).
- **The checks** are told what those in the scene are to follow (`checks/context.ts` `RULES_TITLE`), and going against one
  where it applies is a warning, unless the scene lifts it; following it without knowing why never is.
- **By hand.** "Knows at the start" on a character's page can add something they are to follow from the start (a
  knowledge change with `said.kind` `rule` and no giver). One from the story shows in its history as "An order or rule"
  and can be removed there, with Undo. Not built: ending one by hand at a chosen scene. What must stay true says "Mary is to follow: …
  (given by Ana) (since Ch 3, Sc 2)" for those in the scene, a key kind (`rule`, `MUST_RULES` 3) in every form. The
  keeper's request lists such facts first, saying who must follow them (`keeper/request.ts`), and "end" finds one for
  someone bound who no longer knows it (`keeper/apply.ts` `endTarget`). Limits: those told must be there at the words
  (one told by letter or over a telephone isn't bound), the giver must be a person, and nothing checks a draft against it
  yet.
- **An older chapter's line** in the story so far also says what happened to people in it (the chapter record's changes,
  those that last first, half of `RECORD_FACTS`, now 4: `memory/snapshot.ts` `timelineFacts`; "Mara and Tobin: rivals"
  for a tie), since its 60-word opening says only how it ended.
- **A book written before this** keeps what the old reading left out: a scene is read again only when its words change.
  "Re-read this scene" (the scene's menu in the binder) reads it with the new rules.
- Test: `keeper/lastingLooks.test.ts` reads an order with the fake model and builds the briefing of a scene in the next
  chapter three days later.
- Not done: a second event with the name of an earlier one (a second "The storm") still joins it
  (`keeper/apply.ts`): from the name alone the keeper can't tell a new storm from talk of the old one, so a fix needs the
  reading to say which.

## Milestone 1 scope

Installer and auto-update; library, worlds and stories; binder; editor with autosave
and backups; providers and model choice; simple forms for characters, places and lore;
style guide; scene cards; context assembly with fixed priorities; Generate draft with
streaming and Stop; "What the AI saw". Anything from a later milestone waits.

## UI review fixes (2026-10-21)

A look-and-feel pass after a review of every room in Dark, Light and Sepia.

- **One name for the AI builders.** Every button that opens Build with AI says "Build with AI" (the binder, the story
  board's next-chapter card), as the area is named; scene, character and story builders keep "Build … with AI". The
  palette's draft action is "Draft the scene", as on the dock, and the world's page is "World" (no "Codex" on screen).
- **The story board.** The strings' how-to note shows until Got it, then nothing in its place (the legend's chips name
  the threads); the pins' key keeps to the right. Pins differ in shape as well as colour: planned an empty ring, drafted
  half full, done full with a tick, planned with AI glowing. The board's right edge fades (over the canvas's own PAD_X
  of room) rather than cutting a column off.
- **Check.** The all-clear says "No consistency issues" and what was checked; the room's lighthouse beside it is the
  only picture.
- **World.** The kinds' card art is quieter on Light and Sepia (saturate 0.45). The room's links lose "By kind": the
  tabs under the world's name choose the kind, and Everything stays lit on a kind's page.
- **Start screen.** Its four other ways sit two by two.
- Looked at and kept: the rooms show their words only above 1200px (measured: at 1024px the words run into the world's
  name); Scene details stays both in the top bar and by the scene's head (the head's carries the issue count and works
  with the top bar hidden).
