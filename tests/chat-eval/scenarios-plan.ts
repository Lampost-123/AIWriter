// The chat eval's plan requests set (chat-truth task 23): changes to a scene's card and to a chapter's plan (its goal,
// its length, its chapter card), asked in story A with "Morning Tally" (Ch 2, Sc 2) open, and two the chat can't do
// (moving a scene, reordering the chapters): those must get a plain answer that claims nothing (the "Answers claiming a
// change never made" row). Run with `--scenarios plan` (also in `all`). Every word is invented.

import type { Scenario } from './scenarios'

export const PLAN: Scenario[] = [
  {
    id: 'PL1',
    group: 'plan',
    rule: 'A change to the open scene’s card is a card change.',
    scene: 'tally',
    turns: [{ ask: 'Change this scene’s card: the goal should be that Ilse finds the missing barrels.', expect: { do: 'propose', kinds: ['card'] } }]
  },
  {
    id: 'PL2',
    group: 'plan',
    rule: 'A chapter’s goal is set through a chapter_card change (R5).',
    scene: 'tally',
    turns: [{ ask: 'Set chapter 2’s goal to: Ilse learns who took the barrels.', expect: { do: 'propose', kinds: ['chapterCard'] } }]
  },
  {
    id: 'PL3',
    group: 'plan',
    rule: 'A chapter’s length is set through a chapter_card change (R5).',
    scene: 'tally',
    turns: [{ ask: 'Make chapter 2 about 4,000 words long.', expect: { do: 'propose', kinds: ['chapterCard'] } }]
  },
  {
    id: 'PL4',
    group: 'plan',
    rule: 'A chapter card’s mood is a chapter_card change.',
    scene: 'tally',
    turns: [{ ask: 'Change chapter 3’s chapter card: the mood should be cold and quiet.', expect: { do: 'propose', kinds: ['chapterCard'] } }]
  },
  {
    id: 'PL5',
    group: 'plan',
    rule: 'Moving a scene can’t be done from the chat: a plain answer saying where, no proposal, no claim.',
    scene: 'tally',
    turns: [{ ask: 'Move scene 3 before scene 2.', expect: { do: 'no-propose' } }]
  },
  {
    id: 'PL6',
    group: 'plan',
    rule: 'Reordering the chapters can’t be done from the chat: a plain answer saying where, no proposal, no claim.',
    scene: 'tally',
    turns: [{ ask: 'Reorder the chapters so chapter 3 comes first.', expect: { do: 'no-propose' } }]
  }
]
