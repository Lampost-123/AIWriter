import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { countWords } from '@shared/defaults'
import { defaultStyleGuide } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { JobModel } from '../ai/jobModel'
import { UserError } from '../util'
import { anchorQuote, categoryOf, critiqueNotes, readCritiqueReply, weightOf } from './parse'
import {
  castFor,
  castText,
  chapterTextForms,
  critiqueSystem,
  sceneTextForms,
  shortened,
  storyLines,
  CRITIQUE_MARKER,
  MAX_NOTES
} from './prompts'
import { critiqueBriefing, fitCritique, runCritique, type CritiqueDeps } from './run'
import { critiqueKey, loadCritique, saveCritique, savedCritique, textsHash } from './store'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1 })
})
afterAll(() => fake.close())

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

const model = (modelId = 'fake/writer', contextLength = 32000): JobModel => ({
  job: 'writer',
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' },
  choice: { providerId: 'p1', modelId, label: modelId, contextLength, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

const SCENE_1 = `The ferry came in late. Mara stood at the rail and counted the lamps on the shore.

"You're late," said Tobin. He did not look up from the rope.`

const SCENE_2 = `The inn was full. Nobody made room for her at the fire.

She took the stairs two at a time and locked the door behind her.`

/** A chapter of two scenes, with Mara and Tobin in the memory. */
function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const chapterId = outline.chapters[0].id
  const s1 = outline.scenes[0].id
  const s2 = repo.createScene(db, chapterId, { title: 'The inn' }).id
  repo.createEntry(db, 'character', { name: 'Mara', summary: 'Runs the ferry.', fields: { speech: 'Short and dry.' } })
  repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  repo.createEntry(db, 'character', { name: 'Osric', summary: 'Never in these scenes.' })
  repo.saveSceneText(db, s1, null, SCENE_1)
  repo.saveSceneText(db, s2, null, SCENE_2)
  return { db, storyId: story.id, chapterId, s1, s2 }
}

const deps = (db: CritiqueDeps['db'], m = model()): CritiqueDeps => ({ db, model: m, prefs: PREFS, emit: () => undefined, retryDelays: [] })

describe('the critic’s instructions', () => {
  it('start with the marker, ask for craft not continuity, and cap the notes', () => {
    const scene = critiqueSystem('scene')
    expect(scene.startsWith(`${CRITIQUE_MARKER} scene`)).toBe(true)
    expect(scene).toMatch(/don't check facts or continuity/)
    expect(scene).toContain(`At most ${MAX_NOTES} notes`)
    expect(scene).toMatch(/Show and tell/)
    const chapter = critiqueSystem('chapter')
    expect(chapter.startsWith(`${CRITIQUE_MARKER} chapter`)).toBe(true)
    expect(chapter).toMatch(/pull to read on/)
    expect(chapter).toMatch(/quote only words that are shown/)
  })

  it('say how the story is written in a few lines: genre, tone, point of view and tense', () => {
    const style = { ...defaultStyleGuide(), genres: ['fantasy'], pov: 'Close third', tense: 'Past' }
    const text = storyLines({ title: 'The Ferry', style, tone: 'Quiet and cold' })
    expect(text).toMatch(/^Title: The Ferry/)
    expect(text).toMatch(/Genre: Fantasy \(/)
    expect(text).toContain('Tone: Quiet and cold')
    expect(text).toContain('Point of view: Close third')
    expect(text).toContain('Tense: Past')
    expect(storyLines({ title: '', style: defaultStyleGuide(), tone: '' })).toBe('Title: Untitled story')
  })

  it('name only who is on the card or in the words, with how a character speaks', () => {
    const { db } = world()
    const entries = repo.listEntries(db)
    const cast = castFor(entries, SCENE_1)
    expect(cast.map((e) => e.name)).toEqual(['Mara', 'Tobin'])
    expect(castText(cast, 12, true)).toContain('- Mara (character): Runs the ferry. Speaks: Short and dry.')
    expect(castText(cast, 1, false)).toBe('- Mara (character): Runs the ferry.')
    const osric = entries.find((e) => e.name === 'Osric')!
    expect(castFor(entries, SCENE_1, [osric.id])[0].name).toBe('Osric')
  })
})

describe('long words, shortened', () => {
  const para = (n: number, word: string): string => Array.from({ length: n }, () => word).join(' ') + '.'
  const long = Array.from({ length: 20 }, (_, i) => para(50, `w${i}`)).join('\n\n')

  it('keeps the opening and the ending, whole paragraphs, and says how much was left out', () => {
    const out = shortened(long, 300)
    expect(out.startsWith('w0 w0')).toBe(true)
    expect(out.trimEnd().endsWith('w19.')).toBe(true)
    expect(out).toMatch(/\[… 700 words left out …\]/)
    expect(countWords(out)).toBeLessThan(330)
    expect(shortened('A short scene.', 300)).toBe('A short scene.')
  })

  it('gives a long scene shorter forms, and a short one only its whole text', () => {
    expect(sceneTextForms(SCENE_1)).toEqual([SCENE_1])
    const forms = sceneTextForms(long)
    expect(forms).toHaveLength(3)
    expect(forms[0]).toBe(long)
    expect(countWords(forms[2])).toBeLessThan(countWords(forms[1]))
  })

  it('gives a chapter forms down to its scenes’ summaries', () => {
    const forms = chapterTextForms([
      { title: 'The ferry', text: long, summary: 'Mara crosses the river.' },
      { title: 'The inn', text: SCENE_2, summary: '' }
    ])
    expect(forms).toHaveLength(5)
    expect(forms[0]).toMatch(/^### Scene 1: The ferry \(about 1,000 words\)/)
    expect(forms[0]).toContain('### Scene 2: The inn')
    expect(forms[2]).toContain('Summary: Mara crosses the river.')
    expect(forms[2]).toContain('words left out')
    // A short scene stays whole until only summaries are left.
    expect(forms[3]).toContain(SCENE_2.trim())
    expect(forms[4]).toContain('Summary: Mara crosses the river.')
    expect(forms[4]).not.toContain('w5 w5')
  })
})

describe('reading the reply', () => {
  const texts = [
    { sceneId: 's1', text: SCENE_1 },
    { sceneId: 's2', text: SCENE_2 }
  ]

  it('reads the JSON object, forgiving a fence, and says what was wrong otherwise', () => {
    const ok = readCritiqueReply('```json\n{"summary": "Fine.", "strengths": "The rope.", "notes": []}\n```')
    expect(ok).toEqual({ ok: true, value: { summary: 'Fine.', strengths: ['The rope.'], notes: [] } })
    expect(readCritiqueReply('I liked it.').ok).toBe(false)
    expect(readCritiqueReply('{"notes": "lots"}')).toEqual({ ok: false, why: 'its "notes" was not a list' })
    expect(readCritiqueReply('{"other": 1}')).toEqual({ ok: false, why: 'it had no "summary" and no "notes"' })
  })

  it('reads the words models use for categories and weights', () => {
    expect(categoryOf('Show vs tell')).toBe('show-tell')
    expect(categoryOf('stakes')).toBe('tension')
    expect(categoryOf('Character voice')).toBe('voice')
    expect(categoryOf('ending hook')).toBe('pull')
    expect(categoryOf('transitions')).toBe('flow')
    expect(categoryOf('repetition')).toBe('prose')
    expect(categoryOf('show-tell')).toBe('show-tell')
    expect(categoryOf('weather')).toBe('other')
    expect(weightOf('High')).toBe('high')
    expect(weightOf('major')).toBe('high')
    expect(weightOf('minor')).toBe('low')
    expect(weightOf('')).toBe('medium')
  })

  it('anchors a quote in the scene it is in, as the scene’s own words, with which appearance', () => {
    expect(anchorQuote(texts, '"you\'re late," said Tobin.')).toEqual({
      sceneId: 's1',
      quote: '"You\'re late," said Tobin.',
      occurrence: 0
    })
    expect(anchorQuote(texts, 'locked the door behind her')).toEqual({ sceneId: 's2', quote: 'locked the door behind her', occurrence: 0 })
    expect(anchorQuote(texts, 'Words that are nowhere.')).toBeNull()
    const twice = [{ sceneId: 's1', text: 'He waited. Then he waited. Then he left.' }]
    expect(anchorQuote(twice, 'Then he waited.')?.occurrence).toBe(0)
    expect(anchorQuote([{ sceneId: 's1', text: 'He left. He left. He left.' }], 'He left.')?.occurrence).toBe(0)
  })

  it('keeps notes with words, takes a made-up quote off its note, puts what matters most first, and caps them', () => {
    const notes = critiqueNotes(
      [
        { category: 'prose', weight: 'low', title: 'Filler', quote: 'He did not look up from the rope.', suggestion: 'Cut "did not".' },
        { category: 'pacing', weight: 'high', title: 'Slow start', quote: 'Words that are nowhere.', suggestion: 'Start at the rail.' },
        { category: 'prose', weight: 'low', title: 'Filler', quote: 'He did not look up from the rope.', suggestion: 'Again.' },
        { title: '', suggestion: '' },
        ...Array.from({ length: 12 }, (_, i) => ({
          category: 'clarity',
          weight: 'medium',
          title: `Note ${i}`,
          quote: '',
          suggestion: 'Say more.'
        }))
      ],
      texts
    )
    expect(notes).toHaveLength(MAX_NOTES)
    expect(notes[0]).toMatchObject({
      id: 'n1',
      title: 'Slow start',
      weight: 'high',
      quote: '',
      sceneId: null,
      suggestion: 'Start at the rail.'
    })
    expect(notes.filter((n) => n.title === 'Filler')).toHaveLength(0)
    expect(notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'])
    const few = critiqueNotes(
      [{ category: 'prose', weight: 'low', title: 'Filler', quote: 'He did not look up from the rope.', suggestion: 'Cut it.' }],
      texts
    )
    expect(few[0]).toMatchObject({ quote: 'He did not look up from the rope.', sceneId: 's1', category: 'prose', weight: 'low' })
  })
})

describe('the briefing', () => {
  it('tells a scene’s critic its card, cast, place in the chapter and words; the chapter’s, every scene', () => {
    const { db, s1, chapterId } = world()
    const scene = critiqueBriefing(db, { scope: 'scene', id: s1 }, PREFS)
    expect(scene.system.startsWith(`${CRITIQUE_MARKER} scene`)).toBe(true)
    expect(scene.sceneId).toBe(s1)
    const text = (id: string) => scene.drafts.find((d) => d.id === id)!.forms[0]
    expect(text('where')).toMatch(/scene 1 of 2/)
    expect(text('cast')).toContain('Mara')
    expect(text('cast')).not.toContain('Osric')
    expect(text('text')).toBe(SCENE_1)
    const chapter = critiqueBriefing(db, { scope: 'chapter', id: chapterId }, PREFS)
    expect(chapter.sceneId).toBe('')
    expect(chapter.texts).toHaveLength(2)
    expect(chapter.drafts.find((d) => d.id === 'text')!.forms[0]).toMatch(/### Scene 2: The inn/)
    expect(chapter.drafts.find((d) => d.id === 'before')!.forms[0]).toBe('')
  })

  it('a scene with no words is said plainly, before anything is asked', () => {
    const { db, chapterId } = world()
    const empty = repo.createScene(db, chapterId, { title: 'Later' }).id
    expect(() => critiqueBriefing(db, { scope: 'scene', id: empty }, PREFS)).toThrow(/no words yet/)
  })

  it('shortens a long chapter for a small model rather than refusing it', () => {
    const { db, chapterId, s1 } = world()
    const long = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i} goes on and on about the river and the rain and the rope for a while.`
    ).join('\n\n')
    repo.saveSceneText(db, s1, null, long.repeat(3))
    mem.putSummary(db, { level: 'scene', targetId: s1, text: 'Mara crosses the river.', origin: 'ai' })
    const b = critiqueBriefing(db, { scope: 'chapter', id: chapterId }, PREFS)
    const fitted = fitCritique(b, model('fake/8k', 8000))
    const block = fitted.blocks.find((x) => x.id === 'text')!
    expect(block.dropped).toBe(false)
    expect(block.short).toBe(true)
    expect(block.text).toContain('words left out')
    // Nothing fits a model this small.
    expect(() => fitCritique(b, model('fake/small', 3000))).toThrow(UserError)
  })
})

describe('a critique, end to end', () => {
  it('asks the writer model, keeps its notes found in the words, and saves it for the scene', async () => {
    const { db, s1 } = world()
    const out = await runCritique(deps(db), { taskId: 't1', target: { scope: 'scene', id: s1 } })
    expect(out.status).toBe('complete')
    if (out.status !== 'complete') return
    const c = out.critique
    expect(c.summary).toBe('The scene moves well, but its middle slows.')
    expect(c.strengths).toEqual(['The opening line sets the mood at once.'])
    expect(c.notes.map((n) => [n.title, n.quote, n.sceneId])).toEqual([
      ['The middle slows', 'Mara stood at the rail and counted the lamps on the shore.', s1],
      ['A quote from nowhere', '', null]
    ])
    expect(c.shortened).toBe(false)
    const rec = db.prepare('SELECT job, scene_id AS sceneId FROM generations WHERE id = ?').get(c.generationId) as {
      job: string
      sceneId: ID
    }
    expect(rec).toEqual({ job: 'critique', sceneId: s1 })
    expect(savedCritique(db, { scope: 'scene', id: s1 })).toEqual({ critique: c, changed: false })
  })

  it('a chapter’s notes point into the scene their words are in', async () => {
    const { db, chapterId, s1, s2 } = world()
    const out = await runCritique(deps(db), { taskId: 't2', target: { scope: 'chapter', id: chapterId } })
    if (out.status !== 'complete') throw new Error(out.status)
    expect(out.critique.notes.map((n) => [n.title, n.sceneId])).toEqual([
      ['The middle slows', s1],
      ['The ending could pull harder', s2],
      ['A quote from nowhere', null]
    ])
    const rec = db.prepare('SELECT scene_id AS sceneId FROM generations WHERE id = ?').get(out.critique.generationId) as { sceneId: ID }
    expect(rec.sceneId).toBe('')
  })

  it('a reply that isn’t JSON is asked for once more', async () => {
    const { db, s1 } = world()
    const out = await runCritique(deps(db, model('fake/critique-bad-json')), { taskId: 't3', target: { scope: 'scene', id: s1 } })
    expect(out.status).toBe('complete')
    expect((db.prepare("SELECT COUNT(*) AS n FROM generations WHERE job = 'critique'").get() as { n: number }).n).toBe(2)
  })

  it('a provider’s problem comes back in plain words, and nothing is kept', async () => {
    const { db, s1 } = world()
    const out = await runCritique(deps(db, model('fake/credit')), { taskId: 't4', target: { scope: 'scene', id: s1 } })
    expect(out.status).toBe('error')
    expect(loadCritique(db, { scope: 'scene', id: s1 })).toBeNull()
  })
})

describe('keeping the latest critique', () => {
  it('keeps one per scene and per chapter, and says when the words changed since', () => {
    const { db, s1, chapterId } = world()
    const texts = [{ sceneId: s1, text: SCENE_1 }]
    const base = { strengths: [], notes: [], at: '2026-10-09T10:00:00.000Z', shortened: false, generationId: null }
    saveCritique(db, { ...base, scope: 'scene', targetId: s1, summary: 'First.', textHash: textsHash(texts) })
    saveCritique(db, { ...base, scope: 'scene', targetId: s1, summary: 'Second.', textHash: textsHash(texts) })
    expect(repo.getMeta(db, critiqueKey({ scope: 'scene', id: s1 }))).toContain('Second.')
    expect(savedCritique(db, { scope: 'scene', id: s1 })).toMatchObject({ critique: { summary: 'Second.' }, changed: false })
    expect(savedCritique(db, { scope: 'chapter', id: chapterId })).toBeNull()
    repo.saveSceneText(db, s1, null, `${SCENE_1} One more line.`)
    expect(savedCritique(db, { scope: 'scene', id: s1 })?.changed).toBe(true)
  })

  it('a chapter’s critique changes with any of its scenes, and goes with a deleted scene', () => {
    const { db, s1, s2, chapterId } = world()
    const texts = [
      { sceneId: s1, text: SCENE_1 },
      { sceneId: s2, text: SCENE_2 }
    ]
    const base = { strengths: [], notes: [], at: '2026-10-09T10:00:00.000Z', shortened: false, generationId: null }
    saveCritique(db, { ...base, scope: 'chapter', targetId: chapterId, summary: 'Ch.', textHash: textsHash(texts) })
    saveCritique(db, { ...base, scope: 'scene', targetId: s2, summary: 'Sc.', textHash: textsHash([texts[1]]) })
    expect(savedCritique(db, { scope: 'chapter', id: chapterId })?.changed).toBe(false)
    repo.saveSceneText(db, s2, null, 'All new.')
    expect(savedCritique(db, { scope: 'chapter', id: chapterId })?.changed).toBe(true)
    repo.deleteScene(db, s2)
    expect(savedCritique(db, { scope: 'scene', id: s2 })).toBeNull()
  })

  it('a kept critique that can’t be read counts as none', () => {
    const { db, s1 } = world()
    repo.setMeta(db, critiqueKey({ scope: 'scene', id: s1 }), '{not json')
    expect(loadCritique(db, { scope: 'scene', id: s1 })).toBeNull()
    repo.setMeta(db, critiqueKey({ scope: 'scene', id: s1 }), JSON.stringify({ scope: 'scene' }))
    expect(loadCritique(db, { scope: 'scene', id: s1 })).toBeNull()
  })
})
