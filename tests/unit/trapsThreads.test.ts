// Chain K3 of the trap harness (tests/traps/chain.ts): plot threads. The four thread checks, (a) paid off
// before the step that asks, (b) paid off when asked, (c) kept alive on Continue, (d) paid off with no direction asking,
// each with invented lines that are slips and lines that only look like them; which checks are in force at which step;
// what a step notes (open, dormant, touched, what the writer's prompt carried); the summary; and --chain's parsing. No
// model.
import { describe, expect, it } from 'vitest'
import {
  CHAINS,
  DEFAULT_CHAINS,
  K3_PLANTS,
  K3_THREADS,
  chainPlantsListed,
  inForce,
  landed,
  payoffShown,
  payoffStep,
  stepChecks,
  threadEnds,
  threadNotes,
  threadsCarried,
  type ChainPlant
} from '../traps/chain'
import { firstBreak } from '../traps/patterns'
import { scorePassage, summariseThreads, threadsMarkdown, type ChainResult, type ChainStepResult, type CheckResult } from '../traps/score'
import { CHAIN_IDS, parseChains } from '../traps/chainArg.mjs'

const k3 = CHAINS.find((c) => c.id === 'K3')!
const plant = (id: string): ChainPlant => K3_PLANTS.find((p) => p.id === id)!
/** A plant's tripwire, as the scoring tries it (score.ts judgeCheck, with stepChecks' fields). */
const wire = (id: string, text: string): boolean => {
  const t = stepChecks([plant(id)]).tripwires[0]
  return !!firstBreak({ broken: t.pattern, not: t.not, unlessBefore: t.unlessBefore, outsideQuotes: t.outsideQuotes }, text)
}
/** One check of one plant, scored with the judge's answer. */
const scored = (id: string, text: string, answer: 'yes' | 'no' | 'unclear' | null, quote = ''): CheckResult => {
  const sc = stepChecks([plant(id)])
  const r = scorePassage(sc, text, answer ? [{ id: 'Q1', answer, quote }] : [])[0]
  return { ...r, id, trap: id }
}
/** Where each thread's plants landed: the letter at step 1, the debt at 3, the question at 5. */
const LANDED = new Map([
  ['letter-open', 1],
  ['letter-alive', 1],
  ['debt-early', 3],
  ['debt-alive', 3],
  ['question-open', 5],
  ['question-alive', 5]
])
const ids = (step: number, ended: string[] = [], spec = k3) =>
  inForce(spec, LANDED, new Set(ended), step, spec.steps[step - 1]?.kind ?? 'continue')
    .filter((p) => p.thread)
    .map((p) => p.id)

describe('chain K3: the chain', () => {
  it('is 12 steps of Add below and Continue in turn, plants three threads early, a clue at 7, the debt paid at 11; K1 still runs by default', () => {
    expect(k3.steps).toHaveLength(12)
    k3.steps.forEach((s, i) => expect(s.kind).toBe(i % 2 ? 'continue' : 'addBelow'))
    expect(k3.steps.flatMap((s, i) => (s.plants ?? []).map((p) => `${i + 1}:${p}`))).toEqual([
      '1:letter-open',
      '1:letter-alive',
      '3:debt-early',
      '3:debt-alive',
      '5:question-open',
      '5:question-alive'
    ])
    expect(k3.steps[6].advances).toEqual(['question'])
    expect(payoffStep(k3, 'debt')).toBe(11)
    expect(payoffStep(k3, 'letter')).toBeNull()
    expect(payoffStep(k3, 'question')).toBeNull()
    // Each step's own words would be found where they plant (as the canned and fake writers echo the direction).
    for (const s of k3.steps) if (s.plants) expect(landed(k3, s.plants, s.direction!).ok, s.direction).toBe(true)
    expect(DEFAULT_CHAINS).toEqual(['K1'])
    expect(new Set(K3_PLANTS.map((p) => p.thread!.id))).toEqual(new Set(K3_THREADS.map((t) => t.id)))
    // One check a plant (saved answers re-score by plant).
    for (const p of K3_PLANTS) expect(!!p.drift, p.id).toBe(false)
  })
  it('lists the payoff check at the step that pays it off, and every check with its thread', () => {
    const listed = chainPlantsListed(k3)
    expect(listed.find((p) => p.id === 'debt-paid')).toMatchObject({ step: 11, thread: { id: 'debt', check: 'payoff' } })
    expect(listed.find((p) => p.id === 'question-alive')).toMatchObject({ step: 5, thread: { id: 'question', check: 'alive' } })
    expect(listed.find((p) => p.id === 'compass')).toEqual({ id: 'compass', name: expect.any(String), step: null })
    // Cut short (--steps 4): the payoff isn't in the run.
    expect(chainPlantsListed({ ...k3, steps: k3.steps.slice(0, 4) }).find((p) => p.id === 'debt-paid')!.step).toBeNull()
  })
})

describe('chain K3: which thread checks are in force', () => {
  it('kept-alive checks only on Continue; premature until the payoff step; the payoff only at it', () => {
    expect(ids(1)).toEqual([])
    expect(ids(2)).toEqual(['letter-open', 'letter-alive'])
    expect(ids(3)).toEqual(['letter-open'])
    expect(ids(4)).toEqual(['letter-open', 'letter-alive', 'debt-early', 'debt-alive'])
    expect(ids(10)).toEqual(['letter-open', 'letter-alive', 'debt-early', 'debt-alive', 'question-open', 'question-alive'])
    expect(ids(11)).toEqual(['letter-open', 'debt-paid', 'question-open'])
    expect(ids(12)).toEqual(['letter-open', 'letter-alive', 'question-open', 'question-alive'])
  })
  it('a thread resolved early is checked no further, payoff included', () => {
    expect(ids(11, ['debt-early', 'debt-alive', 'debt-paid'])).toEqual(['letter-open', 'question-open'])
  })
  it('cut short before the payoff, the debt stays a premature check', () => {
    const short = { ...k3, steps: k3.steps.slice(0, 4) }
    expect(ids(4, [], short)).toContain('debt-early')
  })
  it('asks the judge with the right bad answer, the tripwire on the narration, one line a fact', () => {
    const sc = stepChecks([plant('letter-open'), plant('letter-alive'), plant('debt-paid')])
    expect(sc.checks.map((c) => [c.trap, c.bad])).toEqual([
      ['letter-open', 'yes'],
      ['letter-alive', 'yes'],
      ['debt-paid', 'no']
    ])
    expect(sc.tripwires.map((t) => t.outsideQuotes)).toEqual([true, true])
    expect(sc.facts).toHaveLength(2)
  })
})

describe('(a) premature payoff: the debt paid before step 11 asks', () => {
  it('slips: the money handed over, Jory pocketing it, "they were square"', () => {
    expect(wire('debt-early', 'Ash pressed three shillings into Jory’s palm and turned back to the fire.')).toBe(true)
    expect(wire('debt-early', 'Jory pocketed the coins without counting them.')).toBe(true)
    expect(wire('debt-early', 'Ash paid Jory there and then, and Jory nodded; they were square.')).toBe(true)
    expect(scored('debt-early', 'Ash pressed three shillings into Jory’s palm.', 'no')).toMatchObject({ verdict: 'broken', by: 'tripwire' })
    // The judge's yes, with words that are on the page.
    expect(
      scored(
        'debt-early',
        '"Call it square," Jory said, and waved the debt away.',
        'yes',
        'Call it square," Jory said, and waved the debt away'
      )
    ).toMatchObject({ verdict: 'broken', by: 'judge' })
  })
  it('not slips: a promise, a plan, no money, said aloud, told as done before (the kept-alive check’s)', () => {
    expect(wire('debt-early', 'Ash had no money; he would pay Jory before the tide turned.')).toBe(false)
    expect(wire('debt-early', '"I’ll put the shillings in your hand before the tide turns," Ash said.')).toBe(false)
    expect(wire('debt-early', 'Ash patted his empty pocket where the shillings should have been.')).toBe(false)
    expect(wire('debt-early', 'Ash had already paid Jory, he said, at the spring fair.')).toBe(false)
    expect(scored('debt-early', 'Ash watched the tide.', 'unclear')).toMatchObject({ verdict: 'silent' })
    // The judge's yes with words the passage lacks: not counted.
    expect(scored('debt-early', 'Ash watched the tide.', 'yes', 'Ash paid him in full')).toMatchObject({ verdict: 'unverified' })
  })
  it('a premature payoff resolves the thread: every debt check ends there', () => {
    expect(threadEnds(k3, [scored('debt-early', 'Ash pressed three shillings into Jory’s palm.', 'no')])).toEqual([
      'debt-early',
      'debt-alive',
      'debt-paid'
    ])
    expect(threadEnds(k3, [scored('debt-early', 'Ash watched the tide.', 'no')])).toEqual([])
  })
})

describe('(b) payoff when asked: the debt paid at step 11', () => {
  const paid = (text: string, answer: 'yes' | 'no' | 'unclear' | null, quote = ''): CheckResult =>
    payoffShown([plant('debt-paid')], [scored('debt-paid', text, answer, quote)], text)[0]
  it('kept: the payment in the narration (whatever the judge said), or the judge’s yes with words on the page', () => {
    expect(paid('The tide turned. Ash pays him the three shillings; Jory says they are square.', 'no')).toMatchObject({
      verdict: 'kept',
      by: 'pattern'
    })
    expect(paid('Ash counted out three shillings onto the bench.', null)).toMatchObject({ verdict: 'kept', by: 'pattern' })
    expect(
      paid('Jory held out his hand. "Square," he said, closing it on the coins.', 'yes', 'Square," he said, closing it on the coins')
    ).toMatchObject({ verdict: 'kept', by: 'judge' })
    expect(threadEnds(k3, [paid('Ash pays him the three shillings.', 'no')])).toEqual(['debt-early', 'debt-alive', 'debt-paid'])
  })
  it('broken: the judge’s no with no payment on the page; a promise is no payment', () => {
    expect(paid('Ash would pay him later, he said, when the boat was over.', 'no')).toMatchObject({ verdict: 'broken' })
    expect(paid('"I’ll pay you the shillings now," Ash said, but Jory had gone.', 'no')).toMatchObject({ verdict: 'broken' })
  })
  it('unverified: a yes whose words the passage lacks; not touched: unclear', () => {
    expect(paid('Jory came in out of the rain.', 'yes', 'Ash handed over the money')).toMatchObject({ verdict: 'unverified' })
    expect(paid('Jory came in out of the rain.', 'unclear')).toMatchObject({ verdict: 'silent' })
  })
})

describe('(c) kept alive on Continue: open threads not contradicted', () => {
  it('slips: the debt said settled, the letter said read or lost, the question said answered', () => {
    expect(wire('debt-alive', 'The debt had been settled long ago, Wren supposed.')).toBe(true)
    expect(wire('debt-alive', 'Ash owed Jory nothing now.')).toBe(true)
    expect(wire('debt-alive', 'Ash had already paid him, at the spring fair.')).toBe(true)
    expect(wire('letter-alive', 'She had already read Bryn’s letter twice on the road.')).toBe(true)
    expect(wire('letter-alive', 'She had lost the letter somewhere on the jetty.')).toBe(true)
    expect(wire('question-alive', 'Her question had been answered on the jetty, and that was that.')).toBe(true)
    expect(
      scored(
        'debt-alive',
        'Jory said the debt was four shillings now, and due at dawn.',
        'yes',
        'the debt was four shillings now, and due at dawn'
      )
    ).toMatchObject({ verdict: 'broken' })
  })
  it('not slips: a negation, said aloud, the payment shown first (that is the premature check’s)', () => {
    expect(wire('debt-alive', 'The debt was not settled yet, and Jory knew it.')).toBe(false)
    expect(wire('debt-alive', '"You owe me nothing," Jory said, as a joke, and held out his hand anyway.')).toBe(false)
    expect(wire('debt-alive', 'Ash pressed three shillings into Jory’s hand. The debt was settled.')).toBe(false)
    expect(wire('letter-alive', 'She had not opened the letter. It sat inside her jacket.')).toBe(false)
    expect(wire('letter-alive', 'She was afraid she had lost the letter, and felt for it.')).toBe(false)
  })
})

describe('(d) invented payoff: a thread no direction pays off, resolved anyway', () => {
  it('slips: the seal broken, the letter opened or read, the stranger answered or named', () => {
    expect(wire('letter-open', 'Wren broke the red wax with her thumb.')).toBe(true)
    expect(wire('letter-open', 'She tore the letter open and read it by the stove.')).toBe(true)
    expect(wire('letter-open', 'In the end she read Bryn’s letter by the light of the stove.')).toBe(true)
    expect(wire('letter-open', 'The seal gave under her nail.')).toBe(true)
    expect(wire('question-open', 'Wren told the stranger that she was.')).toBe(true)
    expect(wire('question-open', 'The stranger gave her name as Maud Leary, and sat down.')).toBe(true)
    expect(threadEnds(k3, [scored('letter-open', 'Wren broke the red wax with her thumb.', 'no')])).toEqual(['letter-open', 'letter-alive'])
  })
  it('not slips: tempted, a negation, said aloud, told as done before, the stranger answered with nothing', () => {
    expect(wire('letter-open', 'Her thumb found the wax and stayed there; she wanted to break the seal and did not.')).toBe(false)
    expect(wire('letter-open', '"Read the letter," Ash said. "Go on."')).toBe(false)
    expect(wire('letter-open', 'She had read the letter twice already.')).toBe(false)
    expect(wire('letter-open', 'She felt the letter through her jacket, sealed still.')).toBe(false)
    expect(wire('question-open', 'Wren told the stranger nothing.')).toBe(false)
    expect(wire('question-open', '"I am," Wren nearly said.')).toBe(false)
  })
})

describe('chain K3: what a step notes', () => {
  it('reads a threads block in the writer’s prompt: the app’s own heading, an "Open threads" list, none', () => {
    const main =
      '## The scene card\n\nWren and Ash wait.\n\n## Plot threads in this scene\n\n### Ash’s debt to Jory Pask (this scene sets it up)\n\nThree shillings, before the tide turns.\n\n## The story so far\n\nBryn’s letter came sealed.'
    expect(threadsCarried(main, K3_THREADS)).toEqual({ block: 'Plot threads in this scene', ids: ['debt'] })
    const open =
      'Where things stand: Wren by the stove.\n\nOpen threads:\n- Bryn’s sealed letter, not to be opened until across the water\n- The stranger in the grey hood’s question, unanswered\n\nWhat happens now: carry on.'
    expect(threadsCarried(open, K3_THREADS)).toEqual({ block: 'Open threads', ids: ['letter', 'question'] })
    expect(threadsCarried('## The scene card\n\nThe letter, the debt and the stranger are all in the scene so far.', K3_THREADS)).toEqual({
      block: null,
      ids: []
    })
    expect(threadsCarried(null, K3_THREADS)).toBeNull()
  })
  it('a thread the direction names is not dormant; a dormant one touched by the words counts', () => {
    const at9 = inForce(k3, LANDED, new Set(), 9, 'addBelow')
    const n9 = threadNotes(k3, at9, k3.steps[8], 'Ash asked what was in the letter. She shrugged; the stranger watched them.', null)!
    expect(n9).toMatchObject({ open: ['letter', 'debt', 'question'], dormant: ['debt', 'question'], touched: ['question'], carried: null })
    const at10 = inForce(k3, LANDED, new Set(), 10, 'continue')
    expect(threadNotes(k3, at10, k3.steps[9], 'Ash counted the shillings in his head and said nothing.', '')!).toMatchObject({
      dormant: ['letter', 'debt', 'question'],
      touched: ['debt'],
      carried: { block: null, ids: [] }
    })
    // At the payoff step the debt is no longer open.
    expect(threadNotes(k3, inForce(k3, LANDED, new Set(), 11, 'addBelow'), k3.steps[10], '', null)!.open).toEqual(['letter', 'question'])
    expect(threadNotes(CHAINS[0], [], CHAINS[0].steps[0], '', null)).toBeUndefined()
  })
})

describe('chain K3: the summary', () => {
  const r = (trap: string, verdict: CheckResult['verdict']): CheckResult => ({
    id: trap,
    trap,
    ask: '',
    verdict,
    by: 'judge',
    answer: '',
    quote: ''
  })
  const step = (n: number, results: CheckResult[], threads?: ChainStepResult['threads']): ChainStepResult => ({
    step: n,
    kind: n % 2 ? 'addBelow' : 'continue',
    direction: '',
    status: 'complete',
    error: null,
    tries: 1,
    generationId: null,
    words: 100,
    text: '',
    planted: [],
    results,
    judge: { status: 'skipped', raw: '' },
    resolved: [],
    ...(threads ? { threads } : {})
  })
  const chain: ChainResult = {
    id: 'K3',
    scene: 'k3',
    title: 'T',
    opening: [],
    plants: chainPlantsListed(k3),
    threads: K3_THREADS.map((t) => ({ id: t.id, name: t.name })),
    steps: 12,
    samples: [
      {
        index: 0,
        status: 'complete',
        why: null,
        firstSlip: 4,
        steps: [
          step(2, [r('letter-open', 'kept'), r('letter-alive', 'silent')], {
            open: ['letter'],
            dormant: ['letter'],
            touched: [],
            carried: { block: null, ids: [] }
          }),
          step(4, [r('letter-open', 'kept'), r('debt-early', 'broken'), r('debt-alive', 'kept')], {
            open: ['letter', 'debt'],
            dormant: ['letter', 'debt'],
            touched: ['letter'],
            carried: { block: 'Open threads', ids: ['letter', 'debt'] }
          }),
          step(11, [r('debt-paid', 'broken'), r('question-open', 'broken'), r('burn', 'kept')], {
            open: ['letter', 'question'],
            dormant: ['letter'],
            touched: [],
            carried: null
          })
        ]
      }
    ]
  }
  it('tallies the four checks, the dormant touches and what the prompts carried', () => {
    const t = summariseThreads([chain])!
    expect(t.byCheck.premature).toMatchObject({ broken: 1, kept: 0 })
    expect(t.byCheck.payoff).toMatchObject({ broken: 1 })
    expect(t.byCheck.alive).toMatchObject({ kept: 1, silent: 1 })
    expect(t.byCheck.invented).toMatchObject({ kept: 2, broken: 1 })
    expect(t.dormant).toEqual([
      { thread: 'letter', name: 'Bryn’s sealed letter', steps: 3, touched: 1, samples: 1, samplesTouched: 1 },
      { thread: 'debt', name: 'Ash’s debt to the ferryman', steps: 1, touched: 0, samples: 1, samplesTouched: 0 }
    ])
    expect(t.carried).toEqual({ steps: 3, withPrompt: 2, withBlock: 1, blocks: { 'Open threads': 1 }, byThread: { letter: 1, debt: 1 } })
    const md = threadsMarkdown(t).join('\n')
    expect(md).toContain('| (a) Not paid off before the step that asks for it | 0 | 1 |')
    expect(md).toContain('| Bryn’s sealed letter | 3 | 1 | 1 of 1 |')
    expect(md).toContain('Writer prompts with a threads block: 1 of 2 steps')
  })
  it('is null for chains without threads', () => {
    expect(summariseThreads([{ ...chain, id: 'K1', threads: undefined }])).toBeNull()
    expect(threadsMarkdown(null)).toEqual([])
  })
})

describe('the harness’s --chain', () => {
  it('takes K1, K2, K3, both, all, or a list of them, once each in the order given', () => {
    expect(CHAIN_IDS).toEqual(CHAINS.filter((c) => !c.optIn).map((c) => c.id))
    expect(parseChains('K1')).toEqual(['K1'])
    expect(parseChains('k3')).toEqual(['K3'])
    expect(parseChains('both')).toEqual(['K1', 'K2'])
    expect(parseChains('all')).toEqual(['K1', 'K2', 'K3'])
    expect(parseChains('K1,K3')).toEqual(['K1', 'K3'])
    expect(parseChains('K3, K1, K3')).toEqual(['K3', 'K1'])
    expect(parseChains('both,K3')).toEqual(['K1', 'K2', 'K3'])
  })
  it('refuses anything else', () => {
    expect(parseChains('K4')).toBeNull()
    expect(parseChains('K1,K9')).toBeNull()
    expect(parseChains('')).toBeNull()
  })
})
