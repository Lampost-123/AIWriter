import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { castOf } from './cast'
import {
  contextBlock,
  DIRECT_PROMPT,
  EMPTY_STATE,
  linesByParagraph,
  marksOfScript,
  numberWindow,
  parseDirection,
  windowsOf,
  withDirection,
  withoutDirectorTone,
  type ScriptLine
} from './director'
import { keptFor, Marker, MarkStore, tagsOf, type Ask, type MarkingScene } from './marks'
import { MARKER, NARRATOR } from './speakers'

const cast = castOf([
  { id: 'mara', name: 'Mara', aliases: ['the courier'], about: 'A young courier.' },
  { id: 'tom', name: 'Tomas', aliases: [], about: 'An old ferryman.' }
])

const line = (l: Partial<ScriptLine>): ScriptLine => ({ kind: 'speech', who: 'Mara', emotion: 'neutral', intensity: 2, note: '', ...l })

describe('the director’s prompt and windows', () => {
  it('names the cast, who tells the story, and every kind of line', () => {
    const p = DIRECT_PROMPT(cast, 'Mara')
    expect(p.startsWith(`${MARKER} director`)).toBe(true)
    expect(p).toContain('- Mara (also called "the courier"): A young courier.')
    expect(p).toContain('told in the first person by Mara')
    for (const k of ['"speech"', '"thought"', '"text_message"', '"chat"', '"letter"', '"sign"', '"narration"']) expect(p).toContain(k)
  })

  it('numbers every quote and sentence of narration, and shows a passage set apart as a quoted block', () => {
    const { text, lines } = numberWindow([
      { id: 'a', text: '“Out,” Mara said. He went.' },
      { id: 'b', text: 'Dear Tomas,\nCome home.', block: 'quote' }
    ])
    expect(text).toBe('[1]“Out,” [2]Mara said. [3]He went.\n\n> [4]Dear Tomas,\n> [5]Come home.')
    expect(lines.map((l) => [l.n, l.pid, l.key, l.quote])).toEqual([
      [1, 'a', 'out', true],
      [2, 'a', '~mara said', false],
      [3, 'a', '~he went', false],
      [4, 'b', '~dear tomas', false],
      [5, 'b', '~come home', false]
    ])
  })

  it('shows the words in italics between asterisks, so a thought can be told apart', () => {
    const { text } = numberWindow([{ id: 'a', text: 'Not again, she thought. He left.', italics: [[0, 10]] }])
    expect(text).toBe('[1]*Not again,* she thought. [2]He left.')
  })

  it('splits a scene into windows of about a size, never splitting a paragraph', () => {
    const ps = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)].map((text) => ({ text }))
    expect(windowsOf(ps, 110)).toEqual([
      [0, 2],
      [2, 3]
    ])
    expect(windowsOf(ps, 10)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3]
    ])
  })

  it('tells each window what the one before ended on', () => {
    expect(contextBlock(EMPTY_STATE, '')).toBe('')
    const got = contextBlock({ ...EMPTY_STATE, present: ['Mara'] }, 'Before.')
    expect(got).toContain('So far: {"present":["Mara"]')
    expect(got).toContain('for context only (no numbers to answer):\nBefore.')
  })
})

describe('reading the director’s reply', () => {
  it('reads each line, leniently, and counts what it can’t', () => {
    const got = parseDirection(
      'Here: {"lines": {"1": {"kind": "dialogue", "who": "Mara", "emotion": "ANGRY", "intensity": 3, "note": "through clenched teeth", "pace": "slow", "sound": "(sigh)"}, "2": {"kind": "message", "who": "Tomas", "emotion": "warm"}, "3": {"kind": "sign", "who": "Mara"}, "x": {}, "4": {"note": "no who"}}, "state": {"present": ["Mara"], "pov": null, "newPeople": [{"label": "new:the guard", "gender": "male"}]}}'
    )!
    expect(got.bad).toBe(2)
    expect(got.lines.get(1)).toEqual({ kind: 'speech', who: 'Mara', emotion: 'angry', intensity: 3, note: 'through clenched teeth', sound: 'sigh' })
    expect(got.lines.get(2)).toMatchObject({ kind: 'text_message', who: 'Tomas', emotion: 'warm', intensity: 2 })
    // A sign is nobody's words.
    expect(got.lines.get(3)?.who).toBe(NARRATOR)
    expect(got.state).toMatchObject({ present: ['Mara'], newPeople: [{ label: 'new:the guard', gender: 'male' }] })
    expect(parseDirection('no json')).toBeNull()
  })

  it('turns a paragraph’s script into marks: thoughts, messages and letters a character owns are voiced', () => {
    const text = '*Not again,* she thought. “Run,” Mara said. A sign: “NO ENTRY.”'
    const marks = marksOfScript(text, {
      '~not again she thought': line({ kind: 'thought', emotion: 'anxious', intensity: 1, note: 'tight, inward' }),
      run: line({ emotion: 'afraid', intensity: 3, note: 'urgent', pace: 'fast' }),
      'no entry': line({ kind: 'sign', who: NARRATOR })
    })
    expect(marks.voiced).toEqual({ '~not again she thought': 'Mara' })
    expect(marks.kinds).toEqual({ '~not again she thought': 'thought', run: 'speech', 'no entry': 'sign' })
    expect(marks.speakers).toEqual({ run: 'Mara', 'no entry': NARRATOR })
    expect(marks.delivery?.run).toEqual({ tone: 'urgent', pace: 'fast', feeling: 'afraid', intensity: 3, by: 'director' })
    expect(marks.delivery?.['no entry']).toEqual({})
    expect(marks.delivery?.['~not again she thought']).toEqual({ tone: 'tight, inward', feeling: 'anxious', intensity: 1, by: 'director' })
  })

  it('keeps someone new by their label, and gives a first-person narrator their own thoughts', () => {
    const marks = marksOfScript('“Papers.” I wondered why.', {
      papers: line({ who: 'new:the guard' }),
      '~i wondered why': line({ kind: 'thought', who: NARRATOR })
    }, 'Mara')
    expect(marks.speakers).toEqual({ papers: 'the guard' })
    expect(marks.voiced).toEqual({ '~i wondered why': 'Mara' })
  })

  it('gives a paragraph whose narration got no note an empty one, so it isn’t asked about again', () => {
    expect(marksOfScript('He left. She stayed.', {}).delivery).toEqual({ '~he left': {} })
  })

  it('lays the director under the writer’s tags: the writer’s speaker and note stay, the director adds what a line is', () => {
    const block = { id: 'a', text: '“Run,” he said. *Too late.*', speakers: { run: 'Tomas' }, delivery: { run: { tone: 'hoarse' } } }
    const got = withDirection(
      block,
      marksOfScript(block.text, {
        run: line({ who: 'Mara', emotion: 'afraid', intensity: 3, note: 'panicked' }),
        '~too late': line({ kind: 'thought', who: 'Mara' })
      })
    )
    expect(got.speakers).toEqual({ run: 'Tomas' })
    expect(got.delivery?.run).toEqual({ tone: 'hoarse', feeling: 'afraid', intensity: 3 })
    expect(got.kinds).toEqual({ run: 'speech', '~too late': 'thought' })
    expect(got.voiced).toEqual({ '~too late': 'Mara' })
  })

  it('finds each numbered line’s script by paragraph', () => {
    const { lines } = numberWindow([{ id: 'a', text: '“Hi.”' }, { id: 'b', text: 'Bye.' }])
    const got = linesByParagraph(lines, { lines: new Map([[2, line({ kind: 'narration', who: NARRATOR })]]), state: null, bad: 0 })
    expect([...got.keys()]).toEqual(['b'])
  })

  it('carries the telling’s mood into the paragraphs after it that got no narration note, without its sound', () => {
    const { lines } = numberWindow([
      { id: 'a', text: 'Rain fell. It kept falling.' },
      { id: 'b', text: '“Go,” he said.' },
      { id: 'c', text: 'Then the sun. Birds.' }
    ])
    const grim = line({ kind: 'narration', who: NARRATOR, emotion: 'sad', note: 'grey and low', sound: 'sigh' })
    const bright = line({ kind: 'narration', who: NARRATOR, emotion: 'happy', note: 'lifting' })
    const got = linesByParagraph(lines, { lines: new Map([[1, grim], [3, line({ who: 'Tomas' })], [5, bright]]), state: null, bad: 0 })
    expect(Object.keys(got.get('a')!)).toEqual(['~rain fell'])
    // "he said" reads in the mood before it; the sigh happened once.
    expect(got.get('b')?.['~he said']).toMatchObject({ emotion: 'sad', note: 'grey and low' })
    expect(got.get('b')?.['~he said']?.sound).toBeUndefined()
    expect(got.get('c')?.['~then the sun']).toBe(bright)
  })

  it('reads a narration entry with no "who" as the narrator’s, as the prompt asks for', () => {
    const got = parseDirection('{"lines": {"1": {"kind": "narration", "emotion": "tense", "note": "taut"}, "2": {"kind": "speech", "emotion": "angry"}}}')!
    expect(got.lines.get(1)).toMatchObject({ kind: 'narration', who: NARRATOR, emotion: 'tense' })
    // A spoken line still needs to say whose it is.
    expect(got.bad).toBe(1)
  })

  it('tells the director a letter read out loud is the reader’s speech, and to keep narration notes few', () => {
    const p = DIRECT_PROMPT(cast)
    expect(p).toContain('reads out loud ("he read", "she read it aloud") is "speech", and its "who" is the one reading it')
    expect(p).toContain('A narration entry is only {"kind": "narration", "emotion": ..., "note": ...}')
    expect(p).toContain('only for the passage\'s first sentence and wherever the mood of the telling turns')
    expect(p).toContain('name that feeling rather than neutral')
  })

  it('with Emotion and tone off, leaves out the director’s notes but keeps the writer’s, and who and what each line is', () => {
    const m = {
      speakers: { go: 'Tomas' },
      kinds: { go: 'speech' as const },
      delivery: {
        go: { tone: 'hoarse', feeling: 'afraid', intensity: 3 as const },
        stay: { tone: 'urgent', feeling: 'angry', intensity: 2 as const, by: 'director' as const },
        '~x': {}
      }
    }
    expect(withoutDirectorTone(m)).toEqual({ speakers: { go: 'Tomas' }, kinds: { go: 'speech' }, delivery: { go: { tone: 'hoarse' }, '~x': {} } })
  })
})

describe('the Marker’s calls to the director', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aw-direct-'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  })

  const scene = (blocks: MarkingScene['blocks']): MarkingScene => ({ worldId: 'w', sceneId: 's', blocks, run: blocks.map((b) => b.id), cast })
  const settle = async (m: Marker): Promise<void> => {
    for (let i = 0; i < 100 && m.busyIn('w', 's').size; i++) await new Promise((r) => setTimeout(r, 1))
  }

  it('asks the director instead of the marker, once more when its reply can’t be read, and keeps what it said', async () => {
    const store = new MarkStore(dir)
    const asked: { system: string; user: string }[] = []
    const replies = [
      'Sorry, here you go: lines 1 to 3.',
      '{"lines": {"1": {"kind": "speech", "who": "Tomas", "emotion": "tense", "intensity": 2, "note": "low"}, "2": {"kind": "narration", "who": "narrator", "emotion": "tense"}, "3": {"kind": "thought", "who": "Mara", "emotion": "anxious", "intensity": 1}}, "state": {"present": ["Mara", "Tomas"]}}'
    ]
    const ask: Ask = async (c) => {
      asked.push(c)
      return { text: replies.shift() ?? null, error: null }
    }
    const done = vi.fn()
    const m = new Marker(store, () => ({ call: ask, stop: () => undefined }), done)
    const blocks = [{ id: 'a', text: '“Go.” He turned.' }, { id: 'b', text: '*Not him,* she thought.' }]
    m.noteAll(scene(blocks), new Set(['a', 'b']))
    await settle(m)
    expect(asked).toHaveLength(2)
    expect(asked[0]!.system.startsWith(`${MARKER} director`)).toBe(true)
    expect(asked[0]!.user).toBe('[1]“Go.” [2]He turned.\n\n[3]*Not him,* she thought.')
    expect(asked[1]!.user).toContain('Your reply was not one JSON object. Reply again')
    const kept = store.current('w', 's', blocks.map((b) => ({ pid: b.id, text: b.text })))
    expect(kept.get('a')?.speakers).toEqual({ go: 'Tomas' })
    expect(kept.get('b')?.voiced).toEqual({ '~not him she thought': 'Mara' })
    expect(kept.get('b')?.kinds).toEqual({ '~not him she thought': 'thought' })
    expect(done).toHaveBeenCalled()
  })

  it('carries what a window ended on into the next', async () => {
    const store = new MarkStore(dir)
    const users: string[] = []
    const ask: Ask = async (c) => {
      users.push(c.user)
      const n = (c.user.match(/\[\d+\]/g) ?? []).map((x) => x.slice(1, -1))
      const lines = Object.fromEntries(n.map((k) => [k, { kind: 'narration', who: 'narrator', emotion: 'neutral' }]))
      return { text: JSON.stringify({ lines, state: { present: ['Mara'], lastSpeakers: [] } }), error: null }
    }
    const m = new Marker(store, () => ({ call: ask, stop: () => undefined }), () => undefined)
    const long = 'Word '.repeat(700).trim() + '.'
    const blocks = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, text: `${long} ${i}` }))
    m.noteAll(scene(blocks), new Set(blocks.map((b) => b.id)))
    await settle(m)
    expect(users.length).toBeGreaterThan(1)
    expect(users[0]).not.toContain('So far:')
    expect(users[1]).toContain('So far: {"present":["Mara"]')
  })
})

describe('marks kept when other words in the paragraph change', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aw-keep-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads who each quote’s speech tag names', () => {
    expect(tagsOf('“Out,” he said. Mara laughed. “Fine,” she said, “go.”')).toEqual({ out: 'he', fine: 'he mara she', go: 'she' })
  })

  it('keeps each quote’s marks while the paragraph still has its words and its tag names the same one, and drops the rest', () => {
    const k = {
      speakers: { out: 'Tomas', where: 'Mara' },
      delivery: { out: { tone: 'flat' }, '~he said': {} },
      kinds: { out: 'speech' as const },
      tags: { out: 'he', where: '' }
    }
    // Another verb, more words: still "he".
    expect(keptFor(k, '“Out,” he muttered, and left.')).toEqual({ speakers: { out: 'Tomas' }, delivery: { out: { tone: 'flat' } }, kinds: { out: 'speech' } })
    // "she" now: the quote is marked again; the rest of the paragraph had nothing of its own.
    expect(keptFor(k, '“Out,” she muttered.')).toBeNull()
    // A tag never known (marks kept before tags were): the quote is marked again too.
    expect(keptFor({ speakers: { out: 'Tomas' }, delivery: { '~it rained': { tone: 'grey' } } }, '“Out,” he said. It rained.')).toEqual({
      delivery: { '~it rained': { tone: 'grey' } }
    })
    expect(keptFor(k, 'Nothing like it.')).toBeNull()
  })

  it('in the store: an edit elsewhere in the paragraph keeps its quotes’ marks, under the new words', () => {
    const store = new MarkStore(dir)
    const was = { id: 'p1', text: '“Out,” he said.', speakers: { out: 'Tomas' }, delivery: { out: { tone: 'flat' } } }
    store.save('w', 's', [was], [{ pid: 'p1', text: was.text }])
    const edited = [{ pid: 'p1', text: '“Out,” he said, not looking up.' }]
    expect(store.current('w', 's', edited).get('p1')).toEqual({ speakers: { out: 'Tomas' }, delivery: { out: { tone: 'flat' } } })
    // Saving something else for the scene keeps them, now under the paragraph's new words.
    store.save('w', 's', [{ id: 'p2', text: 'Two.', delivery: { '~two': {} } }], [...edited, { pid: 'p2', text: 'Two.' }])
    expect(store.load('w', 's').p1?.tags).toEqual({ out: 'he' })
    expect(store.current('w', 's', edited).get('p1')?.speakers).toEqual({ out: 'Tomas' })
    // The tag changed to someone else: the quote is asked about again.
    expect(store.current('w', 's', [{ pid: 'p1', text: '“Out,” Mara said, not looking up.' }]).get('p1')).toBeUndefined()
  })
})
