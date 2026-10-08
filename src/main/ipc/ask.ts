// Milestone 4: the handlers for src/shared/contracts/ask.ts (one part owns both files). See
// docs/ARCHITECTURE.md, "Milestone 4". The work is done in src/main/ask/*; this file connects it to
// the open world, the settings, the chat and brainstorm model and the window.
import type { Handlers } from './index'
import { contractLastWords } from '@shared/askChanges'
import type { AskIntent } from '@shared/askIntent'
import type { Proposal } from '@shared/contracts/ask'
import { chatExp } from '../ask/exp'
import { compactBlocks, pastAnswer, stepPreamble } from '../ask/history'
import { asksForNewProse, bareRequest, editorNudge, MAX_EDIT_NUDGES, routeIntent, temperatureFor } from '../ask/route'

/**
 * An earlier answer as the model is shown it again: with the changes it proposed through its tools, so it sees itself
 * proposing (a chat whose past answers read as words alone teaches the model to write changes out, not propose them).
 * With AIWRITE_EXP_CHAT_HISTORY on, each proposal says what it changed and the answer is trimmed (ask/history.ts).
 * With AIWRITE_EXP_CHAT_FORMAT on, an answer in blocks is made compact first (option titles kept, ::more left out).
 */
function withProposals(full: string, proposals: Proposal[]): string {
  const answer = chatExp('FORMAT') ? compactBlocks(full) : full
  if (chatExp('HISTORY')) return pastAnswer(answer, proposals, chatExp('ACTFIRST'))
  if (!proposals.length) return answer
  const what = proposals.map((p) => `change ${p.id} (${p.kind === 'text' ? 'an edit' : p.kind === 'passage' ? 'a rewrite' : p.kind}, ${p.status})`).join(', ')
  return `${answer}\n\n[Proposed with the tools: ${what}]`
}
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
import { EDIT_BRIEFING_CAP, finishAsk, PAGE_BLOCK, prepareAsk } from '../ask/context'
import { aboutTheWords, pageText } from '../ask/page'
import { chatInStory, chatTurns, listChats, newChatId, toTurn } from '../ask/chats'
import { saveNote, undoNote } from '../ask/note'
import { EditorAgent, MAX_STEPS } from '../ask/agent'
import { proposalsOf, saveProposals, setOptionMark, setSavedNote } from '../db/ask'

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
    // The chat overhaul's switches, each read once per question.
    const route = chatExp('ROUTE')
    const contract = chatExp('CONTRACT')
    // A question quoting words selected in the page ("Ask about this", "Edit this") already has the words to change.
    const quoted = typeof input.selection?.text === 'string' && !!input.selection.text.trim()
    // What the question asks for, told from its words (no model call; ask/route.ts): used only by the switches on.
    const routeInput = { question, mode: input.mode, lastAnswer: earlier.at(-1)?.answer ?? null, selection: quoted ? input.selection?.text : null }
    const routed = routeIntent(routeInput)
    const intent: AskIntent | null = route ? routed : null
    // A bare request ("Shorten it." with nothing selected and nothing said before): unsure, and asked rather than guessed.
    const unclear = intent === 'unsure' && bareRequest(routeInput)
    // ACTFIRST (the Phase 2 fix): an edit reads before it asks, and "write the next bit" is made to draft.
    const actFirst = chatExp('ACTFIRST')
    const newProse = actFirst && intent === 'edit' && asksForNewProse(question)
    // Phase 3. SCENE: an edit (or an unclear request, or one about a selection) gets the open scene's numbered words in
    // the briefing, so it can propose without reading first. CACHE: the briefing's front stays the same from question
    // to question. CAP: an edit's briefing is kept to EDIT_BRIEFING_CAP tokens.
    const sceneId = input.sceneId ?? null
    const words =
      chatExp('SCENE') && sceneId && (routed === 'edit' || routed === 'unsure' || quoted)
        ? pageText(db, sceneId, { question, selection: quoted ? input.selection : null })
        : null
    // A long scene's end, with nothing to place the window by, goes only for new prose (it carries on from there):
    // otherwise the DeepSeek run read the scene anyway in 9 of 10 such turns, and one looped re-reading it.
    const page = words && (words.whole || words.anchored || newProse) ? words : null
    const p = prepareAsk(db, {
      question,
      storyId,
      sceneId: input.sceneId ?? null,
      turns: earlier.map((t) => ({ question: t.question, answer: withProposals(t.answer, t.proposals ?? []) })),
      prefs: getWritingPrefs(),
      contextLength: model.choice.contextLength ?? null,
      // The answer may use tools: room is kept for what they bring back (ai/tasks.ts keeps them within it).
      withTools: true,
      ...(intent ? { intent } : {}),
      ...(unclear ? { unclear: true } : {}),
      ...(page ? { page } : {}),
      ...(chatExp('CACHE') ? { cache: true } : {}),
      ...(chatExp('CAP') && routed === 'edit' ? { briefingCap: EDIT_BRIEFING_CAP } : {})
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
    // The page went in (not left out to fit): its words count as read, so an edit's first request may be made to propose;
    // not for a request about the story's records (an issue, a chapter card, a thread), which looks them up first.
    const wordsOnPage = !!page && b.blocks.some((x) => x.id === PAGE_BLOCK.id && !x.dropped) && aboutTheWords(question)
    const agent = new EditorAgent(
      db,
      {
        storyId,
        sceneId: input.sceneId ?? null,
        prefs: getWritingPrefs(),
        ...(intent ? { intent } : {}),
        ...(quoted ? { wordsInQuestion: true } : {}),
        ...(newProse ? { newProse: true } : {}),
        ...(wordsOnPage ? { wordsOnPage: true } : {}),
        ...(unclear ? { unclear: true } : {})
      },
      // Each step's label: no longer sent to the window (the tool rows, 'ask:tool' below, show each call; Phase 4).
      () => undefined,
      (proposals) => {
        if (generationId && db.open) saveProposals(db, generationId, proposals)
        emit('ask:proposals', { taskId: input.taskId, generationId, proposals })
      },
      (choice) => emit('ask:choice', { taskId: input.taskId, generationId, choice }),
      // Each tool call as it starts and ends (the Ask panel's tool rows).
      (phase, call) => emit('ask:tool', { taskId: input.taskId, generationId, phase, call })
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
      temperature: chatExp('TEMP') ? temperatureFor(routed) : TEMPERATURE,
      direction: question,
      blocks: b.blocks,
      entries: b.entries,
      extra: { chatId },
      emit: send,
      onKeyRejected: notes.onKeyRejected,
      agent: {
        // The same list on every request of the answer (the lab switches are read once, by the agent).
        tools: agent.tools,
        maxSteps: MAX_STEPS,
        ended: () => agent.ended(),
        forceTool: () => agent.forceTool(),
        // With the contract on, a short "I'll read the scene first" written before tool calls is left out of the reply.
        ...(contract ? { dropBeforeTools: stepPreamble } : {}),
        run: (calls, step, info) => agent.runAll(calls, step, info?.cutOff ?? false),
        onCallStart: (slot, name, step) => agent.callStarted(slot, name, step),
        // With the contract on, the last words say what was proposed or what blocked it (never "ask again").
        lastWords: () => (contract ? contractLastWords(agent.proposals.map((x) => x.id), intent) : agent.lastWords()),
        // An answer with no proposals is asked once more when it claims changes or the writer asked for edits; with
        // routing on, an edit is asked again whatever its wording, twice at most, and an answer or ideas never are.
        // Never once the chat has asked the writer a question with options (ask_user ends the answer).
        maxNudges: route ? MAX_EDIT_NUDGES : 1,
        nudge: (answer, attempt) =>
          editorNudge({
            answer,
            attempt,
            question,
            proposed: agent.proposals.length,
            intent,
            route,
            contract,
            asked: !!agent.choice,
            // With a scene open, an edit's question before reading is sent back to read first (ACTFIRST).
            ...(actFirst && input.sceneId ? { read: agent.knowsWords() } : {})
          }),
        // The proposals and the question it ended with (agent.extraParams), and the routed intent.
        extraParams: () => ({ ...agent.extraParams(), ...(intent ? { intent } : {}) })
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
      () => {
        const db = world.db()
        const note = saveNote(db, input)
        // Kept with the answer's record, so it still shows "Saved" after a restart (and isn't saved twice).
        if (input.generationId) setSavedNote(db, input.generationId, note)
        return note
      }
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
  setOptionMark: (generationId, card, mark) => {
    const n = Number(card)
    if (!Number.isInteger(n) || n < 1) throw new UserError('Something went wrong. Try again.')
    setOptionMark(world.db(), generationId, n, mark && typeof mark === 'object' ? mark : null)
  },
  undoAskNote: (undo, generationId) => {
    memoryWrite(
      () => undo.entryId,
      () => {
        const db = world.db()
        undoNote(db, undo)
        if (generationId) setSavedNote(db, generationId, null)
      }
    )
  }
}
