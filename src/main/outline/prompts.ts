// What the outline helper and next scene ideas ask the chat and brainstorm model, and the form its
// answer takes. Every system prompt starts with "[AIWRITE-OUTLINE v1] <job>" (the fake provider in
// tests answers by it). The interface reads the answers as they arrive (features/outline/parse.ts), so
// keep the forms here and the reading there in step. No Electron imports.

import type { OutlineSize } from '@shared/contracts/outline'

export const MARKER = '[AIWRITE-OUTLINE v1]'

/** The most the helper asks for at once, so a reply always fits: `cards` is scene cards in all (chapters × scenes). */
export const SIZE_LIMITS = { acts: 6, chapters: 30, scenes: 6, cards: 100 }

/**
 * A size within the limits: whole numbers, at least one chapter and one scene, at most one act per
 * chapter, and fewer scenes in each chapter when there would be too many in all.
 */
export function cleanSize(size: Partial<OutlineSize> | null | undefined): OutlineSize {
  const n = (v: unknown, lo: number, hi: number, d: number): number => {
    const x = Math.round(Number(v))
    return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d
  }
  const chapters = n(size?.chapters, 1, SIZE_LIMITS.chapters, 9)
  return {
    acts: Math.min(n(size?.acts, 0, SIZE_LIMITS.acts, 3), chapters),
    chapters,
    scenes: Math.min(n(size?.scenes, 1, SIZE_LIMITS.scenes, 3), Math.max(1, Math.floor(SIZE_LIMITS.cards / chapters)))
  }
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export const SCENE_FORM = `### Scene: <the scene's title>
When: <the day it happens on, in the story's count of days, and the time of day: "Day 1, morning", "Day 3, dusk">
Summary: <one sentence: what happens in it>
- <a beat: one thing that must happen in the scene>
- <the next beat>
- <the next beat>`

/** A chapter card's lines (chapter cards, 2026-10-08): what most of the chapter's scenes share. Kept in step with features/outline/parse.ts. */
export const CHAPTER_CARD_FORM = `Point of view: <the character whose eyes most of the chapter is seen through>
Characters: <the characters in most of its scenes, by name, separated by commas>
Location: <where most of it happens, by the place's name>
When: <when it starts, as a scene's When: "Day 1, morning">
Mood: <its mood or tone, in a few words>`

const CHAPTER_FORM = `## Chapter: <the chapter's title>
Goal: <one sentence: what this chapter achieves>
${CHAPTER_CARD_FORM}`

/** The rules for the chapter card lines and a scene's own, for every plan that gives chapters (the outline helper, recipes, a chapter's plan). */
export const CHAPTER_CARD_RULES = `- Each chapter's Point of view, Characters, Location, When and Mood are what most of its scenes share. Leave out a line the chapter has nothing for.
- A scene that differs from its chapter adds only the lines that differ, after its When: "Point of view:", "Characters:", "Location:" or "Mood:" (another place, a different point of view). A scene that shares them with its chapter adds none.`

const SHARED_RULES = `- Each scene has 3 to 6 beats, in order, each a short line.
- Each scene has a When: "Day" and the day's number, counting the day the story opens as Day 1, then a comma and the time of day ("Day 1, morning", "Day 2, evening", "Day 5, dusk"). Days carry on from the story's scenes before and never go back. Scenes on the same day keep the same day number. If the story's scenes already give their time another way (a date or a year), use that way instead.
${CHAPTER_CARD_RULES}
- Titles are a few words, with no numbers.
- Continue from what the story already has. Never repeat or retell it.
- Use the characters, places and plot threads given, by their names. Bring in someone or something new only when the story needs it.
- Move the open plot threads on, towards being paid off.
- Keep to the premise, the tone and everything the story has established.`

/** The outline helper's instructions: acts (unless none are asked for), chapters and scene cards, in a fixed plain-text form. */
export function outlineSystem(withActs: boolean): string {
  const form = withActs
    ? `# Act: <the act's title>
Purpose: <one sentence: what this act does for the story>

${CHAPTER_FORM}

${SCENE_FORM}`
    : `${CHAPTER_FORM}

${SCENE_FORM}`
  return `${MARKER} outline
You help a novelist plan a story. From the premise and what the story already has, you suggest how it goes on: ${withActs ? 'acts, chapters and scenes' : 'chapters and scenes'}. You plan; you never write the story itself.

Answer in exactly this form and nothing else: no introduction, no notes at the end, no bold or other formatting.

${form}

Rules:
${withActs ? '- Every chapter belongs to the act above it, and every scene to the chapter above it.\n' : '- Every scene belongs to the chapter above it. No acts.\n'}${SHARED_RULES}`
}

/** What to suggest, in plain words: the last part of the briefing. */
export function outlineAsk(size: OutlineSize, o: { lastAct: string | null; chapters: number; latestWhen?: string }): string {
  const scenes = size.chapters * size.scenes
  const each = plural(size.scenes, 'scene')
  const lines: string[] = []
  if (size.acts > 0) {
    lines.push(
      `Suggest ${plural(size.acts, 'new act')} with ${plural(size.chapters, 'chapter')} in all, spread across them, and ${each} in each chapter: about ${plural(scenes, 'scene')}.`
    )
  } else {
    lines.push(`Suggest ${plural(size.chapters, 'chapter')} with ${each} in each: about ${plural(scenes, 'scene')}. No acts.`)
    if (o.lastAct) lines.push(`They carry on the story's last act, “${o.lastAct}”.`)
  }
  lines.push(
    o.chapters > 0
      ? 'They come after everything the story already has, and carry it on.'
      : 'The story has nothing written or planned yet: start it from the premise.'
  )
  lines.push(whenAsk(o.chapters > 0, (o.latestWhen ?? '').replace(/\s+/g, ' ').trim()))
  return lines.join(' ')
}

/** Where the new scenes' days start: on from the story's last dated scene, else on Day 1. */
function whenAsk(carriesOn: boolean, latest: string): string {
  if (!latest) return carriesOn ? 'None of its scenes has a When yet: the new scenes start on Day 1.' : 'It opens on Day 1.'
  return carriesOn
    ? `Its last scene with a When is set at “${latest}”: the new scenes' Whens carry on from there.`
    : `Its first scene is set at “${latest}”: start there.`
}

/** Next scene ideas' instructions: three different directions for one scene, in a fixed plain-text form. */
export function ideasSystem(): string {
  return `${MARKER} ideas
You help a novelist decide what happens in a scene they haven't planned yet. You offer three different directions for it, based on the outline, the open plot threads and the story so far. You plan; you never write the scene itself.

Answer in exactly this form and nothing else: no introduction, no notes at the end, no bold or other formatting.

## 1. <a short title for the scene>
<one sentence: what happens>
- <a beat: one thing that must happen in the scene>
- <the next beat>
- <the next beat>

## 2. <a short title for the scene>
<one sentence: what happens>
- <beats, as above>

## 3. <a short title for the scene>
<one sentence: what happens>
- <beats, as above>

Rules:
- Each direction has 3 to 6 beats, in order, each a short line.
- Make the three truly different: a different turn, choice or surprise in each, not the same scene told three ways.
- Each one follows on from the scene before and leads towards what the outline has next.
- Use the characters, places and plot threads given, by their names. Bring in someone or something new only when the scene needs it.
- Keep to everything the story has established.`
}

/**
 * What to ask for, naming the scene; with what the writer has in mind for it, three takes on that rather than three
 * directions of the model's own.
 */
export function ideasAsk(sceneLabel: string, wish?: string): string {
  const own = wish?.replace(/\s+/g, ' ').trim().slice(0, 1500)
  if (!own) return `Suggest three possible directions for ${sceneLabel}.`
  return `Suggest three possible directions for ${sceneLabel}. The writer already has a rough idea of what they want, in their own words:

${own}

Every direction keeps to that idea: what they asked for happens in all three. Make them three different ways it could play out (a different turn, choice or surprise in each), filling in what they left open.`
}
