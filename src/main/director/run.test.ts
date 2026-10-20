// Directed writing's stretch loop, end to end through a draft (ai/drafts.ts startDraftJob with the director's stream),
// against a scripted provider: the writer's stretches and the director's call are answered per request, so each case says
// exactly what the writer wrote. Stretch sizing and requests, the clean stop, a free check's retake, the director only when
// needed, the limits (two retakes, twelve stretches), Stop, Adam's notes, and what the record keeps. Invented text only.
import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { AppEvents } from '@shared/api'
import type { ChatMessage, ContextPreview, ID, ModelChoice } from '@shared/types'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as gens from '../db/generations'
import { startDraftJob, stopDraft, type Emit } from '../ai/drafts'
import type { JobModel } from '../ai/jobModel'
import { directedStream, type DirectorSetup } from './run'
import { planStretches, MOST_STRETCHES } from './stretch'
import { addNote } from './live'
import { DIRECTOR_MARKER } from './prompts'
import type { CheckWorld } from './checks'

// ---------- A scripted provider ----------

interface Sent {
  model: string
  messages: ChatMessage[]
  max: number
}
type Answer = { text: string; finish?: string; ms?: number }

/** A fetch that answers each chat request with `answer(request)`, streamed a few words at a time (`ms` apart). */
function scripted(answer: (r: Sent, n: number) => Answer): typeof fetch & { sent: Sent[] } {
  const sent: Sent[] = []
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string; messages: ChatMessage[]; max_tokens?: number; max_completion_tokens?: number }
    const r: Sent = { model: body.model, messages: body.messages, max: body.max_tokens ?? body.max_completion_tokens ?? 0 }
    sent.push(r)
    const a = answer(r, sent.length)
    const line = (o: object): string => `data: ${JSON.stringify(o)}\n\n`
    const chunk = (delta: object, finish: string | null = null): string => line({ choices: [{ index: 0, delta, finish_reason: finish }] })
    const enc = new TextEncoder()
    const parts = a.text.match(/\S+\s*|\s+/g) ?? []
    const body2 = new ReadableStream<Uint8Array>({
      async start(c) {
        const stop = (): void => {
          try {
            c.error(new DOMException('The operation was aborted.', 'AbortError'))
          } catch {
            // closed already
          }
        }
        init.signal?.addEventListener('abort', stop, { once: true })
        for (let i = 0; i < parts.length; i += 3) {
          if (init.signal?.aborted) return
          c.enqueue(enc.encode(chunk({ content: parts.slice(i, i + 3).join('') })))
          if (a.ms) await new Promise((res) => setTimeout(res, a.ms))
          else await Promise.resolve()
        }
        if (init.signal?.aborted) return
        c.enqueue(enc.encode(chunk({}, a.finish ?? 'stop')))
        c.enqueue(enc.encode(line({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } })))
        c.enqueue(enc.encode('data: [DONE]\n\n'))
        c.close()
      }
    })
    return new Response(body2, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as unknown as typeof fetch & { sent: Sent[] }
  f.sent = sent
  return f
}

const userOf = (r: Sent): string => r.messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
const isDirector = (r: Sent): boolean => r.messages[0]?.content.startsWith(DIRECTOR_MARKER) ?? false
const verdict = (v: string, note = '', reason = ''): Answer => ({ text: JSON.stringify({ verdict: v, note, reason }) })
/** The beat a stretch is asked for (its first “…”). */
const beatAsked = (r: Sent): string => /(?:Write only stretch|Write stretch) \d+ of \d+(?: now)?, about \d+ words: “([^”]+)”/.exec(userOf(r))?.[1] ?? ''

// ---------- A draft ----------

const choice = (modelId: string): ModelChoice => ({ providerId: 'p1', modelId, label: modelId, contextLength: 32_000, promptPrice: 0.000001, completionPrice: 0.000002 })
const target = { id: 'p1', name: 'Scripted', kind: 'custom' as const, baseUrl: 'http://scripted.test/v1', apiKey: 'k' }
const director: JobModel = { job: 'director', target, choice: choice('director'), thinking: 'off' }
const BRIEFING: ChatMessage[] = [
  { role: 'system', content: 'You are a novelist.' },
  { role: 'user', content: 'The briefing: the scene card, the memory, the plan.\n\nNow the prose itself:' }
]
const NO_CHECKS: CheckWorld = { free: null, dreamlike: false, rules: null, beats: null, wearers: [] }

let db: Database.Database | null = null
afterEach(() => {
  db?.close()
  db = null
})

function draft(o: {
  fetch: typeof fetch
  beats?: string[]
  words?: number | null
  checks?: CheckWorld
  model?: JobModel | null
  asks?: string[]
  closing?: string
}) {
  db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const events: { name: keyof AppEvents; payload: unknown }[] = []
  const emit: Emit = (name, payload) => events.push({ name, payload })
  const setup: DirectorSetup = {
    db,
    sceneId,
    plan: planStretches(o.beats ?? ['Mara finds the letter.', 'Tobin knocks at the door.', 'Mara hides the letter.'], o.words === undefined ? 600 : o.words),
    closing: o.closing ?? '',
    asks: o.asks ?? [],
    direction: '',
    carryOn: '',
    checks: o.checks ?? NO_CHECKS,
    model: o.model === undefined ? director : o.model,
    emit,
    fetchImpl: o.fetch,
    retryDelays: [1, 1, 1]
  }
  const preview: ContextPreview = { blocks: [], messages: BRIEFING, budget: { contextLength: 32_000, reserved: 4000, available: 28_000, used: 900 } }
  const started = startDraftJob({
    db,
    sceneId,
    options: { direction: '', targetWords: 600, creativity: 'balanced' },
    preview,
    provider: target,
    model: choice('writer'),
    thinking: 'off',
    entryVersions: new Map(),
    emit,
    stream: directedStream(setup),
    fetchImpl: o.fetch,
    retryDelays: [1, 1, 1]
  })
  const chunks = (): string =>
    events.reduce((t, e) => {
      if (e.name === 'generation:chunk') return t + (e.payload as AppEvents['generation:chunk']).text
      if (e.name === 'generation:takeBack') return t.slice(0, t.length - (e.payload as AppEvents['generation:takeBack']).text.length)
      return t
    }, '')
  return { ...started, events, sceneId, chunks, record: () => gens.getGeneration(db!, started.generationId) }
}

/** The writer lands each beat it is asked for, in a paragraph of its own words. */
const landsBeats = (r: Sent): Answer => ({ text: `${beatAsked(r)} The rain went on against the shutters, steady and cold.` })
const progress = (events: { name: string; payload: unknown }[]) =>
  events.filter((e) => e.name === 'director:progress').map((e) => e.payload as AppEvents['director:progress'])

describe('directed writing: the stretch loop', () => {
  it('writes a stretch a beat; every request starts as the briefing does; the draft so far goes as the writer’s own words', async () => {
    const f = scripted((r) => (isDirector(r) ? verdict('continue') : landsBeats(r)))
    const d = draft({ fetch: f })
    const end = await d.done
    expect(end.status).toBe('complete')
    const writes = f.sent.filter((r) => !isDirector(r))
    expect(writes).toHaveLength(3)
    // The director was never asked: every beat landed and nothing was wrong.
    expect(f.sent.filter(isDirector)).toHaveLength(0)
    // Each request begins with the briefing as it was built.
    for (const w of writes) expect(w.messages[0]).toEqual(BRIEFING[0])
    expect(writes[0].messages[1].content.startsWith(BRIEFING[1].content)).toBe(true)
    expect(writes[0].messages[1].content).toContain('Write only stretch 1 of 3 now, about 200 words: “Mara finds the letter.”')
    expect(writes[1].messages.slice(0, 2)).toEqual(BRIEFING)
    expect(writes[1].messages[2]).toEqual({ role: 'assistant', content: 'Mara finds the letter. The rain went on against the shutters, steady and cold.' })
    expect(writes[1].messages[3].content).toContain('Write stretch 2 of 3, about 200 words: “Tobin knocks at the door.”')
    expect(writes[2].messages[3].content).toContain('This is the last stretch')
    // Each stretch's reply room is sized to its words, well under the draft's own.
    expect(writes[0].max).toBeLessThan(700)
    // One paragraph a stretch, streamed into the page as it came.
    expect(end.text.split('\n\n')).toHaveLength(3)
    expect(d.chunks()).toBe(end.text)
    const rec = d.record()
    expect(rec.params.directed).toEqual({ stretches: 3, retakes: 0, directorCalls: 0, notes: 0 })
    expect(rec.params.steps?.map((s) => s.label)).toEqual(['Stretch 1 of 3 · Carry on', 'Stretch 2 of 3 · Carry on', 'Stretch 3 of 3 · The scene is done'])
    expect(rec.params.steps?.[0].result).toContain('The director wasn’t asked: nothing was wrong or overdue.')
    expect(rec.response).toBe(end.text)
    // The window heard the director's line.
    const lines = progress(d.events).map((p) => p.line)
    expect(lines).toContain('Writing: Mara finds the letter')
    expect(lines).toContain('Carry on — next, Tobin knocks at the door')
  })

  it('stops a stretch at a paragraph’s end past its words, and a sentence cut off by the reply limit never reaches the page', async () => {
    const long = (n: number): string => Array.from({ length: n }, () => 'Mara counted the doors along the wet street.').join(' ')
    const f = scripted((r, n) =>
      isDirector(r)
        ? verdict('continue')
        : n === 1
          ? { text: `${beatAsked(r)} ${long(30)}\n\nThis paragraph is past the stop.` }
          : { text: `${beatAsked(r)} ${long(20)} She looked up and saw the`, finish: 'length' }
    )
    const d = draft({ fetch: f, beats: ['Mara finds the letter.', 'Tobin knocks at the door.'], words: 300 })
    const end = await d.done
    expect(end.text).not.toContain('past the stop')
    expect(end.text).not.toContain('She looked up')
    // Not one chunk sent to the page had it: past the stretch's words, the sentence waited for its end.
    const sent = d.events.filter((e) => e.name === 'generation:chunk').map((e) => (e.payload as AppEvents['generation:chunk']).text).join('')
    expect(sent).not.toContain('She looked up')
    expect(sent).not.toContain('past the stop')
    expect(end.text.endsWith('wet street.')).toBe(true)
  })

  it('cut off early by a model that writes less in one go: the unfinished sentence comes back off the page', async () => {
    const f = scripted((r) => (isDirector(r) ? verdict('continue') : { text: `${beatAsked(r)} The rain kept on. She looked up and saw the`, finish: 'length' }))
    const d = draft({ fetch: f, beats: ['Mara finds the letter.'], words: 200 })
    const end = await d.done
    expect(end.text).toBe('Mara finds the letter. The rain kept on.')
    expect(d.chunks()).toBe(end.text)
  })

  it('a free check’s finding in the last paragraph: the director is asked, and the paragraph taken back and written again', async () => {
    const checks: CheckWorld = { ...NO_CHECKS, wearers: [{ name: 'Mara', names: ['Mara'], pronoun: 'she', clothes: [{ name: 'coat', state: 'off, on the peg' }] }] }
    const f = scripted((r) => {
      if (isDirector(r)) {
        const u = userOf(r)
        return u.includes('[its last paragraph]') && u.includes('so far: 0 of 2') ? verdict('retake', 'Her coat stays on the peg.', 'Mara’s coat is off.') : verdict('continue')
      }
      if (userOf(r).includes('Take your last paragraph again')) return { text: 'Mara held her cold hands to the fire instead.' }
      return { text: `${beatAsked(r)} The fire was low.\n\nMara pulled her coat tighter.` }
    })
    const d = draft({ fetch: f, checks, beats: ['Mara finds the letter.'], words: 200 })
    const end = await d.done
    expect(end.text).toBe('Mara finds the letter. The fire was low.\n\nMara held her cold hands to the fire instead.')
    const back = d.events.filter((e) => e.name === 'generation:takeBack').map((e) => (e.payload as AppEvents['generation:takeBack']).text)
    expect(back).toEqual(['Mara pulled her coat tighter.'])
    const retake = f.sent.find((r) => userOf(r).includes('Take your last paragraph again'))!
    expect(userOf(retake)).toContain('“Mara pulled her coat tighter.”')
    expect(userOf(retake)).toContain('What’s wrong: Mara’s coat is off.')
    // The retake carries on from the paragraph before: the words so far less the paragraph taken back.
    expect(retake.messages[2]).toEqual({ role: 'assistant', content: 'Mara finds the letter. The fire was low.' })
    expect(d.chunks()).toBe(end.text)
    const rec = d.record()
    expect(rec.params.directed).toMatchObject({ retakes: 1, directorCalls: 1 })
    expect(rec.params.steps?.[0].label).toBe('Stretch 1 of 1 · Take the last paragraph again')
    expect(rec.params.steps?.[0].result).toContain('Mara’s coat is off (on the peg), but here')
    expect(rec.params.steps?.[0].result).toContain('Why: Mara’s coat is off.')
    expect(rec.params.steps?.[1].label).toBe('Stretch 1, retake 1 · The scene is done')
  })

  it('with no director model, a slip in the last paragraph is taken again all the same, for free', async () => {
    const checks: CheckWorld = { ...NO_CHECKS, wearers: [{ name: 'Mara', names: ['Mara'], pronoun: 'she', clothes: [{ name: 'coat', state: 'off' }] }] }
    const f = scripted((r) => (userOf(r).includes('Take your last paragraph again') ? { text: 'She sat by the fire.' } : { text: `${beatAsked(r)}\n\nMara buttoned her coat.` }))
    const d = draft({ fetch: f, checks, beats: ['Mara finds the letter.'], words: 200, model: null })
    const end = await d.done
    expect(end.text).toBe('Mara finds the letter.\n\nShe sat by the fire.')
    expect(d.record().params.directed).toMatchObject({ retakes: 1, directorCalls: 0 })
  })

  it('a paragraph is taken again at most twice', async () => {
    const checks: CheckWorld = { ...NO_CHECKS, wearers: [{ name: 'Mara', names: ['Mara'], pronoun: 'she', clothes: [{ name: 'coat', state: 'off' }] }] }
    // The writer makes the same slip every time it writes the paragraph.
    const f = scripted((r) => (isDirector(r) ? verdict('retake', '', 'Still wrong.') : { text: 'Mara finds the letter. Mara pulled her coat tighter.' }))
    const d = draft({ fetch: f, checks, beats: ['Mara finds the letter.'], words: 200 })
    const end = await d.done
    expect(end.status).toBe('complete')
    expect(f.sent.filter((r) => userOf(r).includes('Take your last paragraph again'))).toHaveLength(2)
    const rec = d.record()
    expect(rec.params.directed?.retakes).toBe(2)
    expect(rec.params.steps?.at(-1)?.result).toContain('It has been taken again 2 times already, so it stays as it is.')
  })

  it('the director is asked when a beat is overdue, and its note goes to the next stretch', async () => {
    const f = scripted((r) =>
      isDirector(r) ? verdict('continue', 'Let Tobin knock now, loud.') : { text: beatAsked(r) === 'Mara finds the letter.' ? 'The rain kept on.' : `${beatAsked(r)} It was late.` }
    )
    const d = draft({ fetch: f, beats: ['Mara finds the letter.', 'Tobin knocks at the door.'], words: 300 })
    await d.done
    const asked = f.sent.filter(isDirector)
    expect(asked.length).toBeGreaterThanOrEqual(1)
    expect(userOf(asked[0])).toContain('Beat 1, “Mara finds the letter.”, isn’t on the page yet.')
    const second = f.sent.filter((r) => !isDirector(r))[1]
    expect(userOf(second)).toContain('Director’s note: Let Tobin knock now, loud.')
    expect(progress(d.events).some((p) => p.note === 'Let Tobin knock now, loud.')).toBe(true)
  })

  it('an unreadable reply from the director: decided for free, and the record says so', async () => {
    const f = scripted((r) => (isDirector(r) ? { text: 'It reads nicely.' } : { text: 'The rain kept on.' }))
    const d = draft({ fetch: f, beats: ['Mara finds the letter.'], words: 200 })
    const end = await d.done
    expect(end.status).toBe('complete')
    expect(d.record().params.steps?.[0].result).toContain('The director couldn’t be asked (its answer couldn’t be read)')
  })

  it('never more than twelve stretches, whatever the director says', async () => {
    const beats = Array.from({ length: 14 }, (_, i) => `Beat ${i + 1} happens.`)
    const f = scripted((r) => (isDirector(r) ? verdict('continue', 'Keep going.') : { text: 'Nothing much happened.' }))
    const d = draft({ fetch: f, beats, words: 3000 })
    const end = await d.done
    expect(end.status).toBe('complete')
    expect(f.sent.filter((r) => !isDirector(r))).toHaveLength(MOST_STRETCHES)
    expect(d.record().params.directed?.stretches).toBe(MOST_STRETCHES)
  })

  it('Stop stops it at once: the words so far are kept and nothing more is asked', async () => {
    const f = scripted((r) => (isDirector(r) ? verdict('continue') : { text: `${beatAsked(r)} ${'The rain went on and on. '.repeat(30)}`, ms: 5 }))
    const d = draft({ fetch: f })
    await new Promise((r) => setTimeout(r, 60))
    await stopDraft(d.generationId)
    const end = await d.done
    expect(end.status).toBe('stopped')
    const asked = f.sent.length
    await new Promise((r) => setTimeout(r, 50))
    expect(f.sent.length).toBe(asked)
    expect(end.text.length).toBeGreaterThan(0)
    expect(d.record().status).toBe('stopped')
  })

  it('Adam’s note goes in at the next pause: the director hears it and the writer gets it', async () => {
    let id: ID = ''
    const f = scripted((r, n) => {
      if (isDirector(r)) return verdict('continue', 'Slow the knock down.')
      if (n === 1) setTimeout(() => addNote(id, 'slower'), 0)
      return { ...landsBeats(r), ms: 3 }
    })
    const d = draft({ fetch: f })
    id = d.generationId
    await d.done
    const asked = f.sent.filter(isDirector)
    expect(asked).toHaveLength(1)
    expect(userOf(asked[0])).toContain('The author’s note: “slower”')
    const writes = f.sent.filter((r) => !isDirector(r))
    expect(userOf(writes[1])).toContain('The author’s note, just now: “slower”')
    expect(userOf(writes[2])).not.toContain('“slower”')
    expect(d.record().params.directed?.notes).toBe(1)
    expect(progress(d.events).find((p) => p.taken?.length)?.taken).toEqual(['slower'])
    expect(d.record().params.steps?.[0].result).toContain('Your notes: “slower”')
  })

  it('a note for a draft that has ended goes nowhere', async () => {
    const f = scripted((r) => (isDirector(r) ? verdict('continue') : landsBeats(r)))
    const d = draft({ fetch: f, beats: ['Mara finds the letter.'], words: 200 })
    await d.done
    expect(addNote(d.generationId, 'slower')).toBe(false)
  })
})
