# Plan: Every chat tells the truth about changes

**Spec**: .planning/specs/chat-truth.md
**Epic**: none
**Created**: 2026-10-20
**Status**: draft
**Stack**: Electron + React + TypeScript (main / shared / renderer), Vitest, Playwright. Not Kotlin or Next.js: the
Spartan backend/frontend layering maps to shared types → main (ipc, ask, ai) → renderer (stores, components).
**Branch**: `claude/chat-truth` in worktree `AIWriter-chat-truth`. Nothing merged or released without Adam's word.

## Approach

Fix in the order that stops Adam's real losses first, then the false words, then the gaps in what chats can do:

1. **Changes that are lost after Apply** (R7, R8, R10). Real data bugs; small, contained.
2. **The app's outcome line** (R1, R9). The one thing that makes every chat trustworthy even when the AI's words
   slip: Adam reads the app's line, not the AI's claim.
3. **One truth check for every chat, matched by target** (R2, R3, R4). Make the shared check stricter and run it on
   every ending and in every chat.
4. **Chapter plans the chat can change, and chats that know their limits** (R5, R6).
5. **Measure** with the chat eval and e2e, then update `docs/ARCHITECTURE.md`.

TDD throughout: each task writes its failing test first (scripted model or unit), then the code.

## Components

| Component | Type | Purpose |
|---|---|---|
| `outcomeOf(proposals, tried)` | shared pure function (`shared/askOutcome.ts`, new) | Works out the outcome line's state and words from recorded proposals and statuses |
| `OutcomeLine` | renderer component (`features/ask/OutcomeLine.tsx`, new) | One line under an answer: state word (amber waiting / green applied / muted nothing) + plain words |
| Truth check v2 | shared pure (`shared/askTruth.ts`) | Wider claim catch, narrower exemptions, target matching, backed claims reworded as waiting |
| Talk truth hook | renderer (`features/planning/talkStore.ts`) | Runs the shared check and outcome on Plan, recipe and cast talk answers |
| Card refresh | renderer (`SceneCardPanel.tsx`, others) | Re-reads a card on apply/undo; field merge with unsaved typing |
| Chapter plan change | main tool + renderer apply | `chapter_card` takes `goal` and `totalWords`; Apply writes them with Undo |

## New files

| File | Location | Purpose |
|---|---|---|
| `askOutcome.ts` + test | `src/shared/` | Outcome state and words (R1) |
| `OutcomeLine.tsx` | `src/renderer/src/features/ask/` | Outcome line for Ask and the talks (R1, R9) |
| `cardMerge.ts` + test | `src/renderer/src/features/inspector/` | Merge a re-read card with unsaved typing, field by field (R7) |
| `planRequests` scenarios | `tests/chat-eval/scenarios-plan.ts` | Eval set: scene card, chapter goal, chapter length, chapter card, move, reorder (spec Testing) |
| fake `plan-wrong-tags` | `tests/fake-provider/` | Plan talk fake that sends changes with wrong tags (R6) |
| `planTalk.spec.ts` | `tests/e2e/` | Plan talk outcome on screen (R6) |

## Files to change

| File | What changes | Why |
|---|---|---|
| `src/renderer/src/features/inspector/SceneCardPanel.tsx` | Listen to `briefingRev`; re-read and merge (`cardMerge`) unless the re-read equals what it holds | R7: applied card was hidden then overwritten |
| `src/renderer/src/features/chapterCard/ChapterCardPanel.tsx`, `features/planHub/ZoomPages.tsx`, `ChapterPlanPanel.tsx`, `features/beats/BeatBar.tsx` | Same re-read rule; audit each for a stale whole-object save | R7 |
| `src/renderer/src/features/ask/applyProposal.ts` | `started` status for drafts/issue fixes; empty `why` never dropped; chapter hold for chapter cards; changed-since check for card, rename, chapter card | R8 |
| `src/renderer/src/features/ask/applyDraft.ts` | Report landing/failure so `started` turns `applied` or back to `pending` | R8 |
| `src/main/ipc/chapterCards.ts` | Turn down a chapter card write for a chapter Write the chapter holds | R8 |
| `src/shared/contracts/ask.ts` | `ProposalStatus` adds `'started'`; chapter card proposal patch adds `goal?`, `totalWords?` | R8, R5 |
| `src/renderer/src/features/ask/Proposals.tsx` | Amber "Waiting: press Apply" label; "Nothing changes until you apply" visible; "Started" state | R9 |
| `src/renderer/src/features/ask/AskPanel.tsx`, `askWords.ts` | Replace `NO_CHANGES_CAME` / `notProposedNote` with `OutcomeLine`; reserve its space while streaming | R1 |
| `src/shared/askTruth.ts` (+ test) | Verbs, bare/heading/“now reads” forms, targets plan/outline/goal/beats/chapter, `ELSEWHERE` only for earlier answers, `you` no longer cancels passive, claims carry target ids, `unbackedClaims` matches ids, backed claims reworded as waiting | R3 |
| `src/main/ask/agent.ts` | Proposals record target ids; `recheck`/`settle` no longer skip on `choice`; earlier-answer claims checked against recorded statuses; prompt: never word a change as made; chapter_card `goal`/`totalWords`; "can't do from here" list | R2, R3, R4, R5 |
| `src/main/ask/storyTools.ts`, `src/main/ask/prompts.ts` | chapter_card schema and checks for `goal`, `totalWords`; chat instructions on chapter plans and limits | R5, R6 |
| `src/main/ai/tasks.ts` (+ `tasks.agent.test.ts`) | `settle` on stop and on periodic saves | R4 |
| `src/main/ipc/ask.ts` | Earlier answers sent with each proposal's status (pending/applied/declined) by target | R3 |
| `src/renderer/src/features/outline/planTalk.ts` | Shared truth check on the final answer; outcome "Nothing was changed" + reason when all lost / unreadable / nudges spent; detect requests for story chapters/scenes in writing mode | R6, R3 |
| `src/renderer/src/features/planning/talkStore.ts`, `TalkPanel.tsx` | `Answer` carries outcome reason; `OutcomeLine` under talk answers; "Make this change in the story" button opens Ask with the request sent | R1, R6 |
| `src/renderer/src/features/planHub/PlanHub.tsx` | Writing-mode intro no longer invites changes it can't make | R6 |
| `src/main/storyBuilder/prompts.ts`, `jobs.ts` | Plan, recipe and cast talk instructions: what each can change, suggest-don't-claim; recipe/cast unreadable reply → outcome reason | R2, R6 |
| `src/renderer/src/features/recipes/RecipeTalk.tsx`, `features/storyBuilder/store.ts` | Outcome line + shared check on talk answers | R1, R6 |
| `src/main/planHub/update.ts`, `src/renderer/src/features/planHub/hubStore.ts` | Return `{ sceneId, card }`; match by id; toast counts real changes and missing scenes | R10 |
| `src/renderer/src/features/ask/open.ts` | Open Ask with a request already sent (for the Plan talk hand-off) | R6 |
| `docs/ARCHITECTURE.md` | New section "Every chat tells the truth (2026-10-20)"; update the two earlier sections' pointers | Rules |

## Tasks

Each task: test first, max 3 source files (+ tests), one commit (`git -c user.name=Claude -c user.email=noreply@anthropic.com commit`).

### Phase 1: Changes stay applied (R7, R8, R10) — no dependencies

| # | Task | Files |
|---|---|---|
| 1 | `cardMerge`: merge a re-read card with the panel's unsaved fields (fields Adam typed win, others take the re-read) | `inspector/cardMerge.ts`, test |
| 2 | SceneCardPanel re-reads on `briefingRev`, merges via `cardMerge`, never autosaves a copy older than the last re-read | `inspector/SceneCardPanel.tsx`, component test |
| 3 | Same rule for ChapterCardPanel, ZoomPages scene page, ChapterPlanPanel, BeatBar (audit; fix any whole-object stale save) | up to 3 files per commit; split into 3a/3b if needed |
| 4 | `ProposalStatus` `'started'`; applyDraft / issue fix report landing or failure; card goes `applied` or back to `pending` with the reason | `contracts/ask.ts`, `applyProposal.ts`, `applyDraft.ts` |
| 5 | Empty-reason apply never dropped ("That change couldn't be made"); changed-since check for card, rename, chapter card | `applyProposal.ts`, `applyProposal.test.ts` |
| 6 | Chapter card hold: Apply and `updateChapterCard` turn down a held chapter with the plain reason | `applyProposal.ts`, `ipc/chapterCards.ts`, test |
| 7 | Update the plan: `{ sceneId, card }` pairs, match by id, honest toast counts | `planHub/update.ts`, `planHub/hubStore.ts`, tests |

### Phase 2: The outcome line (R1, R9) — depends on task 4 (status `started`)

| # | Task | Files |
|---|---|---|
| 8 | `outcomeOf`: states none / tried-and-refused (with reason) / waiting n / started / applied n of m / declined; Adam's words | `shared/askOutcome.ts`, test |
| 9 | `OutcomeLine` component; Ask shows it under every answer, live with status changes, space reserved while streaming; remove `NO_CHANGES_CAME` / `notProposedNote` | `ask/OutcomeLine.tsx`, `AskPanel.tsx`, `askWords.ts` |
| 10 | Proposal cards: amber "Waiting: press Apply", visible "Nothing changes until you apply", "Started" | `ask/Proposals.tsx`, test |

### Phase 3: One truth check, by target, on every ending (R2, R3, R4) — parallel with Phase 2

| # | Task | Files |
|---|---|---|
| 11 | Wider catch: every miss in the audit list as a failing case first, then patterns (verbs, bare past/headings, "now reads/has/opens", "in place", "the edit is in", "Ive", dash/"Okay —" starts, targets plan/outline/goal/beats/chapter); all of today's controls still pass | `shared/askTruth.ts`, `askTruth.test.ts` |
| 12 | Narrower exemptions: `ELSEWHERE` only for earlier-answer phrases; "you" no longer cancels passive | `shared/askTruth.ts`, test |
| 13 | Target matching: claims carry the scene/chapter/entry they name (by number, title, name); proposals carry target ids; `unbackedClaims` matches ids; untargeted claims need a proposal of the same kind *and* are reworded as waiting | `shared/askTruth.ts`, `ask/agent.ts`, tests |
| 14 | Backed claims reworded as waiting ("Change 1 is ready to apply: …") in `honestReply`; chat instructions: suggest, never "I've changed" | `shared/askTruth.ts`, `ask/prompts.ts`, tests |
| 15 | `recheck`/`settle` run when the answer ends with `ask_user`; `settle` on Stop and on periodic saves | `ask/agent.ts`, `ai/tasks.ts`, `tasks.agent.test.ts` |
| 16 | Earlier answers sent with each proposal's status; a claim about an earlier change checked against it | `ipc/ask.ts`, `shared/askTruth.ts`, tests |

### Phase 4: Chapter plans and chats that know their limits (R5, R6) — depends on Phases 2 and 3

| # | Task | Files |
|---|---|---|
| 17 | `chapter_card` takes `goal` and `totalWords` (tool schema, checks, plain errors); "chapter plan" = goal, length, card in the instructions; can't-do list (move, reorder, delete, Write the chapter's plan) with where to do it | `ask/storyTools.ts`, `ask/agent.ts`, `ask/prompts.ts` |
| 18 | Apply/Undo for chapter goal (`updateChapter`) and `totalWords` (`updateChapterCard`); Plan hub chapter page refreshes | `ask/applyProposal.ts`, `Proposals.tsx`, test |
| 19 | Plan talk: shared check on its final answer; outcome reason for all-lost / unreadable / nudges spent; `OutcomeLine` under talk answers | `outline/planTalk.ts`, `planning/talkStore.ts`, `planning/TalkPanel.tsx` |
| 20 | Plan talk writing mode: intro words; a request reaching story chapters/scenes gets "This talk changes suggestions only." + **Make this change in the story** (opens Ask with the request sent) | `planHub/PlanHub.tsx`, `planning/TalkPanel.tsx`, `ask/open.ts` |
| 21 | Plan, recipe and cast talk instructions (suggest, don't claim; what each can change) | `storyBuilder/prompts.ts`, `storyBuilder/jobs.ts` |
| 22 | Recipe and cast talks: outcome line and shared check; unreadable reply says "Nothing was changed" | `recipes/RecipeTalk.tsx`, `storyBuilder/store.ts`, `storyBuilder/jobs.ts` |

### Phase 5: Measure and document — depends on all

| # | Task | Files |
|---|---|---|
| 23 | Chat eval: plan-requests scenario set; fake `plan-wrong-tags`; Plan talk rows in the report | `tests/chat-eval/scenarios-plan.ts`, `score.ts`, `tests/fake-provider/` |
| 24 | E2E: outcome line states in `editorChat.spec.ts`; new `planTalk.spec.ts`; scene card panel keeps an applied change | `tests/e2e/` |
| 25 | `docs/ARCHITECTURE.md` section; run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run chat-eval` on every fake; ponytail-review the whole branch | docs |

## Parallel vs sequential

| Parallel group | Tasks | Why |
|---|---|---|
| A | 1–3, 7 | Card panels and plan update: separate files |
| B | 4–6 | applyProposal.ts: one writer at a time, run in order |
| C | 11–14 | askTruth.ts: one writer, in order; can run beside A and B |
| D | 21 | main prompts only |

| Sequential | Depends on | Why |
|---|---|---|
| 8–10 | 4 | needs the `started` status |
| 15–16 | 13 | need target-carrying claims |
| 17–18 | 10, 13 | new kind shows on cards and is matched by target |
| 19–20, 22 | 8, 9, 11–14 | reuse `OutcomeLine` and the shared check |
| 23–25 | all | measure the whole |

## Testing plan (traced to the spec)

| Spec item | Test |
|---|---|
| R1 outcome line, edge 11 old chats | `askOutcome.test.ts` (each state, old records with nothing recorded); e2e line on screen per state |
| R2/R3 wording, edges 1, 5, 10 | `askTruth.test.ts`: every audit miss caught, every control exempt, target mismatch put right, backed claim reworded, quotes never counted |
| R4 endings, edges 2, 3 | `tasks.agent.test.ts`: settle after Stop, after `ask_user`, on periodic save (scripted model) |
| R5 chapter plans | `agent.tools.test.ts` (schema, checks), `applyProposal.test.ts` (goal, totalWords, Undo); eval plan-requests set |
| R6 limits, edge 6 | planTalk tests (all-lost, unreadable, nudges spent, writing-mode hand-off); fake `plan-wrong-tags`; `planTalk.spec.ts` |
| R7 stays applied, edge 4 | `cardMerge.test.ts`; SceneCardPanel test (applied shown, typing merged, no stale save); e2e |
| R8 apply truth, edges 7, 8 | `applyProposal.test.ts`: started→applied/pending, empty reason, chapter hold, changed-since |
| R9 waiting looks waiting | `Proposals` render test |
| R10 plan update, edge 9 | update.ts + hubStore tests: scene written in between, fewer cards |
| Goal metrics | `npm run chat-eval -- --model fake/<each>`: "Truth check" rows 0 on core + plan-requests sets; edit turns ending in a real change ≥ before (record before/after in ARCHITECTURE) |

No data layer (no migration). No live model run unless Adam gives a key; then DeepSeek Flash only.

## Risks

- **Over-catching**: a wider claim net may reword honest suggestions. Guard: every control in today's test stays
  exempt, plus new controls for "I suggest changing…", "you could update…", story people's actions.
- **Field merge in the card panel**: a field Adam is typing in and the chat changed at once. Rule: Adam's typing wins
  for that field, and the toast says the chat's change to that field wasn't kept.
- **Plan talk detection** of "story chapter" requests may misfire; the button is offered, never forced, and the talk
  still answers.

## Gate 2

- [x] Follows the project's layout (shared types → main ipc/ask/ai → renderer stores/components), API rules
  (additive `AppApi`/contracts), `UserError` plain words
- [x] Each layer calls only the one below (renderer through `window.aiwrite`)
- [x] New and changed files listed with locations
- [x] Tasks small (≤3 source files), dependencies and parallel groups marked
- [x] Data layer: none needed (statuses already saved), stated
- [x] Logic, integration (scripted model, eval), UI (component, e2e) tests planned
- [x] Every spec edge case mapped to a test
