// The handlers for src/shared/contracts/chapterCards.ts: chapter cards, and writing them into the scene cards that
// follow them. The SQL is in src/main/db/repo.ts, the rules in src/shared/chapterCard.ts.
import type { Handlers } from './index'
import type { ChapterCardsApi } from '@shared/contracts/chapterCards'
import * as repo from '../db/repo'
import * as world from '../world'
import { fillChapterCard } from '../outline/chapterCard'

/** Wraps a write so the world's "last changed" time moves (backups watch it). */
function write<T>(fn: () => T): T {
  const out = fn()
  repo.touchWorld(world.db())
  return out
}

export const chapterCardsHandlers: Handlers<keyof ChapterCardsApi> = {
  getChapterCard: (chapterId) => repo.getChapterCard(world.db(), chapterId),
  updateChapterCard: (chapterId, card) => write(() => repo.saveChapterCard(world.db(), chapterId, card)),
  restoreChapterCard: (chapterId, card, scenes) => write(() => repo.restoreChapterCard(world.db(), chapterId, card, scenes ?? [])),
  fillChapterCard: (chapterId, names) => write(() => fillChapterCard(world.db(), chapterId, names))
}
