// What the director decides for free, and when it is asked; its request and how its reply is read; the clothes rule.
import { describe, expect, it } from 'vitest'
import type { StretchFinding } from './checks'
import { clothesSlips, type Wearer } from './clothes'
import { decisionLine, freeDecision, progressOf, reasonsToAsk } from './decide'
import { DIRECTOR_MARKER, directorMessages, readVerdict } from './prompts'
import { planStretches } from './stretch'

const plan = planStretches(['Mara finds the letter under the hearthstone.', 'Tobin knocks at the door.'], 400)
const finding = (o: Partial<StretchFinding> = {}): StretchFinding => ({
  rule: 'clothes',
  message: 'Mara’s coat is off (on the peg), but here: “pulled her coat tighter”.',
  quote: 'Mara pulled her coat tighter.',
  inLast: true,
  mustFix: true,
  ...o
})

describe('progress, read for free', () => {
  it('beats on the page, the checklist, and the closing image in the latest stretch', () => {
    const page = 'Mara knelt and found the letter under the loose hearthstone, its seal unbroken.'
    const p = progressOf(plan, ['Mara hides the letter in her sleeve.'], 'the fire burning low', page, page)
    expect(p.beatsOn).toBe(1)
    expect(p.asks).toEqual([{ text: 'Mara hides the letter in her sleeve.', landed: false }])
    expect(p.closing).toBe(false)
    expect(progressOf(plan, [], '', page, page).closing).toBeNull()
  })
})

describe('when the director is asked', () => {
  const quiet = { findings: [] as StretchFinding[], adam: [] as string[], words: 200 }

  it('not at all while everything is as planned', () => {
    const progress = { beatsOn: 1, asks: [], closing: null }
    expect(reasonsToAsk({ ...quiet, progress, plan, stretches: 1 })).toEqual([])
  })

  it('a finding, Adam’s note, an overdue beat', () => {
    const progress = { beatsOn: 0, asks: [], closing: null }
    const why = reasonsToAsk({ findings: [finding()], adam: ['slower'], words: 200, progress, plan, stretches: 1 })
    expect(why.map((w) => w.kind)).toEqual(['finding', 'adam', 'beat'])
    expect(why[2].text).toBe('Beat 1, “Mara finds the letter under the hearthstone.”, isn’t on the page yet.')
  })

  it('an ask not on the page once the planned stretches are written, and a closing image not reached', () => {
    const asks = reasonsToAsk({ ...quiet, progress: { beatsOn: 2, asks: [{ text: 'Mara burns it.', landed: false }], closing: null }, plan, stretches: 2 })
    expect(asks).toEqual([{ kind: 'ask', text: 'Not on the page yet: “Mara burns it.”' }])
    const end = reasonsToAsk({ ...quiet, progress: { beatsOn: 2, asks: [], closing: false }, plan, stretches: 2 })
    expect(end.map((w) => w.kind)).toEqual(['end'])
    expect(reasonsToAsk({ ...quiet, progress: { beatsOn: 2, asks: [], closing: true }, plan, stretches: 2 })).toEqual([])
  })
})

describe('the decision made for free', () => {
  const progress = { beatsOn: 1, asks: [], closing: null }

  it('a slip that must not stand in the last paragraph: taken again, twice at most', () => {
    expect(freeDecision({ findings: [finding()], progress, plan, stretches: 1, retakes: 0 })).toMatchObject({ verdict: 'retake', reason: finding().message })
    expect(freeDecision({ findings: [finding()], progress, plan, stretches: 1, retakes: 2 }).verdict).toBe('continue')
    expect(freeDecision({ findings: [finding({ inLast: false })], progress, plan, stretches: 1, retakes: 0 })).toMatchObject({
      verdict: 'continue',
      note: `Keep to the story: ${finding().message}`
    })
  })

  it('done once the planned stretches are written and everything landed; one stretch more to land what didn’t', () => {
    expect(freeDecision({ findings: [], progress: { beatsOn: 2, asks: [], closing: null }, plan, stretches: 2, retakes: 0 }).verdict).toBe('done')
    const more = freeDecision({ findings: [], progress: { beatsOn: 1, asks: [], closing: null }, plan, stretches: 2, retakes: 0 })
    expect(more).toMatchObject({ verdict: 'continue', note: 'Before the scene ends: “Tobin knocks at the door.”' })
    expect(freeDecision({ findings: [], progress: { beatsOn: 1, asks: [], closing: null }, plan, stretches: 3, retakes: 0 }).verdict).toBe('done')
  })

  it('an overdue beat is the note', () => {
    expect(freeDecision({ findings: [], progress: { beatsOn: 0, asks: [], closing: null }, plan, stretches: 1, retakes: 0 }).note).toBe(
      'Land this now: “Mara finds the letter under the hearthstone.”'
    )
  })

  it('the window’s line in plain words', () => {
    expect(decisionLine({ verdict: 'continue', reason: '' }, { beats: ['Someone knocks at the door.'], words: 200 })).toBe('Carry on — next, someone knocks at the door')
    expect(decisionLine({ verdict: 'continue', reason: '' }, { beats: ['Tobin knocks.'], words: 200 })).toBe('Carry on — next, Tobin knocks')
    expect(decisionLine({ verdict: 'retake', reason: 'Her coat is off.' }, null)).toBe('Taking the last paragraph again — her coat is off.')
    expect(decisionLine({ verdict: 'done', reason: '' }, null)).toBe('That’s the scene.')
  })
})

describe('the director’s request and reply', () => {
  it('the plan, the checklist, the direction, why it is asked, and the words', () => {
    const m = directorMessages({
      plan,
      progress: { beatsOn: 0, asks: [{ text: 'Mara burns the letter.', landed: false }], closing: false },
      stretch: 1,
      of: 2,
      closing: 'the fire low',
      direction: 'Keep it tense.',
      findings: [finding()],
      why: [{ kind: 'finding', text: 'Her coat is off.' }],
      before: 'The rain fell.',
      stretchText: 'Mara pulled her coat tighter.',
      retakes: 0,
      next: plan.units[1]
    })
    expect(m[0].content.startsWith(DIRECTOR_MARKER)).toBe(true)
    const user = m[1].content
    expect(user).toContain('1. Mara finds the letter under the hearthstone. (written for, not found on the page)')
    expect(user).toContain('2. Tobin knocks at the door. (next)')
    expect(user).toContain('It ends on: the fire low')
    expect(user).toContain('- Mara burns the letter. (not yet)')
    expect(user).toContain("## The author's direction\nKeep it tense.")
    expect(user).toContain('[its last paragraph]')
    expect(user).toContain('## The latest stretch (stretch 1 of 2)\nMara pulled her coat tighter.')
    expect(user).toContain('Retakes of its last paragraph so far: 0 of 2')
  })

  it('reads the verdict, forgiving fences and case; anything else is unreadable', () => {
    expect(readVerdict('```json\n{"verdict": "Retake", "note": "Keep it on the peg.", "reason": "Coat off."}\n```')).toEqual({
      verdict: 'retake',
      note: 'Keep it on the peg.',
      reason: 'Coat off.'
    })
    expect(readVerdict('{"verdict": "carry on", "note": "Go on."}')).toEqual({ verdict: 'continue', note: 'Go on.', reason: '' })
    expect(readVerdict('{"verdict": "maybe"}')).toBeNull()
    expect(readVerdict('It reads well.')).toBeNull()
  })
})

describe('the clothes rule: a coat already off', () => {
  const mara: Wearer = { name: 'Mara Venn', names: ['Mara Venn', 'Mara'], pronoun: 'she', clothes: [{ name: 'oilskin coat', state: 'off, on the peg behind the door' }] }
  const tobin: Wearer = { name: 'Tobin', names: ['Tobin'], pronoun: 'he', clothes: [{ name: 'boots', state: 'on' }] }

  it('someone uses a piece that is off as worn', () => {
    const slips = clothesSlips('The fire hissed. Mara pulled her coat tighter against the draught.', '', [mara, tobin])
    expect(slips).toHaveLength(1)
    expect(slips[0].message).toBe('Mara Venn’s oilskin coat is off (on the peg behind the door), but here: “pulled her coat tighter against”.')
    expect(slips[0].quote).toBe('Mara pulled her coat tighter against the draught.')
    expect(clothesSlips('She buttoned her coat to the chin.', '', [mara, tobin])).toHaveLength(1)
  })

  it('never in dialogue, a memory, or once it is put on again', () => {
    expect(clothesSlips('“Mara pulled her coat tighter,” Tobin said.', '', [mara, tobin])).toEqual([])
    expect(clothesSlips('She remembered how Mara pulled her coat tighter on the quay.', '', [mara, tobin])).toEqual([])
    expect(clothesSlips('Mara put on her coat. Later Mara pulled her coat tighter.', '', [mara, tobin])).toEqual([])
    expect(clothesSlips('Mara pulled her coat tighter.', 'Mara took her coat from the peg and put her coat back on.', [mara, tobin])).toEqual([])
  })

  it('a piece the draft took off earlier counts; "her" is never guessed when two people go by it', () => {
    const before = 'Tobin pulled off his boots and set them by the fire.'
    expect(clothesSlips('Tobin tugged his boots tighter.', before, [mara, tobin])).toHaveLength(1)
    const ash: Wearer = { name: 'Ash', names: ['Ash'], pronoun: 'she', clothes: [] }
    expect(clothesSlips('She pulled her coat tighter.', '', [mara, tobin, ash])).toEqual([])
    expect(clothesSlips('Tobin pulled his coat tighter.', '', [mara, tobin])).toEqual([])
  })
})
