// The AI planning pages' small rules, without React (unit-tested in planLogic.test.ts): which pieces of streaming text
// are still fading in, where each page's steps stand, and how far apart cards dealt in together land.

// ---------- Words fading in ----------

/** What FreshText remembers between drawings: the text it showed, and the pieces still fading in (where each starts, and since when). */
export interface Fresh {
  text: string
  marks: { start: number; at: number }[]
}

/** How long a piece keeps its fade mark (the fade itself is 160ms). */
export const FRESH_MS = 220

export interface FreshPart {
  start: number
  text: string
  fresh: boolean
}

/**
 * The text in pieces: what has settled, then each piece still fading in. Only text that grows at its end fades; any other
 * change (a new answer, an edit) shows at once. Not live: all of it plain.
 */
export function freshPieces(prev: Fresh, text: string, live: boolean, now: number): { state: Fresh; parts: FreshPart[] } {
  if (!live || !text.startsWith(prev.text)) return { state: { text, marks: [] }, parts: text ? [{ start: 0, text, fresh: false }] : [] }
  const marks = prev.marks.filter((m) => now - m.at < FRESH_MS && m.start < text.length)
  if (text.length > prev.text.length) marks.push({ start: prev.text.length, at: now })
  const parts: FreshPart[] = []
  const plainEnd = marks[0]?.start ?? text.length
  if (plainEnd > 0) parts.push({ start: 0, text: text.slice(0, plainEnd), fresh: false })
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.start ?? text.length
    if (end > m.start) parts.push({ start: m.start, text: text.slice(m.start, end), fresh: true })
  })
  return { state: { text, marks }, parts }
}

// ---------- Cards dealt in ----------

/** Between two cards dealt in together. */
export const DEAL_STEP_MS = 45
/** No card waits longer than this for its turn. */
export const DEAL_MAX_MS = 360
/** Cards that show within this long of each other are one deal. */
const SAME_DEAL_MS = 34

/**
 * How long a card waits before it is dealt in: cards shown together (a page opening on ten suggestions) land one after
 * another, 45ms apart; a card that arrives on its own (the next suggestion streaming in) lands at once.
 */
export function dealClock(): (now: number) => number {
  let last = -Infinity
  let n = 0
  return (now) => {
    n = now - last <= SAME_DEAL_MS ? n + 1 : 0
    last = now
    return Math.min(n * DEAL_STEP_MS, DEAL_MAX_MS)
  }
}

// ---------- Steps ----------

export type StepState = 'done' | 'now' | 'working' | 'todo'

export interface PlanStep {
  id: string
  label: string
  /** A few words under it: what was chosen, how far it got. */
  sub: string
  state: StepState
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** The outline helper's (and a story planned from a recipe's) steps: what to plan from, how much, the AI's suggestions, and keeping. */
export function suggestSteps(p: {
  /** The premise (the outline helper) or Adam's own ideas (a recipe's plan): written yet. */
  from: { label: string; written: boolean; sub: string }
  /** "About 9 scenes". */
  size: string
  running: boolean
  /** Suggestions that have arrived, and how many are still to decide and were kept. */
  arrived: number
  open: number
  kept: number
}): PlanStep[] {
  const asked = p.running || p.arrived > 0
  return [
    { id: 'from', label: p.from.label, sub: p.from.sub, state: p.from.written ? 'done' : asked ? 'done' : 'now' },
    { id: 'size', label: 'How much', sub: p.size, state: asked ? 'done' : p.from.written ? 'now' : 'todo' },
    {
      id: 'suggest',
      label: 'Suggest',
      sub: p.running ? 'The AI is at work…' : p.arrived ? plural(p.arrived, 'suggestion') : 'Not yet',
      state: p.running ? 'working' : p.arrived ? 'done' : 'todo'
    },
    {
      id: 'keep',
      label: 'Keep',
      sub: p.kept || p.open ? [p.kept ? `${p.kept} kept` : '', p.open ? `${p.open} to decide` : ''].filter(Boolean).join(', ') : 'What you like',
      state: !p.arrived || p.running ? 'todo' : p.open ? 'now' : 'done'
    }
  ]
}

/** Planning a chapter: its goal, the interview, the scene cards, keeping. */
export function chapterSteps(p: { goal: boolean; interview: 'none' | 'open' | 'done'; answered: number; running: boolean; arrived: number; open: number; kept: number }): PlanStep[] {
  const asked = p.running || p.arrived > 0
  return [
    { id: 'goal', label: 'Goal', sub: p.goal ? 'Written' : 'Optional', state: p.goal || asked ? 'done' : 'now' },
    {
      id: 'interview',
      label: 'Interview',
      sub: p.interview === 'open' ? (p.answered ? `${plural(p.answered, 'answer')} so far` : 'Answer a few questions') : p.answered ? plural(p.answered, 'answer') : 'Optional',
      state: p.interview === 'open' ? 'now' : asked || p.answered ? 'done' : p.goal ? 'now' : 'todo'
    },
    {
      id: 'suggest',
      label: 'Scene cards',
      sub: p.running ? 'The AI is at work…' : p.arrived ? plural(p.arrived, 'card') : 'Not yet',
      state: p.running ? 'working' : p.arrived ? 'done' : 'todo'
    },
    {
      id: 'keep',
      label: 'Keep',
      sub: p.kept || p.open ? [p.kept ? `${p.kept} kept` : '', p.open ? `${p.open} to decide` : ''].filter(Boolean).join(', ') : 'What you like',
      state: !p.arrived || p.running ? 'todo' : p.open ? 'now' : 'done'
    }
  ]
}

/** Building the world from a summary: the summary, when it is true, the build, and what it made. */
export function worldSteps(p: { words: number; when: string; running: boolean; made: number; undone: boolean; ended: boolean }): PlanStep[] {
  return [
    { id: 'summary', label: 'Summary', sub: p.words ? plural(p.words, 'word') : 'Type, paste or dictate', state: p.words ? 'done' : 'now' },
    { id: 'when', label: 'When', sub: p.when, state: p.words ? 'done' : 'todo' },
    {
      id: 'build',
      label: 'Build',
      sub: p.running ? 'The AI is at work…' : p.ended ? 'Built' : 'One click',
      state: p.running ? 'working' : p.ended ? 'done' : p.words ? 'now' : 'todo'
    },
    {
      id: 'review',
      label: 'Look it over',
      sub: p.undone ? 'Undone' : p.made ? `${plural(p.made, 'thing')} made` : 'Open any of them',
      state: p.running ? (p.made ? 'now' : 'todo') : p.ended && p.made && !p.undone ? 'done' : 'todo'
    }
  ]
}

/** Making a recipe: bring the story in, check its chapters, make it. */
export function recipeSteps(p: { story: boolean; chapters: number; making: boolean }): PlanStep[] {
  return [
    { id: 'bring', label: 'Bring in a story', sub: p.story ? 'Read' : 'A file, or paste it', state: p.story ? 'done' : 'now' },
    { id: 'check', label: 'Check its chapters', sub: p.story ? plural(p.chapters, 'chapter') : 'Merge any that belong together', state: p.story ? (p.making ? 'done' : 'now') : 'todo' },
    { id: 'make', label: 'Make the recipe', sub: p.making ? 'In the background' : 'The AI reads it', state: p.making ? 'working' : 'todo' }
  ]
}

/** How far along the steps are, 0 to 1 (a step at work counts half). */
export function stepsProgress(steps: PlanStep[]): number {
  if (!steps.length) return 0
  const n = steps.reduce((sum, s) => sum + (s.state === 'done' ? 1 : s.state === 'working' ? 0.5 : 0), 0)
  return Math.min(1, n / steps.length)
}
