// Ask the world's chats: each turn is a 'chat' generation record, and a chat is the records that share
// its `params.chatId`. A chat's id starts with the id of the story it was asked in ('world:' when none
// was open), so the list of earlier chats is the open story's, and a chat never carries on in another
// story: an own version of events never reaches another story's chat that way. No Electron imports.

import type Database from 'better-sqlite3'
import type { AskTurn, ChatSummary } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import * as rows from '../db/ask'
import { newId } from '../util'

type DB = Database.Database

/** The start of every chat id in a story. */
export const chatPrefix = (storyId: ID | null): string => `${storyId ?? 'world'}:`

/** A new chat's id, in a story (or with none). */
export const newChatId = (storyId: ID | null): ID => `${chatPrefix(storyId)}${newId()}`

/** True when the chat was started in this story. */
export const chatInStory = (chatId: ID, storyId: ID | null): boolean => chatId.startsWith(chatPrefix(storyId))

/** A chat's name in the list: its first question on one line, cut at a word. */
export function chatTitle(question: string, max = 80): string {
  const t = question.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t || 'A question'
  const cut = t.slice(0, max - 1)
  const word = cut.replace(/\s+\S*$/, '')
  return `${(word.length > max / 2 ? word : cut).replace(/[\s,;:.]+$/, '')}…`
}

/** The chats asked in a story, the most recent first. */
export function listChats(db: DB, storyId: ID | null, limit = 30): ChatSummary[] {
  return rows.listChatRows(db, chatPrefix(storyId), limit).map((r) => ({
    chatId: r.chatId,
    title: chatTitle(r.first),
    turns: r.turns,
    updatedAt: r.updatedAt
  }))
}

export const toTurn = (r: rows.TurnRow): AskTurn => ({
  generationId: r.id,
  chatId: r.chatId,
  question: r.question,
  answer: r.answer,
  status: r.status,
  error: r.error,
  cost: r.cost,
  costEstimated: r.costEstimated,
  cutOff: r.cutOff,
  createdAt: r.createdAt,
  ...(r.steps.length ? { steps: r.steps } : {}),
  ...(r.proposals.length ? { proposals: r.proposals } : {}),
  ...(r.choice ? { choice: r.choice } : {}),
  ...(r.savedNote ? { saved: r.savedNote } : {})
})

/** A chat's turns, oldest first. */
export const chatTurns = (db: DB, chatId: ID): AskTurn[] => rows.chatTurnRows(db, chatId).map(toTurn)
