// A chat is the 'chat' records that share its id; each story has its own chats.
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import type { SavedNote } from '@shared/contracts/ask'
import * as gens from '../db/generations'
import { setSavedNote } from '../db/ask'
import { chatInStory, chatTitle, chatTurns, listChats, newChatId } from './chats'

type DB = ReturnType<typeof memoryWorld>

let n = 0
/** A turn of a chat as the task runner records it. */
function record(
  db: DB,
  o: { chatId: ID | null; question: string; answer?: string; job?: 'chat' | 'draft'; at: number; status?: 'complete' | 'stopped' }
): ID {
  const id = `g${++n}`
  gens.insertGeneration(db, {
    id,
    sceneId: '',
    job: o.job ?? 'chat',
    providerId: 'p',
    providerName: 'Fake',
    modelId: 'fake/model',
    params: { temperature: 0.8, top_p: 0.95, max_tokens: 1500, ...(o.chatId ? { chatId: o.chatId } : {}) },
    direction: o.question,
    blocks: [],
    messages: [],
    budget: { contextLength: 8000, reserved: 1500, available: 6500, used: 100 },
    entries: [],
    createdAt: new Date(Date.parse('2026-10-01T10:00:00.000Z') + o.at * 60_000).toISOString()
  })
  gens.finishGeneration(db, id, {
    status: o.status ?? 'complete',
    error: null,
    response: o.answer ?? `Answer to ${o.question}`,
    promptTokens: 100,
    completionTokens: 50,
    cost: 0.002,
    finishedAt: new Date().toISOString()
  })
  return id
}

describe('chats', () => {
  it('belong to the story they were asked in', () => {
    const id = newChatId('story-1')
    expect(chatInStory(id, 'story-1')).toBe(true)
    expect(chatInStory(id, 'story-2')).toBe(false)
    expect(chatInStory(id, null)).toBe(false)
    expect(chatInStory(newChatId(null), null)).toBe(true)
  })

  it('are listed for their story, the most recently asked in first, named by their first question', () => {
    const db = memoryWorld()
    const a = newChatId('s1')
    const b = newChatId('s1')
    const other = newChatId('s2')
    record(db, { chatId: a, question: 'Who is Mara?', at: 1 })
    record(db, { chatId: b, question: 'Tavern names?', at: 2 })
    record(db, { chatId: a, question: 'And Tobin?', at: 3 })
    record(db, { chatId: other, question: 'Somewhere else?', at: 4 })
    record(db, { chatId: null, question: 'A draft', job: 'draft', at: 5 })
    const chats = listChats(db, 's1')
    expect(chats.map((c) => [c.chatId, c.title, c.turns])).toEqual([
      [a, 'Who is Mara?', 2],
      [b, 'Tavern names?', 1]
    ])
    expect(listChats(db, 's2').map((c) => c.chatId)).toEqual([other])
    expect(listChats(db, null)).toEqual([])
  })

  it('give their turns oldest first, with what came back', () => {
    const db = memoryWorld()
    const chat = newChatId('s1')
    record(db, { chatId: chat, question: 'First?', answer: 'One.', at: 1 })
    record(db, { chatId: chat, question: 'Second?', answer: 'Two so f', at: 2, status: 'stopped' })
    const turns = chatTurns(db, chat)
    expect(turns.map((t) => [t.question, t.answer, t.status])).toEqual([
      ['First?', 'One.', 'complete'],
      ['Second?', 'Two so f', 'stopped']
    ])
    expect(turns[0]).toMatchObject({ chatId: chat, cost: 0.002, costEstimated: false, cutOff: false })
  })

  it('keep the note saved from an answer with its turn, so it shows "Saved" after a restart', () => {
    const db = memoryWorld()
    const chat = newChatId('s1')
    const id = record(db, { chatId: chat, question: 'Who is Tobin?', answer: 'The ferryman.', at: 1 })
    const draft = record(db, { chatId: null, question: 'A draft', job: 'draft', at: 2 })
    expect(chatTurns(db, chat)[0].saved).toBeUndefined()
    const note: SavedNote = {
      entryId: 'e1',
      kind: 'character',
      name: 'Tobin',
      created: false,
      onlyIn: null,
      asOf: null,
      undo: { kind: 'added', entryId: 'e1', text: 'The ferryman.', before: '', origin: null, byHand: false }
    }
    setSavedNote(db, id, note)
    setSavedNote(db, draft, note)
    expect(chatTurns(db, chat)[0].saved).toEqual(note)
    expect(chatTurns(db, chat)[0].answer).toBe('The ferryman.')
    // A record that isn't a chat turn is left alone.
    expect(gens.getGeneration(db, draft).params.savedNote).toBeUndefined()
    setSavedNote(db, id, null)
    expect(chatTurns(db, chat)[0].saved).toBeUndefined()
  })

  it('are named by a long first question cut at a word', () => {
    const q = 'What would happen if the old ferryman who keeps the river crossing decided one winter night to tell everyone the truth?'
    const t = chatTitle(q)
    expect(t.length).toBeLessThanOrEqual(80)
    expect(t.endsWith('…')).toBe(true)
    expect(q.startsWith(t.slice(0, -1))).toBe(true)
    expect(chatTitle('  Who   is\nMara? ')).toBe('Who is Mara?')
  })
})
