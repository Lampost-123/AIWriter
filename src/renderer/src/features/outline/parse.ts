// Reading the outline helper's and next scene ideas' answers as they arrive. The AI is asked for a fixed
// plain-text form (src/main/outline/prompts.ts: "# Act:", "## Chapter:", "### Scene:", "Purpose:",
// "Goal:", "Summary:", "- beat"; ideas as "## 1. Title", a sentence and "- beat" lines), but models
// wander: numbered or bold headings ("**Act 1: The Arrival**"), "Act One —", scenes as list items
// ("- **Scene 1: Docks** — Mara lands."), ideas numbered with no "##", "*" bullets, a chatty first or
// last line, code fences. This reads all of those, line by line, and works on a reply cut off anywhere
// (a stream still arriving, or stopped): the last thing read is simply not complete yet.
// No React, so it is unit-tested.

export interface SuggestedScene {
  /** Stable while the reply grows: "a0c1s2" (act, chapter, scene), or "c1s2" in a reply with no acts. */
  key: string
  title: string
  /** One line on what happens (it goes on the scene card as its goal). */
  summary: string
  beats: string[]
  /** Fully arrived: something after it has started, or the reply has ended. */
  complete: boolean
}

export interface SuggestedChapter {
  key: string
  title: string
  goal: string
  scenes: SuggestedScene[]
  complete: boolean
}

export interface SuggestedAct {
  key: string
  title: string
  purpose: string
  chapters: SuggestedChapter[]
  complete: boolean
}

export interface ParsedOutline {
  acts: SuggestedAct[]
  /** Chapters before any act: all of them, in a reply with no acts. */
  chapters: SuggestedChapter[]
}

export interface SceneIdea {
  title: string
  /** What happens, in a sentence. */
  summary: string
  beats: string[]
  complete: boolean
}

// ---------- Lines ----------

const NUMBER_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty'
]

/** Bold and italic marks, and quotes around the whole of it, taken off. */
function plain(s: string): string {
  let t = s
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s(“"'])[*_](?=\S)/g, '$1')
    .replace(/(\S)[*_](?=$|[\s.,;:!?)”"'])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const quoted = t.match(/^["“'‘](.*)["”'’]$/)
  if (quoted && !/["“”]/.test(quoted[1])) t = quoted[1].trim()
  return t
}

const BULLET = /^\s*(?:[-*•+–—]|\d{1,2}[.)])\s+(.*)$/

/** A heading's number: "1", "One", "IV", or none. */
const NUMBER = `(?:\\d{1,3}|${NUMBER_WORDS.join('|')}|[ivxlc]{1,6}(?=\\s*(?:[:.)\\-–—]|$)))`

type Level = 'act' | 'chapter' | 'scene'

/** A heading's level and title; `text`: a line on the same line after the title (see listedHeading). */
interface Heading {
  level: Level
  title: string
  number: string
  text?: string
}

const HEADING = new RegExp(
  `^(?:#{1,6}\\s*)?(?:\\d{1,2}[.)]\\s+)?(act|part|chapter|scene)\\b\\s*(${NUMBER})?\\s*(?:[:.)\\-–—]\\s*|\\s+|$)(.*)$`,
  'i'
)

/** A heading line ("## Chapter 3 – Rain", "**Act One: The Arrival**"): its level and title. */
function heading(line: string): Heading | null {
  const raw = line.trim()
  // Plain prose that happens to start with "Act" or "Scene" isn't a heading: a heading is marked
  // (#, bold or a number), has a number, or puts a colon or dash after the word.
  const marked = /^#{1,6}\s|^(\*\*|__)/.test(raw)
  const bare = plain(raw.replace(/^#{1,6}\s*/, ''))
  const m = bare.match(HEADING)
  if (!m) return null
  const [, word, number = '', rest] = m
  const separated = /^(?:\d{1,2}[.)]\s+)?(?:act|part|chapter|scene)\b\s*(?:\S+\s*)?[:.)\-–—]/i.test(bare)
  if (!marked && !number && !separated) return null
  const level: Level = /^(act|part)$/i.test(word) ? 'act' : (word.toLowerCase() as Level)
  const title = plain(rest.replace(/^(?:title\s*:\s*)/i, '')).replace(/[:\s]+$/, '')
  return { level, title, number }
}

/**
 * A heading written as a list item ("- **Scene 1: Docks** — Mara lands.", "2. Chapter: Lanterns"). Only
 * when it is clearly one (in bold, numbered, or with a colon or dash straight after the word), as a beat
 * may well start with "Act" or "Scene". What follows the title after a dash or colon is its line: a
 * scene's summary, a chapter's goal, an act's purpose.
 */
function listedHeading(item: string): Heading | null {
  const raw = item.trim()
  const bold = raw.match(/^(\*\*|__)(.+?)\1\s*(.*)$/)
  const h = heading(bold ? `**${bold[2]}**` : raw)
  if (!h) return null
  if (!bold && !h.number && !/^(?:act|part|chapter|scene)\s*[:：—–-]/i.test(plain(raw))) return null
  const after = bold ? plain(bold[3].replace(/^[:：—–-]\s*/, '')) : ''
  return after ? { ...h, text: after } : { ...h, ...splitTitle(h.title) }
}

/** "Docks — Mara lands.": a title and the line after it, split at the first dash or colon with a space after it. */
function splitTitle(s: string): { title: string; text: string } {
  const m = s.match(/^(.+?)(?:\s+[—–-]\s+|\s*[:：]\s+)(.+)$/)
  return m ? { title: plain(m[1]), text: plain(m[2]) } : { title: s, text: '' }
}

/** "Purpose: …", "**Goal:** …", "Summary — …": the label (lower case) and what follows. */
function labelled(line: string): { label: string; text: string } | null {
  const m = plain(line).match(/^(purpose|goal|aim|summary|what happens|beats|logline)\s*[:：—–-]\s*(.*)$/i)
  return m ? { label: m[1].toLowerCase(), text: m[2].trim() } : null
}

const isNoise = (line: string): boolean => /^\s*(```|~~~|---+\s*$|___+\s*$|\*\*\*+\s*$)/.test(line)

/** A short line ending in a colon ("Scenes:") labels what follows; it isn't a summary, goal or purpose. */
const isLabel = (line: string): boolean => {
  const t = plain(line)
  return t.endsWith(':') && t.length <= 40
}

const fallbackTitle = (level: Level, number: string): string => {
  const n = number && /^\d+$/.test(number) ? number : number ? number.charAt(0).toUpperCase() + number.slice(1).toLowerCase() : ''
  const word = level === 'act' ? 'Act' : level === 'chapter' ? 'Chapter' : 'Scene'
  return n ? `${word} ${n}` : ''
}

// ---------- The outline ----------

/**
 * Reads an outline reply, whole or so far. `done`: the reply has ended (complete, stopped or failed),
 * so its last part counts as complete too.
 */
export function parseOutline(text: string, done: boolean): ParsedOutline {
  const out: ParsedOutline = { acts: [], chapters: [] }
  let act: SuggestedAct | null = null
  let chapter: SuggestedChapter | null = null
  let scene: SuggestedScene | null = null
  /** Lines read under the current heading: a first plain line is its summary, goal or purpose. */
  let sawBeat = false
  let inBeats = false

  const closeScene = (): void => {
    if (scene) scene.complete = true
    scene = null
    sawBeat = false
    inBeats = false
  }
  const closeChapter = (): void => {
    closeScene()
    if (chapter) chapter.complete = true
    chapter = null
  }
  const closeAct = (): void => {
    closeChapter()
    if (act) act.complete = true
    act = null
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || isNoise(line)) continue
    const bullet = line.match(BULLET)
    // A list item is a heading only when it is clearly one; otherwise it is a beat.
    const h = bullet ? listedHeading(bullet[1]) : heading(line)
    if (h) {
      const title = h.title || fallbackTitle(h.level, h.number)
      const said = h.text ?? ''
      if (h.level === 'act') {
        closeAct()
        act = { key: `a${out.acts.length}`, title, purpose: said, chapters: [], complete: false }
        out.acts.push(act)
      } else if (h.level === 'chapter') {
        closeChapter()
        const list: SuggestedChapter[] = act ? (act as SuggestedAct).chapters : out.chapters
        const prefix = act ? (act as SuggestedAct).key : ''
        chapter = { key: `${prefix}c${list.length}`, title, goal: said, scenes: [], complete: false }
        list.push(chapter)
      } else {
        closeScene()
        if (!chapter) {
          // A scene before any chapter: it starts one, so it has somewhere to go.
          const list: SuggestedChapter[] = act ? (act as SuggestedAct).chapters : out.chapters
          const prefix = act ? (act as SuggestedAct).key : ''
          chapter = { key: `${prefix}c${list.length}`, title: '', goal: '', scenes: [], complete: false }
          list.push(chapter)
        }
        const c = chapter as SuggestedChapter
        scene = { key: `${c.key}s${c.scenes.length}`, title, summary: said, beats: [], complete: false }
        c.scenes.push(scene)
      }
      continue
    }

    const field = labelled(line)
    const s = scene as SuggestedScene | null
    const c = chapter as SuggestedChapter | null
    const a = act as SuggestedAct | null
    if (s) {
      if (field && (field.label === 'summary' || field.label === 'what happens' || field.label === 'goal' || field.label === 'logline')) {
        if (!s.summary) s.summary = plain(field.text)
        inBeats = false
      } else if (field?.label === 'beats') {
        inBeats = true
        if (field.text)
          s.beats.push(
            ...field.text
              .split(/\s*;\s*/)
              .map(plain)
              .filter(Boolean)
          )
      } else if (bullet) {
        const beat = plain(bullet[1])
        if (beat) s.beats.push(beat)
        sawBeat = true
      } else if (!s.summary && !sawBeat && !inBeats && !isLabel(line)) {
        s.summary = plain(line)
      }
    } else if (c) {
      if (field && (field.label === 'goal' || field.label === 'aim' || field.label === 'summary' || field.label === 'purpose')) {
        if (!c.goal) c.goal = plain(field.text)
      } else if (!bullet && !field && !c.goal && !isLabel(line)) {
        c.goal = plain(line)
      }
    } else if (a) {
      if (field && (field.label === 'purpose' || field.label === 'goal' || field.label === 'aim' || field.label === 'summary')) {
        if (!a.purpose) a.purpose = plain(field.text)
      } else if (!bullet && !field && !a.purpose && !isLabel(line)) {
        a.purpose = plain(line)
      }
    }
    // Anything before the first heading (an introduction) is left out.
  }

  if (done) closeAct()
  // A chapter started by a scene with no chapter heading takes a plain name.
  const name = (list: SuggestedChapter[]): void =>
    list.forEach((ch, i) => {
      if (!ch.title) ch.title = `Chapter ${i + 1}`
    })
  name(out.chapters)
  out.acts.forEach((a) => name(a.chapters))
  return out
}

/** Every scene of a parsed outline, in order. */
export const outlineScenes = (o: ParsedOutline): SuggestedScene[] =>
  [...o.chapters, ...o.acts.flatMap((a) => a.chapters)].flatMap((c) => c.scenes)

/** How many acts, chapters and scenes a parsed outline has. */
export function outlineCounts(o: ParsedOutline): { acts: number; chapters: number; scenes: number } {
  const chapters = [...o.chapters, ...o.acts.flatMap((a) => a.chapters)]
  return { acts: o.acts.length, chapters: chapters.length, scenes: chapters.reduce((n, c) => n + c.scenes.length, 0) }
}

// ---------- Next scene ideas ----------

const IDEA_HEADING = /^(?:#{1,6}\s*)?(?:(?:idea|option|direction|possibility)\s*)?(\d{1,2})?\s*[.):\-–—]?\s*(.*)$/i

/** A line that starts an idea: "## 1. The door", "**2. A debt**", "Option 3: The wrong messenger". */
function ideaHeading(line: string): string | null {
  const raw = line.trim()
  const hashed = /^#{1,6}\s/.test(raw)
  const bold = /^(\*\*|__)/.test(raw) && /(\*\*|__)\s*[:.]?\s*$/.test(raw)
  const worded = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:idea|option|direction|possibility)\s*\d/i.test(raw)
  if (!hashed && !bold && !worded) return null
  const m = plain(raw.replace(/^#{1,6}\s*/, '')).match(IDEA_HEADING)
  if (!m) return null
  return plain(m[2].replace(/^(?:title\s*:\s*)/i, '')).replace(/[:\s]+$/, '')
}

/** "2. A debt called in": a numbered line at the start of the line, its number and the rest. */
const NUMBERED = /^(\d{1,2})[.)]\s+(.*)$/

/** Reads next scene ideas, whole or so far: at most three. */
export function parseIdeas(text: string, done: boolean): SceneIdea[] {
  const ideas: SceneIdea[] = []
  let idea: SceneIdea | null = null
  let sawBeat = false
  /** The number of the open idea's last numbered beat ("2. She doubles back"); 0 if it has none. */
  let beatNumber = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || isNoise(line)) continue
    let title = ideaHeading(line)
    let summary = ''
    // Numbered with no "##" ("1. The door left open"): the next idea's number starts the next idea,
    // unless it carries on the open idea's own numbered beats.
    const numbered = title === null ? line.match(NUMBERED) : null
    if (numbered) {
      const n = Number(numbered[1])
      const nextIdea = n === ideas.length + 1 && (!idea || !!idea.summary || idea.beats.length > 0)
      const carriesOn = !!idea && beatNumber > 0 && n === beatNumber + 1
      if (nextIdea && !carriesOn) {
        const split = splitTitle(plain(numbered[2]))
        title = split.title
        summary = split.text
      }
    }
    if (title !== null) {
      if (idea) idea.complete = true
      idea = { title, summary, beats: [], complete: false }
      ideas.push(idea)
      sawBeat = false
      beatNumber = 0
      continue
    }
    if (!idea) continue
    const field = labelled(line)
    const bullet = line.match(BULLET)
    if (field && field.label !== 'beats') {
      if (!idea.summary) idea.summary = plain(field.text)
    } else if (field?.label === 'beats') {
      if (field.text)
        idea.beats.push(
          ...field.text
            .split(/\s*;\s*/)
            .map(plain)
            .filter(Boolean)
        )
    } else if (bullet) {
      const beat = plain(bullet[1])
      if (beat) idea.beats.push(beat)
      sawBeat = true
      beatNumber = Number(line.match(/^\s*(\d{1,2})[.)]/)?.[1] ?? 0)
    } else if (!idea.summary && !sawBeat && !isLabel(line)) {
      idea.summary = plain(line)
    }
  }
  if (done && idea) idea.complete = true
  return ideas.slice(0, 3).map((i, n) => ({ ...i, title: i.title || `Idea ${n + 1}` }))
}
