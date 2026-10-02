// Starting an AI edit of selected words, or Continue, on the open world (milestone 4, "Editing with
// AI"). The writer model writes it, with the writer's Thinking (ai/jobModel.ts). The call goes through
// the shared task runner (ai/tasks.ts) as an 'edit' record with `params.tool`, Adam's instruction or
// tone as its direction and the briefing's parts as its blocks, so "What the AI saw" shows them. Its
// words reach the window as task events; the interface shows them as a tracked change.

import type { EditInput, EditStart } from '@shared/contracts/edits'
import type { EditTool } from '@shared/types'
import { effectiveStyle } from '@shared/style'
import { UserError } from '../util'
import * as world from '../world'
import * as repo from '../db/repo'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { providerNotes } from '../ai/draftFlow'
import { startTask } from '../ai/tasks'
import { sceneMemory } from '../memory/scene'
import { editBriefing } from './briefing'

const TOOLS: EditTool[] = ['rewrite', 'expand', 'condense', 'vivid', 'tone', 'voice', 'alternatives', 'continue']

/** Longest text taken from the window for each part (a whole scene is far smaller). */
const MAX_CHARS = 400_000

const text = (v: unknown): string => (typeof v === 'string' ? v.slice(0, MAX_CHARS) : '')

/** Starts an AI edit. Throws (plain words) when there's no writer model or the scene is gone. */
export function startEdit(raw: EditInput): EditStart {
  const tool = raw?.tool
  if (!TOOLS.includes(tool)) throw new UserError('Something went wrong starting that. Try again.')
  const input: EditInput = {
    taskId: String(raw.taskId ?? ''),
    sceneId: String(raw.sceneId ?? ''),
    tool,
    direction: text(raw.direction).trim().slice(0, 2000),
    selection: text(raw.selection),
    before: text(raw.before),
    after: text(raw.after),
    continueAs: raw.continueAs === 'inline' ? 'inline' : 'paragraph'
  }
  if ((tool === 'rewrite' || tool === 'tone') && !input.direction) {
    throw new UserError(tool === 'rewrite' ? 'Say how to rewrite the words first.' : 'Pick a tone first.')
  }

  const settings = getSettings()
  const model = jobModel('writer', { settings, getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  const db = world.db()
  const scene = repo.getScene(db, input.sceneId)
  const { story } = repo.sceneLocation(db, input.sceneId)
  const memory = sceneMemory(db, input.sceneId)
  const briefing = editBriefing(input, {
    style: effectiveStyle(getWritingPrefs(), repo.getWorldStyle(db), story.style),
    scene: { title: scene.title, card: scene.card },
    entries: memory.entries,
    contextLength: model.choice.contextLength ?? null
  })
  if (!briefing.ok) return briefing

  const { generationId } = startTask({
    db,
    taskId: input.taskId,
    job: 'edit',
    sceneId: input.sceneId,
    model,
    messages: briefing.messages,
    reply: briefing.reply,
    temperature: briefing.temperature,
    topP: briefing.topP,
    direction: input.direction,
    blocks: briefing.blocks,
    entries: briefing.entries,
    extra: { tool },
    emit,
    onKeyRejected: providerNotes(model.target.id).onKeyRejected
  })
  return { ok: true, generationId, note: briefing.note }
}
