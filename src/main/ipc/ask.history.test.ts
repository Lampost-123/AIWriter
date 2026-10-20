// chat-truth R3 (task 16): an earlier answer goes back to the model with what the writer made of each of its proposals,
// so it never speaks of a change still waiting, or turned down, as made. Invented words only.
import { afterEach, describe, expect, it } from 'vitest'
import type { Proposal } from '@shared/contracts/ask'
import { chatSwitches } from '../../../tests/unit/helpers'
import { withProposals } from './ask'

const card = (id: string, status: Proposal['status']): Proposal =>
  ({ id, status, why: '', kind: 'card', sceneId: 's4', sceneLabel: 'Ch 1, Sc 4', patch: { goal: 'Cross before the tide.' } }) as Proposal

afterEach(() => chatSwitches(null))

describe('withProposals: earlier answers with each proposal’s real status', () => {
  it('says what each changed and whether the writer applied it, waits on it or turned it down', () => {
    chatSwitches([])
    const out = withProposals('Change 1 is ready to apply: a clearer goal.', [card('1', 'applied'), card('2', 'pending'), card('3', 'declined')])
    expect(out).toBe(
      'Change 1 is ready to apply: a clearer goal.\n\n[Proposed with the tools: change 1 (a scene card change to Ch 1, Sc 4: applied by the writer), change 2 (a scene card change to Ch 1, Sc 4: waiting, not applied), change 3 (a scene card change to Ch 1, Sc 4: turned down by the writer). Only changes the writer applied are in the story.]'
    )
  })
  it('leaves an answer with no proposals as it was', () => {
    chatSwitches([])
    expect(withProposals('Her eyes are grey.', [])).toBe('Her eyes are grey.')
  })
  it('with the history switch on, still says only applied changes are in the story', () => {
    chatSwitches(['HISTORY'])
    expect(withProposals('Change 1 is ready to apply.', [card('1', 'pending')])).toMatch(/\(pending\)\]\n\[Only changes the writer applied are in the story\.\]$/)
  })
})
