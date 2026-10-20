// "Update the plan" (the Plan hub, 2026-10-20): the planned scene cards the story has moved on from (facts.ts planDrift)
// written again by the chat model so they fit what has been written. The request gives the story, what it has so far,
// how the last scene written ends, the open plot threads and the cast, and each card as it stands with what no longer
// fits (the card check's own words, worked out again here); the reply is one scene card for each, in order, in the
// outline helper's scene form. It streams as an 'outline' task, so it can be stopped and shows in What the AI saw. The
// window shows the cards before and after, and nothing changes until Adam keeps them. No Electron imports.

import type { PlanUpdateRequest, PlanUpdateScene } from '@shared/contracts/planHub'
import type { ChatMessage, ID, SceneCard } from '@shared/types'
import { emptySceneCard } from '@shared/defaults'
import { sceneTail } from '../ai/context'
import { MODEL_NAMES } from '../ai/jobModel'
import { startTask } from '../ai/tasks'
import * as repo from '../db/repo'
import { UserError } from '../util'
import { castText, planText, storyText, threadsText, type BlockDraft } from '../outline/briefing'
import { outlineFacts } from '../outline/context'
import { checkReplyRoom, fitBriefing, OUTLINE_TEMPERATURE, type JobDeps } from '../outline/jobs'
import { planUpdateSystem } from '../outline/prompts'
import { cardCheck } from '../plan/cardCheck'
import { memoryAt } from '../memory/asOf'
import { buildStorySafely } from '../storyIndex/upkeep'
import { aboutWhatIsWritten, lastWrittenAt, sceneOrder, type OrderedScene } from './facts'

/** The most planned scenes one update writes again. */
export const UPDATE_MOST = 6

/** A scene card's lines as the update is told them. */
function cardLines(card: SceneCard, name: (id: ID | null) => string): string[] {
  const lines: string[] = []
  const add = (label: string, v: string): void => {
    if (v.trim()) lines.push(`${label}: ${v.replace(/\s+/g, ' ').trim()}`)
  }
  add('When', card.when)
  add('Point of view', name(card.povId))
  add('Characters', card.presentIds.map(name).filter(Boolean).join(', '))
  add('Location', name(card.locationId))
  add('Summary', card.goal)
  for (const b of card.beats) if (b.trim()) lines.push(`- ${b.replace(/\s+/g, ' ').trim()}`)
  return lines
}

/** Each scene's card as it is now, in the order given (the window's "before"). Scenes gone since are left out. */
export function planUpdateScenes(db: JobDeps['db'], sceneIds: readonly ID[]): PlanUpdateScene[] {
  const out: PlanUpdateScene[] = []
  for (const id of sceneIds) {
    try {
      const { story } = repo.sceneLocation(db, id)
      const s = repo.getScene(db, id)
      const label = sceneOrder(db, story.id).find((x) => x.id === id)?.label ?? ''
      const card = { ...emptySceneCard(), ...s.card }
      out.push({ sceneId: id, label, title: s.title, goal: card.goal, when: card.when, beats: card.beats.filter((b) => b.trim()) })
    } catch {
      // Gone since: nothing to show for it.
    }
  }
  return out
}

/** Starts "Update the plan". Throws (plain words) only before it starts. */
export function startPlanUpdate(deps: JobDeps, input: PlanUpdateRequest): { generationId: ID } {
  const storyId = String(input?.storyId ?? '')
  const story = repo.getStory(deps.db, storyId)
  const order = sceneOrder(deps.db, storyId)
  const last = lastWrittenAt(order)
  const wanted = new Set((Array.isArray(input?.sceneIds) ? input.sceneIds : []).map(String))
  // Only scenes of this story, still planned (no words), after the last one written: in story order.
  const scenes: OrderedScene[] = order.filter((s, i) => wanted.has(s.id) && i > last && s.words === 0).slice(0, UPDATE_MOST)
  if (!scenes.length) throw new UserError('Those scenes aren’t planned any more, so there is nothing to update.')

  // The card check reads the story index: brought up to date first (only what changed is built again).
  buildStorySafely(deps.db, storyId)
  const facts = outlineFacts(deps.db, storyId)
  const at = memoryAt(deps.db, { kind: 'end', storyId })
  const entries = [...at.state.entries.values()]
  const names = new Map(entries.map((e) => [e.id, e.name]))
  const name = (id: ID | null): string => (id ? (names.get(id) ?? '') : '')
  const written = new Set(order.filter((s) => s.words > 0).map((s) => s.label))
  const cards = scenes.map((s, i) => {
    const card = { ...emptySceneCard(), ...repo.getScene(deps.db, s.id).card }
    let notes: string[] = []
    try {
      notes = cardCheck({
        db: deps.db,
        storyId,
        sceneId: s.id,
        card,
        direction: '',
        entries,
        relationships: at.state.relationships,
        present: [card.povId, ...card.presentIds].filter((id): id is ID => !!id),
        asItBegins: true,
        storyTitle: story.title
      })
        .filter((f) => aboutWhatIsWritten(f.text, written))
        .map((f) => f.text)
    } catch (e) {
      console.warn('The plan update could not check a card', e)
    }
    const title = s.title.replace(/\s+/g, ' ').trim() || 'Untitled scene'
    return [
      `Scene ${i + 1} of ${scenes.length}: ${s.label}`,
      `### Scene: ${title}`,
      ...cardLines(card, name),
      `What no longer fits: ${notes.length ? notes.join(' ') : 'Check it against the story as written, and put right anything that no longer holds.'}`
    ].join('\n')
  })
  const lastText = last >= 0 ? repo.getScene(deps.db, order[last].id).text : ''
  const tail = (o: { min: number; target: number; max: number }): string => (lastText.trim() ? sceneTail(lastText, o) : '')
  const reply = 300 + scenes.length * 230
  checkReplyRoom(deps.model, reply, 'That is', 'Pick a model that writes longer answers in Settings › Models.')
  const system = planUpdateSystem()
  const drafts: BlockDraft[] = [
    { id: 'story', title: 'The story', priority: 1, forms: [storyText(facts.story)] },
    { id: 'plan', title: 'What the story has so far', priority: 2, forms: [0, 1, 2, 3].map((l) => planText(facts.plan, l)) },
    ...(last >= 0
      ? [{ id: 'previous', title: `How the last scene written ends (${order[last].label})`, priority: 2, forms: [tail({ min: 250, target: 320, max: 420 }), tail({ min: 90, target: 120, max: 160 })] }]
      : []),
    { id: 'threads', title: 'Open plot threads', priority: 3, forms: [threadsText(facts.threads), threadsText(facts.threads, true)], entryIds: facts.threads.map((t) => t.id) },
    {
      id: 'cast',
      title: 'Characters and places',
      priority: 5,
      forms: [castText(facts.cast, 40), castText(facts.cast, 15), castText(facts.cast, 30, true)],
      entryIds: facts.cast.map((c) => c.id)
    },
    { id: 'cards', title: 'The planned scenes to write again', priority: 0, forms: [cards.join('\n\n')] },
    {
      id: 'ask',
      title: 'What to do',
      priority: 0,
      forms: [`Write ${scenes.length === 1 ? 'this scene card' : `these ${scenes.length} scene cards`} again, in this order, so each fits the story as written.`]
    }
  ]
  const fitted = fitBriefing(
    drafts,
    system,
    deps.model,
    reply,
    `The story and its plan are more than the ${MODEL_NAMES.chat} can read at once. Pick a model that can read more in Settings › Models.`
  )
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: fitted.text }
  ]
  return startTask({
    db: deps.db,
    taskId: input.taskId,
    job: 'outline',
    sceneId: '',
    model: deps.model,
    messages,
    reply,
    temperature: OUTLINE_TEMPERATURE,
    direction: `Update the plan: ${scenes.map((s) => s.label).join('; ')}`,
    blocks: fitted.blocks,
    emit: deps.emit,
    onKeyRejected: deps.onKeyRejected
  })
}
