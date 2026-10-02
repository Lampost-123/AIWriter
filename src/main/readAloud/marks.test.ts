import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    store.save('w1', 's1', [{ id: 'p2', text: 'Two.', delivery: { '~two': {} } }], [{ pid: 'p2', text: 'Two.' }])
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
    expect([...h.marker.note(scene)]).toEqual(['p1', 'p2'])
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
    expect(h.marker.note(scene).size).toBe(0)
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

  it('tells the reading at once when the AI can’t be asked', () => {
    const told: (string | null)[] = []
    const marker = new Marker(
      new MarkStore(dir),
      () => ({ error: 'Pick a model for reading aloud in Settings › Models.' }),
      (_s, _p, error) => told.push(error)
    )
    expect(marker.note(scene).size).toBe(0)
    expect(told).toEqual(['Pick a model for reading aloud in Settings › Models.'])
  })
})

describe('marking only who says a line', () => {
  it('asks about the quotes the rules can’t place, and keeps the speakers', async () => {
    const h = harness([reply('{"1": "Tomas"}')])
    const run: MarkingScene = {
      ...scene,
      blocks: [
        { id: 'p1', text: '“Where were you?” Mara asked.' },
        { id: 'p2', text: '“Out.”' }
      ]
    }
    const done = h.told1()
    expect([...h.marker.label(run, new Map([['p2', new Set(['out'])]]))]).toEqual(['p2'])
    await done
    expect(h.asked[0].system.startsWith(`${MARKER} speakers\n`)).toBe(true)
    expect(h.asked[0].user).toBe('“Where were you?” Mara asked.\n\n[1]“Out.”')
    expect(h.asked[0].temperature).toBe(0)
    expect(h.store.current('w1', 's1', [{ pid: 'p2', text: '“Out.”' }]).get('p2')).toEqual({ speakers: { out: 'Tomas' } })
  })
})
