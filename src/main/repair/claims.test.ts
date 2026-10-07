// Check and repair: the memory model's claims about new words, judged one at a time. A flag always quotes words that
// are really in the new words; a slip is mended only when the stage has the story's own words for what it breaks,
// the fix is a few of the AI's own words, and never Adam's; anything else is one question. Invented text throughout.
import { describe, expect, it } from 'vitest'
import type { LandedParagraph } from '@shared/contracts/repair'
import { allTheAis, judgeClaims, newWordsOf, questionOf, readClaims, type Claim } from './claims'
import { plain as plainOf } from '../keeper/text'
import { stageLines, stageLineText, type CodexLine } from './prompts'
import type { SceneState } from '@shared/continuity'

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
    'mara|wearing': { quote: 'pushed her hood back', sceneId: 's1' },
    'mara|posture': { quote: 'lay down on the bench', sceneId: 's1' },
    'tobin|where': { quote: 'Tobin left for the docks', sceneId: 's1' }
    // Tobin's lamp has no words kept (Adam set it himself).
  }
}

const AI = 'Mara stood by the fire with her hood low. Tobin swung his lamp as he came in.\n\nShe knew the ferry had sunk.'
const PARAS: LandedParagraph[] = AI.split('\n\n').map((text) => ({ text, from: 0, to: text.length }))
const stage = stageLines(STAGE)
const code = (who: string | null, field: string): string => stage.find((l) => l.who === who && l.field === field)!.code
const CODEX: CodexLine[] = [{ code: 'K1', kind: 'knows', label: 'The ferry sank.' }]

const claim = (c: Partial<Claim>): Claim => ({ quote: '', who: '', about: 'wearing', line: '', verdict: 'slip', why: 'It doesn’t match.', fix: null, question: '', ...c })
const judge = (claims: Claim[], paragraphs = PARAS, aiText = AI) => judgeClaims(claims, { stage, codex: CODEX, paragraphs, aiText })

describe('the stage as lines', () => {
  it('gives each value an id and the words that show it', () => {
    expect(stage.map(stageLineText)).toContain(`- [${code('Mara', 'wearing')}] Mara · wearing: hood off, wet cloak · words: "pushed her hood back"`)
    expect(stage.map(stageLineText)).toContain(`- [${code('Tobin', 'holding')}] Tobin · holding: a lamp · no words kept`)
    expect(stage[0]).toMatchObject({ code: 'W1', who: null, field: 'time', value: 'dusk', quote: 'the light was going' })
    expect(stageLines(null)).toEqual([])
  })
})

describe('reading the claims', () => {
  it('reads each claim, and a reply with none', () => {
    const got = readClaims(
      'Here: {"claims": [{"quote": "her hood low", "who": "Mara", "about": "Wearing", "line": "w2", "verdict": "SLIP", "why": "Off before.", "fix": {"replace": "hood low", "with": "hood down"}}, {"quote": "x", "about": "hats", "verdict": "maybe"}]}'
    )!
    expect(got[0]).toMatchObject({ about: 'wearing', line: 'W2', verdict: 'slip', fix: { replace: 'hood low', with: 'hood down' } })
    expect(got[1]).toMatchObject({ about: 'other', verdict: 'fits', fix: null })
    expect(readClaims('{"claims": []}')).toEqual([])
    expect(readClaims('no JSON here')).toBeNull()
  })
})

describe('judging claim by claim', () => {
  it('mends a small slip the stage shows with its own words', () => {
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

  it('counts claims that fit or show the change, and flags nothing for them', () => {
    const got = judge([
      claim({ quote: 'Tobin swung his lamp', who: 'Tobin', about: 'holding', line: code('Tobin', 'holding'), verdict: 'fits' }),
      claim({ quote: 'stood by the fire', who: 'Mara', about: 'posture', line: code('Mara', 'posture'), verdict: 'shown' })
    ])
    expect(got).toEqual({ fixes: [], questions: [], claims: 2, slips: 0 })
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

  it('asks rather than mends when the fix is too big, outside the quote, or not the AI’s own words', () => {
    const big = { replace: 'Mara stood by the fire with her hood low.', with: 'Mara lay on the bench by the fire, her hood back, and did not get up for a long while after that.' }
    const got = judge([
      claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: big }),
      claim({ quote: 'stood by the fire', line: code('Mara', 'posture'), fix: { replace: 'swung his lamp', with: 'held his lamp' } })
    ])
    expect(got.fixes).toEqual([])
    expect(got.questions).toHaveLength(2)
    // The words aren't in the record of what the AI wrote (Adam typed them into the draft as it came in).
    const notAi = judge([claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: { replace: 'hood low', with: 'hood down' } })], PARAS, 'Tobin swung his lamp.')
    expect(notAi.fixes).toEqual([])
    expect(notAi.questions).toHaveLength(1)
  })

  it("never mends Adam's words in a paragraph Continue carried on", () => {
    const adams = 'Mara lay down on the bench, her hood low over her eyes.'
    const ai = ' Tobin swung his lamp as he came in.'
    const paragraphs: LandedParagraph[] = [{ text: adams + ai, from: adams.length, to: adams.length + ai.length }]
    expect(newWordsOf(paragraphs)).toBe(ai)
    // The claim quotes Adam's words: not in the new words, so not even flagged.
    const got = judgeClaims([claim({ quote: 'her hood low over her eyes', line: code('Mara', 'wearing'), fix: { replace: 'hood low', with: 'hood down' } })], {
      stage,
      codex: CODEX,
      paragraphs,
      aiText: adams + ai
    })
    expect(got).toEqual({ fixes: [], questions: [], claims: 0, slips: 0 })
    const own = judgeClaims([claim({ quote: 'Tobin swung his lamp', line: code('Tobin', 'where'), fix: { replace: 'swung his lamp', with: 'swung the lamp' } })], {
      stage,
      codex: CODEX,
      paragraphs,
      aiText: ai
    })
    expect(own.fixes[0]).toMatchObject({ para: 0, start: adams.length + 1 + 'Tobin '.length, was: 'swung his lamp' })
  })

  it('makes one fix in a place, and asks once about the same words', () => {
    const one = claim({ quote: 'with her hood low', line: code('Mara', 'wearing'), fix: { replace: 'hood low', with: 'hood down' } })
    const got = judge([one, { ...one, fix: { replace: 'her hood low', with: 'her hood back' } }, { ...one, line: 'K1', fix: null }])
    expect(got.fixes).toHaveLength(1)
    expect(got.questions).toHaveLength(1)
  })

  it("changes whole words only, and only in a paragraph that is all the AI's own", () => {
    const text = 'Tobin lifted the cup up to the lamp.'
    const paragraphs: LandedParagraph[] = [{ text, from: 0, to: text.length }]
    const up = claim({ quote: 'lifted the cup up', line: code('Tobin', 'where'), fix: { replace: 'up', with: 'down' } })
    // "up" first appears inside "cup": never changed there, only as a word of its own.
    const got = judgeClaims([up], { stage, codex: CODEX, paragraphs, aiText: text })
    expect(got.fixes[0]).toMatchObject({ start: text.indexOf(' up ') + 1, was: 'up' })
    // A paragraph Adam typed in as it streamed, or whose words aren't all in the record, is asked about, never mended.
    expect(allTheAis({ ...paragraphs[0], edited: true }, plainOf(text))).toBe(false)
    expect(judgeClaims([up], { stage, codex: CODEX, paragraphs: [{ ...paragraphs[0], edited: true }], aiText: text }).fixes).toEqual([])
    const mixed = `Her hood was up. ${text}`
    const his = judgeClaims([up], { stage, codex: CODEX, paragraphs: [{ text: mixed, from: 0, to: mixed.length }], aiText: text })
    expect(his.fixes).toEqual([])
    expect(his.questions).toHaveLength(1)
  })

  it('makes a question of a reason when the model gave none', () => {
    expect(questionOf({ question: '', why: 'Mara is lying down' })).toBe('Mara is lying down. Change it, or keep it as it is?')
    expect(questionOf({ question: 'Should she stand first?', why: '' })).toBe('Should she stand first?')
  })
})
