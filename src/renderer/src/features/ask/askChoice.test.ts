// The editor chat's question with options as the panel shows it: the numbered options the answer's text ends with
// don't show twice under the buttons; a pick goes as the next question and is read back from it. Invented text only.
import { describe, expect, it } from 'vitest'
import type { AskChoice } from '@shared/contracts/ask'
import { choiceClosing, pickQuestion, pickedOf, withoutChoice } from './askChoice'

const choice: AskChoice = {
  question: 'Which part do you mean?',
  options: [{ label: 'The opening paragraph' }, { label: 'The ending', detail: 'the last two lines' }, { label: 'The lamp-keeper’s lines' }],
  recommended: 1
}

describe('the answer under a choice', () => {
  it('ends with the question and numbered options as the main process writes them', () => {
    expect(choiceClosing(choice)).toBe(
      'Which part do you mean?\n\n1. The opening paragraph\n2. The ending — the last two lines (recommended)\n3. The lamp-keeper’s lines'
    )
    expect(choiceClosing({ ...choice, multi: true })).toMatch(/\n\nYou can pick more than one\.$/)
  })

  it('shows without them when they close it word for word', () => {
    const answer = `I can tighten either end.\n\n${choiceClosing(choice)}`
    expect(withoutChoice(answer, choice)).toBe('I can tighten either end.')
    // Nothing but the question: nothing left to show above the buttons.
    expect(withoutChoice(choiceClosing(choice), choice)).toBe('')
  })

  it('takes off numbered lines naming the options (and the question above them) when they differ a little', () => {
    const answer = 'I can tighten either end.\n\nWhich part do you mean?\n1. The opening paragraph\n2. The ending\n3. The lamp-keeper’s lines\n'
    expect(withoutChoice(answer, choice)).toBe('I can tighten either end.')
  })

  it('leaves an answer alone with no choice, or a numbered list that isn’t the options', () => {
    const list = 'Two ideas:\n\n1. A storm at sea\n2. A quiet harbour'
    expect(withoutChoice(list, undefined)).toBe(list)
    expect(withoutChoice(list, choice)).toBe(list)
  })
})

describe('a pick', () => {
  it('goes as one line per option picked, with its detail, and is read back from that question', () => {
    expect(pickQuestion(choice, [1])).toBe('The ending — the last two lines')
    expect(pickQuestion(choice, [2, 0])).toBe('The opening paragraph\nThe lamp-keeper’s lines')
    expect(pickedOf(choice, 'The ending — the last two lines')).toEqual([1])
    expect(pickedOf(choice, pickQuestion(choice, [0, 2]))).toEqual([0, 2])
    // A label alone counts too.
    expect(pickedOf(choice, 'The ending')).toEqual([1])
  })

  it('reads words of his own as no pick', () => {
    expect(pickedOf(choice, 'Actually, the middle bit where the gulls go quiet')).toEqual([])
    expect(pickedOf(choice, undefined)).toEqual([])
  })
})
