// Check and repair: the memory model's claims about new words, judged one at a time. A flag always quotes words that
// are really in the new words; a slip is mended without asking only when it plainly can't be true at that moment (the
// stage's own words for it just before, nothing that could have happened between, about what someone wears or holds
// or an injury, a few of the AI's own words, never Adam's); anything else is one question, or nothing when it isn't a
// contradiction at all. The cases from the trap story's real runs are kept here, with invented wording around them.
import { describe, expect, it } from 'vitest'
import type { LandedParagraph } from '@shared/contracts/repair'
import { allTheAis, judgeClaims, newWordsOf, questionOf, readClaims, sameMoment, sameThing, SAME_MOMENT_CHARS, type Claim } from './claims'
import { plain as plainOf } from '../keeper/text'
import { stageLines, stageLineText, type CodexLine, type StageLine } from './prompts'
import { pieceKey, thingKey, type SceneState } from '@shared/continuity'

const STAGE: SceneState = {
  time: 'dusk',
  weather: '',
  light: '',
  characters: [
    { name: 'Mara', where: 'the inn', wearing: 'hood off, wet cloak', posture: 'lying on the bench', holding: '', condition: '', mood: '', lastAction: '' },
    { name: 'Tobin', where: 'gone to the docks', wearing: '', posture: '', holding: 'a lamp', condition: '', mood: '', lastAction: '' }
  ],
  said: {
    '|time': { quote: 'the light was going', sceneId: 's1' },
    // Her hood's own words (the old line's pieces share none of them).
    [pieceKey('Mara', 'hood')]: { quote: 'pushed her hood back', sceneId: 's1' },
    'mara|posture': { quote: 'lay down on the bench', sceneId: 's1' },
    'tobin|where': { quote: 'Tobin left for the docks', sceneId: 's1' }
    // Tobin's lamp has no words kept (Adam set it himself).
  }
}

/** The words just before the new ones: where the stage's values were last said. */
const LEAD = 'Mara pushed her hood back and lay down on the bench. Tobin left for the docks.'
const AI = 'Mara stood by the fire with her hood low. Tobin swung his lamp as he came in.\n\nShe knew the ferry had sunk.'
const PARAS: LandedParagraph[] = AI.split('\n\n').map((text) => ({ text, from: 0, to: text.length }))
const stage = stageLines(STAGE)
const code = (who: string | null, field: string): string => stage.find((l) => l.who === who && l.field === field)!.code
const CODEX: CodexLine[] = [{ code: 'K1', kind: 'knows', label: 'The ferry sank.' }]

/** A claim as a model sure of a plain contradiction gives it (the worst case for being too eager). */
const claim = (c: Partial<Claim>): Claim => ({
  quote: '',
  who: '',
  about: 'wearing',
  line: '',
  verdict: 'slip',
  bothTrue: 'no',
  between: 'nothing',
  why: 'It doesn’t match.',
  fix: null,
  question: '',
  ...c
})
const judge = (claims: Claim[], paragraphs = PARAS, aiText = AI) => judgeClaims(claims, { stage, codex: CODEX, paragraphs, aiText, leadIn: LEAD })

describe('the stage as lines', () => {
  it('gives each value an id and the words that show it', () => {
    // Each piece of clothing its own line (step 2b; here read from a state kept before it, in one line).
    const worn = stage.filter((l) => l.who === 'Mara' && l.field === 'wearing').map(stageLineText)
    expect(worn).toEqual([
      `- [${code('Mara', 'wearing')}] Mara · wearing: hood off · words: "pushed her hood back"`,
      `- [W4] Mara · wearing: wet cloak · no words kept`
    ])
    expect(stage.map(stageLineText)).toContain(`- [${code('Tobin', 'holding')}] Tobin · holding: a lamp · no words kept`)
    expect(stage[0]).toMatchObject({ code: 'W1', who: null, field: 'time', value: 'dusk', quote: 'the light was going' })
    expect(stageLines(null)).toEqual([])
  })
})

describe('reading the claims', () => {
  it('reads each claim, and a reply with none', () => {
    const got = readClaims(
      'Here: {"claims": [{"quote": "her hood low", "who": "Mara", "about": "Wearing", "line": "w2", "verdict": "SLIP", "bothTrue": "No", "between": "nothing", "why": "Off before.", "fix": {"replace": "hood low", "with": "hood down"}}, {"quote": "x", "about": "hats", "verdict": "maybe"}]}'
    )!
    expect(got[0]).toMatchObject({ about: 'wearing', line: 'W2', verdict: 'slip', bothTrue: 'no', between: 'nothing', fix: { replace: 'hood low', with: 'hood down' } })
    // Left out, the model isn't sure: never a fix made without asking.
    expect(got[1]).toMatchObject({ about: 'other', verdict: 'fits', bothTrue: 'maybe', between: 'unclear', fix: null })
    expect(readClaims('{"claims": []}')).toEqual([])
    expect(readClaims('no JSON here')).toBeNull()
  })
})

describe('judging claim by claim', () => {
  it('mends a small slip the stage shows with its own words, just before', () => {
    const got = judge([
      claim({ quote: 'with her hood low', who: 'Mara', line: code('Mara', 'wearing'), why: 'Mara pushed her hood back earlier.', fix: { replace: 'hood low', with: 'hood down' } })
    ])
    expect(got.questions).toEqual([])
    expect(got.fixes).toHaveLength(1)
    const f = got.fixes[0]
    expect(PARAS[f.para].text.slice(f.start, f.end)).toBe('hood low')
    expect(f.now).toBe('hood down')
    expect(got).toMatchObject({ claims: 1, slips: 1 })
  })

  it('drops a claim whose words are not in the new words, or whose line does not exist', () => {
    const got = judge([
      claim({ quote: 'Mara pulled her boots on', line: code('Mara', 'wearing') }),
      claim({ quote: 'stood by the fire', line: 'W99' }),
      claim({ quote: 'stood by the fire', line: 'E7' })
    ])
    expect(got).toEqual({ fixes: [], questions: [], claims: 0, slips: 0 })
  })

  it('counts claims that fit or show the change, or could both be true, and flags nothing for them', () => {
    const got = judge([
      claim({ quote: 'Tobin swung his lamp', who: 'Tobin', about: 'holding', line: code('Tobin', 'holding'), verdict: 'fits' }),
      claim({ quote: 'stood by the fire', who: 'Mara', about: 'posture', line: code('Mara', 'posture'), verdict: 'shown' }),
      claim({ quote: 'with her hood low', who: 'Mara', line: code('Mara', 'wearing'), bothTrue: 'yes', fix: { replace: 'hood low', with: 'hood down' } })
    ])
    expect(got).toEqual({ fixes: [], questions: [], claims: 3, slips: 0 })
  })

  it('asks a question for a slip that needs a choice, quoting the new words exactly', () => {
    const got = judge([
      claim({
        quote: 'tobin swung his LAMP as he came in',
        who: 'Tobin',
        about: 'where',
        line: code('Tobin', 'where'),
        question: 'Tobin left for the docks. Should he come back first, or is it someone else'
      })
    ])
    expect(got.fixes).toEqual([])
    expect(got.questions[0]).toMatchObject({ quote: 'Tobin swung his lamp as he came in', message: 'Tobin left for the docks. Should he come back first, or is it someone else?', fix: null })
  })

  it('never mends what the stage has no words for, nor a slip against the memory: those are asked', () => {
    const got = judge([
      claim({ quote: 'Tobin swung his lamp', who: 'Tobin', about: 'holding', line: code('Tobin', 'holding'), fix: { replace: 'swung his lamp', with: 'swung his arms' } }),
      claim({ quote: 'She knew the ferry had sunk', who: 'Mara', about: 'knows', line: 'K1', why: 'Mara wasn’t told.', fix: { replace: 'knew', with: 'feared' } })
    ])
    expect(got.fixes).toEqual([])
    expect(got.questions.map((q) => q.fix)).toEqual(['Tobin swung his arms', 'She feared the ferry had sunk'])
    expect(got.questions[1].message).toBe('Mara wasn’t told. Change it, or keep it as it is?')
  })

  it('asks rather than mends when the fix is too big, outside the quote, about a posture, unsure, or not the AI’s own words', () => {
    const big = { replace: 'Mara stood by the fire with her hood low.', with: 'Mara lay on the bench by the fire, her hood back, and did not get up for a long while after that.' }
    const hood = { replace: 'hood low', with: 'hood down' }
    const got = judge([
      claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: big }),
      claim({ quote: 'stood by the fire', line: code('Mara', 'posture'), fix: { replace: 'stood by', with: 'lay by' } }),
      claim({ quote: 'Tobin swung his lamp', line: code('Mara', 'wearing'), fix: { replace: 'swung his lamp', with: 'held his lamp' } })
    ])
    expect(got.fixes).toEqual([])
    expect(got.questions).toHaveLength(3)
    // The model not sure nothing happened between, or not sure it's a contradiction: asked.
    for (const unsure of [{ between: 'time' as const }, { between: 'unclear' as const }, { bothTrue: 'maybe' as const }]) {
      const asked = judge([claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: hood, ...unsure })])
      expect(asked.fixes).toEqual([])
      expect(asked.questions).toHaveLength(1)
    }
    // The words aren't in the record of what the AI wrote (Adam typed them into the draft as it came in).
    const notAi = judge([claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: hood })], PARAS, 'Tobin swung his lamp.')
    expect(notAi.fixes).toEqual([])
    expect(notAi.questions).toHaveLength(1)
  })

  it("never mends Adam's words in a paragraph Continue carried on", () => {
    const adams = 'Mara lay down on the bench, her hood low over her eyes.'
    const ai = ' Mara pulled her hood low again.'
    const paragraphs: LandedParagraph[] = [{ text: adams + ai, from: adams.length, to: adams.length + ai.length }]
    const leadIn = `Mara pushed her hood back. ${adams}`
    expect(newWordsOf(paragraphs)).toBe(ai)
    // The claim quotes Adam's words: not in the new words, so not even flagged.
    const hood = { replace: 'hood low', with: 'hood back' }
    const got = judgeClaims([claim({ quote: 'her hood low over her eyes', line: code('Mara', 'wearing'), fix: hood })], { stage, codex: CODEX, paragraphs, aiText: adams + ai, leadIn })
    expect(got).toEqual({ fixes: [], questions: [], claims: 0, slips: 0 })
    const own = judgeClaims([claim({ quote: 'Mara pulled her hood low', line: code('Mara', 'wearing'), fix: hood })], { stage, codex: CODEX, paragraphs, aiText: ai, leadIn })
    expect(own.fixes[0]).toMatchObject({ para: 0, start: adams.length + ' Mara pulled her '.length, was: 'hood low' })
  })

  it('makes one fix in a place, and asks once about the same words', () => {
    const one = claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: { replace: 'hood low', with: 'hood down' } })
    const got = judge([one, { ...one, fix: { replace: 'her hood low', with: 'her hood back' } }, { ...one, line: 'K1', fix: null }])
    expect(got.fixes).toHaveLength(1)
    expect(got.questions).toHaveLength(1)
  })

  it("changes whole words only, and only in a paragraph that is all the AI's own", () => {
    const cup: StageLine = { code: 'W9', who: 'Tobin', field: 'holding', value: 'nothing; the cup on the table', quote: 'Tobin set the cup on the table' }
    const leadIn = 'Tobin set the cup on the table.'
    const text = 'Tobin lifted the cup up to the lamp.'
    const paragraphs: LandedParagraph[] = [{ text, from: 0, to: text.length }]
    const up = claim({ quote: 'lifted the cup up', about: 'holding', line: 'W9', fix: { replace: 'up', with: 'down' } })
    const with_ = (p: LandedParagraph[], aiText = text) => judgeClaims([up], { stage: [cup], codex: [], paragraphs: p, aiText, leadIn })
    // "up" first appears inside "cup": never changed there, only as a word of its own.
    expect(with_(paragraphs).fixes[0]).toMatchObject({ start: text.indexOf(' up ') + 1, was: 'up' })
    // A paragraph Adam typed in as it streamed, or whose words aren't all in the record, is asked about, never mended.
    expect(allTheAis({ ...paragraphs[0], edited: true }, plainOf(text))).toBe(false)
    expect(with_([{ ...paragraphs[0], edited: true }]).fixes).toEqual([])
    const mixed = `Her hood was up. ${text}`
    const his = with_([{ text: mixed, from: 0, to: mixed.length }])
    expect(his.fixes).toEqual([])
    expect(his.questions).toHaveLength(1)
  })

  it('makes a question of a reason when the model gave none', () => {
    expect(questionOf({ question: '', why: 'Mara is lying down' })).toBe('Mara is lying down. Change it, or keep it as it is?')
    expect(questionOf({ question: 'Should she stand first?', why: '' })).toBe('Should she stand first?')
  })
})

describe('fixing only what plainly can’t be true (the trap story’s real runs, 2026-10-07)', () => {
  /** One claim against one stage line, with the words just before and the new words: what is made of it. */
  function judgeOne(o: {
    line: Omit<StageLine, 'code'>
    leadIn: string
    text: string
    quote: string
    was: string
    now: string
    c?: Partial<Claim>
  }) {
    const line: StageLine = { code: 'W1', ...o.line }
    const paragraphs: LandedParagraph[] = [{ text: o.text, from: 0, to: o.text.length }]
    return judgeClaims([claim({ quote: o.quote, line: 'W1', who: o.line.who ?? '', fix: { replace: o.was, with: o.now }, ...o.c })], {
      stage: [line],
      codex: [],
      paragraphs,
      aiText: o.text,
      leadIn: o.leadIn
    })
  }
  const fixed = (j: ReturnType<typeof judgeOne>) => j.fixes.map((f) => [f.was, f.now])
  const asked = (j: ReturnType<typeof judgeOne>) => [j.fixes.length, j.questions.length]

  it('still mends a plain contradiction at the same moment: a pipe between her teeth, a hat just put back on', () => {
    expect(
      fixed(
        judgeOne({
          line: { who: 'Bryn', field: 'holding', value: 'her pipe, unlit, between her teeth', quote: 'set her unlit pipe between her teeth' },
          leadIn: 'Bryn set her unlit pipe between her teeth and looked up at the sky.',
          text: 'She stood at the gate with her pipe in her hand, waiting for the cart.',
          quote: 'her pipe in her hand',
          was: 'her pipe in her hand',
          now: 'her pipe between her teeth'
        })
      )
    ).toEqual([['her pipe in her hand', 'her pipe between her teeth']])
    expect(
      fixed(
        judgeOne({
          line: { who: 'Ash', field: 'wearing', value: 'hat on', quote: 'Ash put his hat back on' },
          leadIn: 'Ash put his hat back on.',
          text: 'He stood with his hat in his hands and said nothing.',
          quote: 'with his hat in his hands',
          was: 'with his hat in his hands',
          now: 'with his hat on his head'
        })
      )
    ).toEqual([['with his hat in his hands', 'with his hat on his head']])
  })

  it('asks about a hat put on at the ford and held in a hand later: across a scene break, or long after', () => {
    const hat = {
      line: { who: 'Gale', field: 'wearing', value: 'hat on', quote: 'Gale put his hat on at the ford' },
      text: 'He came up the stair with his hat in his hand.',
      quote: 'with his hat in his hand',
      was: 'with his hat in his hand',
      now: 'with his hat on his head'
    }
    expect(asked(judgeOne({ ...hat, leadIn: 'Gale put his hat on at the ford.\n\n* * *\n\nThe inn was warm.' }))).toEqual([0, 1])
    expect(asked(judgeOne({ ...hat, leadIn: `Gale put his hat on at the ford. ${'They rode on through the rain. '.repeat(25)}` }))).toEqual([0, 1])
  })

  it('never mends where someone is or how they are placed: a hand on the floor, a man home by his fire, someone gone for the night, a cart, a horse left at a farm', () => {
    const cases = [
      {
        line: { who: 'Ash', field: 'posture', value: 'asleep, sitting with his back to the wall', quote: 'Ash slept sitting with his back to the wall' },
        leadIn: 'Ash slept sitting with his back to the wall.',
        text: 'His hand lay open on the floor beside him.',
        quote: 'His hand lay open on the floor',
        was: 'lay open on the floor',
        now: 'lay open on his knee'
      },
      {
        line: { who: 'Oskar', field: 'where', value: 'on the river, taking his ferry back across', quote: 'Oskar took his ferry back across the river' },
        leadIn: 'Oskar took his ferry back across the river with his daughter.',
        text: 'Oskar was sitting by his own fire with his boots off.',
        quote: 'Oskar was sitting by his own fire with his boots off',
        was: 'was sitting by his own fire with his boots off',
        now: 'had taken the ferry back across the water'
      },
      {
        line: { who: 'Bryn', field: 'where', value: 'gone to the farrier, not back before morning', quote: 'Bryn went down to the farrier' },
        leadIn: 'Bryn went down to the farrier with both horses and would not be back before morning.',
        text: 'Bryn saw them off from the yard.',
        quote: 'Bryn saw them off from the yard',
        was: 'saw them off from the yard',
        now: 'had left word at the yard'
      },
      {
        line: { who: 'Bryn', field: 'where', value: 'driving south out of the square', quote: 'Bryn drove her cart off south' },
        leadIn: 'Bryn drove her cart off south and did not look back.',
        text: "At the fork there was Bryn's cart standing in the mouth of it.",
        quote: "there was Bryn's cart standing in the mouth of it",
        was: "Bryn's cart",
        now: 'a cart'
      },
      {
        line: { who: 'Thistle', field: 'where', value: 'left at the farm, lame', quote: 'left Thistle at the farm' },
        leadIn: 'They left Thistle at the farm with a poultice on her.',
        text: 'She knew the way Thistle stamped when she wanted the gate.',
        quote: 'the way Thistle stamped when she wanted the gate',
        was: 'Thistle stamped when she wanted',
        now: 'a horse stamps when it wants'
      }
    ]
    for (const c of cases) expect(asked(judgeOne(c))).toEqual([0, 1])
    // Not a contradiction at all (a sleeping man's hand can lie on the floor): when the model says so, nothing is said.
    expect(asked(judgeOne({ ...cases[0], c: { bothTrue: 'yes' } }))).toEqual([0, 0])
  })

  it('never rewrites what happens to something held: a case across her knees, both hands free, a knife put down', () => {
    const rein = { who: 'Wren', field: 'holding', value: 'her left arm through the rein', quote: 'Wren put her left arm through the rein' }
    const lead = 'Wren put her left arm through the rein.'
    expect(
      asked(
        judgeOne({
          line: rein,
          leadIn: lead,
          text: "They rode on, the case lying across Wren's knees.",
          quote: "the case lying across Wren's knees",
          was: "the case lying across Wren's knees",
          now: 'the rein through her left arm'
        })
      )
    ).toEqual([0, 1])
    expect(
      asked(
        judgeOne({
          line: rein,
          leadIn: lead,
          text: 'She was riding with both hands and nothing to hold.',
          quote: 'riding with both hands and nothing to hold',
          was: 'riding with both hands and nothing to hold',
          now: 'riding with her left arm through the rein and the case gone'
        })
      )
    ).toEqual([0, 1])
    expect(
      asked(
        judgeOne({
          line: { who: 'Ash', field: 'holding', value: 'his knife, his hand on it as he slept', quote: 'Ash went to sleep with his hand on his knife' },
          leadIn: 'Ash went to sleep with his hand on his knife.',
          text: 'In the morning the knife was on the bench where Ash had left it.',
          quote: 'the knife was on the bench where Ash had left it',
          was: 'was on the bench where Ash had left it',
          now: "was still in Ash's hand where he slept",
          c: { between: 'action' }
        })
      )
    ).toEqual([0, 1])
  })

  it('tells the same moment and the same thing', () => {
    expect(sameMoment('took off her hood', 'Mara took off her hood.', 'Mara kept her hood low.', 0)).toBe(true)
    expect(sameMoment('took off her hood', 'Mara took off her hood.\n\n* * *', 'Mara kept her hood low.', 0)).toBe(false)
    expect(sameMoment('took off her hood', 'Mara took off her hood.', `${'x'.repeat(SAME_MOMENT_CHARS)} Mara kept her hood low.`, SAME_MOMENT_CHARS + 1)).toBe(false)
    expect(sameMoment(null, 'Mara took off her hood.', 'Mara kept her hood low.', 0)).toBe(false)
    expect(sameThing('her pipe in her hand', { value: 'her pipe between her teeth', quote: null })).toBe(true)
    expect(sameThing('with his hat in his hands', { value: 'hat on', quote: 'put his hat back on' })).toBe(true)
    expect(sameThing("the case lying across Wren's knees", { value: 'her left arm through the rein', quote: 'put her left arm through the rein' })).toBe(false)
  })
})

describe('piece by piece (step 2b)', () => {
  // Adam, 2026-10-07: a door barred and then opened from outside with nothing keeping track of it, and a case put on a
  // windowsill back in someone's hand.
  const STAGE2: SceneState = {
    time: '',
    weather: '',
    light: '',
    things: [
      { name: 'the door', state: 'shut and barred from inside' },
      { name: 'the survey case', state: 'on the windowsill' }
    ],
    characters: [
      {
        name: 'Wren',
        where: 'the parlour',
        posture: '',
        touching: "her hand on Ash's arm",
        sees: '',
        holding: 'nothing',
        condition: '',
        mood: '',
        lastAction: '',
        clothes: [
          { name: 'grey coat', state: 'on' },
          { name: 'boots', state: 'off, by the hearth' }
        ]
      }
    ],
    said: {
      [thingKey('the door')]: { quote: 'Ash dropped the bar across the door', sceneId: 's1' },
      [thingKey('the survey case')]: { quote: 'set the survey case on the windowsill', sceneId: 's1' },
      [pieceKey('Wren', 'boots')]: { quote: 'kicked off her boots by the hearth', sceneId: 's1' },
      'wren|touching': { quote: "laid her hand on Ash's arm", sceneId: 's1' }
    }
  }
  const lines2 = stageLines(STAGE2)
  const at = (field: string, value: string): string => lines2.find((l) => l.field === field && l.value.startsWith(value))!.code
  const LEAD2 =
    "Ash dropped the bar across the door. Wren laid her hand on Ash's arm, kicked off her boots by the hearth and set the survey case on the windowsill."
  const AI2 = 'Wren gripped the survey case in both hands. Someone hammered on the door from outside, and it swung open.'
  const PARAS2: LandedParagraph[] = [{ text: AI2, from: 0, to: AI2.length }]
  const judge2 = (claims: Claim[], leadIn = LEAD2) =>
    judgeClaims(claims, { stage: lines2, codex: [], paragraphs: PARAS2, aiText: AI2, leadIn })

  it('gives each piece of clothing, each thing in the place, and who touches whom a line of its own with its words', () => {
    const text = lines2.map(stageLineText)
    expect(text).toContain(
      `- [${at('wearing', 'boots')}] Wren · wearing: boots off, by the hearth · words: "kicked off her boots by the hearth"`
    )
    expect(text).toContain(`- [${at('wearing', 'grey coat')}] Wren · wearing: grey coat on · no words kept`)
    expect(text).toContain(
      `- [${at('thing', 'the door')}] thing in the place: the door: shut and barred from inside · words: "Ash dropped the bar across the door"`
    )
    expect(text).toContain(`- [${at('touching', 'her hand')}] Wren · touching: her hand on Ash's arm · words: "laid her hand on Ash's arm"`)
    expect(lines2.find((l) => l.field === 'thing')).toMatchObject({ who: null })
    expect(
      readClaims('{"claims": [{"quote": "q", "about": "thing", "line": "W6"}, {"quote": "q", "about": "sees"}]}')!.map((c) => c.about)
    ).toEqual(['thing', 'sees'])
  })

  it('mends a thing in the place only when it plainly can’t be so at that moment; a door opened from outside is a question', () => {
    const got = judge2([
      claim({
        quote: 'Wren gripped the survey case in both hands',
        who: 'Wren',
        about: 'thing',
        line: at('thing', 'the survey case'),
        why: 'Wren had just set the survey case on the windowsill.',
        fix: { replace: 'gripped the survey case', with: 'eyed the survey case' }
      }),
      // Someone outside could have lifted the bar: something could have happened in between.
      claim({
        quote: 'it swung open',
        about: 'thing',
        line: at('thing', 'the door'),
        between: 'action',
        why: 'The door was barred from inside.',
        question: 'The door was barred from inside. Should someone unbar it first, or was it never barred?',
        fix: { replace: 'it swung open', with: 'the bar held' }
      })
    ])
    expect(got.fixes.map((f) => [f.was, f.now])).toEqual([['gripped the survey case', 'eyed the survey case']])
    expect(got.questions.map((q) => q.message)).toEqual([
      'The door was barred from inside. Should someone unbar it first, or was it never barred?'
    ])
    // The same slip after a scene break: time has passed, so it is asked, never mended.
    const later = judge2(
      [
        claim({
          quote: 'Wren gripped the survey case in both hands',
          about: 'thing',
          line: at('thing', 'the survey case'),
          fix: { replace: 'gripped the survey case', with: 'eyed the survey case' }
        })
      ],
      `${LEAD2}\n\n* * *\n\nMorning came.`
    )
    expect(later.fixes).toEqual([])
    expect(later.questions).toHaveLength(1)
  })

  it('never mends who touches whom: hands move', () => {
    const got = judge2([
      claim({
        quote: 'Wren gripped the survey case in both hands',
        who: 'Wren',
        about: 'touching',
        line: at('touching', 'her hand'),
        fix: { replace: 'in both hands', with: 'in one hand' }
      })
    ])
    expect(got.fixes).toEqual([])
    expect(got.questions).toHaveLength(1)
  })

describe('words shared by an old one-line outfit (review, 2026-10-07)', () => {
  it('never mend a piece without asking: they show the line, not that piece', () => {
    const old: SceneState = {
      time: '',
      weather: '',
      light: '',
      characters: [{ name: 'Mara', where: '', wearing: 'dark trousers, grey cloak off', posture: '', holding: '', condition: '', mood: '', lastAction: '' }],
      said: { 'mara|wearing': { quote: 'took her grey cloak off', sceneId: 's1' } }
    }
    const lines = stageLines(old)
    const trousers = lines.find((l) => l.value === 'dark trousers')!
    expect(trousers).toMatchObject({ quote: 'took her grey cloak off', shared: true })
    const words = 'Mara hitched up her dark trousers.'
    const got = judgeClaims(
      [claim({ quote: 'hitched up her dark trousers', who: 'Mara', line: trousers.code, fix: { replace: 'hitched up', with: 'smoothed' } })],
      { stage: lines, codex: [], paragraphs: [{ text: words, from: 0, to: words.length }], aiText: words, leadIn: 'Mara took her grey cloak off.' }
    )
    expect(got.fixes).toEqual([])
    expect(got.questions).toHaveLength(1)
  })
})
})
