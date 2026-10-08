// The chat eval's "real" set (Phase 1): 24 scenarios that reproduce how Adam actually uses the editor chat, which the
// 40 core scenarios (fresh chats, a small world, clear asks) don't. Run with `--scenarios real` (or `all` for both).
//   r-history   a chat that already has 8-12 earlier turns (seeded as the app stores them: 'chat' generation records),
//               whose answers hedged, asked permission, offered options in prose or described a change instead of
//               proposing it; then a clear request. Old hedging answers are re-sent with every question.
//   r-vague     a novelist's phrasing: "this drags", "she'd be angrier", "make it hit harder", "the ending's flat",
//               "punch this up", "can you sort this paragraph", with and without a selection.
//   r-followup  a chat whose last answer offered options or asked "want me to?", then "the second one", "yes",
//               "both", "go ahead", "do it".
//   r-continue  "continue from here", "write the next bit", "draft the scene from the card": a propose_draft hand-off
//               where that tool exists, else a proposal.
//   r-change-q  questions that say "change" but want no edit.
// Scenarios marked `big` are asked in story C (bigWorld.ts), whose briefing is 30-60k tokens: the cost of the set is
// mostly theirs. Every word is invented.

import { SCENES } from './world'
import { WINTER } from './bigWorld'
import type { HistoryTurn, Outcome, Scenario } from './scenarios'

const para = (scene: string, i: number): string => SCENES.find((x) => x.key === scene)!.paragraphs[i]

// ---------- Earlier turns: story A (the small world) ----------

/** Hedging answers about story A's scenes, in the order a long chat would have them. */
const HEDGE_A: HistoryTurn[] = [
  {
    q: 'Can you have a look at the opening of this scene?',
    a: 'I’ll read the scene first.\n\nThe opening does a lot of work: the tally book, the light through the window, Ilse’s sleepless night. A few things you might consider:\n\n- The doubled “the the” in the first sentence.\n- “It was, after all, only Tuesday” undercuts the tension a little.\n- The lamp-oil detail is strong; you could lean on it more.\n\nIf you’d like, I can propose changes for any of these. Just let me know which.'
  },
  {
    q: 'the doubled word, yes',
    a: 'Happy to help. The fix would be to change “the the morning light” to “the morning light” in the first paragraph. Would you like me to go ahead and propose that edit?'
  },
  {
    q: 'Is Hesper too calm here?',
    a: 'Let me look at her lines first.\n\nShe’s controlled rather than calm, which suits her: she reads the number aloud, then asks where nine barrels went. If you wanted more heat, one option would be to let her slam the book, or to have her say Bram’s name before Ilse does. Another would be to keep her quiet and let the shawl do the work. I can draft something along those lines if that would help.'
  },
  {
    q: 'What about the dog, is his name consistent?',
    a: 'Good thing to check. The dog is called Pitch in the memory, but this scene calls him Patch once, where he barks at the gulls. You’ll want to change “Patch barked” to “Pitch barked” so it matches.'
  },
  {
    q: 'and Brom?',
    a: 'Yes, “Brom will know” should be “Bram will know”. That’s the only place it’s misspelt in this scene. Let me know if you’d like me to make a proposal for it, or if you’d rather fix it yourself in the page.'
  },
  {
    q: 'Does the ending land?',
    a: 'I’ll take a look at the last few paragraphs.\n\nIt lands quietly. Hesper closing the book is a good beat, and “Go and find him” is a strong last line. Some writers would cut the simile about the door so the closing line hits harder; others would keep it for the rhythm. It depends on the effect you want. Do you want to keep the simile, or should I suggest a version without it?'
  },
  {
    q: 'Hmm. Not sure.',
    a: 'That’s fair, there’s no rush. Two ways to think about it:\n\n1. Keep the simile, and trust the quiet.\n2. Cut it, and let Hesper’s line close the scene on its own.\n\nEither works. When you’ve decided, tell me and I can help with the wording.'
  },
  {
    q: 'Could the vigil scene start faster?',
    a: 'Let me check the vigil scene’s opening first.\n\nIt starts with the rule about visitors, then the stair, then the lamps. To start faster, you could open on Quill in the doorway and fold the rule into Ilse’s thoughts. I’d be glad to sketch out what that might look like. Shall I?'
  },
  {
    q: 'Quill’s line about barrels being late, I like it',
    a: 'It’s one of the best lines in that scene: dry, precise, very him. I wouldn’t change it. If anything, you could give Ilse a sharper reply, since “They’re not missing. They’re late.” gives him the last word too easily. Something like “They’ll turn up” or “Ask Bram” might push back more. Let me know if you want me to try a few.'
  },
  {
    q: 'maybe later. Is the office scene too short?',
    a: 'I’ll read the Salt Office scene to check.\n\nIt’s short, but it doesn’t feel thin: the note, Quill’s line about short letters, and Ilse folding the note away all do their job. If you wanted more, you could add a beat where Ilse notices something on Quill’s desk. I could propose a paragraph for that if you’d like, or leave it as it is.'
  },
  {
    q: 'leave it. What does Hesper’s note mean by “not the boy”?',
    a: 'The memory doesn’t say who “the boy” is. It could be a hint at someone who hasn’t appeared yet, or a way of telling Ilse to keep the matter in the family. If you know who you meant, I can add it to Hesper’s entry, or leave it open for now.'
  },
  {
    q: 'leave it open',
    a: 'Understood, I’ll leave it open. Nothing changed.'
  }
]

/** One earlier turn that did propose (and was applied), as a long chat has a few of. */
const PROPOSED_A: HistoryTurn = {
  q: 'Fix the cap line in the ferry steps scene, it says "cap pushed back" twice in the story',
  a: 'I’ve proposed one change: in the ferry steps scene, “his cap pushed back” becomes “his cap tipped back”, so the phrase isn’t repeated word for word.',
  proposals: [{ kind: 'text', scene: 'steps', find: 'Bram Tolley at the tiller with his cap pushed back', replace: 'Bram Tolley at the tiller with his cap tipped back', status: 'applied' }]
}

const historyA = (n: number, ...last: HistoryTurn[]): HistoryTurn[] => {
  const base = [...HEDGE_A.slice(0, 6), PROPOSED_A, ...HEDGE_A.slice(6)]
  return [...base.slice(0, n - last.length), ...last]
}

// ---------- Earlier turns: story C (the big briefing) ----------

const HEDGE_C: HistoryTurn[] = [
  {
    q: 'Can you read this scene and tell me what’s working?',
    a: 'I’ll read the scene first.\n\nWhat’s working: the snow is vivid, the missing boats give the scene a clear question from the first paragraph, and Bram sweeping faster when he sees Ilse says more than any line of dialogue could. What might need attention:\n\n- The paragraph where she goes down the steps runs long.\n- Hesper’s reaction is very muted.\n- The ending is quiet.\n\nI can look at any of these in more detail if you’d like.'
  },
  {
    q: 'the bit going down the steps feels long',
    a: 'Let me look at that paragraph.\n\nIt is long: one sentence that keeps adding “and about”. That can be deliberate, mimicking her slow steps on the ice. If you want it tighter, you might cut “which was very cold” and “perhaps ever”, and end the sentence at Hesper. Shall I suggest a tighter version?'
  },
  { q: 'maybe', a: 'No problem. When you’re ready, I can propose a tighter version, or offer a couple of options to choose from.' },
  {
    q: 'What’s Quill doing in this scene?',
    a: 'I’ll look at the paragraph where Quill appears.\n\nHe comes along the wall at noon, looks at the two empty cradles and writes something down, which the scene says he never does. It’s a good beat. The paragraph does switch between present and past tense (“comes”, “had”, “stops”, “looked”), which you might want to fix. I can do that if you’d like.'
  },
  { q: 'later. Who are the Penhallows again?', a: 'The memory lists several Penhallows, one of the town’s older families. None of them appears in this scene, though they’re named in the story so far. Do you want me to look up any one of them?' },
  {
    q: 'Does the ending work?',
    a: 'Let me read to the end. The scene is long, so I’ll look at the last part.\n\nThe last paragraph is plain: she walks home, it snows, she goes to bed. That could be a deliberate deflation after the boathouse, or it could read as flat. It depends what you want the reader to carry into the next scene. Would you like some options?'
  },
  { q: 'give me a sec', a: 'Of course. Take your time.' },
  { q: 'how long is this scene?', a: 'I can’t count it exactly, but it’s long: well past the length of the other scenes in this chapter, mostly in the snow-and-harbour description between the dialogue.' },
  {
    q: 'ok. Is the boat count consistent with earlier chapters?',
    a: 'I’ll check the story so far.\n\nEarlier summaries mention boats being stove in and lent, but no exact count of six. So four of six doesn’t contradict anything I can see. If you want, I could add a note to the memory about the six boats.'
  },
  { q: 'no thanks', a: 'Understood, nothing added.' },
  {
    q: 'Bram’s sweeping, too much?',
    a: 'It’s a nice beat: he stops, then sweeps faster. I’d keep it. You might consider giving him one line before Ilse speaks, so his guilt shows in what he says as well as what he does. If you want me to rework it, just say.'
  },
  {
    q: 'Is Hesper in character?',
    a: 'Mostly, yes. Her shrug fits her dryness, but after two boats go missing it may be too mild. If you’d like her angrier, here are some options:\n\n1. She turns from the stove: “Two boats. And you stood there counting them.”\n2. She doesn’t shrug it off: “Two boats,” Hesper said, and set the kettle down so hard the lid jumped. “Somebody in this town is going to tell me where.”\n3. Keep her calm, but have her go straight out to the boathouse herself.\n\nLet me know which direction appeals.'
  }
]

const historyC = (n: number, ...last: HistoryTurn[]): HistoryTurn[] => [...HEDGE_C.slice(0, n - last.length), ...last]

// ---------- The scenarios ----------

type Propose = Extract<Outcome, { do: 'propose' }>
const P = (touches?: string, more: Partial<Propose> = {}): Propose => ({ do: 'propose', kinds: ['text', 'passage', 'insert', 'cut'], ...(touches ? { touches } : {}), ...more })

export const REAL: Scenario[] = [
  // ---------- Long history, then a clear request ----------
  { id: 'R01', group: 'r-history', rule: 'After 10 hedging turns, a plain one-word change is still proposed on the first ask.', scene: 'tally', history: historyA(10), turns: [{ ask: 'Change "grey shawl" to "salt-stiff shawl".', expect: P('grey shawl') }] },
  {
    id: 'R02',
    group: 'r-history',
    rule: 'After 12 turns (one that proposed), cutting a quoted sentence is proposed.',
    scene: 'steps',
    history: historyA(12),
    turns: [{ ask: 'Cut "She waited and waited, and the light went on going, and still the ferry did not come, and she went on waiting." from the first paragraph.', expect: P('The ferry steps at Saltreach') }]
  },
  { id: 'R03', group: 'r-history', rule: 'After 8 turns that offered and never proposed, "make it sharper" on a named line is proposed.', scene: 'vigil', history: historyA(8), turns: [{ ask: 'make Ilse’s reply to Quill sharper, the "They\'re not missing" line', expect: P('They’re not missing') }] },
  { id: 'R04', group: 'r-history', rule: 'After 10 turns, a selection and "this drags" is proposed.', scene: 'tally', history: historyA(10), selection: para('tally', 0), turns: [{ ask: 'this drags', expect: P('The tally book lay open') }] },
  { id: 'R05', group: 'r-history', big: true, rule: 'Big briefing and 12 turns (one described the tense fix), then "fix the tenses" is proposed.', scene: 'winter', history: historyC(12), turns: [{ ask: 'Fix the tenses in Quill’s paragraph.', expect: P('Quill comes along the wall') }] },

  // ---------- A novelist's vague phrasing ----------
  { id: 'R06', group: 'r-vague', rule: 'A selection of Hesper’s line and "she’d be angrier".', scene: 'tally', selection: para('tally', 4), turns: [{ ask: 'she’d be angrier', expect: P('I don’t care what the ledger says') }] },
  { id: 'R07', group: 'r-vague', rule: '"The ending’s flat" with no selection: propose a stronger ending (or ask one question with options).', scene: 'tally', turns: [{ ask: 'the ending’s flat', expect: P('Go and find him', { orAsk: true }) }] },
  { id: 'R08', group: 'r-vague', rule: 'A selection and "make it hit harder".', scene: 'vigil', selection: para('vigil', 6), turns: [{ ask: 'make it hit harder', expect: P('She did see it') }] },
  { id: 'R09', group: 'r-vague', rule: '"Punch up the bit where…" names the paragraph, no selection.', scene: 'steps', turns: [{ ask: 'punch up the bit where Bram brings the ferry in', expect: P('When it came at last') }] },
  { id: 'R10', group: 'r-vague', big: true, rule: 'Big briefing: a selection and "can you sort this paragraph" (its tenses are muddled).', scene: 'winter', selection: WINTER.muddled, turns: [{ ask: 'can you sort this paragraph', expect: P('Quill comes along the wall') }] },
  { id: 'R11', group: 'r-vague', big: true, rule: 'Big briefing: a selection and "this drags".', scene: 'winter', selection: WINTER.drags, turns: [{ ask: 'this drags', expect: P('She went down the steps slowly') }] },
  { id: 'R12', group: 'r-vague', big: true, rule: 'Big briefing: "the ending’s flat" in a scene whose ending is past read_scene’s first 24,000 characters.', scene: 'winter', turns: [{ ask: 'The ending’s flat.', expect: P('Ilse walked home along the harbour wall', { orAsk: true }) }] },

  // ---------- Follow-ups after options or a question ----------
  {
    id: 'R13',
    group: 'r-followup',
    rule: 'The last answer offered three numbered options; "the second one" proposes option 2.',
    scene: 'tally',
    history: historyA(8, {
      q: 'Hesper’s line about the ledger, can it be stronger?',
      a: 'Here are three ways to sharpen Hesper’s line:\n\n1. “Ledgers lie, Ilse. The water doesn’t.”\n2. “I don’t care what the ledger says. I care what the water says, and the water says nothing was lost.”\n3. Cut the line and let her slam the book instead.\n\nWhich would you like?'
    }),
    turns: [{ ask: 'the second one', expect: P('I don’t care what the ledger says') }]
  },
  {
    id: 'R14',
    group: 'r-followup',
    rule: 'The last answer asked "want me to tighten the opening?"; "yes" proposes it.',
    scene: 'steps',
    history: historyA(8, { q: 'This opening paragraph, hmm', a: 'It repeats itself near the end: “she waited and waited… and she went on waiting.” Want me to tighten the opening paragraph so the waiting is said once?' }),
    turns: [{ ask: 'yes', expect: P('The ferry steps at Saltreach') }]
  },
  {
    id: 'R15',
    group: 'r-followup',
    rule: 'The last answer offered two fixes and asked which; "both" proposes both.',
    scene: 'tally',
    history: historyA(9, { q: 'first paragraph again', a: 'I could cut the Tuesday line, or fix the doubled “the the” in the first sentence. Which would you like?' }),
    turns: [{ ask: 'both', expect: P('only Tuesday') }]
  },
  {
    id: 'R16',
    group: 'r-followup',
    rule: 'The last answer asked "shall I make Quill’s entrance more menacing?"; "go ahead" proposes it.',
    scene: 'vigil',
    history: historyA(10, { q: 'Quill coming up the stair', a: 'It’s a strong moment, but he arrives quite politely: he stands in the doorway with rain on his shoulders. Shall I make Quill’s entrance more menacing?' }),
    turns: [{ ask: 'go ahead', expect: P('Quill came up the stair') }]
  },
  {
    id: 'R17',
    group: 'r-followup',
    rule: 'The last answer suggested cutting the narration before the last line and asked; "do it" proposes it.',
    scene: 'tally',
    history: historyA(11, { q: 'the last two paragraphs', a: 'I’d end on Hesper’s line and cut the narration before it (the book closing, the door simile). Want me to?' }),
    turns: [{ ask: 'do it', expect: P('Hesper closed the tally book') }]
  },
  { id: 'R18', group: 'r-followup', big: true, rule: 'Big briefing; the last answer offered three options for Hesper; "the second one" proposes option 2.', scene: 'winter', history: historyC(12), turns: [{ ask: 'the second one', expect: P('“Two boats,” Hesper said') }] },

  // ---------- "Write the next bit" ----------
  { id: 'R19', group: 'r-continue', rule: '"Continue from here" at the end of the open scene: a draft hand-off or a proposal.', scene: 'tally', turns: [{ ask: 'continue from here', expect: P('Go and find him', { draft: true }) }] },
  { id: 'R20', group: 'r-continue', big: true, rule: 'Big briefing: "write the next bit" with a direction: a draft hand-off or a proposal.', scene: 'winter', turns: [{ ask: 'write the next bit, Ilse goes back to the boathouse that night', expect: P('Ilse walked home along the harbour wall', { draft: true }) }] },
  { id: 'R21', group: 'r-continue', big: true, rule: 'Big briefing: "draft the scene from the card" in an empty scene: a draft hand-off (any proposal counts).', scene: 'boathouse', turns: [{ ask: 'draft the scene from the card', expect: { do: 'propose', draft: true } }] },

  // ---------- Questions that say "change" ----------
  { id: 'R22', group: 'r-change-q', rule: '"Did Hesper change her mind…?" is a question: nothing proposed.', scene: 'tally', turns: [{ ask: 'Did Hesper change her mind about the barrels in chapter 2?', expect: { do: 'no-propose' } }] },
  { id: 'R23', group: 'r-change-q', rule: '"Don’t change anything, just tell me…": nothing proposed.', scene: 'tally', turns: [{ ask: 'Don’t change anything, just tell me: is the opening too slow?', expect: { do: 'no-propose' } }] },
  { id: 'R24', group: 'r-change-q', rule: 'After 8 hedging turns, "what would change if…" is thinking aloud: nothing proposed.', scene: 'steps', history: historyA(8), turns: [{ ask: 'What would change if Bram were younger? Just thinking out loud.', expect: { do: 'no-propose' } }] }
]
