# Spec: Every chat tells the truth about changes

**Created**: 2026-10-20
**Status**: draft
**Author**: Adam (problem), Claude (spec)
**Epic**: none
**Builds on**: docs/ARCHITECTURE.md "The editor chat (Ask the world, October 2026)" and "The chat never claims a change
it didn't make (Adam, 2026-10-19)"

## In plain words (for Adam)

The chats still say "I've changed the scene card" or "I've updated the chapter plan" when nothing changed. Three
things cause it:

1. **The AI gets to say what happened.** Only the Ask chat checks the AI's words, and the check is a word list. New
   wordings ("Plan updated.", "The goal now reads…", "I've reworked…") slip past it. The Plan talk ("Talk it over")
   has no check: when its change can't be made, the AI's "I've moved those scenes" is shown as it was written.
2. **"Ready to apply" reads like "done".** In Ask, the AI suggests a change and you press Apply. But it says "I've
   updated the card", and the waiting card has no clear "waiting" label. If you don't press Apply, nothing changes.
3. **Some changes really are lost after Apply.** If the scene card is open in the side panel when you apply a card
   change, the panel keeps showing the old card. The next thing you type there saves the old card back over the
   change. Also, no chat can change a chapter's goal or length yet, and the Plan talk on the Plan hub can only change
   suggestions, not chapters already in the story. It still invites "ask for a change", so the AI claims one.

The fix in one rule: **the app, not the AI, says what changed.** Under every chat answer the app writes one plain
line from what really happened: "Nothing was changed", "1 change is waiting: press Apply", or "Applied". The AI's
own words never claim a change as made. Every change the chat offers really lands, and stays.

## Problem

Adam asks a chat to edit a scene or a chapter plan. The chat says the edit was made, but the story is unchanged.
Sometimes no change was ever proposed. Sometimes the change was proposed but only waits for Apply. Sometimes it was
applied and then quietly overwritten. He can't trust any chat's answer, so he has to check every change by hand.

## Goal

- No chat answer that Adam sees says a change was made unless the app recorded that change as applied.
- No chat answer says a change is waiting unless a card or preview for it is on screen.
- An applied change stays applied: no open view writes an old copy back over it.
- A request the chat can't carry out gets a plain "I can't change that from here", with where to do it.
- Measured on the chat evals: answers claiming a change never made = 0 on every fake model, and on the new
  "scene plan / chapter plan" request set; edit requests that end with a real change ≥ today's rate.

## The chats this covers

Found in the 2026-10-20 audit (file paths under `src/`):

| Chat (Adam's name) | Where | How it changes things | Truth check today |
|---|---|---|---|
| Ask the world (the editor chat) | `renderer/.../features/ask/`, `main/ask/` | Tool calls make proposal cards; Apply writes | Yes (`shared/askTruth.ts`), with holes |
| Plan talk: "Talk it over" / "Make this change" (Build with AI, Plan hub) | `features/outline/planTalk.ts`, `features/planning/talkStore.ts`, `main/storyBuilder/jobs.ts` `startPlanChat` | Tagged text parsed into a preview of the suggestions; Apply changes the unkept suggestions only | Only a small `CLAIMS` re-ask; the final answer is shown as written |
| Recipe talk ("Talk the recipe over") | `features/recipes/RecipeTalk.tsx`, `jobs.ts` `recipeChat` | Parsed parts become a preview | None |
| Cast and world list talk (Story builder) | `features/storyBuilder/store.ts`, `jobs.ts` `storyCodexChat` | Parsed JSON list becomes a preview | None |
| Update the plan (Plan hub drift card, with a direction) | `features/planHub/hubStore.ts`, `main/planHub/update.ts` | Writes scene cards after Keep | App writes the toast, but cards can land on the wrong scene |
| Interview me (scene or chapter card) | `features/outline/planInterviewStore.ts` | App fills the card; AI only asks | App writes the toast; some drops are silent |

Not chats (no AI claim to check): the character interview, QuickStart and topic questions, the instruction boxes
(Edit, director note, direction composer, variants, critique).

## User stories

- As Adam, when I ask any chat to change a scene card, I see either a change waiting for Apply or a plain "nothing
  was changed, because…", never "done" when it isn't.
- As Adam, when I ask to change a chapter's plan (its goal, its length, its card), the chat can really make that
  change, and after I press Apply the chapter shows it.
- As Adam, when I apply a change while the scene card is open beside me, the card shows the change at once and keeps
  it.
- As Adam, when I ask the Plan hub's talk to change a chapter already in the story, it either makes that change or
  tells me where it can be made, with one click to get there.

## Requirements

### Must have

**R1. The app writes the outcome line.** Under every answer in every chat above, the app shows one line built only
from what the app recorded, never from the AI's words:
- "Nothing was changed." (plus the plain reason when a change was tried and turned down)
- "1 change is waiting for you: press Apply." / "3 changes are waiting…" (amber, `ai`)
- "Applied." / "2 of 3 applied." (green, `success`), updated live as Adam applies, undoes or declines
- Plan talk, recipe talk, cast talk: the same line for their preview ("The plan below has 2 changes waiting: press
  Apply"; "Nothing was changed: the parts it named aren't in the plan").
The line is saved with the answer, so a chat opened later shows the same truth.

**R2. The AI never words a change as made.** Every chat's instructions say: you can't change anything yourself; say
what you suggest ("Here's a change you can apply: …"), never "I've changed / updated / done". The shared truth
check (R3) puts right any answer that still does, before Adam sees the final text.

**R3. One shared truth check for every chat.** `shared/askTruth.ts` becomes the check for all chats, not only Ask:
- **A claim must match its target, not just its kind.** A proposal records what it changes (the scene, chapter or
  entry). "I've updated the cards for scenes 4 and 5" with one proposal for scene 4 is put right for scene 5.
- **A claim of "made" is false even when a proposal backs it**, because nothing in a chat is applied by the AI. A
  backed claim is reworded as waiting ("Change 1 is ready to apply: …"), not left as "done".
- **Wider catch**, from the audit's list of misses: bare past tense and headings ("Plan updated.", "## Changes
  made", "**Updated scene card**", "Summary of edits:"), "X now reads / now has / now opens with", "the edit is in",
  "the changes are in place", missing verbs (wrote, written, drafted, reworked, revamped, overhauled, refined,
  condensed, streamlined, incorporated, shifted, rearranged, planned), plan / outline / goal / beats / chapter as
  targets, "Ive" without an apostrophe, a dash or "Okay —" before the claim.
- **Narrower exemptions**: "earlier" or "previously" exempts a sentence only when it refers to an earlier answer
  ("in my last answer", "earlier in our talk"), never "moved the reveal earlier". "you" no longer cancels a passive
  claim ("revised as you asked").
- Claims about a change made in an earlier answer are checked against that answer's recorded outcome (waiting,
  applied, declined), not exempted.

**R4. The check runs on every way an answer can end**: finished, stopped by Adam (the text so far is checked before
it's saved), ending with a question to Adam (`ask_user`), and the periodic save while streaming saves only checked
text. Words that stream in may show a claim for a moment; the final text and the saved record never do.

**R5. Chapter plans can be changed from the chat.** Ask's `chapter_card` change also takes the chapter's **goal**
and its **length target**. "Chapter plan" in Adam's words means the chapter's goal, length and card; the chat's
instructions say so. Apply writes them through the same APIs the Plan hub uses, with Undo, and the Plan hub's
chapter page shows the change at once. Changes the chat can't make (reorder, move or delete scenes; Write the
chapter's own running plan) are answered with "I can't do that from here" and where to do it.

**R6. Each chat knows what it can and can't change, and says so.** Every chat's instructions list what it can change.
- Plan talk on the Plan hub with no suggestions waiting (writing mode): its opening line no longer invites changes
  it can't make. A request to change chapters or scenes already in the story is answered with the outcome line
  "This talk changes suggestions only." and a button **Make this change in the story** that opens Ask with the
  request sent, where it becomes proposal cards (R5).
- Plan talk: when every change it sent names a part that isn't in the plan, or its reply doesn't read as a plan,
  the outcome line says "Nothing was changed" with the reason, and the truth check puts right the AI's claim.
- Recipe and cast talks: a reply whose parts don't read shows "Nothing was changed" rather than the AI's words alone.

**R7. An applied change stays applied.** Every open view of a thing re-reads it when a chat applies or undoes a
change to it, and never writes an older copy back:
- The scene card panel (`features/inspector/SceneCardPanel.tsx`) re-reads its card on `briefingRev` (or a per-scene
  card revision) when it has no unsaved typing; with unsaved typing, it merges field by field so neither Adam's
  typing nor the applied change is lost.
- The same rule for the chapter card panel, the Plan hub's chapter and scene pages, and the beat bar. A test covers
  each.

**R8. Apply tells the truth.**
- A draft or issue fix that only *starts* shows "Started", and turns to "Applied" only when it lands; if it fails or
  Adam turns it down in the page, the card goes back to waiting with the reason.
- An apply that returns no reason is never dropped silently: it shows "That change couldn't be made" and the card
  stays waiting.
- A chapter card change for a chapter that Write the chapter is holding is turned down with the plain reason, the
  same as scene changes.
- A card, title or chapter card that changed since the proposal is not overwritten blindly: Apply says "This card
  has changed since; here's what it says now" and asks Adam to apply again or ask again.

**R9. Waiting changes look waiting.** A proposal card that waits shows an amber "Waiting: press Apply" label, not
only a button. "Nothing changes until you apply" is shown, not only a hover tip.

**R10. Update the plan puts each card on its own scene.** The cards come back with the scene ids main sent, and the
window matches them by id, not by position. Fewer cards than scenes is said in the toast ("4 of 6 scenes got new
cards").

### Nice to have

- N1. The outcome line links to the change: click "Applied" to jump to the scene or chapter.
- N2. "Apply all" on the outcome line when more than one change waits.
- N3. Interview me: say plainly when a goal wasn't filled because the chapter already has one.

### Out of scope

- The chat applying changes by itself without Apply (Adam's rule: it proposes, he applies).
- Deleting anything from the chat (Adam's rule: never deletes).
- Reordering or moving scenes from the chat (it says where to do it instead).
- Changing Write the chapter's own plan while it runs.
- New chats, a new chat look, or new models. The Chat and brainstorm model stays the chat's model.
- Classic look (retired).

## Data and API changes

- **Proposals** (`shared/types.ts`, ask proposals): each records its target ids (`sceneId` / `chapterId` /
  `entryId`), already mostly there; the `chapterCard` proposal gains `goal?: string` (applied with the existing
  `updateChapter(id, { goal })`) and `totalWords?: number` (the chapter card's length target, `ChapterCard.totalWords`).
- **Answer records**: no migration. Ask already saves each proposal's status with its answer
  (`ProposalStatus` 'pending' | 'applied' | 'declined', `setProposalStatus`), so the outcome line is worked out from
  them; `ProposalStatus` gains `'started'` (additive) for drafts and in-page fixes still running. The talk stores
  already keep each answer's `outcome` (`offered` / `applied` / `declined` / `revised`) and gain the reason when
  nothing was changed. Old answers with no proposals and no record of a try show no line rather than a wrong one.
- **AppApi** (`shared/api.ts`): no new methods. Apply reuses `updateChapter` (goal) and `updateChapterCard`
  (`totalWords`), both already used by the Plan hub.
- **Plan update** (`main/planHub/update.ts`): returns `{ sceneId, card }` pairs, not a bare list.

## UI changes

- **Outcome line** under each chat answer: one line, Inter, small, muted text plus the state word in amber (waiting)
  or green (applied). Never red unless a change failed. No layout shift: the line's space is kept while the answer
  streams.
- **Proposal card**: amber "Waiting: press Apply" label on waiting cards; "Started" for drafts in progress.
- **Plan talk**: "Make this change in the story" button when a request reaches past the suggestions.
- **Scene card panel**: shows an applied change at once.
- All words in Adam's words (scene, chapter, card, plan; never "proposal", "entity", "LLM").

## Edge cases

1. The AI proposes a change for scene 4 and says it changed scenes 4 and 5 → the outcome line says 1 change
   waiting; the words about scene 5 are put right.
2. The AI says "Done." and stops to ask Adam a question → still checked and put right.
3. Adam presses Stop just after "I've updated the chapter card" streams in → the saved answer is put right.
4. Adam has typed in the scene card's Mood field, unsaved, and applies a goal change from the chat → both the
   typing and the new goal are kept.
5. Adam applies a change, then the AI says in its next answer "as I changed earlier" → checked against the
   recorded outcome: true only because it was applied.
6. Plan talk sends changes whose tags are all wrong → "Nothing was changed: the parts it named aren't in the plan."
7. A chapter card change while Write the chapter holds that chapter → turned down: "Write the chapter is working on
   this chapter. Apply it when it's done."
8. The card changed (by Adam) between the proposal and Apply → Apply shows what it says now and doesn't overwrite.
9. Update the plan when a scene was written in between → each card still lands on its own scene; the written scene
   is skipped and the toast says so.
10. A quoted line from the story ("'I've changed,' she said") → never counted as a claim (kept from today's check).
11. An old chat saved before this change → shows its answers with no outcome line, never a wrong one.

## Testing criteria

### Happy path
- Ask: "Change chapter 3's goal to …" with a scripted model that proposes it → card waits, outcome line "1 change is
  waiting", Apply → chapter page shows the goal, line turns "Applied", Undo puts it back.
- Ask: scene card change applied with the scene card panel open → panel shows it; typing in another field keeps it.
- Plan talk: a valid change → preview with chips, outcome line "waiting", Apply → suggestions changed.

### Edge cases
- `shared/askTruth.test.ts`: every wording in R3's list caught; every exemption in today's controls still exempt;
  the target-match cases; backed claims reworded as waiting.
- `ai/tasks.agent.test.ts`: settle runs after Stop, after `ask_user`, and on the periodic save.
- `planTalk` tests: all-lost changes, unreadable reply, nudges exhausted → outcome "Nothing was changed" and the
  claim put right.
- SceneCardPanel test: applied change shown, unsaved typing merged, never overwritten.
- `applyProposal.test.ts`: started vs applied, empty reason, chapter hold, changed-since.
- Update the plan test: a scene written in between, fewer cards back.
- Chat eval (`npm run chat-eval`): a new "plan requests" set (scene card, chapter goal, chapter length, chapter card,
  move a scene, reorder) for every fake model; "Truth check" rows all 0; Plan talk gets its own eval rows.
- E2E (`tests/e2e/editorChat.spec.ts`, a new `planTalk.spec.ts`): the outcome line on screen for each state, with
  fake/claims-stubborn and a new fake that sends wrong tags to Plan talk.

## Dependencies

- Today's truth check (`shared/askTruth.ts`, `ask/agent.ts` recheck/settle, `ai/tasks.ts`) and its tests.
- The fake providers (`tests/fake-provider/`), the chat eval (`tests/chat-eval/`).
- Chapter goal and length APIs used by the Plan hub (`features/planHub/ChapterPlanPanel.tsx`).
- No live model test without a key from Adam; when one is given, DeepSeek Flash only.

## Gate 1

- [x] Problem clearly stated
- [x] Goal specific and measurable (eval rows = 0; changes stay applied)
- [x] User stories
- [x] Must-have / nice-to-have / out of scope
- [x] Data model: no migration (statuses already saved), old records handled
- [x] API: reuses existing calls; one possible addition named
- [x] Edge cases (11)
- [x] Testing: happy path and edge cases
- [x] Dependencies
