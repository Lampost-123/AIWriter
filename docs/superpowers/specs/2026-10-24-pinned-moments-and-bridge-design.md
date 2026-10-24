# Pinned moments and "Bridge the gap" (design, 2026-10-24)

## In plain words

Adam can **pin** a moment the story must reach: the ending, or any planned scene ("Kael burns the crown"). A pinned
moment is never changed by the AI. Between where the story has got to and a pin there is usually a **gap**: chapters
with no scenes, or no chapters at all. **Bridge the gap** asks the AI to plan just that stretch so the story lands on
the pin, as suggestions in their place in the story line, kept or discarded one by one like every other plan.

This is the "Fill gaps" / "To ending" idea from the Story Map mock-ups, built on what Build with AI already has.
Nothing here replaces the story line, Fill in the empty cards, Update the plan or Talk it over.

## What already exists (reuse, don't rebuild)

| Mock-up idea | Already in the app |
|---|---|
| Suggestions as cards with Keep / Change / Redo / Discard | The story line's suggestions (`LineSuggestions.tsx`, `HelperRun`) |
| AI fills only empty fields, never overwrites | Fill in the empty cards (`startPlanUpdate` mode `fill`, `planOnCard`) |
| Story rules | `StoryBrief.mustHappen` and `avoid` |
| Steer the story box | `direction` on every outline request (`DIRECTION_RULE`) |
| Thread health ("Mira goes quiet") | `PlanHubFacts.threads` (`quiet`), Plan its payoff |
| Re-project after changes | Update the plan (`planDrift`) |

New: the pin itself, the gap it makes, and one request that plans the gap towards the pin.

## Data

No migration. Pins live in the world's meta table, like chapter cards (`chapter_card:<id>`).

```ts
// src/shared/types.ts (additive)

/** A moment the story must reach (2026-10-24). The AI plans towards it and never changes it. */
export interface PinnedMoment {
  id: ID
  storyId: ID
  /** A planned scene that is pinned (its card is the moment), or null for a moment with no scene yet. */
  sceneId: ID | null
  /** The moment in Adam's words. For a pinned scene, '' (its card says it). */
  text: string
  /** Where a moment with no scene sits: the story's end, or the end of a chapter. Ignored when sceneId is set. */
  at: { kind: 'end' } | { kind: 'chapter'; chapterId: ID }
  createdAt: string
}
```

Stored as `story_pins:<storyId>` → `PinnedMoment[]` (at most 6; a story rarely needs more).

Rules:

- A pinned scene's card is locked to the AI: every outline, fill and update job leaves it as it is, the same way a
  card part Adam wrote is never overwritten. Adam can still edit it himself.
- Deleting a pinned scene removes its pin (announced with the scene's own Undo).
- Writing a pinned scene (it gets words) keeps the pin until Adam unpins it; it no longer makes a gap.

## The gap

Worked out with no AI call, in `planHub/facts.ts`, added to `PlanHubFacts`:

```ts
// src/shared/contracts/planHub.ts (additive)

export interface HubGap {
  pinId: ID
  /** "Kael burns the crown" (the pin's text, else its scene's title or goal). */
  pinLabel: string
  /** The last scene before the gap that has a card (written or planned), null at the story's start. */
  fromSceneId: ID | null
  /** Chapters between that scene and the pin with no scenes, or only empty cards. */
  emptyChapterIds: ID[]
  /** True when there are no chapters between them at all: the bridge must make some. */
  needsChapters: boolean
}

// in PlanHubFacts
gaps: HubGap[]
```

A gap exists when the pin is not the very next thing after `fromSceneId`. The nearest pin ahead of YOU ARE HERE comes
first.

## The request

One new outline stage, so it streams through the same task runner and parser as every other plan:

```ts
// src/shared/contracts/outline.ts (additive)

export interface BridgeRequest {
  taskId: ID
  storyId: ID
  pinId: ID
  /** About how many chapters the bridge may use. Left out: the AI chooses, 1 to 6. */
  chapters?: number
  /** Adam's words and ticked threads, as on every hub request. */
  direction?: string
}

// OutlineApi
startBridge(input: BridgeRequest): Promise<{ generationId: ID }>
```

Main side: `src/main/outline/bridge.ts`, job `outline`, the chat model (`jobModel('chat')`), marker
`[AIWRITE-OUTLINE v1] bridge`. It reads what the plan already reads (`briefMaterial`: the chapters so far in short, the
scene before word for word up to 2,000 words), never the whole book.

## The prompt

System:

```
[AIWRITE-OUTLINE v1] bridge
You plan the stretch of a story between where it has got to and a moment the author has pinned. The pinned moment is
fixed: plan everything before it so that it can happen exactly as written, and plan nothing after it.

${CHAPTER_CARD_RULES}
${THREAD_RULES}
- Every chapter you plan moves the story closer to the pinned moment. Don't reach it early, and don't stall: no
  chapter that only repeats what the one before did.
- Your last scene leaves everyone and everything where the pinned moment needs them: who is there, where, what they
  know and what they have.
- The plot threads the pinned moment pays off are set up before it, if they aren't already.
- Keep to the author's rules: what must happen, and what must never happen.
- Use the chapters given to you to plan inside (they keep their titles); add new chapters only where there are none.

Answer in this form, and nothing else:

${CHAPTER_FORM}

${SCENE_FORM}
```

User message, in this order (cacheable parts first, as `cacheUpTo` does for the plan):

```
## The story so far, chapter by chapter, in short
<briefMaterial chapters>

## Where the story has got to
<the last scene with a card: "Ch 6, Sc 1: Mira learns the truth", its gist, then its last 2,000 words if written>

## The pinned moment (fixed: plan towards it)
<the pin's text, or its scene's whole card in the scene form>
Where it is: <"the end of the story" | "the end of Ch 11: The Ashen Throne">

## The chapters to plan inside
<each empty chapter in the chapter form, ending "(plan this one)"; or "None yet: plan about N chapters.">

## Open plot threads
<PlanHubFacts.threads: name, since when, how quiet>

## The author's rules
Must happen: <brief.mustHappen>
Must never happen: <brief.avoid>

## What the author wants (make it happen)
<direction, when there is one>
```

The reply is the existing chapter and scene form, so `features/outline/parse.ts` reads it with no change. Planned
chapters come before the pin (`HelperRun.place` is the pin's chapter, or `end`), and Keep puts them there.

## On screen

- **Pin it** on a planned scene's ⋯ menu and on the scene's own page; **Pin the ending** under the story line's last
  row (a box: "How does your story end?"). A pinned scene shows a small pin and "The AI plans towards this".
- In the story line, a gap shows as one quiet row between the last planned scene and the pin: "Nothing planned
  between here and *Kael burns the crown*", with **Bridge the gap**. It uses the hub's box and ticked threads, like
  **Plan it**.
- Its suggestions arrive in the gap's place, under the usual batch head. Nothing goes in without Keep; Undo takes it
  back out.

## Not in this step

These mock-ups come later and reuse the pins and gaps:

- The plot-thread timeline with the tension line (a view of `PlanHubFacts.threads` and the scenes' Sets up / Pays off).
- What-if branches (three bridges to the same pin, side by side).

## Tests

- `planHub/facts.test.ts`: gaps for a pinned ending with no chapters, a pinned scene after empty chapters, a pin with
  no gap, a written pin.
- `outline/bridge.test.ts`: the prompt's parts and order; the pinned card is in it word for word; Adam's rules and
  direction are there.
- Pinned cards are never changed by `fill` and `update` (`update.test.ts`).
- The fake provider answers `[AIWRITE-OUTLINE v1] bridge` (`tests/fake-provider/m4/outline.mjs`).
- `tests/e2e/planHub.spec.ts`: pin the ending, Bridge the gap, keep two chapters, Undo.
