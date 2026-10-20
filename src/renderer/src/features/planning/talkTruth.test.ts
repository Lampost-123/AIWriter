// The talks' truth check and outcome line (chat-truth R1, R2, R6): the shared check puts right a claim with no change
// sent, says a waiting change as waiting, and the line under each answer comes from what came of it.
import { describe, expect, it } from 'vitest'
import { NO_CHANGE_LEAD } from '@shared/askTruth'
import type { TalkTurn } from './talkStore'
import { claimsChange, settleTalk, talkOutcome } from './talkTruth'

const turn = (o: Partial<TalkTurn>): TalkTurn => ({ role: 'assistant', text: 'An answer.', recorded: true, ...o })

describe('settleTalk', () => {
  it('puts right a claim of a change with none sent', () => {
    const out = settleTalk('I’ve moved those scenes to the kitchen.', false)
    expect(out.startsWith(NO_CHANGE_LEAD)).toBe(true)
    expect(out).not.toMatch(/I[’']ve moved/)
  })

  it('says a change that waits in the preview as waiting, never as made', () => {
    const out = settleTalk('I’ve moved those scenes to the kitchen.', true)
    expect(out).not.toMatch(/I[’']ve moved/)
    expect(out).toMatch(/ready to apply/i)
    expect(out).not.toMatch(/Change 1/)
  })

  it('leaves an answer, a question and an offer be', () => {
    for (const a of ['The second chapter is where Ada catches the wrecker.', 'Shall I move them to the kitchen?', 'I’d move those scenes to the kitchen.']) {
      expect(settleTalk(a, false)).toBe(a)
      expect(claimsChange(a)).toBe(false)
    }
    expect(claimsChange('I’ve moved those scenes to the kitchen.')).toBe(true)
  })
})

describe('talkOutcome', () => {
  const where = 'The plan below'
  it('waiting, applied, declined, built on', () => {
    expect(talkOutcome(turn({ outcome: 'offered', changes: ['Scene: A', 'Scene: B'] }), where).words).toBe('The plan below has 2 changes waiting: press Apply.')
    expect(talkOutcome(turn({ outcome: 'offered' }), where, 'Make this change').words).toBe('The plan below has 1 change waiting: press Make this change.')
    expect(talkOutcome(turn({ outcome: 'applied' }), where).words).toBe('Applied.')
    expect(talkOutcome(turn({ outcome: 'declined' }), where).words).toBe('Not applied: you turned it down.')
    expect(talkOutcome(turn({ outcome: 'revised' }), where).words).toBe('Built on in the answer below.')
  })

  it('nothing changed, with the reason when a change was tried', () => {
    expect(talkOutcome(turn({}), where).words).toBe('Nothing was changed.')
    expect(talkOutcome(turn({ reason: 'the parts it named aren’t in the plan' }), where).words).toBe('Nothing was changed: the parts it named aren’t in the plan.')
  })

  it('a hand-off says this talk changes suggestions only', () => {
    expect(talkOutcome(turn({ handOff: 'Make chapter 3 shorter' }), where).words).toBe('This talk changes suggestions only.')
  })

  it('no line for an answer with nothing recorded, or for Adam’s own words', () => {
    expect(talkOutcome(turn({ recorded: undefined, outcome: 'applied' }), where).words).toBeNull()
    expect(talkOutcome({ role: 'user', text: 'Hi' }, where).words).toBeNull()
  })
})
