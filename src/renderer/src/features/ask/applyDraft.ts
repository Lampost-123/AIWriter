// The editor chat's proposed draft (propose_draft, lab switch DRAFT), when Adam clicks Apply: it starts the writer's
// OWN job for the scene with the chat's direction, never a generation of its own, so everything after is as usual:
//   generate / add_below  Generate's draft (draftRun.startDraft): into an empty scene, or below its words (both
//                         modes: a scene's words are never written over); Ctrl+Z and History as for any draft
//   continue              Continue (features/edits): a tracked change at the end of the paragraph named, or of the
//                         scene, to Accept or Reject
//   redo_beat             Beat by beat's Write it again (features/beats/redo.ts) for the card's beat, with the
//                         direction as its note
// The scene opens first if it isn't open. Nothing starts while anything else is being written into that scene.
import type { Proposal } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { BLANK_DRAFT_OPTIONS } from '@/features/generate/draftOptions'
import { busyElsewhere, startDraft, useDraft } from '@/features/generate/draftRun'
import { startTool, waitingSuggestion } from '@/features/edits/session'
import { beatBeingWritten } from '@/features/beats/flow'
import { redoBeat, redoing } from '@/features/beats/redo'
import { isWriting, setOf, useVariants } from '@/features/variants/store'
import { beatNumber, continueAt } from './askEdits'
import { sceneInPage } from './sceneInPage'

export type DraftProposal = Extract<Proposal, { kind: 'draft' }>

/** Started, or why not in plain words ('' when the writer's own flow has said why already). */
export type DraftStarted = { ok: true } | { ok: false; why: string }

export const DRAFT_BUSY = 'Something is being written into this scene already. Wait for it to finish (or stop it), then apply the draft.'
export const DRAFT_WAITING = 'The AI’s change in this scene is waiting for you. Accept or reject it first, then apply the draft.'

/** Why nothing more can be written into the scene now, or null. */
function busyIn(sceneId: ID): string | null {
  const bridge = editorBridge()
  const draft = useDraft.getState()
  if (draft.sceneId === sceneId && draft.phase !== 'idle') return DRAFT_BUSY
  if (bridge?.busy() || useApp.getState().activeGeneration?.sceneId === sceneId) return DRAFT_BUSY
  if (beatBeingWritten(sceneId) != null || redoing(sceneId) != null) return DRAFT_BUSY
  if (isWriting(setOf(useVariants.getState(), sceneId))) return 'Variants of this scene are being written. Stop them on the Variants page, or wait for them to finish.'
  if (waitingSuggestion()) return DRAFT_WAITING
  return null
}

/** Starts the writer's job a proposed draft names. Never throws. */
export async function startProposedDraft(p: DraftProposal, storyId?: ID | null): Promise<DraftStarted> {
  try {
    if (!useApp.getState().settings?.models.writer) return { ok: false, why: 'Choose a writer model in Settings first, then apply the draft.' }
    const editor = await sceneInPage(p.sceneId, storyId)
    const bridge = editorBridge()
    if (!editor || !bridge || bridge.sceneId !== p.sceneId) return { ok: false, why: `${p.sceneLabel} couldn’t be opened.` }
    const busy = busyIn(p.sceneId)
    if (busy) return { ok: false, why: busy }
    let started = false
    switch (p.mode) {
      case 'generate':
      case 'add_below': {
        // One draft at a time: one being written into another scene says where it is.
        if (busyElsewhere(p.sceneId)) return { ok: false, why: '' }
        // A scene that already has words is never written over: generate goes below them, as add_below does.
        const filled = bridge.hasText()
        started = await startDraft(p.sceneId, bridge, {
          replace: false,
          takeKeyboard: true,
          // The scene's own draft options, with the chat's direction (and length) for this draft only.
          options: () => ({
            ...(useApp.getState().draftOptions[p.sceneId] ?? BLANK_DRAFT_OPTIONS),
            direction: p.direction,
            ...(p.length ? { targetWords: p.length } : {}),
            ...(filled ? { addBelow: true } : {})
          })
        })
        break
      }
      case 'continue': {
        const at = continueAt(editor.state.doc, p.atParagraph)
        if (at === null) return { ok: false, why: `${p.sceneLabel} has no words to carry on from yet.` }
        started = await startTool('continue', { direction: p.direction, at })
        break
      }
      case 'redo_beat': {
        if (!p.beat) return { ok: false, why: 'This draft doesn’t say which beat to write again.' }
        const card = (await api.getScene(p.sceneId)).card
        const n = beatNumber(card.beats, p.beat)
        if (n === null) return { ok: false, why: `Beat ${p.beat.index} isn’t on the scene card any more.` }
        started = await redoBeat(p.sceneId, n, p.direction)
        break
      }
    }
    return started ? { ok: true } : { ok: false, why: '' }
  } catch (e) {
    return { ok: false, why: (e as Error)?.message || 'The draft couldn’t be started.' }
  }
}
