// The chat overhaul's routing (AIWRITE_EXP_CHAT_ROUTE): each invented request lands on the intent the plan's contract
// expects, with no model call; a short pick after options is an edit, and "don't change anything" is an answer.
import { describe, expect, it } from 'vitest'
import type { AskIntent } from '@shared/askIntent'
import { PROPOSE_NOW, proposeNow } from '@shared/askChanges'
import { editorNudge, MAX_EDIT_NUDGES, offersChoice, routeIntent, temperatureFor } from './route'

const OPTIONS = 'Three ways it could go:\n1. Wren bolts for the ferry.\n2. Wren hides in the chandlery.\n3. Wren gives himself up.'
const QUESTION = 'I can tighten the opening or the ending. Which one do you mean?'
const PLAIN = 'The ferryman is Old Tobin; he first appears in Ch 2, Sc 1.'

const table: [string, AskIntent][] = [
  // Edit: change verbs, add/cut/insert, "make X <adj>", complaints, should/needs, continuing.
  ['Tighten this paragraph', 'edit'],
  ['tighten the second paragraph', 'edit'],
  ['Can you rewrite the opening?', 'edit'],
  ['Could you please fix the typo in the first line?', 'edit'],
  ['Fix the typos', 'edit'],
  ['Make her angrier', 'edit'],
  ['make the ending darker', 'edit'],
  ['Make the fight scene punchier', 'edit'],
  ['Make Wren sound more tired when he answers', 'edit'],
  ['Add a line where he hesitates before opening the door', 'edit'],
  ['Cut the bit about the gulls', 'edit'],
  ['Remove the second simile', 'edit'],
  ['Insert a beat where Tobin notices the letter', 'edit'],
  ['This drags', 'edit'],
  ['the middle section is clunky', 'edit'],
  ['This dialogue feels flat', 'edit'],
  ['Wren should hesitate more before he lies', 'edit'],
  ['Should Mara be angrier here?', 'edit'],
  ['The scene needs more tension', 'edit'],
  ['Punch up the last line', 'edit'],
  ['Rename the chapter to The Salt Stair', 'edit'],
  ['Write the next bit', 'edit'],
  ['Continue the scene from where it stops', 'edit'],
  ['Draft the opening of the next scene', 'edit'],
  ['Push this beat harder', 'edit'],
  ['I want you to trim the description of the harbour', 'edit'],
  ['Please swap the order of the last two paragraphs', 'edit'],
  ['The opening is too long', 'edit'],
  ['Give her a limp', 'edit'],
  ['In the scene at the inn, change "red" to "rust".', 'edit'],
  ['Tobin is fifty, not forty. Update his entry.', 'edit'],
  ['Near the end Mara rings the second bell. Make it the third bell.', 'edit'],
  ['Can this be more ominous?', 'edit'],
  ['punch this up', 'edit'],
  ['In the letter, join the first two lines into one sentence.', 'edit'],
  ['Make this whole chapter darker', 'edit'],
  ['About this passage: “The gulls went quiet.” fix this', 'edit'],
  // Brainstorm: ideas, options, what could.
  ['What could go wrong at the lighthouse?', 'brainstorm'],
  ['Any ideas for a new place in the harbour town?', 'brainstorm'],
  ['Suggest a name for the ferryman’s dog', 'brainstorm'],
  ['Brainstorm reasons Wren might lie to Tobin', 'brainstorm'],
  ['Give me a few options for the chapter title', 'brainstorm'],
  ['What if Mara found the letter first?', 'brainstorm'],
  ['Rewrite the opening line, give me some options', 'brainstorm'],
  ['What might Tobin do when he finds out?', 'brainstorm'],
  // Answer: questions of fact, and hands off.
  ['Did I say how old Edric is?', 'answer'],
  ['Who knows about the letter?', 'answer'],
  ['Where does Tobin live?', 'answer'],
  ['How old is Mara at this point?', 'answer'],
  ['Is Wren the one who rang the bell?', 'answer'],
  ['What colour is the ferry?', 'answer'],
  ['Did I change Edric’s age anywhere?', 'answer'],
  ["Don't change anything, just tell me if the timeline works", 'answer'],
  ['Without editing it, is the pacing ok?', 'answer'],
  ['Why does Wren distrust the harbourmaster?', 'answer'],
  ['Can you tell me who was at the inn?', 'answer'],
  // Unsure: neither a question nor a request we know.
  ['The ferry scene', 'unsure'],
  ['Do the thing we talked about.', 'unsure'],
  ['Do you think Tobin would lie?', 'answer']
]

describe('routeIntent', () => {
  it('has a table of at least 40 phrasings', () => {
    expect(table.length).toBeGreaterThanOrEqual(40)
  })
  it.each(table)('%s → %s', (question, intent) => {
    expect(routeIntent({ question })).toBe(intent)
  })

  it('Edit mode is always an edit', () => {
    expect(routeIntent({ question: 'Who knows about the letter?', mode: 'edit' })).toBe('edit')
    expect(routeIntent({ question: 'Who knows about the letter?', mode: 'talk' })).toBe('answer')
  })

  const picks = [
    'yes',
    'Yes, do it',
    '2',
    'option 2',
    'Option B',
    'the second',
    'The second one',
    'go ahead',
    'do it',
    'both',
    'do both',
    'that one',
    'ok, go with 3',
    "let's do the first",
    'sure',
    '#1'
  ]
  it.each(picks)('a short pick after options or a question is an edit: %s', (question) => {
    expect(routeIntent({ question, lastAnswer: OPTIONS })).toBe('edit')
    expect(routeIntent({ question, lastAnswer: QUESTION })).toBe('edit')
    expect(routeIntent({ question, lastHadOptionsOrQuestion: true })).toBe('edit')
  })
  it('the same reply with nothing offered is not an edit', () => {
    expect(routeIntent({ question: '2', lastAnswer: PLAIN })).toBe('unsure')
    expect(routeIntent({ question: 'yes', lastAnswer: null })).toBe('unsure')
    expect(routeIntent({ question: 'both', lastHadOptionsOrQuestion: false, lastAnswer: OPTIONS })).toBe('unsure')
  })
  it('a long reply after options is routed by its words, and "no" is not a pick', () => {
    expect(routeIntent({ question: 'No, none of those, what else could he do?', lastAnswer: OPTIONS })).toBe('brainstorm')
    expect(routeIntent({ question: 'no', lastAnswer: OPTIONS })).toBe('unsure')
  })
  it('a short complaint about selected words is an edit', () => {
    expect(routeIntent({ question: 'too stiff?', selection: 'He said nothing.' })).toBe('edit')
    expect(routeIntent({ question: 'stiff?' })).toBe('answer')
  })
})

describe('offersChoice', () => {
  it('sees a list of options or a closing question', () => {
    expect(offersChoice(OPTIONS)).toBe(true)
    expect(offersChoice(QUESTION)).toBe(true)
    expect(offersChoice('- darker\n- shorter')).toBe(true)
    expect(offersChoice(PLAIN)).toBe(false)
    expect(offersChoice('')).toBe(false)
  })

  it('in the block format, only ::options or a question in the words offer a choice', () => {
    expect(offersChoice('Three ways.\n::options\n- **Bolt**: a\n- **Hide**: b\n::')).toBe(true)
    expect(offersChoice('Yes.\n::facts yes\n- one (Ch 1)\n- two (Ch 2)\n::\n::next\n- Ask about the ferry\n- Ask about the bell\n::')).toBe(false)
    expect(offersChoice('Which one do you mean?\n::next\n- The opening\n::')).toBe(true)
  })
})

describe('temperatureFor', () => {
  it('is exact for edits and unsure, freer for ideas', () => {
    expect(temperatureFor('edit')).toBe(0.3)
    expect(temperatureFor('unsure')).toBe(0.3)
    expect(temperatureFor('answer')).toBe(0.5)
    expect(temperatureFor('brainstorm')).toBe(0.8)
  })
})

describe('editorNudge', () => {
  const base = { attempt: 1, proposed: 0, intent: null, route: false, contract: false }
  it('never nudges once the chat asked the writer a question with options (ask_user ended the answer)', () => {
    expect(editorNudge({ ...base, question: 'Tighten this', answer: 'Which part?', asked: true })).toBe(null)
    expect(editorNudge({ ...base, route: true, intent: 'edit', question: 'Tighten this', answer: 'x', asked: true })).toBe(null)
    expect(editorNudge({ ...base, route: true, contract: true, intent: 'edit', question: 'Tighten this', answer: 'x', asked: true })).toBe(null)
  })
  it('routing off: today’s rule, once per the task (claims or edit verbs)', () => {
    expect(editorNudge({ ...base, question: 'Tighten this', answer: 'Here it is, tighter.' })).toBe(PROPOSE_NOW)
    expect(editorNudge({ ...base, question: 'Make her angrier', answer: 'She slams the door.' })).toBe(null)
    expect(editorNudge({ ...base, question: 'Who is Tobin?', answer: 'I’ve fixed the line.' })).toBe(PROPOSE_NOW)
    expect(editorNudge({ ...base, question: 'Tighten this', answer: 'x', proposed: 1 })).toBe(null)
    // "Don't change anything" still trips the verb regex with routing off (today's behaviour).
    expect(editorNudge({ ...base, question: "Don't change anything, is the pacing ok?", answer: 'It flows.' })).toBe(PROPOSE_NOW)
  })
  it('routing on: an edit is asked again whatever its wording, twice; answers and ideas never', () => {
    const on = { ...base, route: true }
    const edit = { ...on, intent: 'edit' as const, question: 'Make her angrier', answer: 'She slams the door.' }
    expect(editorNudge(edit)).toBe(PROPOSE_NOW)
    expect(editorNudge({ ...edit, attempt: 2 })).toBe(PROPOSE_NOW)
    expect(MAX_EDIT_NUDGES).toBe(2)
    // One short clarifying question is allowed.
    expect(editorNudge({ ...edit, answer: 'Which scene do you mean, the dawn one or the storm?' })).toBe(null)
    const question = "Don't change anything, is the pacing ok?"
    expect(editorNudge({ ...on, intent: routeIntent({ question }), question, answer: 'It flows.' })).toBe(null)
    expect(editorNudge({ ...on, intent: 'brainstorm', question: 'Ideas?', answer: 'I’ve fixed the line.' })).toBe(null)
    expect(editorNudge({ ...on, intent: 'unsure', question: 'The ferry', answer: 'I’ve fixed the line.' })).toBe(PROPOSE_NOW)
    expect(editorNudge({ ...on, intent: 'unsure', question: 'The ferry', answer: 'I’ve fixed the line.', attempt: 2 })).toBe(null)
  })
  it('contract on: an edit’s note has no ideas exit, and the second says so', () => {
    const edit = { ...base, route: true, contract: true, intent: 'edit' as const, question: 'This drags', answer: 'Cut the gulls.' }
    expect(editorNudge(edit)).toBe(proposeNow('edit', 1))
    expect(editorNudge({ ...edit, attempt: 2 })).toMatch(/gives no proposal again/)
    expect(editorNudge({ ...base, contract: true, question: 'Tighten this', answer: 'Tighter.' })).toBe(proposeNow('edit'))
  })
})
