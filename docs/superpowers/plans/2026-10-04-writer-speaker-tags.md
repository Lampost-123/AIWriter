# Writer speaker and tone tags: findings and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The writer model that drafts the prose also says, correctly and completely, who says every line and how, and how the narration is read, so read aloud and "Show speakers and tone" need no second AI pass for AI-written text.

**Architecture:** Keep inline tags (the writer knows who speaks while it writes, and a tag sits exactly where its line is). Harden the parser, give tags one shared format with the marker's notes, let a narration mood carry on until the writer says it turns, keep tags for every AI writing path (variants, Continue, edits), and measure how well each model follows it.

**Tech Stack:** TypeScript, Electron main process, Vitest, Playwright with the fake provider (`tests/fake-provider`).

## Global Constraints

- Adam's words on screen only; tags never reach the page, the saved scene, a record's response or the word count.
- Data model is frozen: no migration. New record data goes in `params_json` (JSON) only.
- Marks stay a cache in `<userData>/speech-cache/marks`, never in a world.
- Tests use invented stories in an `AIWRITE_DATA_DIR` copy only.

---

## How it works today

1. `ai/draftFlow.ts` adds `SPEAKER_TAG_LINE` (and with Emotion and tone, `NARRATION_TAG_LINE`) to the end of the closing instruction when read aloud or "Show speakers and tone" is on.
2. The writer writes `{Mara|coldly}“Get out,” she said.` and `{~hushed}The stairs went on.`
3. `SpeakerTagFilter` (`ai/speakerTags.ts`) strips tags as the draft streams, remembering where each was.
4. At draft end, `tags.speakers(text)` binds each tag to the quote that starts right where the tag was (or the narration sentence after a `~` tag), keyed by the line's words (`quoteKey`).
5. `noteWriterSpeakers` keeps them in memory for 10 minutes; when the draft's paragraphs are marked (`DraftMarks`, 2.5 s after the last save), `writerMarks` puts them on the new paragraphs.
6. Anything still unmarked (`unmarkedIn`) goes to a second AI call (`MARK_PROMPT`, writer model, no thinking).

## Findings

### A. Most AI-written paragraphs still go to the second AI call

- **A1. Dialogue paragraphs.** `unmarkedIn` treats a paragraph's narration as unmarked unless one of its sentences has a note. `“You came,” he said, as if he had laid money on the opposite.` has its quote tagged, but its narration (` he said, as if…`) has none, and the writer is only told to tag "paragraphs of narration". So nearly every dialogue paragraph is re-sent to the AI. The app's own e2e draft shows it: only the opening paragraph's mood comes from the writer.
- **A2. "Same" means "plain".** The marker is told to answer `same` when the mood carries on, but `marksFrom` stores `{}` for it, and the plan only looks within the paragraph (`savedNarration`), so a "same" paragraph is read with no mood at all, not the previous one. The writer's `NARRATION_TAG_LINE` asks for a tag "at the start of each paragraph … and where its mood turns", and an untagged paragraph also gets no carry-on.
- **A3. Speaker without tone.** With Emotion and tone on, a quote the writer tagged `{Tobin}` (no bar) is sent to the AI just for the tone. The tag line makes "how it is said" sound optional ("with how it is said after a bar").

### B. Tags are lost or leak into the prose

- **B1. Long narration moods leak.** `TAG` allows at most 60 characters before the bar, and a `~` mood has no bar, so `{~hushed and tight, dread building with every careful step up the stairs}` is not a tag: it stays on the page. Verified with the regex.
- **B2. A tag must sit exactly before the quote.** `speakers()` only matches a quote that starts right at the tag. Common model habits lose the tag silently: `{Mara|cold} Mara turned. “Get out.”` (tag at paragraph start), `“{Mara|cold}Get out.”` (inside the quote).
- **B3. Variants drop their tags.** `variants/index.ts` passes no `onSpeakers`, so tags are stripped and thrown away; a picked variant is marked by the second AI call from scratch.
- **B4. Continue and the selection edits (Expand, Change tone, Fix voice, Rewrite…) never ask for tags.** They run through `startTask` with their own prompts; whatever they write is marked by the second call. Change tone and Fix voice are exactly the tools that change how lines are said.
- **B5. Tags live only in memory for 10 minutes.** If marking doesn't run in that window (app closed, world switched), they are gone. Low impact, but nothing records what the writer said, so a bad tag can't be looked into later ("What the AI saw" shows the response without them).

### C. Quality and consistency

- **C1. Two different styles of note.** The marker's prompt has careful rules (under 15 words, feeling and strength, what the listener hears, never describe the voice, pace and sound fields). The writer gets one example. Notes from the two sources read differently, and the writer never gives a pace or a sound (sighs, laughs) in a structured way.
- **C2. Nobody measures compliance.** There is no count of how many quotes a model tagged, so we can't tell a model that ignores the instruction from one that follows it, or compare models.
- **C3. Tags cost reply room.** The reply limit is the target length plus 40% (`REPLY_HEADROOM`). Dialogue-heavy scenes with full tagging use a noticeable share of it; with a tight model limit (`fallback`), the risk of a cut-off goes up.

### What is fine and should stay

- Inline tags are the right design: the writer knows the speaker and intent at the moment it writes the line, and a tag is anchored by position for free. Streaming-safe stripping across chunk boundaries is solid and tested.
- Keying by the quote's words survives Adam editing the narration around a line, and in-order consumption handles repeated short lines ("Yes.").
- Beat by beat already passes tags through.

## Options considered

1. **Harden the inline tags (recommended).** Fix the parser, the narration carry-on and the missing paths; one shared note format; measure. Small, incremental, keeps streaming and prose quality.
2. **A structured appendix after the prose** (JSON listing every line and its speaker). Rejected: the model must re-quote every line (more tokens, more mismatches), and nothing is known until the end.
3. **The writer re-reads its own draft in a second call.** This is what happens today for anything untagged; it doubles cost and loses the writer's intent. Keep it only as the fallback.

---

## Tasks

### Task 1: The parser never leaks a tag and finds the line a tag belongs to

**Files:**
- Modify: `src/main/ai/speakerTags.ts`
- Test: `src/main/ai/speakerTags.test.ts`

**Interfaces:**
- Produces: `WriterSpeaker` gains optional `pace?: 'slow' | 'fast'` and `sound?: string` (parsed with `readMark` from `readAloud/speakers.ts`); `SpeakerTagFilter` API unchanged.

- [ ] **Step 1: Write failing tests**

```ts
it('takes out a long narration mood, and any {…|…} tag, so none reach the page', () => {
  const long = '{~hushed and tight, dread building with every careful step up the stairs}The stairs went on.'
  expect(stream(long, 5).out).toBe('The stairs went on.')
  expect(stream('{Mara the ferry woman from the harbour who never smiles at anyone|cold}“Go.”', 4).out).toBe('“Go.”')
})

it('gives a tag to the next line in its paragraph, or the line it sits inside', () => {
  const { speakers } = stream('{Mara|cold} Mara turned. “Get out.”\n\n“{Tobin|dry}No.”', 3)
  expect(speakers).toEqual([
    { key: 'get out', who: 'Mara', tone: 'cold' },
    { key: 'no', who: 'Tobin', tone: 'dry' }
  ])
})

it('reads pace and sound as the marker does', () => {
  const { speakers } = stream('{Mara|thick with tears|slow|sob}“I can’t.”', 4)
  expect(speakers[0]).toMatchObject({ key: 'i can t', who: 'Mara', tone: 'thick with tears', pace: 'slow' })
  expect(speakers[0].sound).toBeTruthy()
})
```

- [ ] **Step 2: Run** `npx vitest run src/main/ai/speakerTags.test.ts`. Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**
  - `TAG` becomes `/^\{(~[^{}\n]{1,200}|[^{}|\n]{1,120})(?:\|([^{}\n]*))?\}$/` (a `~` mood may be long; a name up to 120).
  - In `speakers()`, for a quote tag: look for the next quote (or italic speech) from `from` up to the end of the paragraph (`\n`) and before the next tag's position; if the character just before `from` is an opening quote (`"` or `“`), the quote that starts there.
  - Read the fields with `readMark(\`${who} | ${rest}\`)` and copy `how.tone`, `how.pace`, `how.sound`.
  - Bump nothing else; the class's streaming logic stays.

- [ ] **Step 4: Run** the same command. Expected: PASS, with the existing tests too.
- [ ] **Step 5: Commit** `git commit -m "Writer tags: long moods never leak, a tag finds its line in the paragraph"`

### Task 2: A narration mood carries on, so a tagged paragraph needs no second call

**Files:**
- Modify: `src/main/readAloud/index.ts` (`writerMarks`), `src/main/readAloud/speakers.ts` (`marksFrom`)
- Test: `src/main/readAloud/marksFrom.test.ts`, new `src/main/readAloud/writerMarks.test.ts` (export `writerMarks`' pure part as `writerBlocks(paragraphs, given, cast, kept)` from a new `src/main/readAloud/writerBlocks.ts` so it is testable without Electron)

**Interfaces:**
- Produces: `writerBlocks(paragraphs: {pid,text}[], given: WriterSpeaker[], cast: CastMember[], kept: Map<string, ParagraphMarks>, carried?: LineDelivery): { blocks: Para[]; carried?: LineDelivery }`.

- [ ] **Step 1: Write failing tests**

```ts
it('carries the narrator’s mood into later paragraphs the writer didn’t tag, dialogue tags included', () => {
  const paragraphs = [
    { pid: 'a', text: 'The rain had not let up.' },
    { pid: 'b', text: '“You came,” he said, as if he had laid money on the opposite.' }
  ]
  const given = [
    { key: '~the rain had not let up', who: '', tone: 'low and watchful' },
    { key: 'you came', who: 'Tobin', tone: 'dry, a little amused' }
  ]
  const { blocks } = writerBlocks(paragraphs, given, cast, new Map())
  const b = blocks.find((x) => x.id === 'b')!
  expect(unmarkedIn(b.text, b.speakers, b.delivery)).toEqual([])
  expect(b.delivery?.['~he said as if he had laid money on the opposite']).toEqual({ tone: 'low and watchful' })
})

it('reads “same” as the mood before it, not as no mood', () => {
  // A part of two paragraphs: the first gets "tense", the second "same".
  const [part] = markParts([{ id: 'p1', text: 'She ran.' }, { id: 'p2', text: 'The door held.' }], ['p1', 'p2'], new Set(), 5000, 5000)
  const got = marksFrom(part, { '1': 'tense, quick', '2': 'same' }, undefined, cast)
  expect(got.get('p2')!.delivery).toEqual({ '~the door held': { tone: 'tense, quick' } })
})
```

- [ ] **Step 2: Run** `npx vitest run src/main/readAloud`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - `writerBlocks`: walk the draft's paragraphs in order with `carried` (start from the last narration note kept on the paragraph before the draft, if any). A `~` tag sets `carried`. Each paragraph with narration and no tag of its own gets `carried` (or `{}` when nothing is carried yet) on its first narration span. Quotes as today.
  - `writerMarks` in `index.ts` calls `writerBlocks` and saves as today.
  - `marksFrom`: keep `last` (the most recent narration note in the part); `same` stores a copy of `last` instead of returning, falling back to `{}`.

- [ ] **Step 4: Run** `npx vitest run src/main/readAloud`. Expected: PASS.
- [ ] **Step 5: e2e.** In `tests/e2e/speakerLabels.spec.ts` first test, after the labels show, add: `expect((await invoke(win, 'listGenerations', sceneId)).filter((g) => g.job === 'speech')).toHaveLength(0)` (the fully tagged fake draft needs no second call). Run `npm run build; npx playwright test tests/e2e/speakerLabels.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `git commit -m "A narration mood carries on until the writer says it turns"`

### Task 3: One note format for the writer and the marker

**Files:**
- Modify: `src/main/ai/speakerTags.ts` (`SPEAKER_TAG_LINE`, `NARRATION_TAG_LINE`), `src/main/readAloud/speakers.ts` (`MARK_PROMPT`)
- Test: `src/main/ai/speakerTags.test.ts`, `tests/fake-provider/server.mjs` (keep its trigger phrases in step)

**Interfaces:**
- Produces: `export const HOW_NOTE` in `readAloud/speakers.ts`: the shared rules for a line's note (under 15 words; the feeling and its strength, the intent, what the listener hears; never age, gender or accent). Both prompts include it.

- [ ] **Step 1: Write a failing test** that both `SPEAKER_TAG_LINE` and `MARK_PROMPT([])` contain `HOW_NOTE`, that `SPEAKER_TAG_LINE` asks for `{Who|how|pace|sound}` with how always given, and that `NARRATION_TAG_LINE` says a mood "carries on until the next tilde tag".
- [ ] **Step 2: Run** `npx vitest run src/main/ai/speakerTags.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the new lines:

```ts
export const SPEAKER_TAG_LINE =
  `- Just before the opening quote mark of every line of dialogue (or the opening asterisk of speech in italics), put who says it and how, in curly braces: {Mara|coldly, barely above a whisper}“Get out,” she said. Fields after the name, split by bars: how it is said (always), then pace (slow or fast) and a sound (sigh, gasp, laugh, sob) only when they apply: {Tobin|thick with tears|slow|sob}. ${HOW_NOTE} Use the character's name exactly as given above; for someone unnamed, a few plain words: {the guard|bored}. Give each quote its own tag, a line that carries on after a dialogue tag too. The tags are taken out before the author reads the scene, so never mention them.`
export const NARRATION_TAG_LINE =
  '- Where the narration starts, and wherever its mood turns, put how the narrator reads it in curly braces after a tilde: {~hushed, dread building}The stairs went on. The mood carries on until the next tilde tag, through dialogue too, so tag only where it changes. A few words, for an audiobook narrator: the feeling and how it sounds.'
```

  Update the fake writer's trigger in `tests/fake-provider/server.mjs` (`'put who says it in curly braces'` → `'put who says it and how, in curly braces'`).
- [ ] **Step 4: Run** `npx vitest run` and `npx playwright test tests/e2e/speakerLabels.spec.ts tests/e2e/readAloud.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "The writer and the marker write the same kind of note"`

### Task 4: A picked variant keeps what its writer said

**Files:**
- Modify: `src/main/variants/index.ts`, `src/main/ipc/variants.ts`, `src/main/readAloud/index.ts`, `src/main/ipc/history.ts`
- Test: a new unit test for the store in `src/main/readAloud/writerMarks.test.ts`; e2e in `tests/e2e/variants.spec.ts`

**Interfaces:**
- Produces: `noteVariantSpeakers(generationId: ID, speakers: WriterSpeaker[]): void` and `variantPicked(sceneId: ID, generationId: ID): void` in `readAloud/index.ts`; a map by generation id, kept 30 minutes, at most 30 entries.

- [ ] **Step 1: Write a failing test**: speakers noted for a variant are not on the scene until `variantPicked`, then `writerFor(sceneId)` returns them.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.** `variants/index.ts` passes `onSpeakers: (s) => deps.onVariantSpeakers?.(generationId, s)` (wire `generationId` after `startDraftJob` returns by keeping the callback's id in a closure set before the call). `ipc/history.ts` `takeSnapshot`: when `input.kind === 'ai' && input.generationId`, call `variantPicked(input.sceneId, input.generationId)` before `aiChangeComing`.
- [ ] **Step 4: Run** unit and the variants e2e. Expected: PASS, and no `speech` records for the picked variant's tagged lines.
- [ ] **Step 5: Commit** `git commit -m "A picked variant keeps its writer's speakers and tone"`

### Task 5: Continue and the selection edits tag their lines too

**Files:**
- Modify: `src/main/ai/tasks.ts` (optional `tags?: { filter: SpeakerTagFilter; onSpeakers: (s: WriterSpeaker[]) => void }` applied in its `onText` and at the end), `src/main/edits/prompts.ts` (append the tag lines for tools that write dialogue: rewrite, expand, vivid, tone, voice, alternatives, continue), `src/main/edits/index.ts` (pass the filter and `noteWriterSpeakers` when read aloud or labels are on)
- Test: `src/main/ai/tasks.test.ts`, `src/main/edits/briefing.test.ts`; e2e Continue with labels on

- [ ] **Step 1: Write failing tests**: a task streamed with tags gives the window text with no braces and calls `onSpeakers` once at the end; the Continue prompt contains `SPEAKER_TAG_LINE` only when asked.
- [ ] **Step 2: Run** `npx vitest run src/main/ai/tasks.test.ts src/main/edits`. Expected: FAIL.
- [ ] **Step 3: Implement** as listed. Alternatives' several options each get their own filter (they are split before going to the page); keep the record's response tag-free as drafts do.
- [ ] **Step 4: Run** the unit tests and `npm run build; npx playwright test tests/e2e/edits.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Continue and AI edits say who says each line and how"`

### Task 6: Measure how well each model follows the tags

**Files:**
- Modify: `src/main/ai/speakerTags.ts` (`coverage(text): { quotes: number; tagged: number; toned: number; moods: number; dropped: number }`), `src/main/ai/drafts.ts` (store it in the record's `params.speakerTags` when tags were asked for), `src/shared/types.ts` (`GenerationParams.speakerTags?`, additive)
- Test: `src/main/ai/speakerTags.test.ts`, `src/main/ai/drafts.test.ts`

- [ ] **Step 1: Write failing tests**: `coverage` of the test DRAFT is `{ quotes: 5, tagged: 5, toned: 3, moods: 0, dropped: 0 }`; a finished draft record has `params.speakerTags`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `dropped` counts tags that matched no line (Task 1's binding failed).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Live check (needs Adam's go-ahead, it spends credit).** In a test copy (`AIWRITE_DATA_DIR`) with an invented world, draft one dialogue-heavy scene with each of three writer models he uses; read `params.speakerTags` from the records. Target: tagged ≥ 95% of quotes, toned ≥ 90%, dropped 0. Write the numbers into docs/ARCHITECTURE.md under "Who says each line, from the writer".
- [ ] **Step 6: Commit** `git commit -m "Record how many lines the writer tagged"`

### Task 7: Room in the reply for the tags

**Files:**
- Modify: `src/main/ai/context.ts` (`replyTokenLimit` or its caller in `drafts.ts`: when tags are asked for, `reserved` gains 15%)
- Test: `src/main/ai/context.test.ts`

- [ ] **Step 1: Write a failing test**: with speaker tags on, the reply limit for a 1,000-word target is 15% higher than without.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** a `TAG_ALLOWANCE = 0.15` applied only when `speakerTags` is set (pass it through `PreparedContext`).
- [ ] **Step 4: Run** `npx vitest run src/main/ai`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Drafts keep room for the speaker tags"`

## Order and size

Tasks 1 and 2 give most of the gain (no leaks, no second call for tagged drafts) and are small. Task 3 improves the tones themselves. Tasks 4 and 5 extend it to every AI writing path. Task 6 tells us whether real models comply; do it before deciding anything bigger. Task 7 is a safety margin.

## Already done (this session)

- Labels mark paragraphs that have none yet, without Listen.
- An empty tone no longer counts as finished while Emotion and tone is on; old cached empty tones are cleared once.
