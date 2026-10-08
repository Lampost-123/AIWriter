// The chat eval's Phase 3 text-tools set (lab switch TEXTTOOLS): asks that want a new paragraph at a point (insert), whole
// paragraphs out (cut), where something is mentioned (find_mentions) or a change to the card's beats (beats). Run with
// `--scenarios p3` (or `all`). The proposal kinds are held strictly to the new kinds, so the score says whether the
// model picks them; with TEXTTOOLS off the same asks show what it did before. Every word is invented (world.ts).

import type { Scenario } from './scenarios'

export const P3TEXT: Scenario[] = [
  {
    id: 'T01',
    group: 'p3-text',
    rule: 'A new line at a named point is an insert after that paragraph.',
    scene: 'tally',
    turns: [{ ask: 'Add a line after paragraph 3 where Ilse hesitates before she answers.', expect: { do: 'propose', kinds: ['insert'], touches: 'Patch barked at the gulls' } }]
  },
  {
    id: 'T02',
    group: 'p3-text',
    rule: 'A new paragraph before the last one, described by its content, is an insert.',
    scene: 'tally',
    turns: [{ ask: 'Put a short paragraph just before Hesper sends her off, where Pitch whines at the door.', expect: { do: 'propose', kinds: ['insert'], touches: 'Go and find him' } }]
  },
  {
    id: 'T03',
    group: 'p3-text',
    rule: 'Cutting a paragraph named by what happens in it is a cut.',
    scene: 'tally',
    turns: [{ ask: 'Cut the paragraph where Pitch comes in wet and shakes himself.', expect: { do: 'propose', kinds: ['cut'], touches: 'Pitch came in wet' } }]
  },
  {
    id: 'T04',
    group: 'p3-text',
    rule: 'Cutting two paragraphs in a row is one cut over both.',
    scene: 'steps',
    turns: [{ ask: 'Cut the bit where Ilse calls out that he is late and Bram jokes about the moon. Both paragraphs.', expect: { do: 'propose', kinds: ['cut'], touches: 'You’re late' } }]
  },
  {
    id: 'T05',
    group: 'p3-text',
    rule: '"Where do I mention…" finds the mentions (find_mentions) and proposes nothing.',
    scene: 'tally',
    turns: [{ ask: 'Where do I mention lamp oil in this story?', expect: { do: 'no-propose', tool: 'find_mentions' } }]
  },
  {
    id: 'T06',
    group: 'p3-text',
    rule: 'Every place an item comes up, by its name: find_mentions, no proposal.',
    scene: 'steps',
    turns: [{ ask: 'List every scene where the tally book comes up, and roughly where.', expect: { do: 'no-propose', tool: 'find_mentions' } }]
  },
  {
    id: 'T07',
    group: 'p3-text',
    rule: 'Adding a beat to the card is a beats change.',
    scene: 'tally',
    turns: [{ ask: 'Add a beat to this scene’s card: Ilse finds the letter.', expect: { do: 'propose', kinds: ['beats'] } }]
  }
]
