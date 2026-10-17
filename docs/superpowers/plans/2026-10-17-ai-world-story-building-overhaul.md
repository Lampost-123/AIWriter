# AI world and story building: findings and overhaul plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Line numbers were right on 2026-10-17; check them before editing.

**Goal:** Every way the AI builds a world or a story (the World builder, story recipes, the outline helper and interview,
Quick start and the character builder) makes each character, place and event once, links them correctly, dates them
correctly on the timeline, never tells the writer about the future, and can be undone in full. They share one core
instead of four near-copies.

**Architecture:** Four phases, each made of steps that can ship on their own:

1. **Phase A, Safety net and bug fixes.** Write failing tests for every high finding, then fix them where they are.
2. **Phase B, One shared core** in `src/main/building/`:
   - one name matcher;
   - one way to make an entry;
   - one AI reply reader;
   - one log of what a build made.

   The World builder, recipes, outline and builder all move onto it.
3. **Phase C, Fixes by area** that are easier once the core exists.
4. **Phase D, The overhaul:** one pipeline from recipe or summary to plan, then cast and world, then links and timeline,
   with one "Here's what I'll add" step and a full record of what the build did.

**Tech Stack:** TypeScript, Electron main process, better-sqlite3, React 19 and zustand, Vitest, Playwright with the
fake provider (`tests/fake-provider`).

## Global constraints

- **No migration.** The data model is frozen (docs/ARCHITECTURE.md). Everything below fits the current schema:
  - new issue kinds are text;
  - "possible duplicate" goes into the existing memory check list;
  - a planned name is kept as an alias;
  - "drafted by AI" is worked out from field origins.

  If a step finds it truly needs a migration, stop and write the reason into ARCHITECTURE.md first.
- **Adam's words on screen** (world, story, chapter, scene, character, place, lore, draft). Errors are `UserError`s with
  a next step; raw provider text goes to the log only.
- **No jank.** Builds keep streaming, stay stoppable and save silently. Nothing new becomes a modal: the review step in
  phase D is a page or a toast, not a dialog.
- **Undo.** Everything a build writes is undoable, timeline dates and issues included. Undo never removes what Adam has
  changed since (the outline's `markMade` rule, applied everywhere).
- **Spec check.** Phases A to C fix behaviour the spec already describes. Phase D changes how building feels, so Adam
  signs it off before it starts (see "Decisions for Adam").
- **Tests.** Invented stories only, in an `AIWRITE_DATA_DIR` copy (`.cursor/rules/no-personal-story-text.mdc`).
- **Before each step is done,** `npm run typecheck`, `npm test` and the step's e2e run must pass.

---

## How it works today

1. **World builder** (`src/main/worldBuilder/run.ts`). The page, or `storyBuild.ts` after an outline is kept, calls
   `startBuild`. The build then works in this order:
   1. The **first look** asks the AI to list everything the summary names, by kind.
   2. `mergePlan` merges the lists.
   3. `sortOut` drops what `findMatch` (`worldBuilder/names.ts`) says already exists.
   4. Characters are laid out one request each, and other kinds in batches of 6, saved while they stream (`save.ts`,
      one transaction per entry).
   5. Then parents, relationships, themes and tone, conflicts (issues), filling in thin pages and voices.
   6. Last, `startTimeline` puts "Day 1" on the opening scene.

   Undo works from the run's logged lines (`lines.ts`).
2. **Recipes** (`src/main/recipes/`). `RecipeMaker` reads a book chapter by chapter and combines its notes into a recipe
   under `## Part` headings. The leak check takes out the book's names. A new story from a recipe:
   1. `applyRecipeToStory` copies the style;
   2. `startRecipeStory` asks for a plan in the outline helper's form;
   3. Keep goes through `keepOutline`;
   4. which starts a World build in the background.
3. **Outline** (`src/main/outline/`). The plan streams as text and is parsed in the renderer
   (`features/outline/parse.ts`, `tree.ts`). Adam keeps parts. `keepOutline` (`structure.ts`) then saves acts, chapters
   and scenes, chapter cards and scene When, and does two other things:
   - makes pages for names it doesn't know (`chapterCard.ts` `addMissing`, matched with `outline/names.ts`
     `matchEntry`);
   - makes plot threads (`threadFinder`).

   It is one transaction, and Undo uses `markMade`. The interview (`interview.ts`) asks one question at a time.
4. **Builder** (`src/main/builder/`). Quick start streams a profile:
   - `parsePartial` reads it about every 40 ms;
   - `createBuilt` saves it once it has a name;
   - `saveBuilt` saves it as each part arrives.

   The guided builder autosaves through `updateEntry`. `gatherWorld` and `worldText` give the AI the world, and the
   World builder reuses them.
5. **Timeline and codex.** Every save sends `memory:changed`, and the renderer then refetches the codex and the timeline.
   `buildTimeline` reads each When with `worldViews/when.ts` and sorts what it can date.

## Findings

Severity: **H** loses or corrupts data, or misleads the writer; **M** is wrong, wasteful or confusing; **L** is a polish
or edge case. IDs are used by the steps below.

### Names and duplicates (cross-cutting)

| ID | Sev | Finding | Where |
|---|---|---|---|
| N1 | H | Names one letter apart are merged, so "Tom"/"Tim" and "Mara Venn"/"Mira Venn" become one character. This happens inside a single summary and against existing entries alike. | `worldBuilder/names.ts:63-75`, `run.ts:606-628, 685` |
| N2 | H | The outline makes duplicate pages: "Mara" makes a third page when "Mara Venn" and "Mara Kell" exist, and "Captain Holt" doesn't match "Holt". Its matcher also keeps accents and a leading "The". | `outline/names.ts:14-20`, `chapterCard.ts:115-126` |
| N3 | H | Quick start never checks for an existing entry, so building from a passage about a known character makes a second page. | `builder/save.ts:53-65`, `jobs.ts:396-401` |
| N4 | M | The same name of a different kind is merged (the place "Ironhold" and the group "Ironhold"), and the group is lost. | `names.ts:64`, `mergePlan` |
| N5 | M | Three more name normalisers (`threadKey`, `placeKey`, `norm`) differ from the World builder's. `threadKey` uses `[^a-z0-9]`, so non-Latin thread names become empty and are dropped. | `structure.ts:37-42`, `chapterCard.ts:76-83` |
| N6 | L | Re-running a build: "The Storm" and "The Great Storm" become two events, and a matched event is never re-dated. | `run.ts:724-727` |

### Reading the AI's replies

| ID | Sev | Finding | Where |
|---|---|---|---|
| R1 | H | A relationships reply that is a bare JSON list saves nothing, with no error, because `firstObject` reads only the first `{…}`. | `keeper/json.ts:11-33`, `run.ts:972-979`, `parse.ts:156-161` |
| R2 | M | `replyItems` returns `[]` for a single object, against its own docstring. That costs a retry, then the item is missed. | `worldBuilder/parse.ts:155` |
| R3 | L | The streaming reader starts at the first `{` anywhere, so "Here's {name}…" kills the live view. On Stop, `closing` doesn't try `parseLenient`. | `builder/partial.ts:25`, `jobs.ts:408-411` |
| R4 | M | Any non-empty reply counts as a recipe's chapter notes, refusals included, and is kept for good. | `recipes/maker.ts:367` |

### World builder

| ID | Sev | Finding | Where |
|---|---|---|---|
| W1 | H | When the profile renames a planned item ("The old ferryman" → "Bram"), later `involved` and `in` links to the planned name are lost. | `run.ts:709, 731, 739, 765` |
| W2 | M | A save that throws while a reply streams is swallowed: the item is in neither made nor missed. | `run.ts:876-888`, `475-479` |
| W3 | M | The "as it stands at the start" `TIME` rule is also given to events and plot threads, which happen later. | `prompts.ts:197, 222` |
| W4 | L | Few links are made: no home place for characters, no owners for items, no places for events, and groups in `involved` are dropped. | `save.ts:105-118`, `run.ts:736-740` |
| W5 | L | Conflict issues aren't logged in the run, so Undo build leaves them behind. | `run.ts:1175` |
| W6 | L | Scene numbers in the summary can differ from story order when chapters with and without an act are mixed. | `storySummary.ts:91-95` |
| W7 | L | The page's progress can label a story build with the wrong story, and the story-build toast has no Stop. | `worldBuilderStore.ts:134`, `storyBuild.ts` |

### Timeline and codex

| ID | Sev | Finding | Where |
|---|---|---|---|
| T1 | H | Backstory dated by a year ("in the year 312") sorts after every "Day N" scene, so it lands at the end of the timeline. | `worldViews/when.ts:891-897`, `timeline.ts:305` |
| T2 | H | Future events are told to the writer as past: an undated or "Day 3" event exists from scene 1, and `sharedHistory` lists it as history between two characters. | `worldBuilder/save.ts:111-116`, `ai/context.ts:1055-1073` |
| T3 | M | "Day 1": <ul><li>it is written even after Cancel;</li><li>without a story, it goes on the first story on the shelf, not `firstStoryId`;</li><li>it isn't logged, so it can't be undone;</li><li>the window isn't told.</li></ul> | `worldBuilder/timeline.ts:23-43`, `run.ts:436-456` |
| T4 | M | "In Book 2" events land in the current story with no date. | `prompts.ts:76, 197`, `save.ts:105` |
| T5 | M | Each save during a build re-reads all scene text for the codex, rebuilds the timeline and refreshes stories. That is seconds of main-process work on a big world. | `entryViews/appearances.ts:91-100`, `features/memory/events.ts:28` |
| T6 | L | Undated events are placed by alphabetical title. | `timeline.ts:194`, `timeline.test.ts:469` |
| T7 | L | The codex can't show or filter what the AI made. | `contracts/entryViews.ts:39-66` |

### Outline and interview

| ID | Sev | Finding | Where |
|---|---|---|---|
| O1 | H | A "Pays off" name it doesn't know creates a thread that is paid off at once, and the real thread stays open forever. | `structure.ts:57-86`, `structure.test.ts:399` |
| O2 | M | A reused first scene loses its own POV, cast and place, but pages are still made for those names. | `structure.ts:329-331` |
| O3 | M | Reply room is about 50 tokens per chapter and 100 per scene, but about 80 and 130 are needed, so big outlines are cut off. | `outline/jobs.ts:47-49` |
| O4 | M | The AI never sees existing chapter cards (POV, cast, place), so the interview asks what the card already says. | `outline/brief.ts:127-128, 260-287`, `context.ts:44-60` |
| O5 | L | "- Part 2 of the plan fails" is read as an act heading. | `features/outline/parse.ts:169-176` |
| O6 | L | "Washington, D.C." makes a place "D.C." with "Washington" inside it, and the room name skips `isPageName`. | `chapterCard.ts:61-66, 125` |
| O7 | L | A chapter plan has no length check and no plain-words "briefing too long" message. | `interview.ts:504` |
| O8 | L | Chapters before the reply's first act go into the story's old last act. | `parse.ts:319`, `tree.ts:93`, `structure.ts:267` |
| O9 | L | `oneLine` is copied three times with different behaviour, and two unrelated files are both called `brief.ts`. | `structure.ts:27`, `chapterCard.ts:18`, `interview.ts:75` |

### Recipes

| ID | Sev | Finding | Where |
|---|---|---|---|
| P1 | H | The recipe's plan prompt has drifted from the outline form: no `Sets up:`/`Pays off:` and no thread rules. Recipe stories never get plot threads. | `recipes/prompts.ts:152-190` vs `outline/prompts.ts:34-66` |
| P2 | H | "Lay it out again" ignores what the story has. It passes `''`, so the kept premise is lost, and it sends no plan, no earlier books and "Day 1" every time. The result is duplicate chapters and a restarted day count. | `recipes/story.ts:33-54`, `outline/context.ts:31`, `prompts.ts:197` |
| P3 | M | The recipe reply is capped at 3500 tokens, so long novels quietly lose their last parts (Devices, Genre). | `estimate.ts:14`, `maker.ts:304, 404` |
| P4 | M | The combine step's room leaves out the pacing table and keeps 200 characters per chapter, so it overflows small models. | `maker.ts:375-381` |
| P5 | M | The recipe's cast roles and devices never reach the World builder, and keeping the premise doesn't start a build. | `worldBuilder/storySummary.ts:68-71`, `storyBuild.ts` |
| P6 | M | "Read the story again" spends the full cost again with no estimate shown. | `RecipePage.tsx:119-124`, `maker.ts:196` |
| P7 | M | The leak check is case-sensitive and skips all-caps names. A name that is also a word ("Will") removes whole sentences. | `leaks.ts:41, 138`, `scrubText` |
| P8 | L | Assorted gaps:<ul><li>changing the library folder mid-make sends costs to the wrong file;</li><li>`making.json` is re-read inside the sort;</li><li>hand-edited or newer recipe files crash or are rewritten;</li><li>ids are checked late;</li><li>`cancelRecipe` deletes a ready recipe;</li><li>`startRecipeStory` uses an unfinished recipe;</li><li>the fix-call estimate runs low;</li><li>plan sessions are lost on restart;</li><li>`unapplyRecipe` overwrites edits made since.</li></ul> | see recipes review |

### Character builder

| ID | Sev | Finding | Where |
|---|---|---|---|
| B1 | H | The AI is never shown the world's places (except when building a place), though it is told to use them. The World builder inherits this gap. | `builder/context.ts:52`, `prompts.ts:102-108, 159` |
| B2 | M | World context is chosen by recency with no size cap. It is weak on small models and costly on large ones, on every Options click and Interview turn. | `context.ts:26-31`, `prompts.ts:112-119` |
| B3 | M | "Finish the rest" leaves out the follow-up answers. | `QuickStart.tsx:123` |
| B4 | M | "Finish the rest" puts back a field Adam cleared meanwhile, marked as AI. | `jobs.ts:380-383`, `save.ts:88-95` |
| B5 | M | Picking an option, and its Undo, overwrite the field without checking it. | `save.ts:108-130`, `useBuildDraft.ts:173-176` |
| B6 | M | Entry creation and the version lookup are copied between the builder and the World builder. | `worldBuilder/save.ts:92-109`, `builder/save.ts:54-63`, `jobs.ts:151`, `fill.ts:176`, `run.ts:593` |
| B7 | L | No AI relationship suggestions in the builder. Some errors read "Something went wrong: <raw>". The interview room is miscounted. `"""` in notes breaks the wrapper. | `jobs.ts:237, 300, 671`, `prompts.ts:208, 310` |

### What is solid and stays

- One transaction per World builder entry and per outline keep.
- `markMade` undo that never removes Adam's changes.
- Stop and world-close handling everywhere.
- Plain-words `UserError`s in most places.
- The recipe write order and crash recovery.
- The leak check's overall approach.
- One build and one keep at a time.
- The streaming-safe saves in the builder.

---

## Phase A: Safety net and the high fixes

Each step starts with a failing test that shows the bug, then fixes it in place. These go first because they lose data
today. Phase B keeps the tests.

### A1. Stop merging different people (N1, N4)

- [ ] Add tests in `worldBuilder/names.test.ts` and `run.test.ts` with an invented summary naming:
  - "Tom" and "Tim";
  - "Mara Venn" and "Mira Venn";
  - the place "Ironhold" and the group "Ironhold".

  Expect three separate pairs.
- [ ] In `mergePlan` (`run.ts:606-628`), merge only an exact name or alias of the **same kind**.
- [ ] In `findMatch`, apply the "clearly a typo" rule (B1 below gives the final version). For now:
  - both names are 5 letters or longer;
  - the same first letter;
  - not a digit difference;
  - no second entry within one edit.

  A cross-kind exact match counts as found only against existing entries, never inside one plan.
- [ ] Update `names.test.ts:44-45`, which asserts the cross-kind merge.

### A2. Read bare-list replies (R1, R2)

- [ ] Add tests in `keeper/json.test.ts` (or `worldBuilder/parse.test.ts`) for:
  - `[{"from":…},{…}]`;
  - a fenced list;
  - a single profile object.
- [ ] In `parseLenient`, when the first bracket is `[`, take the first balanced `[...]`. In `run.ts:973`, the
  `Array.isArray` branch then works.
- [ ] `replyItems`:
  - prefer the list under `listKey(kind)`;
  - return `[value]` when the object has `name`, `fromNotes` or `drafted`.

### A3. Keep links when a planned item is renamed (W1)

- [ ] Add a test: the first look plans "The old ferryman", the profile names him "Bram", and an event lists
  `involved: ["The old ferryman"]`. Expect Bram to be involved.
- [ ] Add a `planned: Map<string, ID>` (bare planned name → entry id) to `Build`, filled in `saveProfile`. Check it before
  `findMatch` when resolving `involved` and `in`.
- [ ] When the saved name differs from `p.name` and `p.name` is a real name (`isPageName`), add it as an alias. Add a
  descriptive name ("the old ferryman") as an alias only when the summary uses it more than once.

### A4. No duplicate pages from the outline or Quick start (N2, N3)

- [ ] Test `addMissing` with:
  - "Mara" against "Mara Venn" and "Mara Kell" (expect no page, and no card link);
  - "Captain Holt" against "Holt" (expect a match);
  - "Venn House" against "The Venn House" (expect a match).
- [ ] Interim fix:
  - `matchEntry` returns `{ entry, ambiguous }`;
  - `addMissing` never creates a page when the name is ambiguous;
  - strip a leading title (the list is in B1);
  - drop a leading "the" and accents.

  B1 replaces this with the shared matcher.
- [ ] Quick start test: notes that name an existing character. At the first save in `quickStart`, look the name up
  (`findMatch`, same kind). On an exact match, switch to the finish path (`existing` = the match, fill only empty
  fields), and the progress message says "Adding to Mara's page".

### A5. "Pays off" never creates a thread (O1)

- [ ] Test: "Pays off: The drowned bell's secret" with an existing "The Drowned Bell". Expect the existing thread to be
  paid off and no new thread. An unknown pays-off name is dropped.
- [ ] Split `withThreads`'s `find` into two:
  - `findOrMake`, for Sets up;
  - `findOnly`, for Pays off, with start-of-name matching on name and aliases.
- [ ] Change `structure.test.ts:399`.

### A6. Backstory before the story, and no future in the writer's briefing (T1, T2)

- [ ] Timeline test: "in the year 312" next to "Day 1" and "Day 2" scenes. Expect the year event first.
- [ ] In `when.ts` / `timeline.ts`, a calendar with no year anchor is placed after every year a waiting event uses. A
  year-dated event that exists from the world's or story's start stays before the first scene.
- [ ] Context test: an event dated "Day 3", both characters involved, writing scene 1 (Day 1). Expect it absent from
  "Between them".
- [ ] In `ai/context.ts` `sharedHistory`, and every other place event entries go into the brief, drop events whose When
  dates after the scene. Reuse `dateOfText`, `elapsedBetween` and `storyCalendar.ts`'s `ahead()`.
- [ ] In `worldBuilder/save.ts`, an in-story "Day N" event without a scene is placed (first exists and involvement) at
  the first scene dated on or after Day N. When none is dated, it goes at the story's last scene, not its start.

### A7. Places in the AI's view of the world (B1)

- [ ] Add `places: of('place')` to `WorldBrief`, and a "Places" section after Groups in `worldText`, in the three
  version lookups.
- [ ] Test next to `builder/jobs.test.ts:661`. A World builder test: a character laid out after places in the same build
  sees them.

### A8. Recipe stories get plot threads and know what they have (P1, P2)

- [ ] Export `SCENE_FORM` and `THREAD_RULES` from `outline/prompts.ts` and use them in `recipes/prompts.ts`
  `storySystem`.
- [ ] Add a contract test: `storySystem()` contains the outline's scene form, and a sample reply parses to `setsUp`.
- [ ] Make the fake provider's `story` reply include `Sets up:`.
- [ ] `recipes/story.ts:33`:
  - pass `undefined`, not `''`;
  - add `facts.plan`, `facts.earlier` and `latestWhen`, as `outline/jobs.ts` does;
  - when `chapterCount > 0`, use the outline's "carry on from Day N" wording, not "It opens on Day 1".
- [ ] Add a test for "Lay it out again" after keeping two chapters. Expect the prompt to hold them and no "Day 1".

**Phase A done when:** every H finding has a test that failed before and passes now, and the e2e "new story from a
recipe → keep → world build" run passes.

---

## Phase B: One shared core (`src/main/building/`)

A new folder, with no Electron imports, pure where it can be. Each module replaces its copies, and the copies are
deleted in the same step. Existing tests move with the code.

### B1. `building/names.ts`: the one name matcher (N1–N6, O6)

**Normalising:**
- NFD, with marks removed;
- curly quotes changed to straight;
- possessive `'s` dropped;
- punctuation changed to spaces;
- a leading "the" dropped;
- spaces collapsed;
- Unicode letters and digits kept (`\p{L}\p{N}`).

`stripTitle` drops a leading Captain, Capt., Dr, Doctor, Mr, Mrs, Ms, Miss, Sir, Lady, Lord, Dame, King, Queen, Prince,
Princess, Duke, Duchess, Father, Mother, Brother, Sister, Master, Mistress, Professor, Prof., Sergeant, Sgt.,
Lieutenant, Lt., General, Commander, Uncle, Aunt. The list is kept in one constant.

`match(want, list)` returns
`{ kind: 'same', entry } | { kind: 'ambiguous', entries } | { kind: 'possible', entry } | { kind: 'none' }`. It tries,
in order:
1. The same name or alias, of the same kind.
2. The same name with titles stripped ("Captain Holt" = "Holt").
3. For characters only, one entry whose full name starts with this single name ("Mara" → "Mara Venn"), or whose single
   name is this full name's first or last word. Two or more candidates give `ambiguous`.
4. A **clear typo**, which gives `same`. All of these must hold:
   - the same kind;
   - both names are 5 letters or longer;
   - one edit apart;
   - the same first letter;
   - not a digit difference;
   - no other entry within one edit;
   - the two names don't both appear as separate names in the same source (one summary, one outline reply or one
     notes passage).

   "Marra"/"Mara" fails the length rule, so it is `possible`. "Grimsby"/"Grimbsy" passes.
5. Any other one-edit name of the same kind gives `possible`.
6. An exact name of a different kind gives `none`, plus a `crossKind` hint.

`threadKey`, `placeKey`, `outline/names.ts` `norm`, `chapterCard.ts` `sameName` and `worldBuilder/names.ts`
`normalizeName` all become this one normaliser. `splitPlace` only splits when:
- the second part matches an existing place, or
- the first part is a known room word (kitchen, hall, cellar, chamber, room, yard, garden, tower, gate, library,
  study, office…) or passes `isPageName`.

Every rule gets one test with an invented name: N1, N2, the titles, "Washington, D.C.", the Cyrillic thread, accents,
"The Great Storm".

### B2. "Possible duplicate" in the memory check list (N1, N6, the clear-typo decision)

- [ ] When a build or keep **makes** an entry whose `match` was `possible` or `crossKind`, record a check item: "Is
  Marra the same as Mara?" with **Same** (merge: an alias on the older entry, references moved, the new one removed
  with Undo), **Different** (never asked again for this pair) and **Undo**.
- [ ] Where it lives: a new `MemoryCheckItem` type in `keeper/checkQueue.ts`. The pairs are kept as JSON in `meta`
  (`possible_duplicates`), as `threadPlans` does. No migration.
- [ ] Merging reuses the existing entry-merge code if there is one; check `db/` for a merge before writing a new one. If
  there isn't one, write `mergeEntries(db, keepId, goneId)` in `db/`: changes, relationships, cards, `presentIds`,
  `povId` and `locationId` move, all in one transaction.

### B3. `building/reply.ts`: one reader for the AI's replies (R1–R3)

- [ ] `readJson(text): { ok, value, cutOff }`:
  - prefers a fenced block;
  - else the first `{"` or `[{` / `["`;
  - else the first `{` or `[`;
  - forgives the same slips as `parseLenient`.
- [ ] `readItems(value, key)`: the list under `key`, else a bare list, else `[value]` for one profile.
- [ ] `readPartial(text)`: the streaming reader from `builder/partial.ts`, starting where `readJson` would. Add tests
  for `\u` escapes, lists of objects and a reply cut off inside a key.
- [ ] `looksLikeRefusal(text)` (reuse `keeper/refusals.ts` and whatever `ai/refusal.test.ts` covers) and `hasLabels(text, labels, min)`, used for R4.
- [ ] Callers move to it:
  - `worldBuilder/run.ts` `readReply`;
  - `worldBuilder/parse.ts` `replyItems`;
  - `builder/jobs.ts` `finalValue`, plus `closing`, which uses `finalValue`;
  - `outline/interview.ts`;
  - `recipes/maker.ts`.

  `keeper/json.ts` keeps its reading-reply shapes and calls `readJson`.

### B4. `building/entries.ts`: one way to make an entry (B6, N3, A3)

- [ ] `makeEntry(db, { kind, values, aiKeys, ownKeys, source, storyId, runId, parentId, sceneId, plannedName })` does
  all of these:
  1. runs `match` first and returns `{ entry, made: false }` on `same`;
  2. on `ambiguous`, makes nothing unless the caller asks (`allowAmbiguous`) and returns `{ ambiguous }`;
  3. otherwise creates it, splits Adam's words from the AI's, runs `stampOrigins` for an AI-chosen name, and adds
     `plannedName` as an alias (A3);
  4. records a "possible duplicate" when it applies (B2);
  5. logs a line in the run (B5).
- [ ] `briefVersions(brief, ids)` replaces the three version lookups.
- [ ] Callers:
  - `builder/save.ts` `createBuilt`;
  - `worldBuilder/save.ts` `saveEntry`;
  - `outline/chapterCard.ts` `addMissing`;
  - `outline/structure.ts` `threadFinder` (as `makeThread`).

### B5. `building/ledger.ts`: one record of what a build did (W5, T3, P8 undo)

- [ ] Generalise `worldBuilder/lines.ts` so any build can log a line with its undo. A build here is a World build, a kept
  outline, a Quick start or an applied recipe. A line is one of:
  - entry made;
  - field filled;
  - link made;
  - relationship;
  - thread made or paid off;
  - issue raised;
  - scene When set (with the value before);
  - chapter card filled (with the card before);
  - recipe style applied (with the values before).
- [ ] Each undo follows the `markMade` rule: a line is undone only when what it wrote is still there. Otherwise the line
  is skipped, and the toast says so ("Kept 2 you changed").
- [ ] `startTimeline`, `raiseConflict`, `fillChapterCard` and `applyRecipeToStory` log lines. `unapplyRecipe` leaves
  edits made since (P8).
- [ ] The outline's `markMade` / `takeBackKept` stay as they are (they work), and report into the same ledger, so phase D
  can undo a whole pipeline run with one Undo.

### B6. `building/world.ts`: what the AI is told about the world (B1, B2, O4)

- [ ] `worldBrief(db, { focusText, storyId, sceneId, room })`:
  - **always** includes the entries named in `focusText` (notes, summary or profile: the `paragraphsNaming` matcher);
  - then fills by kind and recency;
  - caps at `min(room, 6000 tokens)`;
  - leaves out events dated after `sceneId` (T2);
  - includes places, groups, lore, open threads and the chapter cards of nearby chapters (O4).
- [ ] Used by the builder (Quick start, Options, Interview), the World builder and the outline brief. The interview
  counts only the turns it sends (B7).

**Phase B done when:**
- the four old normalisers, the three version lookups and the two copies of entry creation are gone;
- `grep` finds no `normalizeName|threadKey|placeKey|matchEntry` outside `building/`;
- all tests pass.

---

## Phase C: Fixes by area

Each bullet is one small step, with a test. The order within a group doesn't matter.

### C1. World builder

- [ ] **W2.** In `take`, a `saveProfile` that throws while streaming pushes `p.name` to `missed`, and the item leaves
  `pending` only after a successful save. Add a test with a throwing save.
- [ ] **W3.** `TIME` is replaced by `TIME_START` for character, place, group, item, lore and glossary, and by `TIME_EVENT`
  for events and threads ("give when it happens in the story; backstory in the world's own words").
- [ ] **W4.** The relationships request also asks for:
  - a character's home or work place;
  - an item's owner;
  - an event's place;
  - groups involved in an event.

  Saved through the existing change types (check `shared/types.ts` for `location`, `owner` and `member` before adding
  anything). Groups in `involved` are kept.
- [ ] **W6.** `storySummary.ts` numbers scenes in the order `memory/line.ts` walks them.
- [ ] **W7.** Progress carries the build's own `storyId`. The story-build toast gets **Stop**.
- [ ] **T3.** `openTimeline`:
  - is skipped on cancel;
  - uses `mem.firstStoryId`;
  - only dates the build's story when it has one;
  - logs its line (B5);
  - emits `memory:changed` with the scene id.
- [ ] **T4.** Remove "in Book 2" from the prompts. If the model still names "Book N", match it to that story by shelf
  position (`firstStoryId` order) and set `originStoryId`. If there's no such story, keep the words in the event's When
  with no date.
- [ ] **N6.** On a re-run, a matched event whose When or scene is empty gets them filled (a logged line), never
  overwritten.

### C2. Timeline and codex

- [ ] **T5.** `onSaved` emits at most one `memory:changed` every 500 ms during a build, plus one at the end, without
  `sceneId: null`, so `refreshStories` isn't run for each entry. In `appearances.ts` `refresh`, fetch text only for
  scenes whose words could match (`quickCheck` in SQL with `instr` on the lowered text, or the search index). Add a perf
  test: 50 saves in a big world, the codex open, under 1 s of main-process work in total.
- [ ] **T6.** Undated events stay in the order they were made, after the dated ones at the same point. Change
  `timeline.test.ts:469`.
- [ ] **T7.** `CodexCard.aiDrafted` is true when any field origin is `ai` and Adam hasn't edited the entry since. Add a
  codex filter "Drafted by AI" and the amber mark the theme already uses for AI suggestions.

### C3. Outline and interview

- [ ] **O2.** Apply `ownParts` to a reused scene. Add a test with a reused scene whose POV differs.
- [ ] **O3.** Reply room becomes 80 per chapter and 130 per scene. Add a test against a realistic 100-card fake reply.
- [ ] **O5.** In a list item without bold, a heading needs a separator after its number (`Scene 2:` / `Scene 2 –`).
- [ ] **O7.** `startChapterPlan` does the `maxOutput` check and the plain-words "briefing too long" message, sharing the
  helper with `startOutlineJob`.
- [ ] **O8.** When a reply has acts, chapters before its first act heading go into the first suggested act.
- [ ] **O9.** One `oneLine(s, max?)` in `shared/text.ts`. Rename `outline/brief.ts` to `outline/briefing.ts`.
- [ ] **N2 follow-up.** The keep's toast names what it made: "Made pages for Holt and Bren". Clicking it opens them.

### C4. Recipes

- [ ] **R4.** Notes count only with `hasLabels(text, ['Moves:', 'Roles:', 'Style:'], 2)` and not `looksLikeRefusal`.
  Otherwise the chapter is asked once more, then marked "couldn't read" (shown in plain words on the recipe page).
- [ ] **P3.** The combine reply room is `min(maxOutput, 3500 + 40 × chapters)`. A cut-off reply is said in `finished`
  ("The recipe was cut short; the last parts may be thin. Read it again with a bigger model"). The estimate adds the
  room.
- [ ] **P4.** Subtract the pacing table and header from the room. The per-chapter minimum is
  `min(200, room / chapters)`.
- [ ] **P5.** `buildStoryWorld` takes the recipe id. `storySummary` adds the recipe's Cast roles and Devices (leak-checked
  already). `keepPremise` calls `buildStoryWorldSoon`.
- [ ] **P6.** The "Read the story again" toast shows `guessRecipe`'s cost and has Cancel.
- [ ] **P7.** Match invented names without regard to case. Collect all-caps words of 3 or more letters not in a small
  list of common acronyms. A name that is also a common word ("Will", "Hope", "Rose") is only scrubbed where it is
  capitalised mid-sentence.
- [ ] **P8.**
  - Stop and resume the maker on a library change.
  - Read each `making.json` once per update into a map.
  - Coerce parts to strings, and refuse `version > 1` with "This recipe was made by a newer AI Write; update to open
    it".
  - Check ids first (`UserError`).
  - `cancelRecipe` refuses a ready recipe.
  - `startRecipeStory` refuses an unfinished one.
  - Estimate the fix call from the leaking parts.
  - Save plan sessions to the recipe folder (`plans/<storyId>.json`) so they survive a restart.

### C5. Character builder

- [ ] **B3.** "Finish the rest" passes `answers: answersOf(s.chat)`.
- [ ] **B4.** "Finish the rest" passes `saveBuilt` only keys not in `before`. Test: a field cleared during finish stays
  empty.
- [ ] **B5.** `keepSuggestions(replace)` and `restoreField` take the expected current value and skip with a quiet note
  ("Mara's backstory changed since; your edit was kept") when it differs.
- [ ] **B7.**
  - Plain-words errors with "Try again"; the raw message goes to the log.
  - Escape `"""` in notes.
  - An optional "Suggest relationships" step reusing `relationshipsSystem`, saved as AI, with Undo (B5).

### C6. Builds take minutes (Adam, 2026-10-17: "do what gives the most consistent results")

- [ ] **Writing during a build.** Drafting a scene while its story's build runs shows a quiet note in the draft dock: "Your
  cast is still being built, so the AI will know more in a minute". Two choices: **Wait** (the draft starts when the
  build ends) and **Write now**. Never a modal.
- [ ] **Builds lost on close.** Queued story builds (`storyBuild.ts` `waiting`, in memory only) are kept in the world's
  `meta` (`story_builds_waiting`) and started when the world next opens. A story id from another world is never sent.
- [ ] **Undo during a build.** Undoing a kept outline (`unkeepOutline`) while that story's build runs cancels the build
  first, then undoes. Add a test that a page removed by Undo is never filled afterwards.
- [ ] **Timeline dates sooner.** A kept outline already gives scenes a When. Check whether `startTimeline`'s "Day 1" is
  still needed after a keep. If the keep left the opening scene undated, date it at keep time (in the keep's
  transaction, undone with it), and keep the end-of-build date only for summary builds.

A6 note: an in-story "Day N" event with no scene dated that late keeps its old placement. The writer's briefing drops it
anyway while it's in the future (`datedAfter`), so nothing leaks.

**Phase C done when:** every finding above is ticked or moved to "Decisions for Adam" with a reason.

---

## Phase D: The overhaul, one pipeline

Needs Adam's go-ahead (see below). Built on phase B, so it is mostly wiring and one new screen.

### What it does

**Today,** a new story from a recipe or a summary runs as four separate jobs that each guess what the others did:
1. the plan;
2. Keep;
3. the World build 4 seconds later;
4. Day 1.

**After:** one **build run** with steps that hand data to each other, not text:

1. **Idea → plan.** The recipe (or summary, or outline helper) gives a plan in the one outline form (shared
   `SCENE_FORM`).
2. **Plan → cast list.** From the plan and the recipe's Cast roles and Devices, one request gives every character,
   place, group, item, event and thread the story needs, each with:
   - its role;
   - the scenes it is in;
   - its "Day N" or "year" When.
3. **Cast list → matches.** `building/names.match` sorts each into **new**, **already in the world** (it adds to that
   page) or **ask** (`ambiguous` or `possible`).
4. **"Here's what I'll add" step.** On the World builder page, not a modal:
   - a list grouped by kind;
   - each item has a tick, its match ("Adds to Mara Venn's page"), and the scenes it is in;
   - "ask" items show both choices;
   - one button: **Build it**.

   For a background story build, a toast says "Ready to add 9 characters and 6 places to *The Salt Road*" with
   **Review** and **Build now**. A setting "Build without asking" skips the step, for Adam once he trusts it.
5. **Build.** The plan is kept (structure, cards, threads), and the entries are laid out (`makeEntry`) with links and
   relationships. Events are placed at their scenes (A6). Day 1 and scene Whens follow the plan.

   Everything goes into one ledger run (B5), so **one Undo takes the whole build back**, keeping anything Adam changed
   since.
6. **Check.** The existing conflict check runs once at the end. Possible duplicates go to "Worth a look". The codex
   shows the new pages marked "Drafted by AI" (T7).

The World builder page's "Build from a summary" uses the same run, starting at step 2 with the summary as the plan.
Quick start uses steps 3 and 5 for one entry.

### Steps

- [ ] **D1.** `building/run.ts`:
  - a `BuildRun` with typed steps (`plan`, `castList`, `matches`, `review`, `build`, `check`);
  - one cancel signal;
  - one progress event (`build:progress`, additive to `AppApi`);
  - one at a time per world.

  `worldBuilder/run.ts` becomes its `build` step.
- [ ] **D2.** The cast-list prompt and parser (`building/castList.ts`) replace the World builder's first look when a plan
  exists. The summary path keeps the first look.
- [ ] **D3.** The review list:
  - `features/worldBuilder/ReviewList.tsx`;
  - its store;
  - `startBuildRun` / `confirmBuildRun` / `cancelBuildRun` in `AppApi`.

  Follows the look rules (amber for AI, base 220 ms, no layout shift).
- [ ] **D4.** Recipe → `startRecipeStory` starts a `BuildRun` at `plan`. The outline helper's Keep starts one at
  `castList`. `storyBuild.ts`'s 4-second timer goes.
- [ ] **D5.** Add a "Build without asking" setting to Settings → AI. It defaults to off (Adam decides).
- [ ] **D6.** One Undo for a whole run (the ledger), shown as one toast. "Recently deleted" holds what it removed.
- [ ] **D7.** e2e with the fake provider, from an invented recipe: plan, then review (untick one place), then build,
  then check:
  - the cast is on the cards;
  - threads exist;
  - events are placed;
  - the year backstory is first on the timeline;
  - one Undo returns the world to how it was.
- [ ] **D8.** Update `docs/guide/planning.md` and `docs/guide/your-world.md` with screenshots, a section in
  ARCHITECTURE.md ("One build run"), and `build/release-notes.md`.

---

## Decisions for Adam

**Scope change (Adam, 2026-10-17): no overhaul, fix what is there.** Phase D is dropped, and with it answer 1's review
link and setting. Phase B shrinks to the parts that fix bugs, done inside the existing modules rather than a new
`building/` folder:
- one name normaliser and matcher shared by the outline and the World builder (B1);
- the reply reader fixes (B3);
- undo lines for "Day 1" and conflict issues (part of B5).

B2, B4, the ledger generalisation in B5, and B6's rewrite are dropped. B6's useful bits are kept as fixes: places
(A7), a size cap and named entries first (B2 finding). Phases A and C stand.

**Answered 2026-10-17:**
1. Keep building straight away. "Here's what I'll add" becomes an optional look (a "Review" link in the build's toast and
   on the World builder page), not a stop. D5's setting is turned around: "Ask before building" defaults to off.
2. Make both and add a "Worth a look" note. Agreed.
3. Drop "Book 2" events from the prompts.
4. A name that only might be an existing one ("Marra" next to "Mara") is a different entry, and nobody is asked. A
   clear typo of a long name still uses the existing page (B1 rule 4). **B2 is dropped:** no "possible duplicate" item
   on the memory check list, and `match` returning `possible` just means `none`. The same-name, different-kind note
   from decision 2 stays.

1. **Phase D's review step.** Today, kept outlines start building on their own. Should a new story show "Here's what
   I'll add" first, or keep building straight away, with the review as an option?
2. **The same name, different kind** ("Ironhold" the place and the group). The plan is to make both and add a "Worth a
   look" note, not merge. OK?
3. **"In Book 2" events.** Drop them from the prompts (planned), or let the AI plan later books' events into later
   stories?
4. **Possible duplicates.** The plan is a "Worth a look" item with **Same** and **Different**, never a pop-up. OK?

## Order and size

| Phase | Steps | Rough size | Ships as |
|---|---|---|---|
| A | A1–A8 | 2–3 days | one release: "Fixes to building worlds and stories" |
| B | B1–B6 | 4–5 days | one or two releases, no visible change except fewer duplicates and better links |
| C | C1–C5 | 4–5 days | grouped by area, a release each |
| D | D1–D8 | 5–7 days | one release after Adam's sign-off |
