// The chat overhaul's contract (AIWRITE_EXP_CHAT_CONTRACT): off, the instructions are today's; on, the "ask first"
// framing goes, the per-intent contract comes in, and the system message ends with a reminder naming the intent.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultStyleGuide } from '@shared/defaults'
import { askInstructions, askMessages, contractReminder } from './prompts'

const style = defaultStyleGuide()
const on = (): void => {
  process.env.AIWRITE_EXP_CHAT_CONTRACT = 'on'
}
afterEach(() => {
  delete process.env.AIWRITE_EXP_CHAT_CONTRACT
})

describe('the contract switch', () => {
  it('off: today’s instructions and no reminder', () => {
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
    expect(text).toMatch(/Ask one short question only when you can't tell which passage is meant/)
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
