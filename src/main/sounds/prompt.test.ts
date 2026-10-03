import { describe, expect, it } from 'vitest'
import { readAloudReply, SOUND_DOOR, SOUND_RAIN } from '../../../tests/fake-provider/m4/readAloud.mjs'
import { locate, numberedPids, parseSounds, SOUNDS_PROMPT, soundsUser, type PromptParagraph } from './prompt'

describe('the sounds prompt', () => {
  it('starts with Read aloud’s marker and the job, so the fake provider knows it', () => {
    expect(SOUNDS_PROMPT.startsWith('[AIWRITE-READ-ALOUD v1] sounds\n')).toBe(true)
  })

  it('numbers the paragraphs the AI may mark, and shows Adam’s without a number', () => {
    const paragraphs: PromptParagraph[] = [
      { pid: 'a', text: 'Rain fell.', owned: false },
      { pid: 'b', text: 'She waited.', owned: true },
      { pid: 'c', text: 'The door slammed.', owned: false }
    ]
    const user = soundsUser({ before: 'Earlier words.', playing: 'steady rain on a roof', library: [{ kind: 'effect', description: 'a door slamming' }], paragraphs })
    expect(user).toContain('Earlier in the scene, for context only:\nEarlier words.')
    expect(user).toContain('Playing as this passage starts: the ambience "steady rain on a roof".')
    expect(user).toContain('- effect: a door slamming')
    expect(user).toContain('The passage:\n[P1] Rain fell.\n\n[--] She waited.\n\n[P2] The door slammed.')
    expect(numberedPids(paragraphs)).toEqual(['a', 'c'])
    const none = soundsUser({ before: '', playing: null, library: [], paragraphs })
    expect(none).toContain('No ambience is playing as this passage starts.')
    expect(none).toContain('The library has no sounds yet.')
    expect(none).not.toContain('Earlier in the scene')
  })
})

describe('reading the AI’s reply', () => {
  it('reads the JSON it asked for', () => {
    const said = parseSounds(
      '{"sounds":[{"type":"effect","sound":"a heavy wooden door slamming shut","p":3,"at":"the door slammed shut","word":"slammed","seconds":2},' +
        '{"type":"ambience","sound":"steady rain on a tin roof","p":1,"at":"rain hammered","word":"rain","until":{"p":6,"at":"inside","word":"inside"}}]}'
    )
    expect(said).toEqual([
      { type: 'effect', sound: 'a heavy wooden door slamming shut', p: 3, at: 'the door slammed shut', word: 'slammed', seconds: 2 },
      { type: 'ambience', sound: 'steady rain on a tin roof', p: 1, at: 'rain hammered', word: 'rain', until: { p: 6, at: 'inside', word: 'inside' } }
    ])
  })

  it('forgives fences, a bare list, other names for the kinds and "P" numbers', () => {
    const said = parseSounds(
      'Here you go:\n```json\n[{"kind":"Ambient","description":"wind over moorland","p":"P2","at":"the wind","word":"wind","until":null},{"type":"end","p":4,"word":"inside"}]\n```'
    )
    expect(said).toEqual([
      { type: 'ambience', sound: 'wind over moorland', p: 2, at: 'the wind', word: 'wind', until: null },
      { type: 'stop', sound: '', p: 4, at: '', word: 'inside' }
    ])
  })

  it('leaves out what can’t be used: music and voices, no place, unknown kinds, nonsense', () => {
    expect(
      parseSounds(
        JSON.stringify({
          sounds: [
            { type: 'effect', sound: 'a choir singing', p: 1, word: 'choir' },
            { type: 'ambience', sound: 'distant music from a tavern', p: 1, word: 'tavern' },
            { type: 'effect', sound: 'muffled voices', p: 1, word: 'voices' },
            { type: 'effect', sound: 'a bell', p: 0, word: 'bell' },
            { type: 'effect', sound: 'a bell', p: 2 },
            { type: 'smell', sound: 'smoke', p: 1, word: 'smoke' },
            { type: 'effect', sound: 'none', p: 1, word: 'x' },
            'nonsense'
          ]
        })
      )
    ).toEqual([])
    expect(parseSounds('I could not find any sounds.')).toEqual([])
    expect(parseSounds('{"sounds": []}')).toEqual([])
  })
})

describe('finding where a sound happens', () => {
  const text = 'He turned. Behind him, the Door  slammed shut, and the “old” lamp swung.'

  it('finds the words, forgiving case, spacing and quote marks, then the word inside them', () => {
    const a = locate(text, 'p1', 'the door slammed shut', 'slammed')!
    expect(a).toEqual({ pid: 'p1', from: text.indexOf('slammed'), to: text.indexOf('slammed') + 7, words: 'slammed' })
    expect(locate(text, 'p1', 'the "old" lamp swung', 'swung')!.words).toBe('swung')
  })

  it('takes the first word of the words when the word isn’t among them', () => {
    expect(locate(text, 'p1', 'the door slammed', 'crash')!.words).toBe('the')
  })

  it('takes the word alone, as a whole word, when the words aren’t there', () => {
    const a = locate(text, 'p1', 'the gate banged', 'lamp')!
    expect(a.words).toBe('lamp')
    // "him" is a whole word; "hi" is not.
    expect(locate(text, 'p1', '', 'hi')).toBeNull()
  })

  it('drops a sound it can’t place', () => {
    expect(locate(text, 'p1', 'a dog barked', 'barked')).toBeNull()
  })
})

describe('the fake provider’s sounds', () => {
  it('marks a door and rain where the words say so, and stops the rain indoors', () => {
    const paragraphs: PromptParagraph[] = [
      { pid: 'a', text: 'The rain fell on the tin roof.', owned: false },
      { pid: 'b', text: 'She listened.', owned: true },
      { pid: 'c', text: 'Then the door slammed shut behind him.', owned: false },
      { pid: 'd', text: 'They went indoors at last.', owned: false }
    ]
    const user = soundsUser({ before: '', playing: null, library: [], paragraphs })
    const said = parseSounds(readAloudReply(SOUNDS_PROMPT, [{ role: 'user', content: user }])!)
    expect(said.map((s) => [s.type, s.sound, s.p, s.word])).toEqual([
      ['ambience', SOUND_RAIN, 1, 'rain'],
      ['effect', SOUND_DOOR, 2, 'slammed'],
      ['stop', '', 3, 'indoors']
    ])
    // Rain already playing isn't started again.
    const playing = soundsUser({ before: '', playing: SOUND_RAIN, library: [], paragraphs })
    expect(parseSounds(readAloudReply(SOUNDS_PROMPT, [{ role: 'user', content: playing }])!).map((s) => s.type)).toEqual(['effect', 'stop'])
  })
})
