// Starting an AI edit of selected words, or Continue, on the open world (milestone 4, "Editing with
// AI"). The writer model writes it, with the writer's Thinking (ai/jobModel.ts). The call goes through
// the shared task runner (ai/tasks.ts) as an 'edit' record with `params.tool`, Adam's instruction or
// tone as its direction and the briefing's parts as its blocks, so "What the AI saw" shows them. Its
// words reach the window as task events; the interface shows them as a tracked change.

import type { EditInput, EditStart } from '@shared/contracts/edits'
import type { SceneCard } from '@shared/types'
import { CONTINUE_THREADS_MOST, openThreadsAt } from '../ai/openThreads'
import { effectiveStyle } from '@shared/style'
import * as world from '../world'
import * as repo from '../db/repo'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { providerNotes } from '../ai/draftFlow'
import { startTask, startingSignal } from '../ai/tasks'
import type { WriterSpeaker } from '../ai/speakerTags'
import { noteGenerationSpeakers } from '../readAloud'
import { sceneMemory } from '../memory/scene'
import { editBriefing, type EditWorld } from './briefing'
import { editInput } from './input'
import { calendarFor, CATCH_UP_LIMIT_MS, catchUpBeforeDraft, gatherContextInput, leftHereFor, stageWhere, standAtText, standKept } from '../ai/gather'
import { sceneTail, SHORT_TAIL, stageScope, timelineFrom } from '../ai/context'
import { continueBeatsDone, planForContinueOf } from '../plan'
import { buildStoryIndex, stateOf } from '../storyIndex'
import { clip } from '../ai/lookups/text'
import { countWords } from '@shared/defaults'
import { timelineText } from '../ai/timeline'
import { recallForBriefing } from '../retrieval'
import type { SceneMemory } from '../memory/types'
import { stageFor, stageInScene } from '../ai/mustStay'
import { onStageIn, withoutMentioned } from '../storyIndex/there'
import { keptStateBefore, type SceneState } from '../continuity/tracker'
import { noteContract, noteStage } from '../repair'
import { contractWanted } from '../ai/contract'
import { ownWritingFor } from '../style/ownWriting'
import { ownSampleOn } from '@shared/ownSample'
import type { OwnSample } from '../style/ownWords'
import type { StyleGuide } from '@shared/types'
import { UserError } from '../util'
import { writingTemperatureFor } from '@shared/temperature'

/**
 * Change it…'s voice sample: passages of Adam's own writing when "Use my own writing as the sample" is on for the sample
 * passage in effect (as a draft gets them, style/ownWriting.ts), else null (the style guide's sample passage).
 */
function reviseSample(db: ReturnType<typeof world.db>, sceneId: string, style: StyleGuide): OwnSample | null {
  if (!ownSampleOn(getWritingPrefs().ownSample, style.samplePassage)) return null
  return ownWritingFor(db, sceneId, { sample: true, people: [] }).sample
}

/**
 * Where things stand at the end of the words before Continue's cursor (as the previous scene ended, at the start of
 * the scene); null when it isn't known in time.
 */
async function continueStand(db: ReturnType<typeof world.db>, sceneId: string, before: string): Promise<SceneState | null> {
  return before.trim() ? standAtText(db, sceneId, before, CONTINUE_STAND_MS) : keptStateBefore(db, sceneId)
}

/** How long Continue waits for where things stand at the cursor before carrying on without it (it is kept for next time). */
export const CONTINUE_STAND_MS = 20_000

/** The timeline's level Continue gets: the short one, about 800 tokens (ai/timeline.ts). */
export const CONTINUE_TIMELINE_LEVEL = 2

/**
 * Continue's memory core (Adam, 2026-10-08): the timeline's short form, and what step 5 recalls for the words near the
 * cursor (entries found by searching first, then those of the last two scenes; what was said word for word). Recall is
 * skipped when it is off or fails; it never holds Continue up for long (its own wait, recall.ts MEANING_WAIT_MS).
 */
async function continueCore(
  db: ReturnType<typeof world.db>,
  input: EditInput,
  memory: SceneMemory,
  storyTitle: string,
  card: SceneCard
): Promise<EditWorld['core']> {
  const timeline = timelineText(memory.storySoFar, timelineFrom({ memory, story: { title: storyTitle } }), CONTINUE_TIMELINE_LEVEL)
  // The plot threads still open here, kept alive gently (2026-10-08).
  const threads = openThreadsAt(memory, card, CONTINUE_THREADS_MOST)
  let recalled: NonNullable<EditWorld['core']>['recalled'] = []
  let said: NonNullable<EditWorld['core']>['said'] = []
  try {
    const settings = getSettings()
    const ci = gatherContextInput(db, input.sceneId, { direction: input.direction }, {
      prefs: getWritingPrefs(),
      contextLength: null,
      creativity: settings.creativity
    })
    const near = sceneTail(input.before, { min: 300, target: 500, max: 600 })
    const recall = await recallForBriefing(db, input.sceneId, ci, near)
    if (recall) {
      const byId = new Map(memory.entries.map((e) => [e.id, e]))
      const ids = [...new Set([...recall.found, ...recall.sticky])]
      recalled = ids.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e)
      said = recall.said
    }
  } catch (e) {
    console.warn('Continue goes without recall this time', e instanceof Error ? e.message : e)
  }
  return { timeline, recalled, said, threads }
}

/** How much of the previous scene's end Continue is given: about 200 words. */
export const CONTINUE_PREVIOUS = SHORT_TAIL
/**
 * Continue is given the end of the previous scene only while the scene's own words before the cursor are fewer than this
 * (2026-10-19: deep into a scene it only took room; the scene's own words say where it has got to).
 */
export const CONTINUE_PREVIOUS_UNDER = 300

/**
 * What Continue gets besides (2026-10-19): the end of the previous scene, with where it comes from, while the scene's own
 * words are short; the beats of the scene's plan made for the whole of it, those on the page marked done and the next
 * marked (plan/index.ts planForContinueOf); and how many of the card's beats are on the page (continueBeatsDone), so
 * Continue's scene card marks them too.
 */
export function continueExtras(
  input: Pick<EditInput, 'sceneId' | 'before'>,
  memory: Pick<SceneMemory, 'previous' | 'storyId'>,
  card: SceneCard,
  storyTitle: string
): Pick<EditWorld, 'previous' | 'plan' | 'beatsDone'> {
  const prev = memory.previous
  const short = countWords(input.before) < CONTINUE_PREVIOUS_UNDER
  const text = short && prev?.text?.trim() ? sceneTail(prev.text, CONTINUE_PREVIOUS) : ''
  const other = !!prev?.otherStory && prev.storyId !== memory.storyId
  const lead = other
    ? `This is how ${prev!.storyTitle.trim() || 'the story before'} ${prev!.otherStory!.ended ? 'ended' : 'had got to'}; this story (${storyTitle}) comes after it.`
    : 'This is how the scene before this one ended.'
  const plan = planForContinueOf(input.sceneId, card, input.before)
  return { ...(text ? { previous: { lead, text } } : {}), ...(plan ? { plan } : {}), beatsDone: continueBeatsDone(card, input.before) }
}

/** The most lines Continue is given of everyone in the scene as the story index has them: each, and all together. */
export const CONTINUE_PEOPLE_MOST = { each: 7, all: 28 }

/**
 * Everyone in the scene at Continue's cursor as the story index has them (2026-10-19): the card's point of view and
 * people, and whoever the words before the cursor put there (never someone only thought of, talked of or far away, nor
 * named only by another's name, what is theirs, or what they once said or may do: storyIndex/there.ts onStageIn), each
 * with what the index knows of them (where, what they wear and carry, how they are, what they know, their ties); for
 * someone where things stand at the cursor already tells, only what they know and their ties. As the scene ends when the
 * cursor is at its end, else as it begins. Nothing when the index can't be read.
 */
export function continuePeople(
  db: ReturnType<typeof world.db>,
  input: Pick<EditInput, 'sceneId' | 'before' | 'after'>,
  memory: Pick<SceneMemory, 'storyId' | 'entries'>,
  card: SceneCard,
  stand: SceneState | null
): string[] {
  try {
    const storyId = memory.storyId
    if (!storyId) return []
    buildStoryIndex(db, storyId)
    const chars = memory.entries.filter((e) => e.kind === 'character')
    const ids = [card.povId, ...(card.presentIds ?? [])].filter((id): id is string => !!id)
    for (const e of chars) {
      if (ids.includes(e.id)) continue
      if (onStageIn(input.before, e)) ids.push(e.id)
    }
    const out: string[] = []
    for (const id of ids) {
      const e = chars.find((x) => x.id === id)
      const now = e ? stateOf(db, storyId, id, input.sceneId, { asItBegins: !!input.after.trim() }) : null
      if (!e || !now) continue
      const knows = now.lines.filter((l) => l.startsWith(`${now.name} knows:`))
      const ties = now.lines.filter((l) => l.startsWith(`${now.name} and `))
      const rest = now.lines.filter((l) => !knows.includes(l) && !ties.includes(l))
      const told = stageFor(e, stand) ? [] : rest
      out.push(...[...told, ...ties.slice(0, 2), ...knows.slice(0, 2)].slice(0, CONTINUE_PEOPLE_MOST.each).map((l) => clip(l, 240)))
    }
    return out.slice(0, CONTINUE_PEOPLE_MOST.all)
  } catch (e) {
    console.warn('Continue goes without the story index this time', e instanceof Error ? e.message : e)
    return []
  }
}

/**
 * How long Continue waits for the memory to catch up (earlier scenes, then the scene's own fresh read): until it has, as a
 * draft does (Adam, 2026-10-17: "always wait for the extractor to finish before advancing"). Stop ends the wait at once.
 */
export const CONTINUE_CATCH_UP_MS = CATCH_UP_LIMIT_MS

/**
 * Starts an AI edit. Throws (plain words) when there's no writer model or the scene is gone. Continue first works out
 * where things stand at the point it carries on from (the memory model reads the scene so far), never for long.
 */
export async function startEdit(raw: EditInput): Promise<EditStart> {
  const input = editInput(raw)
  const tool = input.tool

  const settings = getSettings()
  const model = jobModel('writer', { settings, getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  const db = world.db()
  // Continue, like a draft, first lets the memory catch up: earlier scenes, then this scene's own unread words
  // (World Memory Overhaul A6), until it has (CONTINUE_CATCH_UP_MS), and Stop ends the wait at once.
  if (tool === 'continue') {
    const ready = startingSignal(input.taskId)
    try {
      const r = await catchUpBeforeDraft(db, input.sceneId, CONTINUE_CATCH_UP_MS, ready.signal)
      if (r === 'cancelled') throw new UserError('The AI was stopped before it began.', 'cancelled')
    } finally {
      ready.done()
    }
    if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the AI could start.')
  }
  const scene = repo.getScene(db, input.sceneId)
  const { story } = repo.sceneLocation(db, input.sceneId)
  // Continue carries on from the words before the cursor: what the memory read from them counts (review, 2026-10-16:
  // a secret told a page ago was still "kept from" the one told).
  const memory = sceneMemory(db, input.sceneId, { forWriter: true, ...(tool === 'continue' && input.before.trim() ? { soFar: input.before } : {}) })
  // The other tools don't wait for where things stand: only what is already kept at exactly that point (step 4).
  const kept = tool === 'continue' ? await continueStand(db, input.sceneId, input.before) : standKept(db, input.sceneId, input.before)
  const core = tool === 'continue' ? await continueCore(db, input, memory, story.title, scene.card) : undefined
  if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the AI could start.')
  // As told (and checked against): only the people in the scene, and a time that still holds (Adam, 2026-10-07); never
  // someone off the card the words only mention (2026-10-19).
  const scope = stageScope(scene.card, memory, [input.direction, input.before, input.selection, input.after], calendarFor(db, input.sceneId, memory, scene.card))
  const stand = withoutMentioned(stageInScene(kept, scope), scope)
  // With reading aloud on (or Show speakers and tone), the writer says who says each line as it writes, as drafts do.
  const speech = settings.speech
  const speakerTags = !!(speech?.readAloud || speech?.showSpeakers)
  const style = effectiveStyle(getWritingPrefs(), repo.getWorldStyle(db), story.style)
  const briefing = editBriefing(input, {
    style,
    scene: { title: scene.title, card: scene.card },
    entries: memory.entries,
    contextLength: model.choice.contextLength ?? null,
    speakerTags,
    stand,
    must: { facts: memory.facts, beliefs: memory.beliefs, sceneId: input.sceneId, storyTitle: story.title, places: stageWhere(db, stand), relationships: memory.relationships },
    ...(core ? { core } : {}),
    // The scene's contract (long story memory fix 13), when Settings › Models says to.
    ...(tool === 'continue' && contractWanted(settings) ? { contract: true } : {}),
    // Continue (2026-10-19): the end of the previous scene while the scene's words are short, the beats of the scene's plan
    // (or card) still to come with the next marked (no call; no plan with Plan before writing off), and everyone in the
    // scene as the story index has them.
    ...(tool === 'continue'
      ? {
          ...continueExtras(input, memory, scene.card, story.title),
          people: continuePeople(db, input, memory, scene.card, stand),
          // After continuePeople, which brings the story index up to date: what was left in this place on an earlier visit.
          leftHere: leftHereFor(db, input.sceneId, memory.storyId, scene.card.locationId, { asItBegins: !!input.after.trim(), stand })
        }
      : {}),
    // Change it… ("Keep this, change that", 2026-10-19): the scene's plan (no call; its beats before the passage marked
    // done) and Adam's own writing as the voice sample, as a draft has them.
    ...(tool === 'revise'
      ? (() => {
          const plan = planForContinueOf(input.sceneId, scene.card, input.before)
          const ownSample = reviseSample(db, input.sceneId, style)
          return { ...(plan ? { plan } : {}), ...(ownSample ? { ownSample } : {}) }
        })()
      : {})
  })
  if (!briefing.ok) return briefing
  // Writing temperature (Settings › Models): Continue, Change it and the other AI edits write the story's words, so
  // Adam's own temperature takes the place of the tool's, within what the model takes; top_p stays the tool's.
  const temp = writingTemperatureFor(briefing.temperature, settings.writingTemperature, model.target, model.choice.modelId)

  const { generationId } = startTask({
    db,
    taskId: input.taskId,
    job: 'edit',
    sceneId: input.sceneId,
    model,
    messages: briefing.messages,
    reply: briefing.reply,
    temperature: temp.temperature,
    topP: briefing.topP,
    direction: input.direction,
    blocks: briefing.blocks,
    entries: briefing.entries,
    extra: { tool, ...(temp.own ? { ownTemperature: true } : {}) },
    emit,
    onKeyRejected: providerNotes(model.target.id).onKeyRejected,
    // Kept until Adam accepts the change (History's snapshot before it names this record).
    ...(speakerTags ? { onSpeakers: (speakers: WriterSpeaker[], id: string) => noteGenerationSpeakers(id, speakers) } : {})
  })
  // Check and repair: once Adam accepts Continue's words, they are checked against where things stood at the cursor, and
  // against the scene's contract Continue was given (fix 13).
  if (tool === 'continue') {
    noteStage(generationId, input.sceneId, stand)
    noteContract(generationId, input.sceneId, briefing.contract ?? null)
  }
  return { ok: true, generationId, note: briefing.note }
}
