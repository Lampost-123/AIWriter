import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { castOf } from './cast'
import { Marker, MarkStore, textHash, type Ask, type MarkingScene } from './marks'
import { MARKER, type Para } from './speakers'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aw-marks-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const cast = castOf([
  { id: 'mara', name: 'Mara', aliases: [], about: '' },
  { id: 'tom', name: 'Tomas', aliases: [], about: '' }
])

describe('the marks kept for a scene', () => {
  it('keys each paragraph by its id and a hash of its words', () => {
    expect(textHash('“Out,” he said.')).toBe(textHash('“Out,” he said.'))
    expect(textHash('“Out,” he said.')).not.toBe(textHash('“Out,” she said.'))
    expect(textHash('a')).toHaveLength(20)
  })

  it('gives back only the marks of paragraphs whose words are unchanged', () => {
    const store = new MarkStore(dir)
    const a = { id: 'p1', text: '“Out,” he said.', speakers: { out: 'Tomas' } }
    const b = { id: 'p2', text: '“Where?”', speakers: { where: 'Mara' }, delivery: { where: { tone: 'sharp' } } }
    store.save(
      'w1',
      's1',
      [a, b],
      [
        { pid: 'p1', text: a.text },
        { pid: 'p2', text: b.text }
      ]
    )
    const now = store.current('w1', 's1', [
      { pid: 'p1', text: a.text },
      { pid: 'p2', text: '“Where to?”' }
    ])
    expect([...now.keys()]).toEqual(['p1'])
    expect(now.get('p1')).toEqual({ speakers: { out: 'Tomas' } })
  })

  it('drops the marks of paragraphs that changed or went when it next saves', () => {
    const store = new MarkStore(dir)
    store.save('w1', 's1', [{ id: 'p1', text: 'One.', delivery: { '~one': { tone: 'calm' } } }], [{ pid: 'p1', text: 'One.' }])
    store.save('w1', 's1', [{ id: 'p2', text: 'Two.', delivery: { '~two': {} } }], [{ pid: 'p2', text: 'Two.' }], new Set(['p2']))
    expect(Object.keys(store.load('w1', 's1'))).toEqual(['p2'])
    // Marks made for words a paragraph no longer has are not kept at all.
    store.save(
      'w1',
      's1',
      [{ id: 'p3', text: 'Old words.', delivery: { '~old words': {} } }],
      [
        { pid: 'p2', text: 'Two.' },
        { pid: 'p3', text: 'New words.' }
      ]
    )
    expect(Object.keys(store.load('w1', 's1'))).toEqual(['p2'])
  })

  it('keeps the marks of paragraphs a reading didn’t send, while the scene still has them', () => {
    const store = new MarkStore(dir)
    store.save('w1', 's1', [{ id: 'p1', text: 'One.', delivery: { '~one': { tone: 'calm' } } }], [{ pid: 'p1', text: 'One.' }])
    // A reading far into the scene sends only the paragraphs a little before where it starts.
    store.save('w1', 's1', [{ id: 'p9', text: 'Nine.', delivery: { '~nine': {} } }], [{ pid: 'p9', text: 'Nine.' }], new Set(['p1', 'p9']))
    expect(Object.keys(store.load('w1', 's1')).sort()).toEqual(['p1', 'p9'])
    // Without the scene's whole list, nothing it wasn't sent is let go.
    store.save('w1', 's1', [{ id: 'p8', text: 'Eight.', delivery: { '~eight': {} } }], [{ pid: 'p8', text: 'Eight.' }])
    expect(Object.keys(store.load('w1', 's1')).sort()).toEqual(['p1', 'p8', 'p9'])
  })

  it('never writes outside its folder for an id that is not the app’s own', () => {
    const store = new MarkStore(dir)
    store.save('../x', 's1', [{ id: 'p1', text: 'One.' }], [{ pid: 'p1', text: 'One.' }])
    store.save('w1', 'a/b', [{ id: 'p1', text: 'One.' }], [{ pid: 'p1', text: 'One.' }])
    expect(readdirSync(dir)).toEqual([])
    expect(store.current('../x', 's1', [{ pid: 'p1', text: 'One.' }]).size).toBe(0)
  })
})

/** A Marker whose AI is a list of replies, with what it was asked and told. */
function harness(replies: ((call: Parameters<Ask>[0]) => Promise<{ text: string | null; error: string | null }>)[] = []) {
  const store = new MarkStore(dir)
  const asked: Parameters<Ask>[0][] = []
  const told: { sceneId: string; pids: string[]; error: string | null }[] = []
  let stopped = 0
  let waiting: (() => void) | null = null
  const marker = new Marker(
    store,
    () => ({
      call: (call) => {
        asked.push(call)
        const next = replies.shift()
        return next ? next(call) : Promise.resolve({ text: null, error: 'No reply.' })
      },
      stop: () => {
        stopped++
      }
    }),
    (sceneId, pids, error) => {
      told.push({ sceneId, pids, error })
      waiting?.()
    }
  )
  const told1 = (): Promise<void> => new Promise((resolve) => (waiting = resolve))
  return { store, marker, asked, told, told1, stops: () => stopped }
}

const blocks: Para[] = [
  { id: 'p1', text: '“Where were you?” Mara asked.' },
  { id: 'p2', text: 'Tomas shrugged. “Out.”' }
]
const scene: MarkingScene = { worldId: 'w1', sceneId: 's1', blocks, run: ['p1', 'p2'], cast }
const reply = (text: string) => () => Promise.resolve({ text, error: null })

describe('marking who says what, and how', () => {
  it('numbers every line that needs a note, and keeps what the AI says', async () => {
    const h = harness([reply('{"1": "Mara | worried, sharp", "2": "plain", "3": "tired | slow", "4": "Tomas | flat, evasive | fast"}')])
    const done = h.told1()
    expect([...h.marker.note(scene).busy]).toEqual(['p1', 'p2'])
    await done
    expect(h.asked[0].system.startsWith(`${MARKER} marks\n`)).toBe(true)
    expect(h.asked[0].user).toBe('[1]“Where were you?” [2]Mara asked.\n\n[3]Tomas shrugged. [4]“Out.”')
    expect(h.told).toEqual([{ sceneId: 's1', pids: ['p1', 'p2'], error: null }])
    const kept = h.store.current('w1', 's1', [
      { pid: 'p1', text: blocks[0].text },
      { pid: 'p2', text: blocks[1].text }
    ])
    expect(kept.get('p1')).toEqual({
      speakers: { 'where were you': 'Mara' },
      delivery: { 'where were you': { tone: 'worried, sharp' }, '~mara asked': { tone: 'plain' } }
    })
    expect(kept.get('p2')?.delivery?.out).toEqual({ tone: 'flat, evasive', pace: 'fast' })
    expect(h.marker.busyIn('w1', 's1').size).toBe(0)
  })

  it('says why in plain words when the AI fails, and doesn’t ask again straight away', async () => {
    const h = harness([() => Promise.resolve({ text: null, error: 'The AI service is busy. Try again in a minute.' })])
    const done = h.told1()
    h.marker.note(scene)
    await done
    expect(h.told[0].error).toBe('The AI service is busy. Try again in a minute.')
    expect(h.marker.note(scene).busy.size).toBe(0)
    expect(h.asked).toHaveLength(1)
  })

  it('reads by the rules when the reply can’t be read', async () => {
    const h = harness([reply('Sorry, I can’t help with that.')])
    const done = h.told1()
    h.marker.note(scene)
    await done
    expect(h.told[0].error).toMatch(/read by the rules alone/)
  })

  it('drops a reply that comes after its reading stopped', async () => {
    let answer: (v: { text: string | null; error: string | null }) => void = () => undefined
    const h = harness([() => new Promise((resolve) => (answer = resolve))])
    h.marker.note(scene)
    h.marker.stop('w1', 's1')
    expect(h.stops()).toBe(1)
    answer({ text: '{"1": "Mara"}', error: null })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.told).toEqual([])
    expect(existsSync(join(dir, 'w1', 's1.json'))).toBe(false)
  })

  it('drops the late reply of a call stopped before the reading started again, and keeps the new reading’s', async () => {
    const answers: ((v: { text: string | null; error: string | null }) => void)[] = []
    const later = () => new Promise<{ text: string | null; error: string | null }>((resolve) => answers.push(resolve))
    const h = harness([later, later])
    h.marker.note(scene)
    h.marker.stop('w1', 's1')
    // Read again at once: the same paragraphs are asked about again.
    expect([...h.marker.note(scene).busy]).toEqual(['p1', 'p2'])
    expect(h.asked).toHaveLength(2)
    // The stopped call answers now: nothing is kept, nobody is told, and the new reading is still waiting on its own.
    answers[0]({ text: '{"1": "Tomas | stale"}', error: null })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.told).toEqual([])
    expect(existsSync(join(dir, 'w1', 's1.json'))).toBe(false)
    expect(h.marker.busyIn('w1', 's1')).toEqual(new Set(['p1', 'p2']))
    const done = h.told1()
    answers[1]({ text: '{"1": "Mara | worried"}', error: null })
    await done
    expect(h.told).toEqual([{ sceneId: 's1', pids: ['p1', 'p2'], error: null }])
    expect(h.store.current('w1', 's1', [{ pid: 'p1', text: blocks[0].text }]).get('p1')?.speakers).toEqual({ 'where were you': 'Mara' })
  })

  it('tells the reading once when the AI can’t be asked, and doesn’t ask again straight away', () => {
    const why = 'Pick a model for reading aloud in Settings › Models.'
    const told: (string | null)[] = []
    const marker = new Marker(
      new MarkStore(dir),
      () => ({ error: why }),
      (_s, _p, error) => told.push(error)
    )
    expect(marker.note(scene).busy.size).toBe(0)
    // Planning again (as the reading does after an edit) asks no more, and says nothing more.
    expect(marker.note(scene)).toEqual({ busy: new Set() })
    expect(told).toEqual([why])
    // Only who says a line, the same.
    const quiet: MarkingScene = { ...scene, blocks: [{ id: 'p3', text: '“Out.”' }] }
    const unplaced = new Map([['p3', new Set(['out'])]])
    expect(marker.label(quiet, unplaced).size).toBe(0)
    expect(marker.label(quiet, unplaced).size).toBe(0)
    expect(told).toEqual([why, why])
  })
})

/** A long scene: paragraphs of 590 characters, each one sentence of narration that needs a note. */
const longScene = (n: number): Para[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    text: `Part ${i + 1} ${'and the tide crept in over the stones '.repeat(16)}`.slice(0, 589) + '.'
  }))

/** The paragraphs a call asked about, by the words each starts with. */
const askedAbout = (user: string): string[] => [...user.matchAll(/\[\d+\](Part \d+)/g)].map((m) => m[1]!)

describe('keeping the notes ahead of the reading', () => {
  it('notes the start, says where to ask again, and from there notes the next part', async () => {
    const h = harness([reply('{"1": "calm"}'), reply('{"1": "calm"}'), reply('{"1": "calm"}')])
    const paras = longScene(14)
    const run: MarkingScene = { ...scene, blocks: paras, run: paras.map((p) => p.id) }
    // A new reading: a small part (back while the first clip plays), then the next, about 4,000 characters in all.
    const first = h.marker.note(run)
    expect([...first.busy]).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])
    expect(h.asked.map((a) => askedAbout(a.user))).toEqual([
      ['Part 1', 'Part 2'],
      ['Part 3', 'Part 4', 'Part 5', 'Part 6', 'Part 7']
    ])
    // The first paragraph not being noted (p8) starts 4,130 characters on: the reading asks again 1,200 before it.
    expect(first.again).toEqual({ pid: 'p5', at: 570 })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.told.map((t) => t.error)).toEqual([null, null])

    // The reading has got there (it reads on from p6): the next part is noted, and the place to ask again moves on.
    const kept = h.store.current(
      'w1',
      's1',
      paras.map((p) => ({ pid: p.id, text: p.text }))
    )
    const later = h.marker.note({ ...run, blocks: paras.map((p) => ({ ...p, ...kept.get(p.id) })), run: run.run.slice(5) })
    expect([...later.busy]).toEqual(['p8', 'p9', 'p10', 'p11', 'p12'])
    expect(askedAbout(h.asked[2].user)).toEqual(['Part 8', 'Part 9', 'Part 10', 'Part 11', 'Part 12'])
    expect(later.again).toEqual({ pid: 'p10', at: 570 })
  })

  it('says nothing about asking again once the rest of the scene has its notes', () => {
    const h = harness()
    const run: MarkingScene = {
      ...scene,
      blocks: [{ id: 'p1', text: 'The tide crept in.', delivery: { '~the tide crept in': {} } }],
      run: ['p1']
    }
    expect(h.marker.note(run)).toEqual({ busy: new Set() })
    expect(h.asked).toHaveLength(0)
  })
})

describe('marking a draft in the background, as it lands', () => {
  it('notes every paragraph it is given, all of the scene’s parts, and keeps what the AI says', async () => {
    const h = harness([reply('{"1": "calm"}'), reply('{"1": "calm"}'), reply('{"1": "calm"}'), reply('{"1": "calm"}')])
    const paras = longScene(8)
    const run: MarkingScene = { ...scene, blocks: paras, run: paras.map((p) => p.id) }
    // Only the new paragraphs (the draft's), however far into the scene they are.
    const busy = h.marker.noteAll(run, new Set(['p3', 'p4', 'p5', 'p6', 'p7', 'p8']))
    expect([...busy]).toEqual(['p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
    expect(h.asked.flatMap((a) => askedAbout(a.user))).toEqual(['Part 3', 'Part 4', 'Part 5', 'Part 6', 'Part 7', 'Part 8'])
    await new Promise((r) => setTimeout(r, 10))
    expect(h.told.every((t) => t.error === null)).toBe(true)
    expect(h.marker.busyIn('w1', 's1').size).toBe(0)
    const kept = h.store.current(
      'w1',
      's1',
      paras.map((p) => ({ pid: p.id, text: p.text }))
    )
    expect([...kept.keys()]).toEqual(['p3', 'p4', 'p5', 'p6', 'p7', 'p8'])
  })

  it('leaves paragraphs a reading is marking for the same words to it, and a reading leaves the draft’s to it', () => {
    const h = harness([() => new Promise(() => undefined), () => new Promise(() => undefined)])
    h.marker.noteAll(scene, new Set(['p1', 'p2']))
    expect(h.asked).toHaveLength(1)
    // Listen now: nothing is asked twice.
    expect([...h.marker.note(scene).busy]).toEqual(['p1', 'p2'])
    h.marker.noteAll(scene, new Set(['p1', 'p2']))
    expect(h.asked).toHaveLength(1)
  })

  it('takes over a paragraph whose words changed while it was being marked, and stops the call made for the old words', async () => {
    const answers: ((v: { text: string | null; error: string | null }) => void)[] = []
    const later = () => new Promise<{ text: string | null; error: string | null }>((resolve) => answers.push(resolve))
    const h = harness([later, later])
    const one: MarkingScene = { ...scene, blocks: [{ id: 'p1', text: 'The tide crept in.' }], run: ['p1'] }
    h.marker.noteAll(one, new Set(['p1']))
    // A new draft rewrote it before the reply came.
    const two: MarkingScene = { ...one, blocks: [{ id: 'p1', text: 'The tide came in fast.' }] }
    h.marker.noteAll(two, new Set(['p1']))
    expect(h.asked).toHaveLength(2)
    expect(h.stops()).toBe(1)
    answers[0]({ text: '{"1": "stale"}', error: null })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.told).toEqual([])
    const done = h.told1()
    answers[1]({ text: '{"1": "urgent | fast"}', error: null })
    await done
    expect(h.store.current('w1', 's1', [{ pid: 'p1', text: 'The tide came in fast.' }]).get('p1')?.delivery).toEqual({
      '~the tide came in fast': { tone: 'urgent', pace: 'fast' }
    })
  })

  it('only logs a failure: nobody is told of an error, and a reading asks again itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const h = harness([() => Promise.resolve({ text: null, error: 'The AI service is busy.' })])
      const done = h.told1()
      h.marker.noteAll(scene, new Set(['p1', 'p2']))
      await done
      expect(h.told).toEqual([{ sceneId: 's1', pids: ['p1', 'p2'], error: null }])
      // Listen: the reading asks for them itself (and says so if that fails too).
      expect([...h.marker.note(scene).busy]).toEqual(['p1', 'p2'])
      expect(h.asked).toHaveLength(2)
      // No model for it: nothing is asked, nothing is said, nothing is held against the paragraphs.
      const told: (string | null)[] = []
      const none = new Marker(
        new MarkStore(dir),
        () => ({ error: 'Pick a model.' }),
        (_s, _p, error) => told.push(error)
      )
      expect(none.noteAll(scene, new Set(['p1'])).size).toBe(0)
      expect(
        none.label({ ...scene, blocks: [{ id: 'p3', text: '“Out.”' }] }, new Map([['p3', new Set(['out'])]]), { quiet: true }).size
      ).toBe(0)
      expect(told).toEqual([])
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
