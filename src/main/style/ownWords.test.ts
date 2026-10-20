import { describe, expect, it } from 'vitest'
import { OWN_SAMPLE } from '@shared/ownSample'
import { echoOf, pickOwnSample, readParagraphs, sampleFrom, splitParagraphs, wordsOf, type OwnScene } from './ownWords'

// Invented prose only. The AI's draft for a scene, and Adam's own paragraphs, in two quite different voices.
const AI_1 =
  'The tavern was warm and loud, filled with the low hum of conversation and the clink of tankards against wooden tables.'
const AI_2 =
  'Mara felt a shiver run down her spine as she scanned the crowded room, her heart pounding in her chest like a drum.'
const AI_3 = '"We need to talk," Tobin said, his voice barely above a whisper as he leaned closer across the table.'
const AI_DRAFT = [AI_1, AI_2, AI_3].join('\n\n')

const ADAM_1 =
  'Rain came sideways off the estuary. Bryn had the shutters half down before the second squall and swore at the latch, which stuck, as it always stuck, because nobody had oiled it since the flood year.'
const ADAM_2 = '"Get the lamp, girl," Bryn said. "No, the other one. The one that works."'
const ADAM_3 =
  'Wren fetched it. The glass was cracked down one side and somebody had mended it with fish glue, so the light came out yellow and smelled faintly of the harbour.'

describe('telling Adam’s own paragraphs from the AI’s', () => {
  it('a paragraph the AI wrote and nobody changed is the AI’s; one Adam wrote is his', () => {
    const scene = [AI_1, ADAM_1, AI_3, ADAM_2].join('\n\n')
    const read = readParagraphs(scene, [AI_DRAFT])
    expect(read.map((p) => p.own)).toEqual([false, true, false, true])
    expect(read[0].aiShare).toBe(1)
    expect(read[1].aiShare).toBe(0)
    // Where each starts in the scene's text, and which have dialogue.
    expect(scene.slice(read[1].start, read[1].start + 20)).toBe(ADAM_1.slice(0, 20))
    expect(read.map((p) => p.dialogue)).toEqual([false, false, true, true])
  })

  it('a lightly edited AI paragraph stays the AI’s; one Adam rewrote is his', () => {
    const light = AI_2.replace('crowded room', 'busy room').replace('like a drum', 'hard')
    const rewritten =
      'Mara looked the room over once, slowly, the way her mother taught her to count a market: exits, knives, who was too sober for the hour.'
    const read = readParagraphs([light, rewritten].join('\n\n'), [AI_DRAFT])
    expect(read[0].own).toBe(false)
    expect(read[0].aiShare).toBeGreaterThan(0.5)
    expect(read[1].own).toBe(true)
  })

  it('never counts a paragraph with one of the AI’s sentences left as it was, however much else is his', () => {
    const mixed = `${ADAM_1} ${AI_2} Then the door banged and the whole room looked round at once, every one of them.`
    const read = readParagraphs(mixed, [AI_DRAFT])
    expect(read[0].aiShare).toBeLessThan(0.5)
    expect(read[0].own).toBe(false)
  })

  it('a very short paragraph is the AI’s only when its words stand together in the AI’s text', () => {
    const read = readParagraphs(['"We need to talk."', '"Shut it."'].join('\n\n'), [AI_DRAFT])
    expect(read.map((p) => p.own)).toEqual([false, true])
  })

  it('a scene with no AI records is all his, and a scene break is never part of anything', () => {
    const read = readParagraphs([ADAM_1, '* * *', ADAM_3].join('\n\n'), [])
    expect(read.map((p) => [p.own, p.isBreak])).toEqual([
      [true, false],
      [false, true],
      [true, false]
    ])
  })

  it('the AI’s *italics* marks and curly apostrophes make no difference', () => {
    const ai = 'She didn’t *want* to go back to the old mill, not tonight, not with the river this high.'
    const page = "She didn't want to go back to the old mill, not tonight, not with the river this high."
    expect(readParagraphs(page, [ai])[0].own).toBe(false)
    expect(wordsOf('Didn’t *want*')).toEqual(["didn't", 'want'])
  })

  it('splits a scene at blank lines, keeping where each paragraph starts', () => {
    const text = 'One.\n\nTwo.\n  \nThree.'
    expect(splitParagraphs(text).map((p) => [p.text, text.slice(p.start, p.start + p.text.length)])).toEqual([
      ['One.', 'One.'],
      ['Two.', 'Two.'],
      ['Three.', 'Three.']
    ])
  })
})

// ---------- Picking the sample ----------

/** A paragraph of narration of about `n` words, different for each `seed`. */
const narration = (seed: string, n: number): string =>
  Array.from({ length: Math.ceil(n / 8) }, (_, i) => `The ${seed} lantern ${i} swung low over wet stones by the quay.`).join(' ')
const line = (seed: string): string => `"Bring the ${seed} nets in before dark," Bryn said, and spat over the rail.`

function scene(id: string, paras: { text: string; own: boolean }[]): OwnScene {
  return {
    sceneId: id,
    where: `Ch 1, Sc ${id.slice(-1)}`,
    paragraphs: paras.map((p, i) => ({
      text: p.text,
      start: i * 1000,
      words: wordsOf(p.text).length,
      aiShare: p.own ? 0 : 1,
      own: p.own,
      dialogue: p.text.includes('"'),
      isBreak: false
    }))
  }
}

describe('picking Adam’s own writing for the sample', () => {
  it('takes 300 to 500 words from several scenes, nearest first, never the AI’s', () => {
    const scenes = [
      scene('s3', [
        { text: narration('ai', 60), own: false },
        { text: narration('red', 80), own: true },
        { text: line('red'), own: true }
      ]),
      scene('s2', [
        { text: narration('blue', 90), own: true },
        { text: line('blue'), own: true },
        { text: narration('ai2', 70), own: false }
      ]),
      scene('s1', [
        { text: narration('green', 120), own: true },
        { text: line('green'), own: true },
        { text: narration('grey', 120), own: true }
      ])
    ]
    const sample = pickOwnSample(scenes)!
    expect(sample.words).toBeGreaterThanOrEqual(300)
    expect(sample.words).toBeLessThanOrEqual(OWN_SAMPLE.max)
    // One stretch from each scene first, nearest first.
    expect(sample.passages.slice(0, 3).map((p) => p.sceneId)).toEqual(['s3', 's2', 's1'])
    expect(sampleFrom(sample)).toEqual(['Ch 1, Sc 3', 'Ch 1, Sc 2', 'Ch 1, Sc 1'])
    const all = sample.passages.map((p) => p.text).join('\n')
    expect(all).not.toContain('ai lantern')
    expect(all).not.toContain('ai2 lantern')
    // Narration and dialogue both.
    expect(sample.passages.some((p) => p.dialogue)).toBe(true)
    expect(sample.passages.some((p) => p.narration)).toBe(true)
    for (const p of sample.passages) expect(p.words).toBeLessThanOrEqual(OWN_SAMPLE.perPassage)
    // The same scenes give the same sample (a provider can keep reusing the prompt).
    expect(pickOwnSample(scenes)).toEqual(sample)
  })

  it('falls back (null) when he has written fewer than about 150 words himself', () => {
    const scenes = [
      scene('s2', [
        { text: narration('mine', 60), own: true },
        { text: narration('ai', 400), own: false }
      ]),
      scene('s1', [{ text: line('mine'), own: true }])
    ]
    expect(pickOwnSample(scenes)).toBeNull()
    expect(pickOwnSample([])).toBeNull()
  })

  it('cuts a long paragraph of his at a sentence end, and keeps to the most a stretch may take', () => {
    const scenes = [scene('s1', [{ text: narration('long', 600), own: true }])]
    const sample = pickOwnSample(scenes)!
    expect(sample.passages[0].words).toBeLessThanOrEqual(OWN_SAMPLE.perPassage)
    expect(sample.passages[0].text).toMatch(/quay\.$/)
  })

  it('adds a line of his dialogue when the stretches picked have none', () => {
    const scenes = [
      scene('s3', [{ text: narration('one', 200), own: true }]),
      scene('s2', [{ text: narration('two', 200), own: true }]),
      scene('s1', [
        { text: narration('three', 30), own: false },
        { text: line('three'), own: true }
      ])
    ]
    const sample = pickOwnSample(scenes)!
    expect(sample.passages.some((p) => p.dialogue)).toBe(true)
    expect(sample.words).toBeLessThanOrEqual(OWN_SAMPLE.max)
  })

  it('says some of it again: about 120 words of a stretch with both dialogue and narration', () => {
    const sample = pickOwnSample([
      scene('s2', [{ text: narration('plain', 200), own: true }]),
      scene('s1', [
        { text: narration('mixed', 100), own: true },
        { text: line('mixed'), own: true }
      ])
    ])!
    const echo = echoOf(sample)!
    expect(echo.sceneId).toBe('s1')
    expect(echo.words).toBeLessThanOrEqual(OWN_SAMPLE.echo + 1)
    expect(echo.words).toBeGreaterThan(60)
  })
})
