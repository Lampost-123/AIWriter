// What the Recipe maker is asked, and the form of its answers. Every system prompt starts with
// "[AIWRITE-RECIPE v1] <step>" (the fake provider in tests answers by it):
//   chapter  notes on one chapter (or one piece of a long chapter): moves, roles, tension, tone, devices, style
//   combine  the recipe itself, from every chapter's notes and the pacing figures counted in code
//   fix      the parts of a recipe that still name the story's people or places or copy its words, rewritten
//   story    a new story's premise, acts, chapters and scene cards from a recipe and Adam's guidance (the outline
//            helper's form, read by features/outline/parse.ts, after a "Premise:" line)
// The recipe comes back as plain text under "## <Part>" headings (parse.ts), which reads well as it streams and
// survives a model that wanders. No Electron imports.

import type { OutlineSize } from '@shared/contracts/outline'
import type { RecipePartId, RecipeParts } from '@shared/contracts/recipes'
import { feelChoices } from './feel'

export const MARKER = '[AIWRITE-RECIPE v1]'

/** The headings the recipe is written under, in order. */
export const PART_HEADINGS: Record<RecipePartId, string> = {
  themes: 'Themes',
  tone: 'Tone',
  pov: 'Point of view',
  tense: 'Tense',
  style: 'Writing style',
  sample: 'Sample passage',
  shape: 'Shape',
  beats: 'Beats',
  cast: 'Cast roles',
  pacing: 'Pacing',
  devices: 'Devices',
  feel: 'Genre and content'
}

const NEVER = `Never use the story's names: not its people, places, ships, houses, groups, titles or invented words. Call characters by the part they play ("the mentor", "the rival", "the lead's sister") and places by what they are ("a port city", "the family farm"). Never quote the story or copy its sentences or phrases: describe in your own words.`

export function chapterSystem(): string {
  return `${MARKER} chapter
You help a novelist study how a story is built, so they can write a different story of their own with the same craft. You read one chapter and take notes on how it works. You never retell the story's particulars.

${NEVER}

Answer in exactly this form and nothing else:

Moves:
- <one thing that happens, as a general move anyone could reuse: "the outsider is offered a place and turns it down">
- <the next move>
Roles:
- <a part a character plays here ("the lead", "the mentor"): what they want and do in this chapter>
Tension: <where it rises and falls in the chapter, in a sentence or two>
Tone: <the chapter's tone and mood in a few words>
Devices:
- <a set-up, pay-off, twist, reveal or recurring motif, if any>
Content: <how much romance, violence and swearing the chapter has, and how openly it is shown, in a few words>
Style: <the narrative voice, point of view and tense, sentence rhythm, vocabulary, how much is description, inner thought and dialogue, how its scenes open and close: two to four sentences>`
}

export function chapterAsk(o: {
  chapter: number
  chapters: number
  span: { from: number; to: number }
  words: number
  scenes: number
  dialogue: number
  piece?: { index: number; of: number }
  text: string
}): string {
  const piece = o.piece && o.piece.of > 1 ? ` This is part ${o.piece.index} of ${o.piece.of} of the chapter; take notes on this part only.` : ''
  return `This is chapter ${o.chapter} of ${o.chapters}. It runs from ${o.span.from}% to ${o.span.to}% of the way through the story: ${o.words} words in ${o.scenes} ${o.scenes === 1 ? 'scene' : 'scenes'}, about ${Math.round(o.dialogue * 100)}% of them dialogue.${piece}

## The chapter
${o.text}`
}

export function combineSystem(): string {
  const heads = (Object.keys(PART_HEADINGS) as RecipePartId[]).map((k) => `## ${PART_HEADINGS[k]}`)
  return `${MARKER} combine
You help a novelist turn notes on a story, chapter by chapter, into a recipe: the story's themes, writing style and structure, without its words, so they can plan a new story of their own with the same shape and craft.

${NEVER}

Answer in exactly this form and nothing else (no bold, no notes before or after):

Name: <a short, neutral name for the recipe that says what kind of story it is, such as "A slow-burn mystery in three acts". Never the story's title or names.>

${heads[0]}
<What the story is about underneath. For each theme, a line: how it surfaces and where it is tested. Then each act's tone and mood, a line each.>

${heads[1]}
<The story's tone in a few words.>

${heads[2]}
<The narrative point of view, in a few words.>

${heads[3]}
<The tense, in a word or two.>

${heads[4]}
<The writing style in plain words: the narrative voice, sentence rhythm, vocabulary, how much is description, inner thought and dialogue, and how scenes open and close. A short paragraph or a few lines.>

${heads[5]}
<A passage of about 120 to 180 words that you write fresh in that style: a new moment with new, unnamed characters. Never a scene from the story.>

${heads[6]}
<The acts and chapters with the job each one does, and where the turning points fall as a share of the way through ("the mentor dies at 60%"). One line each.>

${heads[7]}
<The story's events chapter by chapter, rewritten as general moves. One line a chapter: "Chapter 1: the outsider is offered a place and turns it down.">

${heads[8]}
<The parts the characters play (lead, mentor, rival, love interest...), each one's arc, and how they relate to each other. One line a role.>

${heads[9]}
<Chapter and scene lengths, how much is dialogue, where tension rises and falls. Use the figures given.>

${heads[10]}
<Set-ups and pay-offs, twists and recurring motifs. One line each.>

${heads[11]}
<The story's genres and how far its romance, violence and language go, on one line in exactly this form: "Genres: <genre>, <genre>. Romance: <level>. Violence: <level>. Language: <level>." Choose only from these words. ${feelChoices()} Leave a level out when the story gives no sign of it.>`
}

export function combineAsk(o: { chapters: number; words: number; pacing: string; notes: string[] }): string {
  const notes = o.notes.map((n, i) => `### Chapter ${i + 1}\n${n.trim() || '(No notes.)'}`).join('\n\n')
  return `The story has ${o.chapters} ${o.chapters === 1 ? 'chapter' : 'chapters'} and ${o.words} words.

## Pacing figures (counted)
${o.pacing}

## Notes on each chapter
${notes}

Write the recipe.`
}

export function fixSystem(): string {
  return `${MARKER} fix
You help a novelist keep a story recipe free of the original story's words. You rewrite the parts of a recipe you are given so they say the same things without the names and copied words listed. ${NEVER}

Answer with each part you were given under its own "## <Part>" heading, exactly as given, and nothing else.`
}

export function fixAsk(parts: Partial<RecipeParts>, o: { names: string[]; copied: string[] }): string {
  const lines: string[] = []
  if (o.names.length) lines.push(`Leave out these names: ${o.names.join(', ')}.`)
  if (o.copied.length) lines.push(`These words are copied from the story; say it in your own words: ${o.copied.map((c) => `“${c}”`).join('; ')}.`)
  const body = (Object.keys(parts) as RecipePartId[]).map((k) => `## ${PART_HEADINGS[k]}\n${parts[k] ?? ''}`).join('\n\n')
  return `${lines.join('\n')}\n\n${body}`
}

// ---------- A new story from a recipe ----------

const SCENE_FORM = `### Scene: <the scene's title>
When: <the day it happens on, in the story's count of days, and the time of day: "Day 1, morning", "Day 3, dusk">
Summary: <one sentence: what happens in it>
- <a beat: one thing that must happen in the scene>
- <the next beat>
- <the next beat>`

const CHAPTER_FORM = `## Chapter: <the chapter's title>
Goal: <one sentence: what this chapter achieves>`

/** The story's plan: a premise line, then the outline helper's own form (keep it in step with outline/prompts.ts). */
export function storySystem(withActs: boolean): string {
  const form = withActs
    ? `# Act: <the act's title>
Purpose: <one sentence: what this act does for the story>

${CHAPTER_FORM}

${SCENE_FORM}`
    : `${CHAPTER_FORM}

${SCENE_FORM}`
  return `${MARKER} story
You help a novelist plan a new story of their own from a story recipe: the shape, beats, cast roles, pacing, themes and devices of a story they admire. Follow the recipe's shape and pacing, but tell an entirely new story through the novelist's own guidance and world. Where the guidance differs from the recipe, the guidance wins. Give the cast roles new characters of their own (or the world's characters, when they fit), with new names.

Answer in exactly this form and nothing else: no introduction, no notes at the end, no bold or other formatting.

Premise: <two or three sentences: what the new story is about>

${form}

Rules:
${withActs ? '- Every chapter belongs to the act above it, and every scene to the chapter above it.\n' : '- Every scene belongs to the chapter above it. No acts.\n'}- Each scene has 3 to 6 beats, in order, each a short line.
- Each scene has a When: "Day" and the day's number, counting the day the story opens as Day 1, then a comma and the time of day. Days never go back.
- Titles are a few words, with no numbers.
- Put the recipe's turning points at about the same share of the way through.
- Use the characters, places and lore given, by their names, when they fit the guidance.`
}

export function storyAsk(size: OutlineSize): string {
  const n = (k: number, one: string): string => `${k} ${k === 1 ? one : `${one}s`}`
  const each = n(size.scenes, 'scene')
  return size.acts > 0
    ? `Plan the new story: the premise, then ${n(size.acts, 'act')} with ${n(size.chapters, 'chapter')} in all, spread across them, and ${each} in each chapter. It opens on Day 1.`
    : `Plan the new story: the premise, then ${n(size.chapters, 'chapter')} with ${each} in each. No acts. It opens on Day 1.`
}

/** The recipe as the story's plan is told it (its writing style goes to the style guide instead). */
export function recipeText(p: RecipeParts): string {
  const parts: RecipePartId[] = ['themes', 'tone', 'feel', 'shape', 'beats', 'cast', 'pacing', 'devices']
  return parts
    .filter((k) => p[k].trim())
    .map((k) => `### ${PART_HEADINGS[k]}\n${p[k].trim()}`)
    .join('\n\n')
}
