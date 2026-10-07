// The trap harness's checker (tests/traps): reading the judge's reply, verdicts claim by claim, the tripwires, the
// tallies, and that the story's probes fit the story. No model is called.
import { describe, expect, it } from 'vitest'
import { JUDGE_MARKER, judgeMessages, readJudgeReply } from '../traps/judge'
import { judgeCheck, quoteInPassage, scorePassage, summarise, tally, type ProbeResult, type SampleResult } from '../traps/score'
import { PROBES, RIGHT_HAND_HURT, SCENES, TRAPS, type Check, type Probe } from '../traps/story'

const passage = `Mara flexed her bandaged left hand and winced. "Not yet," she said.\n\nShe pulled her boots back on, wincing at the cold leather, and buttoned her grey coat to the throat.`

const contradiction: Check = { id: 'X1', trap: 'clothing', ask: 'Is Mara wearing her coat?', bad: 'yes' }
const promise: Check = { id: 'X2', trap: 'promise', ask: 'Does Mara give the knife back?', bad: 'no' }

describe('quoteInPassage', () => {
  it('finds a quote word for word, whatever the punctuation, quote marks and spacing', () => {
    expect(quoteInPassage(passage, 'buttoned her grey coat to the throat')).toBe(true)
    expect(quoteInPassage(passage, '“Not yet,” she said.')).toBe(true)
    expect(quoteInPassage(passage, '...pulled her boots   back on...')).toBe(true)
  })
  it('allows a word or so changed in a longer quote, but not words the passage never has', () => {
    expect(quoteInPassage(passage, 'She pulled her boots back on, wincing at the cold leather, and buttoned her coat')).toBe(true)
    expect(quoteInPassage(passage, 'Tobin handed her the bone-handled knife')).toBe(false)
    expect(quoteInPassage(passage, '')).toBe(false)
    expect(quoteInPassage(passage, 'her grey coat')).toBe(true)
    // Too short to allow a changed word.
    expect(quoteInPassage(passage, 'his grey coat')).toBe(false)
  })
})

describe('judgeCheck', () => {
  it('keeps, breaks, or leaves unverified a contradiction by the answer and its quote', () => {
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'no', quote: '' }, passage).verdict).toBe('kept')
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'yes', quote: 'buttoned her grey coat to the throat' }, passage).verdict).toBe('broken')
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'yes', quote: 'she wore a fine red cloak' }, passage).verdict).toBe('unverified')
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'yes', quote: '' }, passage).verdict).toBe('unverified')
  })
  it('breaks something that should have happened on a plain "no", with nothing to quote', () => {
    expect(judgeCheck(promise, { id: 'X2', answer: 'no', quote: '' }, passage).verdict).toBe('broken')
    expect(judgeCheck(promise, { id: 'X2', answer: 'yes', quote: 'anything' }, passage).verdict).toBe('kept')
  })
  it('counts "unclear" and a missing answer as not touched', () => {
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'unclear', quote: '' }, passage).verdict).toBe('silent')
    expect(judgeCheck(contradiction, undefined, passage)).toMatchObject({ verdict: 'silent', by: 'none' })
  })
  it('lets a tripwire break its check whatever the judge said, and only its own check', () => {
    const wire = { check: 'X1', what: 'coat', pattern: /grey coat/gi }
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'no', quote: '' }, passage, [wire])).toMatchObject({ verdict: 'broken', by: 'tripwire' })
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'no', quote: '' }, passage, [{ ...wire, check: 'Z9' }]).verdict).toBe('kept')
    // A tripwire that doesn't match proves nothing: the judge's answer stands.
    expect(judgeCheck(contradiction, { id: 'X1', answer: 'unclear', quote: '' }, 'Nothing here.', [wire]).verdict).toBe('silent')
  })
})

describe('the right-hand tripwire', () => {
  it('catches the cut put on the wrong hand', () => {
    for (const t of [
      'She cradled her right hand, the bandage already spotting red.',
      'Her bandaged right hand throbbed.',
      'The cut on her right palm had opened again.',
      'Her right hand was wrapped in linen.'
    ])
      expect(RIGHT_HAND_HURT.test(t), t).toBe(true)
  })
  it('leaves the right hand doing things, and the left hand hurt, alone', () => {
    for (const t of [
      'She took the cup in her right hand; her bandaged left throbbed.',
      'She held the reins in her right hand. Her left hand was bandaged.',
      'With her right hand she drew the knife, the cut on her left palm stinging.',
      'Her left palm was bandaged.',
      'She looked at her bandaged left hand and her right hand.',
      'Her right hand, steady now, found the latch.',
      'She gripped it with her right hand while the bandaged left throbbed.',
      'She peeled turnips with her right hand, her bandaged left hand in her lap.'
    ])
      expect(RIGHT_HAND_HURT.test(t), t).toBe(false)
  })
})

describe('readJudgeReply', () => {
  it('reads the answers, in a code fence or bare, and plain words for yes and no', () => {
    expect(readJudgeReply('```json\n{"answers":[{"id":"A1","answer":"Yes.","quote":"her coat"},{"id":"A2","answer":"not shown"}]}\n```')).toEqual([
      { id: 'A1', answer: 'yes', quote: 'her coat' },
      { id: 'A2', answer: 'unclear', quote: '' }
    ])
    expect(readJudgeReply('Here you go: [{"id":"B1","answer":"no","quote":""}]')).toEqual([{ id: 'B1', answer: 'no', quote: '' }])
  })
  it('gives null for a reply it cannot read', () => {
    expect(readJudgeReply('I think the passage is fine.')).toBeNull()
    expect(readJudgeReply('{"answers": [')).toBeNull()
  })
})

describe('judgeMessages', () => {
  it('gives the judge the facts, the passage and the questions, and nothing of the briefing', () => {
    const [system, user] = judgeMessages(PROBES[0], 'Some words.')
    expect(system.content.startsWith(JUDGE_MARKER)).toBe(true)
    for (const f of PROBES[0].facts) expect(user.content).toContain(f)
    for (const c of PROBES[0].checks) expect(user.content).toContain(`${c.id}: ${c.ask}`)
    expect(user.content).toContain('"""\nSome words.\n"""')
  })
})

describe('scores', () => {
  const probe: Pick<Probe, 'checks' | 'tripwires'> = { checks: [contradiction, promise], tripwires: [] }
  const sample = (index: number, status: SampleResult['status'], answers: Parameters<typeof scorePassage>[2]): SampleResult => ({
    index,
    status,
    error: null,
    generationId: null,
    words: 10,
    text: passage,
    judge: { status: 'ok', raw: '' },
    results: status === 'complete' ? scorePassage(probe, passage, answers) : []
  })

  it('tallies the verdicts, and consistency counts only what the passage touched', () => {
    expect(tally([{ verdict: 'kept' }, { verdict: 'kept' }, { verdict: 'broken' }, { verdict: 'silent' }, { verdict: 'unverified' }])).toEqual({
      kept: 2,
      broken: 1,
      unverified: 1,
      silent: 1,
      consistency: 2 / 3
    })
    expect(tally([{ verdict: 'silent' }]).consistency).toBeNull()
  })

  it('sums by trap, by probe and in all, leaving out passages that were never written', () => {
    const probes: ProbeResult[] = [
      {
        id: 'P',
        scene: 's1',
        kind: 'generate',
        asks: '',
        samples: [
          sample(0, 'complete', [
            { id: 'x1', answer: 'yes', quote: 'her grey coat' },
            { id: 'X2', answer: 'yes', quote: '' }
          ]),
          sample(1, 'complete', null),
          sample(2, 'error', null)
        ]
      }
    ]
    const s = summarise(probes)
    expect(s.byProbe.P).toMatchObject({ kept: 1, broken: 1, silent: 2 })
    expect(s.byTrap.clothing).toMatchObject({ broken: 1, consistency: 0 })
    expect(s.byTrap.promise).toMatchObject({ kept: 1, consistency: 1 })
    expect(s.byTrap.injury.consistency).toBeNull()
    expect(s.total).toMatchObject({ passages: 2, brokenPerPassage: 0.5, consistency: 0.5 })
  })
})

describe('the trap story', () => {
  it('has probes that fit their scenes, with checks that are each named once', () => {
    const ids = new Set<string>()
    for (const p of PROBES) {
      const scene = SCENES.find((s) => s.key === p.scene)
      expect(scene, p.id).toBeTruthy()
      if (p.kind === 'generate') expect(p.paragraphs).toBe(0)
      else expect(p.paragraphs).toBeGreaterThan(0)
      expect(p.paragraphs).toBeLessThanOrEqual(scene!.paragraphs.length)
      if (p.kind === 'beat') expect(p.beat).toBeLessThanOrEqual(scene!.card.beats?.length ?? 0)
      for (const c of p.checks) {
        expect(ids.has(c.id), c.id).toBe(false)
        ids.add(c.id)
        expect(TRAPS.some((t) => t.id === c.trap)).toBe(true)
      }
      for (const w of p.tripwires) expect(p.checks.some((c) => c.id === w.check)).toBe(true)
    }
    // The story's own words keep to the truth: no tripwire fires on them.
    for (const s of SCENES) for (const para of s.paragraphs) expect(RIGHT_HAND_HURT.test(para), para).toBe(false)
    // Every trap is checked somewhere.
    for (const t of TRAPS) expect(PROBES.some((p) => p.checks.some((c) => c.trap === t.id)), t.id).toBe(true)
  })
})
