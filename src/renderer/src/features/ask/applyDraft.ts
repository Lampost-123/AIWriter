// The editor chat's proposed draft (propose_draft, lab switch DRAFT), when Adam clicks Apply: it starts the writer's
// OWN job for the scene with the chat's direction, never a generation of its own, so everything after is as usual:
//   generate / add_below  Generate's draft (draftRun.startDraft): into an empty scene, or below its words (both
//                         modes: a scene's words are never written over); Ctrl+Z and History as for any draft
//   continue              Continue (features/edits): a tracked change at the end of the paragraph named, or of the
//                         scene, to Accept or Reject
//   redo_beat             Beat by beat's Write it again (features/beats/redo.ts) for the card's beat, with the
//                         direction as its note
// The scene opens first if it isn't open. Nothing starts while anything else is being written into that scene.
// Started is not applied: `landed` says when the words are in (the draft complete, the change accepted in the page),
// or why not (stopped, failed, rejected), so the chat's card turns Applied or waits again (applyProposal.ts).
import type { Proposal } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { BLANK_DRAFT_OPTIONS } from '@/features/generate/draftOptions'
import { busyElsewhere, startDraft, useDraft } from '@/features/generate/draftRun'
import { changeAlive, changeEnded, startTool, waitingSuggestion } from '@/features/edits/session'
import { activeSuggestion, suggestionsOf, type GoneReason } from '@/features/edits/suggestions'
import { beatBeingWritten } from '@/features/beats/flow'
import { redoBeat, redoing } from '@/features/beats/redo'
import { isWriting, setOf, useVariants } from '@/features/variants/store'
import { beatNumber, continueAt } from './askEdits'
import { heldWhy, notOpened, sceneInPage } from './sceneInPage'

export type DraftProposal = Extract<Proposal, { kind: 'draft' }>

/** How a started job ended: its words landed, or why not in plain words. */
export type Landed = { ok: true } | { ok: false; why: string }

/**
 * Started (with how it will end: `landed`), or why not in plain words ('' when the writer's own flow has said why
 * already; the chat then says "That change couldn't be made").
 */
export type DraftStarted = { ok: true; landed: Promise<Landed> } | { ok: false; why: string }

/** How often a started job is looked at to see whether it has ended. */
export const LANDED_POLL_MS = 400

/** Resolves with the first answer `check` gives (looked at now and then). */
function until(check: () => Landed | null): Promise<Landed> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const r = check()
      if (!r) return
      clearInterval(timer)
      resolve(r)
    }, LANDED_POLL_MS)
  })
}

/** Generate's draft for the scene, started at `since`: complete is landed; stopped or failed is said plainly. */
export const draftLanded = (sceneId: ID, label: string, since: number): Promise<Landed> =>
  until(() => {
    const last = useDraft.getState().last
    if (!last || last.sceneId !== sceneId || last.at < since) return null
    if (last.status === 'complete') return { ok: true }
    if (last.status === 'stopped') return { ok: false, why: `The draft in ${label} was stopped before it finished, so the change is waiting again.` }
    return { ok: false, why: `The draft in ${label} didn’t finish, so the change is waiting again.${last.error ? ` ${last.error}` : ''}` }
  })

/** Why a change in the page went without being accepted, in plain words. */
const GONE_WHY: Record<Exclude<GoneReason, 'accepted'>, string> = {
  rejected: 'You rejected it in the page, so the change is waiting again.',
  edited: 'The words under it were edited, so it was dropped and the change is waiting again.',
  cleared: 'It was taken out of the page before it went in, so the change is waiting again.',
  replaced: 'The scene’s text was replaced, so it was dropped and the change is waiting again.',
  draft: 'A new draft started, so it was dropped and the change is waiting again.'
}

/** The AI's change waiting (or being written) in the page for this scene, by its id; null when there is none. */
export function changeInPage(sceneId: ID): ID | null {
  const b = editorBridge()
  const editor = b?.sceneId === sceneId ? b.editor : null
  return editor && !editor.isDestroyed ? (activeSuggestion(editor.state)?.id ?? null) : null
}

/** Said when the change went from the page without Adam accepting or rejecting it (another scene, the page closed). */
export const DROPPED_WHY = 'It went from the page before you accepted it (another scene or story was opened), so the change is waiting again.'

/**
 * The change `id` in the page: landed once Adam accepts it, or why not once it goes another way. While another scene
 * shows, it waits (a change being written goes on out of the page and comes back with its scene) for as long as the AI
 * edits part still has it; once it has let it go (a ready change left behind, its scene's words changed meanwhile, the
 * page closed), it ends there.
 */
export const pageLanded = (sceneId: ID, id: ID): Promise<Landed> =>
  until(() => {
    const b = editorBridge()
    const editor = b?.sceneId === sceneId ? b.editor : null
    if (b?.editor?.isDestroyed) return endedLanded(id)
    if (editor) {
      const s = suggestionsOf(editor.state)
      if (s.active?.id !== id && s.gone?.id === id) return goneLanded(s.gone.reason)
    }
    return changeAlive(id) ? null : endedLanded(id)
  })

const goneLanded = (reason: GoneReason | 'scene'): Landed =>
  reason === 'accepted' ? { ok: true } : { ok: false, why: reason === 'scene' ? DROPPED_WHY : GONE_WHY[reason] }

/**
 * How a change no longer in the page ended: as the AI edits part saw it end (accepted or rejected just before another
 * scene opened), else dropped.
 */
const endedLanded = (id: ID): Landed => goneLanded(changeEnded(id) ?? 'scene')

/** What a writer's job just started in the page will do: a change to accept, else words written straight in. */
function inPageLanded(sceneId: ID): Promise<Landed> {
  const id = changeInPage(sceneId)
  if (id) return pageLanded(sceneId, id)
  // Beat by beat's own Write it again writes the beat straight into the page: landed when it is written.
  if (beatBeingWritten(sceneId) != null) return until(() => (beatBeingWritten(sceneId) == null ? { ok: true } : null))
  return Promise.resolve({ ok: true })
}

export const DRAFT_BUSY = 'Something is being written into this scene already. Wait for it to finish (or stop it), then apply the draft.'
export const DRAFT_WAITING = 'The AI’s change in this scene is waiting for you. Accept or reject it first, then apply the draft.'

/** Why nothing more can be written into the scene now, or null. */
function busyIn(sceneId: ID): string | null {
  const held = heldWhy(sceneId)
  if (held) return held
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
    // Write the chapter holds the scene: said before the page is moved to it.
    const held = heldWhy(p.sceneId)
    if (held) return { ok: false, why: held }
    const editor = await sceneInPage(p.sceneId, storyId)
    const bridge = editorBridge()
    if (!editor || !bridge || bridge.sceneId !== p.sceneId) return { ok: false, why: await notOpened(p.sceneId, p.sceneLabel) }
    const busy = busyIn(p.sceneId)
    if (busy) return { ok: false, why: busy }
    let started = false
    const since = Date.now()
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
    if (!started) return { ok: false, why: '' }
    const landed = p.mode === 'generate' || p.mode === 'add_below' ? draftLanded(p.sceneId, p.sceneLabel, since) : inPageLanded(p.sceneId)
    return { ok: true, landed }
  } catch (e) {
    return { ok: false, why: (e as Error)?.message || 'The draft couldn’t be started.' }
  }
}
