// The chat overhaul's contract (AIWRITE_EXP_CHAT_CONTRACT, on by default): on, the "ask first" framing goes, the
// per-intent contract comes in, and the system message ends with a reminder naming the intent; =off, the old
// instructions.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultStyleGuide } from '@shared/defaults'
import { parseAnswer } from '@shared/answerBlocks'
import { ACT_FIRST_LINE, askInstructions, askMessages, contractReminder, FORMAT_RULES, formatRules, READ_BEFORE_ASKING } from './prompts'

const style = defaultStyleGuide()
/** The default: on. */
const on = (): void => {
  delete process.env.AIWRITE_EXP_CHAT_CONTRACT
}
afterEach(() => {
  delete process.env.AIWRITE_EXP_CHAT_CONTRACT
  delete process.env.AIWRITE_EXP_CHAT_FORMAT
  delete process.env.AIWRITE_EXP_CHAT_ACTFIRST
})

describe('the answer format switch (FORMAT)', () => {
  it('on (the default): the block format replaces the plain-text and length rules', () => {
    const text = askInstructions(style)
    expect(text).toContain(formatRules())
    expect(text).not.toMatch(/No headings, no bold, no tables/)
    expect(text).not.toMatch(/60 words outside lists/)
    expect(text.match(/60 words outside blocks/g)).toHaveLength(1)
    expect(text).toMatch(/::options/)
    expect(text).toMatch(/::facts yes, ::facts no or ::facts unknown/)
    expect(text).toMatch(/at most 3 short follow-up/)
    expect(text).toMatch(/don't repeat the change in words/)
    expect(askInstructions(style, true)).toContain(formatRules())
    process.env.AIWRITE_EXP_CHAT_ACTFIRST = 'off'
    expect(formatRules()).toBe(FORMAT_RULES)
    expect(askInstructions(style)).toContain(FORMAT_RULES)
  })

  it('on: the example in the prompt parses as a lead and three options', () => {
    const example = FORMAT_RULES.slice(FORMAT_RULES.indexOf('Example:\n') + 'Example:\n'.length)
    const blocks = parseAnswer(example)
    expect(blocks.map((b) => b.kind)).toEqual(['lead', 'options'])
    expect(blocks[1]).toMatchObject({ items: [{ title: 'Start on the bell' }, { title: 'Start on the catch' }, { title: 'Start mid-row' }] })
  })

  it('on with the contract off: the old instructions with the block format in place of plain text', () => {
    process.env.AIWRITE_EXP_CHAT_CONTRACT = 'off'
    const text = askInstructions(style)
    expect(text).toMatch(/ask first, in a sentence or two/)
    expect(text).toContain(formatRules())
    expect(text).not.toContain(READ_BEFORE_ASKING)
    expect(text).not.toMatch(/No headings, no bold, no tables/)
  })

  it('on: the reminder names the blocks for ideas and questions', () => {
    expect(contractReminder('brainstorm')).toMatch(/in an ::options block/)
    expect(contractReminder('answer')).toMatch(/then ::facts with \[\[Name\]\] and where/)
    expect(contractReminder(null)).toMatch(/each block closed by "::"/)
    expect(contractReminder('edit').split('\n').slice(1)).toHaveLength(3)
  })

  it('off: today’s plain-text rules exactly', () => {
    process.env.AIWRITE_EXP_CHAT_FORMAT = 'off'
    const text = askInstructions(style)
    expect(text).not.toContain('::')
    expect(text).toMatch(/Write plain text\. For a list, use a simple numbered or dashed list\. No headings, no bold, no tables\./)
    expect(text).toMatch(/Keep it under about 60 words outside lists unless the writer asks for more/)
    expect(contractReminder('brainstorm')).toBe(
      [
        'Reminder:',
        '- An edit is proposed at once as your best single version (the writer can decline it); ideas stay in words until the writer picks; facts lead with the verdict.',
        '- The first line answers. No preambles, no changes written out in words, and never say a change has been made.',
        '- This request asks for ideas: give 3 to 5 options in words and propose nothing until the writer picks one.'
      ].join('\n')
    )
  })
})

describe('the contract switch', () => {
  it('off: the old instructions and no reminder', () => {
    process.env.AIWRITE_EXP_CHAT_CONTRACT = 'off'
    const text = askInstructions(style)
    expect(text).toMatch(/ask first, in a sentence or two, before proposing anything/)
    expect(text).toMatch(/propose changes only once they have chosen/)
    const [system] = askMessages('BRIEFING', [], 'Tighten this', 'edit')
    expect(system.content).toMatch(/BRIEFING$/)
  })

  it('on: the per-intent contract, with no ask-first or ask-again exits', () => {
    on()
    const text = askInstructions(style)
    expect(text).not.toMatch(/ask first|only once they have chosen|offer a few distinct options|can ask again/i)
    expect(text).toMatch(/propose your best single version at once/)
    expect(text).toMatch(/never ask permission to propose/)
    expect(text).toMatch(/3 to 5 distinct options in words/)
    expect(text).toMatch(/the first line is the verdict/)
    expect(text).toMatch(/Ask one short question only when, after reading the words, you still can't tell which passage is meant/)
    expect(text).toMatch(/When propose_changes takes an item of kind ask, it can carry that question too, as its only item/)
    expect(contractReminder('edit')).not.toMatch(/as an item of kind ask/)
    expect(text).toMatch(/propose_draft/)
    expect(text).toMatch(/\[\[Mara Venn\]\]/)
    expect(text).toMatch(/never say a change has been made/)
    expect(askInstructions(style, true)).toMatch(/propose your best single version at once/)
  })

  it('on: the system message ends with a three-line reminder naming the routed intent', () => {
    on()
    const [system, question] = askMessages('BRIEFING', [{ question: 'Who?', answer: 'Tobin.' }], 'Tighten this', 'edit')
    expect(system.content.endsWith(contractReminder('edit'))).toBe(true)
    expect(system.content).toMatch(/BRIEFING\n\nReminder:/)
    expect(contractReminder('edit').split('\n').slice(1)).toHaveLength(3)
    expect(contractReminder('edit')).toMatch(/This request is an edit/)
    expect(contractReminder('brainstorm')).toMatch(/asks for ideas/)
    expect(contractReminder(null)).not.toMatch(/This request/)
    expect(question).toEqual({ role: 'user', content: 'Who?' })
  })
})

describe('ACTFIRST: an edit reads, then proposes; ::options only for ideas, ::next never a question', () => {
  it('on (the default): the ask rule waits for reading, and reading before asking follows it', () => {
    const text = askInstructions(style)
    expect(text).not.toMatch(/Ask one short question only when you can't tell/)
    expect(text).toContain(`${READ_BEFORE_ASKING}\n- Big writing`)
    expect(text).toMatch(/kind ask[^\n]*rather than guess\.\n- Read before you ask: the open scene is the one meant/)
    expect(text.match(/Read before you ask/g)).toHaveLength(1)
    expect(text).toMatch(/::options \(only when the writer asked for ideas, never for an edit: 3 to 5 lines/)
    expect(text).toMatch(/::next \(at most 3 short follow-up requests the writer might send next, .*never a question you need answered/)
  })

  it('on: the edit line never invites "which passage?", the unsure line asks as a question, not in ::next', () => {
    expect(contractReminder('edit').split('\n').at(-1)).toBe(`- ${ACT_FIRST_LINE.edit}`)
    expect(contractReminder('edit')).not.toMatch(/Only if you can't tell which passage/)
    expect(contractReminder('edit')).toMatch(/ask only if, after reading, two readings would give clearly different changes/)
    expect(contractReminder('unsure')).toMatch(/with ask_user when you have it, never in ::next/)
    expect(contractReminder('edit')).toMatch(/ideas \(only ideas\) go in ::options/)
    expect(contractReminder('brainstorm')).toMatch(/in an ::options block/)
    expect(contractReminder('edit').split('\n').slice(1)).toHaveLength(3)
  })

  it('off: Phase 2 as it was', () => {
    process.env.AIWRITE_EXP_CHAT_ACTFIRST = 'off'
    const text = askInstructions(style)
    expect(text).toMatch(/Ask one short question only when you can't tell which passage is meant/)
    expect(text).not.toContain(READ_BEFORE_ASKING)
    expect(contractReminder('edit')).toMatch(/Only if you can't tell which passage is meant, ask one question \(as an item of kind ask/)
    expect(contractReminder('edit')).toMatch(/ideas go in ::options/)
  })
})
