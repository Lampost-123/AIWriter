// The chat answer format's parser (answerBlocks.ts): marked blocks, streaming prefixes, malformed markers, and the
// fallback for answers with no markers. All words invented.
import { describe, expect, it } from 'vitest'
import { answerMarkers, answerText, firstSentence, hasBlockMarkers, listItems, optionOf, parseAnswer, verdictOf, wordsOutsideBlocks, type AnswerBlock } from './answerBlocks'

const IDEAS = [
  'Three ways to open the market scene.',
  '::options',
  '- **Start on the bell**: the toll pulls [[Hesper]] out of the tally, so the noise does the work.',
  '- **Start on the fish**: a cold, close image that fits *the Salt Lamp*’s gloom.',
  '- **Start mid-argument**: [[Bram]] and the clerk already shouting.',
  '::',
  '::next',
  '- Make the second one darker',
  '- Draft the first one',
  '::'
].join('\n')

const FACT = ['Yes. [[Mara Venn]] is 34.', '::facts yes', '- [[Mara Venn]] is 34 (Ch 2, Sc 1, the census).', '- Her brother is older (Ch 1, Sc 3).', '::', '::more', 'The census line is the only place it is said.', 'Ch 4 hints she lies about it.', '::'].join('\n')

/** Every word of an answer (markers aside) is somewhere in its blocks. */
function keepsWords(text: string, blocks: AnswerBlock[]): void {
  const all = JSON.stringify(blocks).replace(/\*\*|__/g, '')
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*:{1,3}\s*[a-z-]*(\s+[a-z]+)?\s*$/i.test(line)) continue
    for (const raw of line.replace(/^\s*(?:[-*•+]|\d{1,2}[.)])\s+/, '').replace(/\*\*|__/g, '').split(/\s+/)) {
      const w = raw.replace(/[:—–-]+$/, '')
      if (w) expect(all, `lost "${w}"`).toContain(JSON.stringify(w).slice(1, -1))
    }
  }
}

describe('parseAnswer: the block format', () => {
  it('reads a lead, options and next', () => {
    expect(parseAnswer(IDEAS)).toEqual([
      { kind: 'lead', text: 'Three ways to open the market scene.' },
      {
        kind: 'options',
        items: [
          { title: 'Start on the bell', why: 'the toll pulls [[Hesper]] out of the tally, so the noise does the work.' },
          { title: 'Start on the fish', why: 'a cold, close image that fits *the Salt Lamp*’s gloom.' },
          { title: 'Start mid-argument', why: '[[Bram]] and the clerk already shouting.' }
        ]
      },
      { kind: 'next', items: ['Make the second one darker', 'Draft the first one'] }
    ])
  })

  it('reads a verdict from the lead and from ::facts, and ::more as text', () => {
    expect(parseAnswer(FACT)).toEqual([
      { kind: 'lead', text: 'Yes. [[Mara Venn]] is 34.', verdict: 'yes' },
      { kind: 'facts', verdict: 'yes', items: ['[[Mara Venn]] is 34 (Ch 2, Sc 1, the census).', 'Her brother is older (Ch 1, Sc 3).'] },
      { kind: 'more', text: 'The census line is the only place it is said.\nCh 4 hints she lies about it.' }
    ])
  })

  it('reads No and Not in memory yet as verdicts', () => {
    expect(parseAnswer('No. Tobin never learns it.\n::facts no\n- He leaves before the letter (Ch 3).\n::')[0]).toEqual({ kind: 'lead', text: 'No. Tobin never learns it.', verdict: 'no' })
    const unknown = parseAnswer('Not in memory yet. Nothing says how old the Duke is.\n::facts unknown\n- [[The Duke]]: no age given.\n::')
    expect(unknown[0]).toMatchObject({ verdict: 'unknown' })
    expect(unknown[1]).toEqual({ kind: 'facts', verdict: 'unknown', items: ['[[The Duke]]: no age given.'] })
  })

  it('does not take "No one" or "Yesterday" for a verdict', () => {
    expect(verdictOf('No one saw her leave.')).toBeUndefined()
    expect(verdictOf('Yesterday, in the story, she left.')).toBeUndefined()
    expect(verdictOf('Yes')).toBe('yes')
    expect(verdictOf('**No.** Never.')).toBe('no')
    expect(verdictOf('The memory doesn’t say.')).toBe('unknown')
  })

  it('keeps text between and after blocks as text blocks, one per paragraph', () => {
    const blocks = parseAnswer('2 changes ready.\n\nI kept your spelling.\n::next\n- Tighten the ending\n::\nTell me if the tone is off.\n\nOr ask again.')
    expect(blocks).toEqual([
      { kind: 'lead', text: '2 changes ready.' },
      { kind: 'text', text: 'I kept your spelling.' },
      { kind: 'next', items: ['Tighten the ending'] },
      { kind: 'text', text: 'Tell me if the tone is off.' },
      { kind: 'text', text: 'Or ask again.' }
    ])
  })

  it('reads CRLF line ends', () => {
    expect(parseAnswer(IDEAS.replace(/\n/g, '\r\n'))).toEqual(parseAnswer(IDEAS))
    expect(parseAnswer(FACT.replace(/\n/g, '\r\n'))).toEqual(parseAnswer(FACT))
  })

  it('leaves [[names]], *italics* and bold inside facts untouched', () => {
    const [, facts] = parseAnswer('Yes.\n::facts\n- [[Hesper]] keeps *the tally* at **the office** (Ch 1).\n::')
    expect(facts).toEqual({ kind: 'facts', items: ['[[Hesper]] keeps *the tally* at **the office** (Ch 1).'] })
  })

  it('reads option titles in every common shape', () => {
    expect(optionOf('**The Salt Lamp**: a tavern by the quay.')).toEqual({ title: 'The Salt Lamp', why: 'a tavern by the quay.' })
    expect(optionOf('**The Salt Lamp:** a tavern by the quay.')).toEqual({ title: 'The Salt Lamp', why: 'a tavern by the quay.' })
    expect(optionOf('**The Salt Lamp** — a tavern by the quay.')).toEqual({ title: 'The Salt Lamp', why: 'a tavern by the quay.' })
    expect(optionOf('__The Oar__ - plain and old.')).toEqual({ title: 'The Oar', why: 'plain and old.' })
    expect(optionOf('*The Net*: for the fishers.')).toEqual({ title: '*The Net*', why: 'for the fishers.' })
    expect(optionOf('The Gull Stair — steep, wet, and loud.')).toEqual({ title: 'The Gull Stair', why: 'steep, wet, and loud.' })
    expect(optionOf('The Gull Stair')).toEqual({ title: 'The Gull Stair', why: '' })
    expect(optionOf('Have Mara find the letter in the boathouse during the storm.')).toEqual({ title: 'Have Mara find the letter…', why: 'Have Mara find the letter in the boathouse during the storm.' })
  })

  it('does not split a title at a hyphenated word or a time', () => {
    expect(optionOf('Meet at the slate-blue door at 10:30 when the tide turns and the lamps go out.').title).toBe('Meet at the slate-blue door…')
  })

  it('reads numbered and starred options, and options with no marker', () => {
    const [, opts] = parseAnswer('Ideas.\n::options\n1. **One**: a\n2) **Two**: b\n* **Three**: c\n**Four**: d\n::')
    expect(opts).toEqual({ kind: 'options', items: ['One', 'Two', 'Three', 'Four'].map((t, i) => ({ title: t, why: 'abcd'[i] })) })
  })

  it('joins nested items and carried-on lines to their item', () => {
    const [, opts] = parseAnswer('Ideas.\n::options\n- **Bell**: loud\n  - and early\n  carries over the water\n- **Fish**: cold\nstill cold\n\n- **Shout**: sharp\n::')
    expect(opts).toEqual({
      kind: 'options',
      items: [
        { title: 'Bell', why: 'loud; and early carries over the water' },
        { title: 'Fish', why: 'cold still cold' },
        { title: 'Shout', why: 'sharp' }
      ]
    })
    expect(listItems(['- a', '    1. b', '- c'])).toEqual(['a; b', 'c'])
  })

  it('takes markers loosely: case, spaces, a colon, a verdict in brackets, ::end', () => {
    const blocks = parseAnswer('Yes.\n:: Facts: (yes)\n- one\n::end\n::Options\n- **A**: x\n::/options')
    expect(blocks).toEqual([
      { kind: 'lead', text: 'Yes.', verdict: 'yes' },
      { kind: 'facts', verdict: 'yes', items: ['one'] },
      { kind: 'options', items: [{ title: 'A', why: 'x' }] }
    ])
  })

  it('takes aliases: ::ideas, ::why, ::sources, ::follow-ups', () => {
    const kinds = parseAnswer('Lead.\n::ideas\n- **A**: x\n::\n::why\nbecause\n::\n::sources\n- s\n::\n::follow-ups\n- f\n::').map((b) => b.kind)
    expect(kinds).toEqual(['lead', 'options', 'more', 'facts', 'next'])
  })

  it('keeps an unknown marker as text', () => {
    const blocks = parseAnswer('Lead.\n::table\n| a | b |\n::')
    expect(blocks).toEqual([
      { kind: 'lead', text: 'Lead.' },
      { kind: 'text', text: '::table\n| a | b |' }
    ])
  })

  it('a block left open runs to the end; a new marker closes the one before', () => {
    expect(parseAnswer('Lead.\n::options\n- **A**: x\n::next\n- go on')).toEqual([
      { kind: 'lead', text: 'Lead.' },
      { kind: 'options', items: [{ title: 'A', why: 'x' }] },
      { kind: 'next', items: ['go on'] }
    ])
  })

  it('drops a stray close and an empty block, but no words', () => {
    expect(parseAnswer('Lead.\n::\nMore words.\n::more\n::')).toEqual([
      { kind: 'lead', text: 'Lead.' },
      { kind: 'text', text: 'More words.' }
    ])
  })

  it('an answer that opens with a block has no lead', () => {
    expect(parseAnswer('::options\n- **A**: x\n::\nPick one.')).toEqual([
      { kind: 'options', items: [{ title: 'A', why: 'x' }] },
      { kind: 'text', text: 'Pick one.' }
    ])
  })

  it('keeps every word of the marked answers', () => {
    for (const t of [IDEAS, FACT]) keepsWords(t, parseAnswer(t))
  })

  it('writes blocks back in the same format', () => {
    expect(parseAnswer(answerText(parseAnswer(IDEAS)))).toEqual(parseAnswer(IDEAS))
    expect(parseAnswer(answerText(parseAnswer(FACT)))).toEqual(parseAnswer(FACT))
  })

  it('empty answers are no blocks', () => {
    expect(parseAnswer('')).toEqual([])
    expect(parseAnswer('   \n\n')).toEqual([])
    expect(parseAnswer('', { streaming: true })).toEqual([])
  })
})

describe('parseAnswer: streaming', () => {
  /** Every prefix of a text, cut at each character. */
  const prefixes = (t: string): string[] => Array.from({ length: t.length + 1 }, (_, i) => t.slice(0, i))

  /** Every string shown: texts, items, titles and whys. */
  const shown = (blocks: AnswerBlock[]): string[] =>
    blocks.flatMap((b) => ('text' in b ? [b.text] : b.kind === 'options' ? b.items.flatMap((o) => [o.title, o.why]) : b.items))

  it('never shows a marker line, at any prefix', () => {
    for (const t of [IDEAS, FACT]) {
      for (const p of prefixes(t)) {
        for (const s of shown(parseAnswer(p, { streaming: true }))) expect(s, JSON.stringify(p)).not.toMatch(/(^|\n)\s*:/)
      }
    }
  })

  it('a block never flickers back to text once its marker has arrived', () => {
    for (const t of [IDEAS, FACT]) {
      let seen = new Set<string>()
      for (const p of prefixes(t)) {
        const kinds = parseAnswer(p, { streaming: true }).map((b) => b.kind)
        for (const k of seen) expect(kinds, JSON.stringify(p)).toContain(k)
        seen = new Set(kinds)
      }
    }
  })

  it('an open ::options shows the items so far, the last one still arriving', () => {
    expect(parseAnswer('Ideas.\n::options\n- **Start on the bell**: the toll', { streaming: true })).toEqual([
      { kind: 'lead', text: 'Ideas.' },
      { kind: 'options', items: [{ title: 'Start on the bell', why: 'the toll' }] }
    ])
    expect(parseAnswer('Ideas.\n::options\n- **Start on', { streaming: true })[1]).toEqual({ kind: 'options', items: [{ title: 'Start on', why: '' }] })
  })

  it('an options block just opened is shown empty', () => {
    expect(parseAnswer('Ideas.\n::options\n', { streaming: true })).toEqual([
      { kind: 'lead', text: 'Ideas.' },
      { kind: 'options', items: [] }
    ])
    expect(parseAnswer('Ideas.\n::options', { streaming: true })[1]).toEqual({ kind: 'options', items: [] })
  })

  it('hides a marker still being typed', () => {
    for (const p of [':', '::', '::o', '::opt', '::facts y', '::facts ye']) {
      const blocks = parseAnswer(`Ideas.\n${p}`, { streaming: true })
      expect(blocks[0]).toEqual({ kind: 'lead', text: 'Ideas.' })
      expect(JSON.stringify(blocks)).not.toContain('::')
    }
  })

  it('an open ::facts, ::more and ::next show what has arrived', () => {
    expect(parseAnswer('Yes.\n::facts yes\n- [[Mara', { streaming: true })[1]).toEqual({ kind: 'facts', verdict: 'yes', items: ['[[Mara'] })
    expect(parseAnswer('Yes.\n::more\nThe census li', { streaming: true })[1]).toEqual({ kind: 'more', text: 'The census li' })
    expect(parseAnswer('Done.\n::next\n- Make it', { streaming: true })[1]).toEqual({ kind: 'next', items: ['Make it'] })
  })

  it('waits for the lead line to end before calling a verdict', () => {
    expect(parseAnswer('No', { streaming: true })).toEqual([{ kind: 'lead', text: 'No' }])
    expect(parseAnswer('No one', { streaming: true })).toEqual([{ kind: 'lead', text: 'No one' }])
    expect(parseAnswer('No.', { streaming: true })[0]).toEqual({ kind: 'lead', text: 'No.', verdict: 'no' })
    expect(parseAnswer('No\n', { streaming: true })[0]).toEqual({ kind: 'lead', text: 'No', verdict: 'no' })
  })

  it('without streaming, an unfinished marker at the end stays as text', () => {
    expect(parseAnswer('Ideas.\n::opt')).toEqual([
      { kind: 'lead', text: 'Ideas.' },
      { kind: 'text', text: '::opt' }
    ])
  })

  it('finished, the streamed answer reads the same as the whole one', () => {
    expect(parseAnswer(IDEAS, { streaming: true })).toEqual(parseAnswer(IDEAS))
    expect(parseAnswer(FACT + '\n', { streaming: true })).toEqual(parseAnswer(FACT))
  })
})

describe('parseAnswer: no markers (old chats, a model that ignores the format)', () => {
  it('the first line is the lead, the rest text', () => {
    expect(parseAnswer('From the memory: [[Mara Venn]] and [[Tobin]].\n\nOne idea that fits: they meet at dusk.')).toEqual([
      { kind: 'lead', text: 'From the memory: [[Mara Venn]] and [[Tobin]].' },
      { kind: 'text', text: 'One idea that fits: they meet at dusk.' }
    ])
  })

  it('a long first line gives its first sentence to the lead, never splitting a [[name]] or Dr.', () => {
    const long = `Yes, [[Dr. Venn]] is the harbour doctor. ${'She has kept the post for years and everyone on the quay knows her by sight. '.repeat(3)}`.trim()
    const [lead, rest] = parseAnswer(long)
    expect(lead).toEqual({ kind: 'lead', text: 'Yes, [[Dr. Venn]] is the harbour doctor.', verdict: 'yes' })
    expect(rest.kind).toBe('text')
    keepsWords(long, parseAnswer(long))
    expect(firstSentence('Mr. Hale came. Then left.')).toBe('Mr. Hale came.')
  })

  it('a list of ideas after an ideas question becomes options', () => {
    const old = 'Three that fit.\n\n1. Cut it back to the one strong image.\n2. End on the line of dialogue instead.\n3. Keep it, but move it earlier.'
    const blocks = parseAnswer(old, { ideas: true })
    expect(blocks.map((b) => b.kind)).toEqual(['lead', 'options'])
    expect((blocks[1] as Extract<AnswerBlock, { kind: 'options' }>).items[1]).toEqual({ title: 'End on the line of…', why: 'End on the line of dialogue instead.' })
    keepsWords(old, blocks)
  })

  it('a list of titled ideas becomes options without the flag; plain facts stay text', () => {
    const titledList = 'Here you go.\n- **The Salt Lamp**: by the quay\n- **The Oar**: old\n- **The Net**: for fishers'
    expect(parseAnswer(titledList).map((b) => b.kind)).toEqual(['lead', 'options'])
    const facts = 'She is 34.\n- Ch 2 gives her age\n- Ch 3 her brother’s\n- Ch 5 the census'
    expect(parseAnswer(facts).map((b) => b.kind)).toEqual(['lead', 'text'])
  })

  it('a list after words asking for ideas becomes options', () => {
    const blocks = parseAnswer('Here are some ideas for the tavern names:\n- The Salt Lamp\n- The Oar\n- The Net\n\nWant more?')
    expect(blocks).toEqual([
      { kind: 'lead', text: 'Here are some ideas for the tavern names:' },
      { kind: 'options', items: ['The Salt Lamp', 'The Oar', 'The Net'].map((title) => ({ title, why: '' })) },
      { kind: 'text', text: 'Want more?' }
    ])
  })

  it('a list of two stays text, even for ideas', () => {
    expect(parseAnswer('Two.\n- a: b\n- c: d', { ideas: true }).map((b) => b.kind)).toEqual(['lead', 'text'])
  })

  it('an answer that starts with a list or a heading has no lead', () => {
    expect(parseAnswer('- one\n- two')[0]).toEqual({ kind: 'text', text: '- one\n- two' })
    expect(parseAnswer('## Ideas\nSome.')[0].kind).toBe('text')
  })

  it('keeps every word of a messy answer', () => {
    const messy = 'Sure — a few thoughts.\r\n\r\n* **Bell**: loud\r\n   * nested\r\n* Fish — cold\r\n\r\nAnd one more:\r\n1. [[Bram]] shouts\r\n'
    keepsWords(messy, parseAnswer(messy, { ideas: true }))
  })
})

describe('markers and words outside blocks', () => {
  it('counts opens, closes and strays', () => {
    expect(answerMarkers(IDEAS)).toEqual({ opened: 2, closed: 2, stray: 0, balanced: true })
    expect(answerMarkers('a\n::options\n- x')).toMatchObject({ opened: 1, closed: 0, balanced: false })
    expect(answerMarkers('a\n::\n')).toMatchObject({ stray: 1, balanced: false })
    expect(hasBlockMarkers(IDEAS)).toBe(true)
    expect(hasBlockMarkers('Plain words: no blocks.')).toBe(false)
  })

  it('counts the words of the lead and text only', () => {
    expect(wordsOutsideBlocks(parseAnswer(IDEAS))).toBe(7)
  })
})
