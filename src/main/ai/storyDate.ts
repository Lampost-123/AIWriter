// The story calendar in the writer's briefing (long story memory fix 11; memory/calendar.ts works the dates out). The
// app, not the model, does the sums: the scene card says the scene's story date and how long it is since the scene
// before and since a few earlier days worth counting from ("Story date: Day 41, evening (3 weeks since the start of Ch
// 4: The Siege; 2 days since the scene before)"), and how old the people on the card are where the memory says enough.
// What must stay true says how much time has passed since the scene before from the same sums (elapsedNote), so there
// is one source of truth for elapsed time. A count of days ("Day 3") is told on the real calendar too where a card
// names a real day beside its count ("Day 25, Christmas Eve": Day 3 falls on 2 December), so the month holds. Both are
// worked out from the scene cards only, never from what a step of a scene adds, so they read the same at every step
// (the cache); the scene card is sent late (SEND_ORDER). Pure.

import { sameWhen } from '@shared/continuity'
import type { SceneCard } from '@shared/types'
import type { SceneMemory } from '../memory/types'
import {
  ageWords,
  buildCalendar,
  dateLabel,
  elapsedBetween,
  elapsedWords,
  sameMoment,
  storyDayWords,
  timeOrder,
  type SceneCalendar,
  type StoryDate
} from '../memory/calendar'

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** What the calendar lines are worked out from (ContextInput's parts). */
export interface DateInput {
  scene: { card: Pick<SceneCard, 'when'> }
  memory: Pick<SceneMemory, 'previous'>
  /** The story calendar at this scene (ai/gather.ts); left out or null: the two scene cards' When alone. */
  calendar?: SceneCalendar | null
}

/**
 * This scene's date and the scene before's: from the story calendar when it was given, else from the two cards' When
 * alone (as before the calendar: a test, or the world couldn't be read), within one story. `previous` is null for a
 * story's first scene after another story (its time gap says how long).
 */
export function datesOf(input: DateInput): { here: StoryDate | null; previous: StoryDate | null } {
  const prev = input.memory.previous
  const other = !!prev?.otherStory
  if (input.calendar) return { here: input.calendar.here, previous: other ? null : input.calendar.previous }
  const items = [
    ...(prev && !other ? [{ id: 'previous', story: 's', when: prev.when ?? '' }] : []),
    { id: 'here', story: 's', when: input.scene.card.when ?? '' }
  ]
  const cal = buildCalendar(items)
  return { here: cal.dates.get('here') ?? null, previous: cal.dates.get('previous') ?? null }
}

/** How many earlier days to count from, at a memory scale (ai/memoryRoom.ts): 1 on the smallest models, up to 3. */
export const storyDateMarks = (scale: number): number => Math.min(3, Math.max(1, Math.floor(scale)))
/** How many people's ages, at a memory scale: 3, up to 6. */
export const storyDateAges = (scale: number): number => Math.min(6, Math.max(3, Math.round(3 * scale)))

/** "2 days since the scene before", "3 days before the scene before, a flashback", "the same day as the scene before". */
function sincePrevious(previous: StoryDate | null, here: StoryDate): string {
  const e = elapsedBetween(previous, here)
  if (!e) return ''
  // Earlier the same day only where it is certain: "That night" after "11pm" may be the same hour.
  if (e.days === 0)
    return timeOrder(previous, here) === -1 ? 'earlier the same day than the scene before' : 'the same day as the scene before'
  if (e.days < 0) return `${elapsedWords(e)} before the scene before${here.back ? ', a flashback' : ''}`
  return `${elapsedWords(e)} since the scene before`
}

/** A date as told: worked out in words where the When leans on the scenes before ("Day 4, morning"), else Adam's own words. */
const told = (d: StoryDate | null, words: string): string => (d?.leans && (d.date || d.day !== null) ? dateLabel(d, ', ') : '') || words

/**
 * The scene card's lines about the story calendar (sceneCardText): "Story date: …" with how long since the scene before
 * and since a few earlier days (fewer on small models: storyDateMarks), then "Ages here: …" for those on the card whose
 * age the sums change (from a birth date, or a year or more after an age at a date), and the reminder to make the time
 * fit. The story date is left out when it would only say the When again ("Day 8" with no sums). When this scene's date
 * isn't known, what the scene before was, as before the calendar. [] when there is nothing.
 */
export function storyDateLines(input: DateInput, scale = 1): string[] {
  const prev = input.memory.previous
  const { here, previous } = datesOf(input)
  const label = dateLabel(here, ', ')
  const lines: string[] = []
  const before = here ? sincePrevious(previous, here) : ''
  // A day, or a month or year, is a date; a time of day alone isn't (the When line says it).
  if (here && label && (here.date || here.day !== null)) {
    const since = (input.calendar?.landmarks ?? [])
      .flatMap((l) => {
        const e = elapsedBetween(l.date, here)
        return e && e.days > 0 ? [`${elapsedWords(e)} since ${l.name}`] : []
      })
      .slice(0, storyDateMarks(scale))
    if (before) since.push(before)
    // A counted day on the real calendar, where a card says which ("Day 25, Christmas Eve"): the month the writer must keep to.
    const real = here.real ? `, which falls ${here.real.startsWith('about ') ? here.real : `on ${here.real}`}` : ''
    if (since.length || here.leans || storyDayWords(here) || real) lines.push(`Story date: ${label}${real}${since.length ? ` (${since.join('; ')})` : ''}`)
  }
  const ages = (input.calendar?.ages ?? [])
    .filter((a) => a.age.born || a.age.age.lo !== a.age.given)
    .slice(0, storyDateAges(scale))
    .map((a) => `${a.name} ${ageWords(a.age.age)} (${a.age.basis})`)
  if (ages.length) lines.push(`Ages here: ${ages.join('; ')}`)
  // How long after the scene before, from both cards (Adam, 2026-10-04: a live run's writer said "four days" where one
  // night had passed). Only within one story, and only when both have a When.
  const now = clean(input.scene.card.when)
  const then = clean(prev?.when)
  if (prev && !prev.otherStory && now && then) {
    const said = lines[0]?.startsWith('Story date:') && !!before
    const was = said ? '' : `The previous scene was ${told(previous, then)}. `
    lines.push(`${was}Make the time that has passed fit (travel, sleep, healing), and don't say more or less of it has gone by.`)
  }
  return lines
}

/**
 * How much time has passed since the scene before, for what must stay true (2026-10-15; since fix 11 from the story
 * calendar): "Time: 2 days since the scene before (Day 39, dusk); this scene is Day 41, evening". For a story's first
 * scene after another story, its time gap. '' when the writing carries on inside the scene, when nothing is known, or
 * at the same moment.
 */
export function elapsedNote(
  input: DateInput & { continuityAtSoFar?: boolean; options: { addBelow?: boolean }; memory: Pick<SceneMemory, 'previous' | 'storyId'> },
  inside: boolean
): string {
  if (inside || input.continuityAtSoFar || input.options.addBelow) return ''
  const prev = input.memory.previous
  if (!prev) return ''
  if (prev.otherStory && prev.storyId !== input.memory.storyId) {
    const gap = clean(prev.otherStory.timeGap).replace(/\.$/, '')
    return gap ? `Time since ${clean(prev.storyTitle) || 'the story before'}: ${gap}` : ''
  }
  const { here, previous } = datesOf(input)
  const before = clean(prev.when)
  const now = clean(input.scene.card.when)
  const e = elapsedBetween(previous, here)
  if (e) {
    if (e.days === 0 && (sameMoment(previous, here) ?? sameWhen(before, now))) return ''
    return `Time: ${sincePrevious(previous, here!)} (${told(previous, before)}); this scene is ${told(here, now)}`
  }
  if (!before || !now || sameWhen(before, now)) return ''
  return `Time: the scene before was ${before}; this scene is ${now}`
}
