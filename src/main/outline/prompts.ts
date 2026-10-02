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

const SCENE_FORM = `### Scene: <the scene's title>
Summary: <one sentence: what happens in it>
- <a beat: one thing that must happen in the scene>
- <the next beat>
- <the next beat>`

const CHAPTER_FORM = `## Chapter: <the chapter's title>
Goal: <one sentence: what this chapter achieves>`

const SHARED_RULES = `- Each scene has 3 to 6 beats, in order, each a short line.
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
export function outlineAsk(size: OutlineSize, o: { lastAct: string | null; chapters: number }): string {
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
  return lines.join(' ')
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

/** What to ask for, naming the scene. */
export function ideasAsk(sceneLabel: string): string {
  return `Suggest three possible directions for ${sceneLabel}.`
}
