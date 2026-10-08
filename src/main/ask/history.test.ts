// The chat overhaul's history hygiene (AIWRITE_EXP_CHAT_HISTORY): past proposals say what they changed, preambles go,
// and an answer that only asked a question is cut to the question. Invented text only.
import { describe, expect, it } from 'vitest'
import type { Proposal } from '@shared/contracts/ask'
import { clipLine, compactBlocks, onlyAsks, pastAnswer, proposalLine, withoutPreambles } from './history'

const edit: Proposal = {
  id: '2',
  status: 'applied',
  why: 'Typo.',
  kind: 'text',
  sceneId: 's1',
  sceneLabel: 'Ch 1, Sc 2',
  find: 'Teh gulls went quiet.',
  replace: 'The gulls went quiet.'
}
const rewrite: Proposal = {
  id: '3',
  status: 'pending',
  why: 'Harder.',
  kind: 'passage',
  sceneId: 's1',
  sceneLabel: 'Ch 1, Sc 2',
  start: 'The tide',
  end: 'waited.',
  original: 'The tide came in over the flats. ' + 'Mara waited by the post. '.repeat(10),
  replace: ''
}

describe('proposalLine', () => {
  it('says what a change changed, where, and what became of it', () => {
    expect(proposalLine(edit)).toBe('change 2: [Ch 1, Sc 2] "Teh gulls went quiet." → "The gulls went quiet." (applied)')
    const long = proposalLine(rewrite)
    expect(long).toMatch(/^change 3: \[Ch 1, Sc 2\] "The tide came in over the flats\. Mara waited.*…" → \(cut\) \(pending\)$/)
    expect(long.length).toBeLessThan(200)
    expect(
      proposalLine({
        id: '4',
        status: 'declined',
        why: '',
        kind: 'rename',
        target: 'chapter',
        targetId: 'c1',
        from: 'Salt',
        to: 'The Salt Stair'
      })
    ).toBe('change 4: rename chapter "Salt" → "The Salt Stair" (declined)')
    expect(
      proposalLine({
        id: '5',
        status: 'pending',
        why: '',
        kind: 'card',
        sceneId: 's1',
        sceneLabel: 'Ch 2, Sc 1',
        patch: { goal: 'Reach the ferry', beats: ['Run', 'Hide'] }
      })
    ).toBe('change 5: [Ch 2, Sc 1] scene card: goal "Reach the ferry", beats "Run; Hide" (pending)')
  })
  it('clips each side to about 120 characters on one line', () => {
    expect(clipLine('a\n\nb  c')).toBe('a b c')
    expect(clipLine('x'.repeat(300))).toHaveLength(120)
  })
})

describe('withoutPreambles', () => {
  it('takes out "I’ll read the scene first" when more follows', () => {
    expect(withoutPreambles("I'll read the scene first.\n\nThe gulls line has a typo.")).toBe('The gulls line has a typo.')
    expect(withoutPreambles('Let me check the outline. Tobin first appears in Ch 2.')).toBe('Tobin first appears in Ch 2.')
    expect(withoutPreambles('Sure, let me look at the scene first. One change ready.')).toBe('One change ready.')
  })
  it('keeps an answer that is only a preamble, and leaves other sentences alone', () => {
    expect(withoutPreambles("I'll read the scene first.")).toBe("I'll read the scene first.")
    expect(withoutPreambles("I'll tighten the opening. One change ready.")).toBe("I'll tighten the opening. One change ready.")
  })
})

describe('pastAnswer', () => {
  it('cuts a clarifying-only answer to its question', () => {
    const asked =
      "I'll read the scene first.\n\nThere are two harbour scenes and either could be the one. Which do you mean, the dawn one or the storm?"
    expect(onlyAsks(asked)).toBe(true)
    expect(pastAnswer(asked, [])).toBe('(Asked) Which do you mean, the dawn one or the storm?')
  })
  it('adds what each proposal changed, one line each', () => {
    expect(pastAnswer('Let me read the scene first. 1 change ready.', [edit])).toBe(
      '1 change ready.\n\n[Proposed with the tools:\nchange 2: [Ch 1, Sc 2] "Teh gulls went quiet." → "The gulls went quiet." (applied)]'
    )
  })
  it('leaves a plain answer as it was', () => {
    expect(pastAnswer('Tobin is the ferryman.', [])).toBe('Tobin is the ferryman.')
  })
})

describe('compactBlocks (the answer format)', () => {
  const long = 'the toll pulls [[Mara Venn]] out of her count, and the noise of it carries the whole opening on its back'
  const answer = [
    'Three ways to open on the quay.',
    '::options',
    `- **Start on the bell**: ${long}`,
    '- **Start on the catch**: cold and close.',
    '- **Start mid-row**: two traders shouting.',
    '::',
    '::more',
    'A long reason the model gave, which the model need not see again.',
    '::',
    '::next',
    '- Make the second one darker',
    '::'
  ].join('\n')

  it('keeps the option titles in order and the follow-ups, cuts the whys short and leaves ::more out', () => {
    const c = compactBlocks(answer)
    expect(c).toBe(
      [
        'Three ways to open on the quay.',
        '::options',
        `- **Start on the bell**: ${clipLine(long, 60)}`,
        '- **Start on the catch**: cold and close.',
        '- **Start mid-row**: two traders shouting.',
        '::',
        '::next',
        '- Make the second one darker',
        '::'
      ].join('\n')
    )
    expect(c).not.toMatch(/long reason/)
    expect(c.length).toBeLessThan(answer.length)
  })

  it('cuts each fact to about 120 characters and keeps the verdict', () => {
    const c = compactBlocks(`Yes.\n::facts yes\n- ${'[[Mara Venn]] is 34 '.repeat(10)}\n::`)
    expect(c).toMatch(/^Yes\.\n::facts yes\n- \[\[Mara Venn\]\] is 34/)
    expect(c.split('\n')[2].length).toBeLessThanOrEqual(122)
  })

  it('leaves an answer without blocks as it was', () => {
    expect(compactBlocks('Tobin is the ferryman.\n\n1. One\n2. Two\n3. Three')).toBe('Tobin is the ferryman.\n\n1. One\n2. Two\n3. Three')
  })

  it('still goes through pastAnswer: a preamble goes, proposals are added', () => {
    const c = pastAnswer(compactBlocks('Let me read the scene first. 1 change ready.\n::next\n- Tighten the ending\n::'), [edit])
    expect(c).toMatch(/^1 change ready\.\n::next\n- Tighten the ending\n::\n\n\[Proposed with the tools:\nchange 2:/)
  })
})
