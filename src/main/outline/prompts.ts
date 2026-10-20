// What the outline helper and next scene ideas ask the chat and brainstorm model, and the form its
// answer takes. Every system prompt starts with "[AIWRITE-OUTLINE v1] <job>" (the fake provider in
// tests answers by it). The interface reads the answers as they arrive (features/outline/parse.ts), so
// keep the forms here and the reading there in step. Since 2026-10-08 (the AI manages plot threads) an outline's scenes
// say which plot threads they set up and pay off ("Sets up:", "Pays off:"); keeping a scene puts them on its card
// (outline/structure.ts), making any new thread it names. No Electron imports.

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
Sets up: <the plot threads this scene opens, by name, separated by semicolons; leave this line out when it opens none>
Pays off: <the plot threads this scene resolves, by name, separated by semicolons; leave this line out when it resolves none>
- <a beat: one thing that must happen in the scene>
- <the next beat>
- <the next beat>`

/** A chapter card's lines (chapter cards, 2026-10-08): what most of the chapter's scenes share. Kept in step with features/outline/parse.ts. */
export const CHAPTER_CARD_FORM = `Point of view: <the character whose eyes most of the chapter is seen through>
Characters: <the characters in most of its scenes, by name, separated by commas>
Location: <where most of it happens, by the place's name; a room or spot inside a bigger place as "room, place": "Kitchen, Venn House">
When: <when it starts, as a scene's When: "Day 1, morning">
Mood: <its mood or tone, in a few words>`

const CHAPTER_FORM = `## Chapter: <the chapter's title>
Goal: <one sentence: what this chapter achieves>
${CHAPTER_CARD_FORM}`

/** The rules for the chapter card lines and a scene's own, for every plan that gives chapters (the outline helper, recipes, a chapter's plan). */
export const CHAPTER_CARD_RULES = `- Each chapter's Point of view, Characters, Location, When and Mood are what most of its scenes share. Leave out a line the chapter has nothing for.
- A scene that differs from its chapter adds only the lines that differ, after its When: "Point of view:", "Characters:", "Location:" or "Mood:" (another place, a different point of view). A scene that shares them with its chapter adds none.`

/** The rules for a scene's "Sets up" and "Pays off" lines, for every plan with scenes (the outline helper, recipes). */
export const THREAD_RULES = `- Move the open plot threads on, towards being paid off. Plan where each is paid off: name it on the "Pays off" line of the scene that answers it (it may stay open past these scenes when the story needs it to).
- A new plot thread (a question, promise, threat or secret the story will answer) goes on the "Sets up" line of the scene that opens it, named in a few words, and is paid off in a later scene or left open for later. Never pay off a thread before the scene that sets it up.`

const SHARED_RULES = `- Each scene has 3 to 6 beats, in order, each a short line.
- Each scene has a When: "Day" and the day's number, counting the day the story opens as Day 1, then a comma and the time of day ("Day 1, morning", "Day 2, evening", "Day 5, dusk"). Days carry on from the story's scenes before and never go back. Scenes on the same day keep the same day number. If the story's scenes already give their time another way (a date or a year), use that way instead.
${CHAPTER_CARD_RULES}
- Titles are a few words, with no numbers.
- Continue from what the story already has. Never repeat or retell it.
- Use the characters, places and plot threads given, by their names. Bring in someone or something new only when the story needs it.
${THREAD_RULES}
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

// ---------- The outline in stages (2026-10-19) ----------

/** The most acts and chapters one stage asks for, and the most scenes a chapter's stage may give. */
export const STAGE_LIMITS = { acts: 6, chapters: 60, actChapters: 15, scenes: 8 }

/** An act's lines in the acts stage: its purpose and about how many chapters it needs (read by features/outline/parse.ts). */
const ACT_STAGE_FORM = `# Act: <the act's title>
Purpose: <one or two sentences: what happens in this act and what it does for the story>
Chapters: <about how many chapters it needs, as a number>`

const STAGE_SHARED = `- Titles are a few words, with no numbers.
- Continue from what the story already has. Never repeat or retell it.
- Use the characters, places and plot threads given, by their names. Bring in someone or something new only when the story needs it.
- Keep to the premise, the tone and everything the story has established.`

const SCENE_RULES = `- Each scene has 3 to 6 beats, in order, each a short line.
- Each scene has a When: "Day" and the day's number, counting the day the story opens as Day 1, then a comma and the time of day ("Day 1, morning", "Day 3, dusk"). Days carry on from the scenes before it and never go back. If the story's scenes already give their time another way (a date or a year), use that way instead.`

/** What a stage of the outline is about, in its system prompt's first line. */
export type StageLevel = 'acts' | 'chapters' | 'scenes' | 'scene'

/**
 * One stage's instructions (marker "stage <level>"): only that level's headings, so each reply is small. `extra`: rules
 * a caller adds (the Story builder's "what wins"); `withPremise`: a "Premise:" line first (a story with none).
 */
export function stageSystem(level: StageLevel, o: { withActs?: boolean; extra?: string[]; withPremise?: boolean } = {}): string {
  const premise = o.withPremise ? 'Premise: <two or three sentences: what the story is about>\n\n' : ''
  const extra = (o.extra ?? []).map((r) => `- ${r}`).join('\n')
  const rules = (lines: string): string => `Rules:\n${extra ? `${extra}\n` : ''}${lines}`
  const head = (what: string, form: string): string => `${MARKER} stage ${level}
You help a novelist plan a story a step at a time. ${what} You plan; you never write the story itself.

Answer in exactly this form and nothing else: no introduction, no notes at the end, no bold or other formatting.

${premise}${form}`
  if (level === 'acts') {
    return `${head('Now you suggest only its acts: what each does for the story, and about how many chapters it needs. Its chapters and scenes are planned later, an act at a time.', ACT_STAGE_FORM)}

${rules(`- Only acts: no chapters and no scenes.
- The acts tell the whole story from beginning to end (or, when the story has parts already, how it goes on from them), each building on the one before.
- Give each act's rough number of chapters on its "Chapters:" line, so they add up to about the number asked for.
${STAGE_SHARED}`)}`
  }
  if (level === 'chapters') {
    return `${head(
      o.withActs === false
        ? 'Now you suggest only chapters, each with its goal and its card. Their scenes are planned later, a chapter at a time.'
        : 'Now you suggest the chapters of one act, each with its goal and its card. Their scenes are planned later, a chapter at a time.',
      CHAPTER_FORM
    )}

${rules(`- Only chapters: no act headings and no scenes.
- They come in order and carry the story on: ${o.withActs === false ? 'after what the story already has.' : 'they do what the act is for, after its chapters so far (if it has any), and lead into the act after it.'}
${CHAPTER_CARD_RULES}
${STAGE_SHARED}`)}`
  }
  if (level === 'scenes') {
    return `${head('Now you suggest the scenes of one chapter: as many as it needs, each a scene card.', SCENE_FORM)}

${rules(`- Only scenes: no act or chapter headings.
- As many scenes as the chapter needs to do what it is for: usually 2 to 6, never more than ${STAGE_LIMITS.scenes}. A short chapter may need one or two; a big one more.
- They come after the chapter's scenes so far (if it has any), carry on from them and never repeat them, and lead into the chapter after it.
${SCENE_RULES}
${CHAPTER_CARD_RULES}
${THREAD_RULES}
${STAGE_SHARED}`)}`
  }
  return `${head('Now you plan one scene that has nothing on its card yet: one scene card, fitting the scenes around it.', SCENE_FORM)}

${rules(`- Exactly one scene card: no act or chapter headings.
- Keep its title when it has one of its own; else give it a title.
- Keep to what its card already says (who is in it, where, when), and fit it between the scene before and the scene after.
${SCENE_RULES}
- Add "Point of view:", "Characters:", "Location:" or "Mood:" lines after its When for what its card doesn't say yet.
${THREAD_RULES}
${STAGE_SHARED}`)}`
}

/**
 * The Plan hub (2026-10-20): the title of the block that carries Adam's own words for what happens next (and the plot
 * threads he asked to bring back), sent just before what is asked.
 */
export const DIRECTION_TITLE = 'What the author wants (make it happen)'

/** The rule every Plan hub request adds when it carries Adam's words: they win. */
export const DIRECTION_RULE = 'What the author wants comes first: make every part of it happen in what you plan, in the order they give.'

/**
 * "Update the plan" (the Plan hub, 2026-10-20): planned scene cards the story has moved on from, written again so they fit
 * what has been written. One card for each scene given, in order, in the scene form.
 */
export function planUpdateSystem(): string {
  return `${MARKER} update
You help a novelist keep the plan of their story in step with what they have written. Some planned scene cards, not written yet, no longer fit the story as written; for each one you are told what no longer fits. Write each of those scene cards again so it fits, keeping as much of its plan as still works. You plan; you never write the story itself.

Answer in exactly this form and nothing else: no introduction, no notes at the end, no bold or other formatting. One card for each scene given, in the same order:

${SCENE_FORM}

Rules:
- Exactly one scene card for each scene given, in the order given, each under its own "### Scene:" heading.
- Put right what each note says no longer fits, and whatever has to change with it. Keep everything else as it was, word for word where you can, and keep its title unless the note makes it wrong.
- Each scene keeps its place in the story: it follows what has been written and leads into what comes after it.
${SCENE_RULES}
${STAGE_SHARED}`
}

/** Where the story stands, for the first stage: carrying on from it, or starting from the premise. */
export function stageStart(o: { chapters: number; lastAct: string | null; newActs: boolean }): string {
  if (o.chapters <= 0) return 'The story has nothing written or planned yet: start it from the premise.'
  if (!o.newActs && o.lastAct) return `They carry on the story's last act, “${o.lastAct}”, after everything the story already has.`
  return 'They come after everything the story already has, and carry it on.'
}

/** What a stage asks for, in plain words: the last part of its briefing. */
export function stageAsk(
  level: StageLevel,
  o: {
    acts?: number
    chapters?: number
    title?: string
    kept?: boolean
    start?: string
    latestWhen?: string
    sceneLabel?: string
    /**
     * The Plan hub (2026-10-20): what the new parts come after, in words ("“The ferry” (Ch 4, Sc 2), the last scene
     * written"): scenes carry on from that scene, chapters from that chapter, rather than from the end.
     */
    after?: string
    /** scenes: exactly this many. */
    count?: number
  }
): string {
  const title = (o.title ?? '').replace(/\s+/g, ' ').trim()
  const latest = (o.latestWhen ?? '').replace(/\s+/g, ' ').trim()
  const days = latest ? ` The story's last scene with a When is set at “${latest}”: carry the days on from the outline around them.` : ''
  const after = (o.after ?? '').replace(/\s+/g, ' ').trim()
  if (level === 'acts') {
    const acts = Math.max(1, o.acts ?? 3)
    const chapters = Math.max(acts, o.chapters ?? acts * 4)
    return `Suggest ${plural(acts, 'act')}, with about ${plural(chapters, 'chapter')} in all across them. Only the acts, each with its purpose and its rough number of chapters. ${o.start ?? ''}`.trim()
  }
  if (level === 'chapters') {
    const n = Math.max(1, o.chapters ?? 3)
    if (!title) return `Suggest ${plural(n, 'chapter')}, each with its goal and card. No acts and no scenes. ${o.start ?? ''}`.trim() + days
    if (after)
      return `Suggest the chapters of the act “${title}”${o.kept ? ' (it is in the story already)' : ''} that come after ${after}, to the end of the act: about ${plural(n, 'chapter')}, each with its goal and card. No scenes yet. Carry on from where the story has got to; never retell it.${days}`
    return `Suggest the chapters of the act “${title}”${o.kept ? ' (it is in the story already)' : ''}: about ${plural(n, 'chapter')}, each with its goal and card. No scenes yet.${days}`
  }
  if (level === 'scenes') {
    const where = `the chapter “${title || 'Untitled chapter'}”${o.kept ? ' (it is in the story already)' : ''}`
    if (after && o.count === 1)
      return `Suggest exactly 1 scene of ${where}: the one that comes right after ${after}. It carries on from how that scene ends and never retells it.${days}`
    if (after)
      return `Suggest the scenes of ${where} that come after ${after}: ${o.count ? `exactly ${plural(o.count, 'scene')}` : 'as many as it still needs to do what it is for'}, each a scene card. They carry on from how that scene ends and never retell it.${days}`
    if (o.count) return `Suggest exactly ${plural(o.count, 'scene')} of ${where}, each a scene card.${days}`
    return `Suggest the scenes of ${where}: as many as it needs, each a scene card.${days}`
  }
  return `Plan ${o.sceneLabel || 'this scene'}: one scene card, fitting what its card already says and the scenes around it.`
}

/** Where the new scenes' days start: on from the story's last dated scene, else on Day 1. Recipes ask it too. */
export function whenAsk(carriesOn: boolean, latest: string): string {
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
