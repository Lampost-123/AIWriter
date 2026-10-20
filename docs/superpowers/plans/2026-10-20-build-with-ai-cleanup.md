# Build with AI cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build with AI shows one section at a time under tabs that stay when zoomed in, planned chapters in plain sight, nothing locked behind another section.

**Architecture:** Renderer only. `PlanHub.tsx` swaps its scroll page and scroll-spy strip for a tab list driven by the view's `section` (remembered per story in `hubStore`). `StoryLine.tsx` drops the planned wrapper row. `topicLogic.connectionsOpen` also opens on what the world already has. `StartCard` gets the idea box.

**Tech Stack:** React 19, zustand, Tailwind 4 + `build.css`, Vitest, Playwright (`_electron`).

**Spec:** `docs/superpowers/specs/2026-10-20-build-with-ai-cleanup-design.md`

## Global Constraints

- Words on screen are Adam's: world, story, chapter, scene, character, place, lore, draft. No "line" as a noun on its own except the existing "Story line" tab name.
- Colours only from theme tokens; tab change is instant (no slide); exits never slower than entries.
- No layout shift: a tab's panel renders nothing rather than a flash while it loads.
- No change to `src/main`, `src/shared` contracts, AI jobs or stores' persisted data.
- Commit with `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`; worktree `AIWriter-buildclean`, branch `claude/build-clean`.

## Review Focus

- A view with `chapterId` and `section: 'idea'` (old saved link): the chapter page wins and Story line is the chosen tab (`tabFor` test).
- Story line tab clicked while on a chapter's page: lands on the whole story with that chapter's row in view (`near`), not at the top.
- A long planned outline (9+ chapters) shown flat: each row stays one line high with its scenes folded (e2e checks `data-chapter` rows and no `data-row="planned"`).
- How it all connects with a world that has only groups or items: stays shut (unit test).
- Typing the idea in the Plan your story card and switching to Your idea: the same text is there (same `brief.plot`; e2e).

---

### Task 1: Which tab is chosen

**Files:**
- Modify: `src/renderer/src/features/planHub/hubStore.ts` (HubState `section: BuildSection | null`, `fresh()`, `setSection(storyId, s)`)
- Modify: `src/renderer/src/features/planHub/buildLogic.ts` (add `tabFor`)
- Test: `src/renderer/src/features/planHub/buildLogic.test.ts`

**Interfaces:**
- Produces: `tabFor(view: { section?: BuildSection; chapterId?: ID; sceneId?: ID }, remembered: BuildSection | null, mode: 'start' | 'planned' | 'writing'): BuildSection`; `setSection(storyId: ID, section: BuildSection): void`.

- [ ] Step 1: tests `tabFor`: zoomed (`chapterId` or `sceneId`) → `'line'` whatever `section` says; else `view.section`; else `remembered`; else `defaultSection(mode)` (`'idea'` for start, `'line'` otherwise).
- [ ] Step 2: run `npx vitest run src/renderer/src/features/planHub/buildLogic.test.ts`: FAIL (no `tabFor`).
- [ ] Step 3: implement both.
- [ ] Step 4: run again: PASS.

### Task 2: Tabs in PlanHub

**Files:**
- Modify: `src/renderer/src/features/planHub/PlanHub.tsx`, `build.css`

**Interfaces:**
- Consumes: `tabFor`, `setSection`.

- [ ] Step 1: `tab = tabFor(view, hub.section, mode)`. Tab click: `setSection(storyId, s)` and `navigate({ kind: 'planHub', storyId, section: s, back, ...(zoom && s === 'line' ? { near: zoom.chapterId } : {}) })`.
- [ ] Step 2: tab list markup: `<div role="tablist" aria-label="Build with AI" data-build-nav>` of `<button role="tab" aria-selected aria-controls data-nav={id}>` (number, label, status), roving tabindex, ArrowLeft/ArrowRight/Home/End. Panel `<div role="tabpanel" data-build-section={tab}>` renders only the chosen section, or the zoom page when zoomed.
- [ ] Step 3: delete scroll-spy (`inView` scroll listener, `holdUntil` reading, `working`), `sectionHead`, the left-side nav layout; `goTo(s, then?)` becomes: choose the tab, then on the next frame call `then` on `[data-build-section="s"]`. Keep `scrollToSoon`/`pin` for chapter rows and zoom targets. `talkSection = tab`.
- [ ] Step 4: side column: `Plan before writing` card only when `tab === 'line'`.
- [ ] Step 5: `build.css`: tabs as one row (wrap on narrow), chosen tab marked with accent underline + `bg-surface`; drop the `.hub-scroll` container query that moved the nav to the left.
- [ ] Step 6: `npm run typecheck`: no errors.

### Task 3: Planned chapters in plain sight

**Files:**
- Modify: `src/renderer/src/features/planHub/StoryLine.tsx` (the `row.kind === 'planned'` branch)

- [ ] Step 1: render the `PlannedChapter` list straight into `items` (key `${row.key}:in`, class `hub-row-kids is-flat`), no wrapper `<li data-row="planned">`, no Write Ch N, no Open the plan / Pick up / Fold away. Remove now-unused imports (`openWriteChapter` only if unused elsewhere in the file) and the `planned` auto-open effect in `PlanHub.tsx`.
- [ ] Step 2: typecheck clean.

### Task 4: How it all connects opens on what the world has

**Files:**
- Modify: `src/renderer/src/features/worldInterviews/topicLogic.ts`, `TopicInterviews.tsx`
- Test: `src/renderer/src/features/worldInterviews/topicLogic.test.ts`

**Interfaces:**
- Produces: `connectionsOpen(progress: InterviewProgress | null, has?: Partial<Record<EntryKind, number>> | null): boolean`

- [ ] Step 1: tests: `connectionsOpen(null, { character: 2 })` true; `connectionsOpen(null, { place: 1 })` true; `connectionsOpen(null, { lore: 1 })` true; `connectionsOpen(null, { group: 3, item: 1 })` false; old cases unchanged.
- [ ] Step 2: run vitest on it: FAIL.
- [ ] Step 3: implement; `TopicInterviews` passes `useEntryCounts()`; locked words "Add a character, place or lore first" (status and title).
- [ ] Step 4: vitest PASS.

### Task 5: The idea box in Plan your story

**Files:**
- Modify: `src/renderer/src/features/planHub/HubCards.tsx` (`StartCard`), `PlanHub.tsx` (`plan()`, `focusIdea`)

- [ ] Step 1: replace the "From your idea" line with a labelled `AutoTextarea` (`data-start-idea`, label "Your idea, in a line or two") bound to `idea`, `onChange` → `patchBrief(storyId, { plot })`. Keep the Cast and world line (its link switches tab).
- [ ] Step 2: `plan()` with no idea: set the problem and focus `[data-start-idea]` in the card; no tab switch.
- [ ] Step 3: typecheck clean.

### Task 6: Tests and docs follow

**Files:**
- Modify: e2e specs that scroll to sections or use the planned wrapper: `buildWithAi`, `planHub`, `storyBuilder`, `buildLook`, `zoom`, `chapterFlow`, `worldInterviews`, `ai-planning-desk`, `recipes` (only where they fail).
- Modify: `docs/ARCHITECTURE.md` "Build with AI" section (tabs, flat planned chapters, connections, idea box).
- Add to `tests/e2e/buildWithAi.spec.ts`: tabs show one section; Story line tab from a chapter's page goes back with the row in view; no `data-row="planned"`; How it all connects enabled in the sample world; Plan before writing absent on Your idea.
- Add to `tests/e2e/planHub.spec.ts` (new story start): idea typed in the card shows in Your idea; Plan it with an empty box keeps Story line chosen.

- [ ] Step 1: `npm run build && npx playwright test buildWithAi planHub storyBuilder buildLook zoom chapterFlow worldInterviews ai-planning-desk recipes`: all pass.
- [ ] Step 2: `npm run typecheck && npm test`: pass.
- [ ] Step 3: pictures with `BUILD_SHOTS`/`ZOOM_SHOTS` to the scratchpad; look at them.
- [ ] Step 4: ponytail-review the branch diff; fix findings.
- [ ] Step 5: commit; push branch; PR `--base main` (no merge without Adam).
