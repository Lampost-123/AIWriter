// Starting an AI edit of selected words, or Continue, on the open world (milestone 4, "Editing with
// AI"). The writer model writes it, with the writer's Thinking (ai/jobModel.ts). The call goes through
// the shared task runner (ai/tasks.ts) as an 'edit' record with `params.tool`, Adam's instruction or
// tone as its direction and the briefing's parts as its blocks, so "What the AI saw" shows them. Its
// words reach the window as task events; the interface shows them as a tracked change.

import type { EditInput, EditStart } from '@shared/contracts/edits'
import { effectiveStyle } from '@shared/style'
import * as world from '../world'
import * as repo from '../db/repo'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { providerNotes } from '../ai/draftFlow'
import { startTask } from '../ai/tasks'
import type { WriterSpeaker } from '../ai/speakerTags'
import { noteGenerationSpeakers } from '../readAloud'
import { sceneMemory } from '../memory/scene'
import { editBriefing } from './briefing'
import { editInput } from './input'

/** Starts an AI edit. Throws (plain words) when there's no writer model or the scene is gone. */
export function startEdit(raw: EditInput): EditStart {
  const input = editInput(raw)
  const tool = input.tool

  const settings = getSettings()
  const model = jobModel('writer', { settings, getProvider: providers.getProvider, providerTarget: providers.providerTarget })
  const db = world.db()
  const scene = repo.getScene(db, input.sceneId)
  const { story } = repo.sceneLocation(db, input.sceneId)
  const memory = sceneMemory(db, input.sceneId)
  // With reading aloud on (or Show speakers and tone), the writer says who says each line as it writes, as drafts do.
  const speech = settings.speech
  const speakerTags = speech?.readAloud || speech?.showSpeakers ? { narration: !!speech.markSpeakers } : undefined
  const briefing = editBriefing(input, {
    style: effectiveStyle(getWritingPrefs(), repo.getWorldStyle(db), story.style),
    scene: { title: scene.title, card: scene.card },
    entries: memory.entries,
    contextLength: model.choice.contextLength ?? null,
    speakerTags
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
    onKeyRejected: providerNotes(model.target.id).onKeyRejected,
    // Kept until Adam accepts the change (History's snapshot before it names this record).
    ...(speakerTags ? { onSpeakers: (speakers: WriterSpeaker[], id: string) => noteGenerationSpeakers(id, speakers) } : {})
  })
  return { ok: true, generationId, note: briefing.note }
}
