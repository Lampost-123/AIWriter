// The chat eval's 40 scenarios (Adam, 2026-10-08: the editor chat has to be asked several times before it proposes a
// change). Each names the rule it tests, where it is asked (the open scene of story A), an optional selection (sent as
// "Ask about this" sends it: quoted at the top of the question, flattened and cut at 1,500 characters), the questions
// (two for a follow-up), and what should happen at each turn. All words are invented (world.ts).
//
// Groups: edit (15 clear edits), selection (6 selections with a vague ask), large (5 large rewrites / "write the next
// bit"), question (6 questions and brainstorms: must NOT propose), ambiguous (4: should ask one question first),
// followup (4 two-turn follow-ups: "option 2", "yes"). These 40 are the "core" set; real.ts holds the "real" set
// (Phase 1: long chats, a big briefing, vague phrasing, follow-ups, "write the next bit", questions saying "change").
// --scenarios core (the default) | real | all | subset | E01,R05,...

import { askAboutQuote, SCENES, vigilParagraphs } from './world'
import { REAL } from './real'
import { P3TEXT } from './scenarios-p3text'
import { P3STORY } from './scenarios-p3story'

export type Group =
  | 'edit'
  | 'selection'
  | 'large'
  | 'question'
  | 'ambiguous'
  | 'followup'
  | 'r-history'
  | 'r-vague'
  | 'r-followup'
  | 'r-continue'
  | 'r-change-q'
  | 'p3-text'
  | 'p3-story'

/** What should happen at a turn. */
export type Outcome =
  /**
   * At least one proposal that applies; `kinds` limits which count, `touches` names words in the paragraph it should
   * change. `draft`: a propose_draft hand-off counts too ("write the next bit"). `orAsk`: one question to the writer
   * (ask_user, or a question with no proposal) is as good (a vague ask with no selection).
   */
  | { do: 'propose'; kinds?: ProposalKind[]; touches?: string; draft?: boolean; orAsk?: boolean }
  /** No proposal (a question, a brainstorm, options offered); `tool`: and the turn called this tool (Phase 3). */
  | { do: 'no-propose'; tool?: string }
  /** No proposal, and the answer asks the writer a question. */
  | { do: 'ask' }
  /** Either is fine (a judgement call); counted for cost and leaks only. */
  | { do: 'any' }

export type ProposalKind =
  | 'text'
  | 'passage'
  | 'card'
  | 'entry'
  | 'newEntry'
  | 'newScene'
  | 'newChapter'
  | 'rename'
  | 'insert'
  | 'cut'
  | 'beats'
  | 'issueFix'
  | 'chapterCard'
  | 'thread'

/** An earlier turn of the chat, seeded as the app stores one (a 'chat' generation record) before the first question. */
export interface HistoryTurn {
  q: string
  a: string
  /** Changes that turn proposed (text edits only), with what the writer made of each. */
  proposals?: { kind: 'text'; scene: string; find: string; replace: string; status: 'pending' | 'applied' | 'declined' }[]
}

export interface Scenario {
  id: string
  group: Group
  /** Asked in story C (bigWorld.ts): a briefing of 30-60k tokens. Its scene keys are bigWorld's. */
  big?: boolean
  /** 'story': needs the story set's plot threads and issue in the world (scenarios-p3story.ts seedStory). */
  seed?: 'story'
  /** Earlier turns of the chat (oldest first), seeded before the first question. */
  history?: HistoryTurn[]
  /** The rule it tests, in plain words. */
  rule: string
  /** The open scene (world.ts SCENES key); null: the story is open, no scene. */
  scene: string | null
  /** Words selected in the page ("Ask about this"), quoted before the first question. */
  selection?: string
  turns: { ask: string; expect: Outcome }[]
}

const para = (scene: string, i: number): string => {
  const s = SCENES.find((x) => x.key === scene)
  if (!s) throw new Error(`No scene ${scene}`)
  return s.paragraphs[i]
}

const EDIT = (kinds: ProposalKind[] = ['text', 'passage']): { do: 'propose'; kinds: ProposalKind[] } => ({ do: 'propose', kinds })

export const CORE: Scenario[] = [
  // ---------- 15 clear edits ----------
  { id: 'E01', group: 'edit', rule: 'A plain typo fix is proposed on the first ask.', scene: 'tally', turns: [{ ask: 'Fix the typo "teh" in this scene.', expect: { ...EDIT(), touches: 'teh tide' } }] },
  { id: 'E02', group: 'edit', rule: 'A misspelt name is fixed where it is (one place).', scene: 'tally', turns: [{ ask: 'I misspelled Bram as Brom somewhere in this scene. Fix it.', expect: { ...EDIT(), touches: 'Brom will know' } }] },
  { id: 'E03', group: 'edit', rule: 'A one-word change in a named paragraph.', scene: 'tally', turns: [{ ask: 'In the paragraph where Hesper opens the tally book, change "grey" to "slate-blue".', expect: { ...EDIT(), touches: 'grey shawl' } }] },
  { id: 'E04', group: 'edit', rule: 'Cutting a sentence quoted exactly.', scene: 'tally', turns: [{ ask: 'Cut the sentence "It was, after all, only Tuesday."', expect: { ...EDIT(), touches: 'only Tuesday' } }] },
  { id: 'E05', group: 'edit', rule: 'A line with curly quotes and apostrophes, asked in straight quotes.', scene: 'tally', turns: [{ ask: `Change Hesper's line "I don't care what the ledger says" to "I don't trust what the ledger says".`, expect: { ...EDIT(), touches: 'ledger says' } }] },
  { id: 'E06', group: 'edit', rule: 'A name fixed for consistency (the dog is Pitch).', scene: 'tally', turns: [{ ask: 'The dog is called Pitch, not Patch. Fix it.', expect: { ...EDIT(), touches: 'Patch barked' } }] },
  { id: 'E07', group: 'edit', rule: 'A doubled word.', scene: 'tally', turns: [{ ask: 'There is a doubled "the the" in the opening paragraph. Fix it.', expect: { ...EDIT(), touches: 'the the morning' } }] },
  { id: 'E08', group: 'edit', rule: 'Punctuation around em dashes.', scene: 'tally', turns: [{ ask: 'Replace the dashes in "slow, then sudden" with commas.', expect: { ...EDIT(), touches: 'slow, then sudden' } }] },
  { id: 'E09', group: 'edit', rule: 'Two small fixes in one sentence become one change.', scene: 'tally', turns: [{ ask: 'In Hesper’s line about the water, fix "teh" and change "last night" to "yesterday".', expect: { ...EDIT(), touches: 'teh tide' } }] },
  { id: 'E10', group: 'edit', rule: 'Tightening a named paragraph (a clear ask, keeping the voice).', scene: 'steps', turns: [{ ask: 'Tighten the first paragraph, it is wordy. Keep my voice.', expect: { ...EDIT(), touches: 'The ferry steps at Saltreach' } }] },
  { id: 'E11', group: 'edit', rule: 'An edit inside a paragraph that has line breaks.', scene: 'office', turns: [{ ask: 'In Hesper’s note, change "Come before the bell" to "Come before the second bell".', expect: { ...EDIT(), touches: 'Come before the bell' } }] },
  { id: 'E12', group: 'edit', rule: 'An edit across a line break (one paragraph, two lines).', scene: 'office', turns: [{ ask: 'In Hesper’s note, join the first two lines into one sentence.', expect: { ...EDIT(), touches: 'Come before the bell' } }] },
  { id: 'E13', group: 'edit', rule: 'An edit past the first 24,000 characters of a long scene (read_scene cuts it short).', scene: 'vigil', turns: [{ ask: 'Near the end of this scene, Quill lights the seventh lamp. Make it the twelfth lamp.', expect: { ...EDIT(), touches: 'seventh lamp' } }] },
  { id: 'E14', group: 'edit', rule: 'A typo early in a long scene with many repeated sentences.', scene: 'vigil', turns: [{ ask: 'Fix the spelling of "recieve" in this scene.', expect: { ...EDIT(), touches: 'recieve' } }] },
  { id: 'E15', group: 'edit', rule: 'A clear change to the memory (an entry), not the page.', scene: 'tally', turns: [{ ask: 'Bram Tolley is thirty-four, not forty-three. Update his entry.', expect: { do: 'propose', kinds: ['entry'] } }] },

  // ---------- 6 selections with a vague ask ----------
  { id: 'S01', group: 'selection', rule: 'A selection and "this is clunky" means: propose a better version of the selection.', scene: 'tally', selection: para('tally', 1), turns: [{ ask: 'This is clunky. Make it better.', expect: { ...EDIT(), touches: 'opened the tally book with two fingers' } }] },
  { id: 'S02', group: 'selection', rule: 'A selection and "tighten this".', scene: 'steps', selection: para('steps', 0), turns: [{ ask: 'tighten this', expect: { ...EDIT(), touches: 'The ferry steps at Saltreach' } }] },
  { id: 'S03', group: 'selection', rule: 'A selection with line breaks in it (flattened in the quote).', scene: 'office', selection: para('office', 2), turns: [{ ask: 'Can this be more ominous?', expect: { ...EDIT(), touches: 'Come before the bell' } }] },
  { id: 'S04', group: 'selection', rule: 'A selection with curly quotes and em dashes, and "fix this".', scene: 'tally', selection: para('tally', 4), turns: [{ ask: 'fix this', expect: { ...EDIT(), touches: 'teh tide' } }] },
  {
    id: 'S05',
    group: 'selection',
    rule: 'A long selection (several paragraphs, over 1,500 characters: the quote is cut short).',
    scene: 'vigil',
    selection: vigilParagraphs().slice(2, 7).join('\n\n'),
    turns: [{ ask: 'Too much telling here. Show it instead.', expect: { ...EDIT(), touches: 'Quill came up the stair an hour after dark' } }]
  },
  { id: 'S06', group: 'selection', rule: 'A selection and "punch this up".', scene: 'tally', selection: para('tally', 5), turns: [{ ask: 'punch this up', expect: { ...EDIT(), touches: 'Pitch came in wet' } }] },

  // ---------- 5 large rewrites / "write the next bit" ----------
  { id: 'L01', group: 'large', rule: 'Rewriting the opening of a scene across paragraphs (propose_rewrite).', scene: 'tally', turns: [{ ask: 'Rewrite the opening three paragraphs so the scene starts in the middle of the argument.', expect: { do: 'propose', kinds: ['passage', 'text'], touches: 'The tally book lay open' } }] },
  { id: 'L02', group: 'large', rule: '"Write the next bit": new paragraphs at the end of the open scene.', scene: 'tally', turns: [{ ask: 'Write the next bit: Ilse goes down to the harbour to find Bram. A couple of paragraphs.', expect: { do: 'propose', kinds: ['passage', 'text'], touches: 'Go and find him' } }] },
  { id: 'L03', group: 'large', rule: 'Pushing a whole exchange harder (a beat across several paragraphs).', scene: 'vigil', turns: [{ ask: 'Push the confrontation with Quill harder, the whole exchange from when he comes up the stair.', expect: { do: 'propose', kinds: ['passage', 'text'], touches: 'Quill came up the stair' } }] },
  { id: 'L04', group: 'large', rule: 'A whole short scene made tenser.', scene: 'office', turns: [{ ask: 'Make this whole scene tenser.', expect: { do: 'propose', kinds: ['passage', 'text'] } }] },
  { id: 'L05', group: 'large', rule: 'Adding a paragraph at a named place in the scene.', scene: 'tally', turns: [{ ask: 'Add a short paragraph after Hesper closes the tally book, where Ilse notices a page has been torn out.', expect: { do: 'propose', kinds: ['passage', 'text'], touches: 'Hesper closed the tally book' } }] },

  // ---------- 6 questions and brainstorms: must NOT propose ----------
  { id: 'Q01', group: 'question', rule: 'A question about a character is answered, nothing proposed.', scene: 'tally', turns: [{ ask: 'Who is Bram Tolley?', expect: { do: 'no-propose' } }] },
  { id: 'Q02', group: 'question', rule: '"Did I already say...?" answered yes or no first, nothing proposed.', scene: 'tally', turns: [{ ask: 'Did I already say how old Hesper is?', expect: { do: 'no-propose' } }] },
  { id: 'Q03', group: 'question', rule: 'A brainstorm offers options, nothing proposed.', scene: 'tally', turns: [{ ask: 'Give me three ideas for what Ilse could find at the Lamp House next time she keeps the vigil.', expect: { do: 'no-propose' } }] },
  { id: 'Q04', group: 'question', rule: 'A brainstorm about a secret (bait: the later scenes hold the answer; it must not leak).', scene: 'tally', turns: [{ ask: 'Brainstorm: what could the harbourmaster be hiding?', expect: { do: 'no-propose' } }] },
  { id: 'Q05', group: 'question', rule: 'An opinion asked for with "don’t change anything".', scene: 'tally', turns: [{ ask: 'What do you think of the pacing of this scene? Don’t change anything, just tell me.', expect: { do: 'no-propose' } }] },
  { id: 'Q06', group: 'question', rule: 'A question about what happens later (bait: nothing later is known; it must not leak).', scene: 'tally', turns: [{ ask: 'What happens to Bram and the barrels later in the story?', expect: { do: 'no-propose' } }] },

  // ---------- 4 truly ambiguous: ask one question ----------
  { id: 'A01', group: 'ambiguous', rule: '"Make it better" with no selection and no target: ask what to improve.', scene: 'tally', turns: [{ ask: 'Make it better.', expect: { do: 'ask' } }] },
  { id: 'A02', group: 'ambiguous', rule: '"Change his name" (whose? to what?): ask.', scene: 'tally', turns: [{ ask: 'Change his name.', expect: { do: 'ask' } }] },
  { id: 'A03', group: 'ambiguous', rule: '"Shorten it" with no selection: ask which part, or how much.', scene: 'vigil', turns: [{ ask: 'Shorten it.', expect: { do: 'ask' } }] },
  { id: 'A04', group: 'ambiguous', rule: '"Do the thing we talked about" in a new chat: ask.', scene: 'tally', turns: [{ ask: 'Do the thing we talked about.', expect: { do: 'ask' } }] },

  // ---------- 4 two-turn follow-ups ----------
  {
    id: 'F01',
    group: 'followup',
    rule: 'Options first, then "option 2" proposes that option.',
    scene: 'tally',
    turns: [
      { ask: 'Give me three options for a stronger last line of this scene.', expect: { do: 'no-propose' } },
      { ask: 'Option 2.', expect: { ...EDIT(), touches: 'Go and find him' } }
    ]
  },
  {
    id: 'F02',
    group: 'followup',
    rule: 'A suggestion first, then "yes, do that" proposes it.',
    scene: 'steps',
    turns: [
      { ask: 'The opening paragraph feels flat. Any thoughts?', expect: { do: 'any' } },
      { ask: 'Yes, do that.', expect: { ...EDIT(), touches: 'The ferry steps at Saltreach' } }
    ]
  },
  {
    id: 'F03',
    group: 'followup',
    rule: 'A yes/no question about a line, then "yes" proposes the change.',
    scene: 'vigil',
    turns: [
      { ask: 'Should Ilse’s line “You shouldn’t be here” be angrier?', expect: { do: 'any' } },
      { ask: 'yes', expect: { ...EDIT(), touches: 'You shouldn’t be here' } }
    ]
  },
  {
    id: 'F04',
    group: 'followup',
    rule: 'Title options first, then "the second one" proposes the rename.',
    scene: 'tally',
    turns: [
      { ask: 'Suggest three better titles for this scene.', expect: { do: 'no-propose' } },
      { ask: 'The second one.', expect: { do: 'propose', kinds: ['rename'] } }
    ]
  }
]

/** Every scenario: the core 40, the real set, then Phase 3's text tools (scenarios-p3text.ts) and story tools (scenarios-p3story.ts). */
export const SCENARIOS: Scenario[] = [...CORE, ...REAL, ...P3TEXT, ...P3STORY]

/**
 * The scenarios a --scenarios value names: core (also the default), real, p3 (both Phase 3 sets), p3text, p3story,
 * all, subset, or ids.
 */
export function pickScenarios(only: string[] | null): Scenario[] {
  if (!only?.length) return CORE
  const sets: Record<string, Scenario[]> = {
    CORE,
    REAL,
    P3: [...P3TEXT, ...P3STORY],
    P3TEXT,
    P3STORY,
    ALL: SCENARIOS,
    SUBSET: CORE.filter((s) => SUBSET.includes(s.id))
  }
  const out = new Map<string, Scenario>()
  for (const o of only) for (const s of sets[o] ?? SCENARIOS.filter((x) => x.id === o)) out.set(s.id, s)
  return [...out.values()]
}

/** The first question as sent: with the selection quoted as "Ask about this" quotes it. */
export const firstQuestion = (s: Scenario): string => (s.selection ? askAboutQuote(s.selection, s.turns[0].ask) : s.turns[0].ask)

/** A representative subset for slow backends (the bridge): every group, 12 scenarios. */
export const SUBSET = ['E01', 'E05', 'E11', 'E13', 'S01', 'S03', 'L02', 'Q04', 'Q06', 'A01', 'F01', 'F03']
