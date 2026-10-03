// Milestone 4: the handlers for src/shared/contracts/ask.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/ask/*; this file connects it to
// the open world, the settings, the chat and brainstorm model and the window.
import type { Handlers } from './index'
import type { AskApi, AskTurn } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { UserError, now } from '../util'
import * as world from '../world'
import * as repo from '../db/repo'
import { chatTurnRow } from '../db/ask'
import { emit } from '../events'
import { getSettings, getWritingPrefs } from '../settings'
import * as providers from '../ai/providers'
import { jobModel } from '../ai/jobModel'
import { startTask, type Emit } from '../ai/tasks'
import { providerNotes } from '../ai/draftFlow'
import { cachedCounter } from '../ai/context'
import { countTokens } from '../ai/tokenService'
import { finishAsk, prepareAsk } from '../ask/context'
import { chatInStory, chatTurns, listChats, newChatId, toTurn } from '../ask/chats'
import { saveNote, undoNote } from '../ask/note'
import { EDITOR_TOOLS, EditorAgent, MAX_STEPS } from '../ask/agent'
import { proposalsOf, saveProposals } from '../db/ask'

/** Questions in a chat are asked again and again with the same briefing: only what changed is counted again. */
const countCached = cachedCounter(countTokens)

/** Room for the answer itself, in tokens (about 1,100 words); thinking gets room on top, as the chat Thinking says. */
const REPLY_TOKENS = 1500
/** Brainstorming wants some invention; facts come from the briefing either way. */
const TEMPERATURE = 0.8
/** The longest question (a pasted passage, say). */
const QUESTION_LIMIT = 4000

/** The story the question is asked in: the open scene's, else the open story, else none. */
function storyOf(db: ReturnType<typeof world.db>, storyId: ID | null, sceneId: ID | null): ID | null {
  if (sceneId) {
    try {
      return repo.sceneLocation(db, sceneId).story.id
    } catch {
      // The scene was deleted meanwhile: the story it was in, if that is still there.
    }
  }
  if (!storyId) return null
  try {
    return repo.getStory(db, storyId).id
  } catch {
    return null
  }
}

/** Wraps a write so the world's "last changed" time moves (backups watch it), and every view of the memory reloads. */
function memoryWrite<T>(entryId: (r: T) => ID, fn: () => T): T {
  const db = world.db()
  const result = fn()
  repo.touchWorld(db)
  emit('memory:changed', { sceneId: null, entryIds: [entryId(result)] })
  return result
}

export const askHandlers: Handlers<keyof AskApi> = {
  askWorld: async (input) => {
    const question = String(input?.question ?? '').trim()
    if (!question) throw new UserError('Type a question first.')
    if (question.length > QUESTION_LIMIT) throw new UserError('That question is too long to ask. Shorten it to a few paragraphs.')
    const model = jobModel('chat', {
      settings: getSettings(),
      getProvider: providers.getProvider,
      providerTarget: providers.providerTarget
    })
    const db = world.db()
    const storyId = storyOf(db, input.storyId ?? null, input.sceneId ?? null)
    if (input.chatId && !chatInStory(input.chatId, storyId)) {
      throw new UserError('That chat was asked in another story. Start a new chat to ask about this one.')
    }
    const chatId = input.chatId ?? newChatId(storyId)
    const earlier = input.chatId ? chatTurns(db, chatId) : []
    const p = prepareAsk(db, {
      question,
      storyId,
      sceneId: input.sceneId ?? null,
      turns: earlier.map((t) => ({ question: t.question, answer: t.answer })),
      prefs: getWritingPrefs(),
      contextLength: model.choice.contextLength ?? null
    })
    const counts = await countCached(p.prepared.texts)
    if (world.maybeCurrentWorld()?.db !== db) throw new UserError('The world was closed before the question could be asked.')
    const b = finishAsk(p, counts)
    const notes = providerNotes(model.target.id)
    const send: Emit = (event, payload) => {
      if (event === 'task:done' && (payload as { status?: string }).status === 'complete') notes.onWorked()
      emit(event, payload)
    }
    // The editor chat: its tools look things up and note proposed changes, never change anything themselves.
    let generationId = ''
    const agent = new EditorAgent(
      db,
      { storyId, sceneId: input.sceneId ?? null, prefs: getWritingPrefs() },
      (label) => emit('ask:step', { taskId: input.taskId, generationId, label }),
      (proposals) => {
        if (generationId && db.open) saveProposals(db, generationId, proposals)
        emit('ask:proposals', { taskId: input.taskId, generationId, proposals })
      }
    )
    ;({ generationId } = startTask({
      db,
      taskId: input.taskId,
      job: 'chat',
      // A chat belongs to no scene (so no scene's records take its turns with them); the briefing says where it was asked.
      sceneId: '',
      model,
      messages: b.messages,
      reply: REPLY_TOKENS,
      temperature: TEMPERATURE,
      direction: question,
      blocks: b.blocks,
      entries: b.entries,
      extra: { chatId },
      emit: send,
      onKeyRejected: notes.onKeyRejected,
      agent: {
        tools: EDITOR_TOOLS,
        maxSteps: MAX_STEPS,
        run: (calls) => agent.runAll(calls),
        extraParams: () => (agent.proposals.length ? { proposals: agent.proposals } : {})
      }
    }))
    const row = chatTurnRow(db, generationId)
    const turn: AskTurn = row
      ? toTurn(row)
      : {
          generationId,
          chatId,
          question,
          answer: '',
          status: 'streaming',
          error: null,
          cost: null,
          costEstimated: false,
          cutOff: false,
          createdAt: now()
        }
    return turn
  },
  listChats: (storyId) => listChats(world.db(), storyId ?? null),
  getChat: (chatId) => chatTurns(world.db(), chatId),
  saveAskNote: (input) =>
    memoryWrite(
      (r) => r.entryId,
      () => saveNote(world.db(), input)
    ),
  setProposalStatus: (generationId, proposalId, status) => {
    const db = world.db()
    if (status !== 'pending' && status !== 'applied' && status !== 'declined') throw new UserError('Something went wrong. Try again.')
    const all = proposalsOf(db, generationId)
    if (!all.some((p) => p.id === proposalId)) return
    saveProposals(
      db,
      generationId,
      all.map((p) => (p.id === proposalId ? { ...p, status } : p))
    )
  },
  undoAskNote: (undo) => {
    memoryWrite(
      () => undo.entryId,
      () => undoNote(world.db(), undo)
    )
  }
}
