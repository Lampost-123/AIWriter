// The trap harness's prose check (tests/traps/prose.ts): metrics with no model call, the judge's rubric in its usual
// call, and the report's Prose section. Invented lines only. No model.
import { describe, expect, it } from 'vitest'
import { CHAINS, chainStepProse } from '../traps/chain'
import { judgeMessages, readJudgeProse, readJudgeReply } from '../traps/judge'
import {
  beatsShown,
  closingOf,
  copiesLine,
  promptText,
  proseMarkdown,
  proseMetrics,
  proseRows,
  sampleLines,
  speechOf,
  summariseProse,
  ticsIn,
  wordsOf,
  type ProseEntry
} from '../traps/prose'

const PROMPT = [
  '### Tam Oakes',
  'Voice',
  '- How they speak: Slow, dry.',
  '- Sample lines of dialogue:',
  '    That is the long and short of it.',
  "    ‘You'll want the north road, and the north road won't want you.’",
  '    No.',
  '',
  'What has happened so far:',
  '- sold a cart'
].join('\n')

const base = { before: '', target: null, samples: [] as string[] }

describe('prose metrics', () => {
  it('reads the sample lines from a writer prompt, also from its saved JSON', () => {
    expect(sampleLines(PROMPT)).toEqual(['That is the long and short of it.', "‘You'll want the north road, and the north road won't want you.’", 'No.'])
    const saved = JSON.stringify([
      { role: 'system', content: 'Write well.' },
      { role: 'user', content: PROMPT }
    ])
    expect(sampleLines(promptText(saved))).toHaveLength(3)
    expect(promptText('not json')).toBe('')
  })
  it('finds a sample line copied word for word, not a short or a paraphrased one', () => {
    const w = wordsOf('‘Well,’ Tam said, ‘that is the long and short of it.’')
    expect(copiesLine(w, 'That is the long and short of it.')).toBe(true)
    expect(copiesLine(w, 'No.')).toBe(false)
    expect(copiesLine(wordsOf('That is the short of it, more or less.'), 'That is the long and short of it.')).toBe(false)
    // A long line: any eight words of it in a row.
    expect(copiesLine(wordsOf('He said you will want the north road, and the north road won’t want you, and laughed.'), "‘You'll want the north road, and the north road won't want you.’")).toBe(true)
    expect(proseMetrics({ ...base, text: 'Tam shrugged. ‘That is the long and short of it.’', samples: sampleLines(PROMPT) }).voiceLines).toEqual(['That is the long and short of it.'])
  })
  it('measures recap against the scene so far, and an opening that echoes the last paragraph', () => {
    const before = 'The mill stood at the bottom of the lane.\n\nMara set the lantern on the sill and looked out at the dark yard.'
    const echo = proseMetrics({ ...base, before, text: 'Mara set the lantern on the sill and looked out at the yard again. A dog barked.' })
    expect(echo.openingEcho).toBe(true)
    expect(echo.recap).toBeGreaterThan(0.3)
    const fresh = proseMetrics({ ...base, before, text: 'Somewhere past the wall a dog barked twice, and stopped.' })
    expect(fresh.openingEcho).toBe(false)
    expect(fresh.recap).toBe(0)
  })
  it('counts six-word runs echoed from earlier steps', () => {
    const m = proseMetrics({ ...base, text: 'She put her hand flat on the cold door and waited.', earlier: ['At the gate she put her hand flat on the cold door and listened.'] })
    expect(m.echoes).toBeGreaterThan(0)
    expect(m.echo).toBe('she put her hand flat on')
    expect(proseMetrics({ ...base, text: 'She waited by the door.', earlier: ['She sat by the fire.'] }).echoes).toBe(0)
  })
  it('finds stock tics, and words against the length asked', () => {
    expect(ticsIn('The rain went on. Neither of them said anything. The rain kept on, unhurried.')).toEqual([
      { tic: 'the rain went on', n: 2 },
      { tic: 'neither of them said', n: 1 },
      { tic: 'unhurried', n: 1 }
    ])
    const m = proseMetrics({ ...base, text: 'one two three four five six', target: 4 })
    expect(m.words).toBe(6)
    expect(m.ratio).toBe(1.5)
    expect(m.andRate).toBe(0)
    expect(proseMetrics({ ...base, text: 'Bread and salt and a knife.' }).andRate).toBeCloseTo(33.33, 1)
  })
  it('a passage that closes the scene off, in its last sentences, not in what is said', () => {
    expect(closingOf('She banked the fire. After a while she closed her eyes and slept.')).toBe('closed her eyes')
    expect(closingOf('The talk ran on. Neither of them spoke again, and the lamp burned low.')).toBe('Neither of them spoke')
    expect(closingOf('‘Go to sleep,’ he said. She reached for the latch.')).toBeNull()
    expect(closingOf('She stood. Nothing more was said.')).toBe('Nothing more was said')
    expect(closingOf('She slept badly that week. In the morning she was up before the birds, hauling water, and the bucket swung against her knee.')).toBeNull()
  })
  it('a card beat done again: shown before, shown again; talk counted only when said aloud', () => {
    const beats = [
      { beat: 'They reach the mill.', sign: /\breached the mill\b/i },
      { beat: 'They talk about the harvest.', sign: /\bharvest\b/i, spoken: true }
    ]
    expect(speechOf('He nodded. ‘The harvest,’ he said.')).toMatch(/^\s+‘The harvest,’\s+$/)
    expect(beatsShown('They reached the mill at dusk.', beats)).toEqual([1])
    expect(beatsShown('She thought of the harvest.', beats)).toEqual([])
    expect(beatsShown('‘After the harvest,’ she said.', beats)).toEqual([2])
    const m = proseMetrics({ ...base, before: 'They reached the mill at dusk.', text: 'They reached the mill as the rain came. ‘The harvest will wait,’ he said.', beats })
    expect(m.beatsRedone).toEqual([1])
  })
  it('a chain step against K1: the opening already reached the inn, so arriving again is a beat done again', () => {
    const spec = CHAINS[0]
    const m = chainStepProse(spec, 'addBelow', 'By the time they saw the inn lamp they were soaked, and Wren stood dripping on the flagstones.', spec.opening, [], null)
    expect(m.beatsRedone).toEqual([1])
    expect(m.target).toBe(spec.addWords)
    expect(chainStepProse(spec, 'continue', 'She turned her cup in her hands.', spec.opening, [], null)).toMatchObject({ target: null, ratio: null, beatsRedone: [] })
  })
})

describe('the judge marks the writing in its usual call', () => {
  const probe = { facts: ['Wren is lying on the settle.'], checks: [{ id: 'Q1', trap: 'lie-down', ask: 'Is she standing?', bad: 'yes' as const }] }
  it('adds the rubric with anchored scores only when asked, and the direction when there is one', () => {
    expect(judgeMessages(probe, 'Words.')[1].content).not.toMatch(/"prose"/)
    const asked = judgeMessages(probe, 'Words.', { direction: 'Someone knocks at the door.' })[1].content
    expect(asked).toMatch(/- voices: 1 = .*; 3 = .*; 5 = /)
    expect(asked).toMatch(/- ending: 1 = closes the scene off/)
    expect(asked).toMatch(/the author asked for this: "Someone knocks at the door\."/)
    expect(judgeMessages(probe, 'Words.', { direction: null })[1].content).toMatch(/there was no direction/)
  })
  it('reads the marks beside the answers; out-of-range marks are left out', () => {
    const reply = '```json\n{"answers": [{"id": "Q1", "answer": "no", "quote": ""}], "prose": {"voices": 4, "subtext": "2", "direction": 9, "ending": 3}}\n```'
    expect(readJudgeReply(reply)).toEqual([{ id: 'Q1', answer: 'no', quote: '' }])
    expect(readJudgeProse(reply)).toEqual({ voices: 4, subtext: 2, direction: null, ending: 3 })
    expect(readJudgeProse('{"answers": []}')).toBeNull()
  })
})

describe('the Prose section', () => {
  const entry = (where: string, text: string, extra: Partial<Parameters<typeof proseMetrics>[0]> = {}): ProseEntry => ({ where, kind: 'addBelow', text, prose: proseMetrics({ ...base, text, ...extra }) })
  it('sums medians and counts, with the worst examples, and shows them as rows', () => {
    const s = summariseProse([
      entry('step 1', 'The rain went on. She slept.', { target: 2 }),
      entry('step 2', 'She cut the bread and handed him half of it, and he took it.', { target: 10, samples: ['and handed him half of it'] }),
      { ...entry('step 3', 'He laughed.'), prose: { ...proseMetrics({ ...base, text: 'He laughed.' }), rubric: { voices: 2, subtext: 4, direction: 3, ending: 5 } } }
    ])
    expect(s.passages).toBe(3)
    expect(s.withTarget).toBe(2)
    expect(s.overLength).toBe(1)
    expect(s.closing).toBe(1)
    expect(s.withTics).toBe(1)
    expect(s.voiceCopies).toBe(1)
    expect(s.rubric).toEqual({ rated: 1, voices: 2, subtext: 4, direction: 3, ending: 5 })
    expect(s.worst.some((w) => w.startsWith('Closes the scene off, step 1'))).toBe(true)
    const rows = proseRows(s)
    expect(rows.find(([k]) => k.startsWith('Ends by closing'))?.[1]).toBe('1 of 3')
    expect(proseMarkdown(s)[0]).toBe('## Prose')
    expect(proseMarkdown(summariseProse([]))).toEqual([])
  })
})
