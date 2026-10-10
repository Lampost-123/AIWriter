import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import type { ChapterWriterProgress } from '@shared/contracts/chapterWriter'
import { ALL_CHECKS } from '@shared/contracts/checks'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { JobModel } from '../ai/jobModel'
import { checkScene } from '../checks/run'
import { runCritique } from '../critique/run'
import { pageFrom, proseBlocks } from './page'
import { ProgressGuard, findingKey } from './progress'
import { ChapterRun, cardReady, type RunDeps } from './run'
import { ChapterSession, type Finding } from './tools'
import { loadBefore, loadReport } from './store'
import { critiqueAsk } from '../critique/prompts'

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 1 })
})
afterAll(() => fake.close())

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

const model = (modelId = 'fake/writer', job: JobModel['job'] = 'chapter'): JobModel => ({
  job,
  target: { id: 'p1', name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' },
  choice: { providerId: 'p1', modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null },
  thinking: 'off'
})

const DRAFTS: Record<number, string> = {
  1: 'The ferry came in late under a low sky. Mara stood at the rail and counted the lamps on the shore.\n\n"You\'re late," said Tobin. He did not look up from the rope.',
  2: 'The inn was full and loud. Nobody made room for her at the fire.\n\nShe took the stairs two at a time and locked the door behind her.'
}

/** A chapter of two scenes with cards, Mara and Tobin in the memory, and old words in the first scene. */
function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const chapterId = outline.chapters[0].id
  const s1 = outline.scenes[0].id
  repo.updateScene(db, s1, { title: 'The ferry' })
  const s2 = repo.createScene(db, chapterId, { title: 'The inn' }).id
  repo.createEntry(db, 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  repo.updateSceneCard(db, s1, { ...repo.getScene(db, s1).card, goal: 'Mara meets Tobin at the ferry.' })
  repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, beats: ['Mara finds no room at the inn.'] })
  repo.saveSceneText(db, s1, null, 'Old words in the first scene.')
  return { db, storyId: story.id, chapterId, s1, s2 }
}

function deps(db: RunDeps['db'], o: { again?: boolean; agent?: string; progress?: ChapterWriterProgress[] } = {}): RunDeps {
  let n = 0
  const order = new Map<ID, number>()
  return {
    db,
    agentModel: model(o.agent ?? 'fake/writer'),
    prefs: PREFS,
    taskEmit: () => undefined,
    progress: (p) => o.progress?.push(p),
    sceneChanged: () => undefined,
    draft: async (sceneId) => {
      if (!order.has(sceneId)) order.set(sceneId, ++n)
      return { status: 'complete', text: DRAFTS[order.get(sceneId)!] ?? DRAFTS[1], error: null }
    },
    save: (sceneId, page) => {
      repo.saveSceneText(db, sceneId, page.doc, page.text)
    },
    check: async (sceneId) => {
      const r = await checkScene({ db, model: model('fake/writer', 'check'), prefs: PREFS, stopped: () => false, retryDelays: [] }, sceneId, ALL_CHECKS)
      return r.status === 'error' ? { status: 'error', error: r.error } : { status: r.status }
    },
    critique: (target, again) =>
      runCritique({ db, model: model('fake/writer', 'writer'), prefs: PREFS, emit: () => undefined, retryDelays: [] }, { taskId: crypto.randomUUID(), target, again: o.again === false ? false : again }),
    limitNote: () => null,
    closed: () => false,
    retryDelays: []
  }
}

describe('pages built in the main process', () => {
  it('splits prose into paragraphs and scene breaks, with italics as marks', () => {
    expect(proseBlocks('One.\n\n* * *\n\nTwo *now*.')).toEqual([{ rule: false, words: 'One.' }, { rule: true }, { rule: false, words: 'Two *now*.' }])
    const p = pageFrom('One.\n\nTwo *now*.')
    expect(p.text).toBe('One.\n\nTwo now.')
    const second = (p.doc!.content[1] as { content: { text: string; marks?: { type: string }[] }[] }).content
    expect(second.find((c) => c.text === 'now')?.marks).toEqual([{ type: 'italic' }])
  })

  it('keeps the ids of paragraphs whose words did not change, and gives changed ones new ids', () => {
    const first = pageFrom('Alpha.\n\nBeta.\n\nGamma.')
    const ids = first.doc!.content.map((b) => (b.type === 'paragraph' ? b.attrs.pid : ''))
    const again = pageFrom('Alpha.\n\nBeta, changed.\n\nGamma.', first.doc)
    const now = again.doc!.content.map((b) => (b.type === 'paragraph' ? b.attrs.pid : ''))
    expect(now[0]).toBe(ids[0])
    expect(now[2]).toBe(ids[2])
    expect(now[1]).not.toBe(ids[1])
    expect(new Set(now).size).toBe(3)
  })

  it('reads a streamed draft as the editor does: any line break starts a paragraph', () => {
    expect(pageFrom('One.\nTwo.', null, 'paragraphs').text).toBe('One.\n\nTwo.')
    expect(pageFrom('One.\nTwo.', null, 'breaks').text).toBe('One.\nTwo.')
  })
})

describe('the progress guard', () => {
  it('stops when the same findings are left three rounds running, or the words come back', () => {
    const g = new ProgressGuard()
    const f = [findingKey('s', 'The middle slows', 'quote')]
    expect(g.round(f, 'a')).toBeNull()
    expect(g.round(f, 'b')).toBeNull()
    expect(g.round(f, 'c')).toBe('same')
    const h = new ProgressGuard()
    expect(h.round(f, 'a')).toBeNull()
    expect(h.round([findingKey('s', 'Other', '')], 'b')).toBeNull()
    expect(h.round(f, 'a')).toBe('circle')
    // Clean words seen before are fine.
    expect(new ProgressGuard().round([], 'a')).toBeNull()
  })
})

describe('the critic reading again', () => {
  it('is told it may find the work ready', () => {
    expect(critiqueAsk('chapter', 'One', true)).toMatch(/This is a re-read/)
    expect(critiqueAsk('chapter', 'One')).not.toMatch(/re-read/)
  })
})

describe('a scene card ready to write from', () => {
  it('needs a goal, conflict, outcome, notes or a beat', () => {
    const { db, s1, s2 } = world()
    expect(cardReady(repo.getScene(db, s1).card)).toBe(true)
    expect(cardReady(repo.getScene(db, s2).card)).toBe(true)
    expect(cardReady({ ...repo.getScene(db, s1).card, goal: '' })).toBe(false)
  })
})

describe('writing a whole chapter', () => {
  it('studies, drafts each scene, fixes what the checks and the critic find, proofreads, and ends clean', { timeout: 30_000 }, async () => {
    const { db, chapterId, s1, s2 } = world()
    const progress: ChapterWriterProgress[] = []
    const run = new ChapterRun(deps(db, { progress }), 'run-1', chapterId)
    run.prepare()
    // The words before the run are kept for Undo.
    expect(loadBefore(db, chapterId).find((b) => b.sceneId === s1)?.text).toBe('Old words in the first scene.')
    const report = await run.run()
    expect(report.status).toBe('done')
    expect(report.message).toBe('')
    expect(report.brief).toContain('Keep Sc 1 true to the memory.')
    expect(report.questions).toEqual(["Sc 1's card has Mara at the inn; the memory has her at the ferry."])
    // Round 1 found the critic's notes; round 2 (a re-read) found nothing; the proofread changed nothing.
    expect(report.rounds).toBe(2)
    expect(report.scenes.find((s) => s.sceneId === s1)?.fixed[0]?.why).toBe('Tightened the middle.')
    expect(repo.getScene(db, s1).text).toContain('The rain went on.')
    expect(repo.getScene(db, s2).text.startsWith('The inn was full')).toBe(true)
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['study', 'drafting', 'checking', 'reviewing', 'proofreading']))
    expect(loadReport(db, chapterId)?.status).toBe('done')
  })

  it('stops, saying so, when a round leaves the same findings again and again', async () => {
    const { db, chapterId } = world()
    // A critic that never finds the chapter ready.
    const run = new ChapterRun(deps(db, { again: false }), 'run-2', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('stuck')
    expect(report.message).toMatch(/couldn't settle/)
    expect(report.left.length).toBeGreaterThan(0)
    expect(report.rounds).toBe(3)
  }, 30_000)

  it('keeps what was written when stopped', async () => {
    const { db, chapterId, s1 } = world()
    const d = deps(db)
    let run: ChapterRun | null = null
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      const r = await draft(sceneId, o)
      void run!.stop()
      return r
    }
    run = new ChapterRun(d, 'run-3', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('stopped')
    expect(report.message).toMatch(/Undo puts the chapter back/)
    // Stopped once the first draft came back, before it was saved.
    expect(repo.getScene(db, s1).text).toBe('Old words in the first scene.')
  })

  it('refuses to start without a scene card to write from', () => {
    const { db, chapterId, s1, s2 } = world()
    for (const id of [s1, s2]) repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, goal: '', beats: [] })
    expect(() => new ChapterRun(deps(db), 'run-4', chapterId).prepare()).toThrow(/scene card to write from/)
  })
})

describe('setting a finding aside', () => {
  const session = (db: RunDeps['db'], storyId: ID, chapterId: ID, s1: ID, findings: Finding[]) =>
    new ChapterSession({
      db,
      job: 'review',
      storyId,
      chapterId,
      sceneId: s1,
      scenes: [{ id: s1, n: 1, title: 'The ferry', label: 'Sc 1 “The ferry”' }],
      prefs: PREFS,
      findings,
      nextFinding: () => 'F9',
      brief: () => '',
      save: (id, page) => repo.saveSceneText(db, id, page.doc, page.text),
      rewrite: async () => ({ ok: false, error: 'no' }),
      checkAgain: async () => [],
      setAsideNote: () => undefined,
      noted: { fix: () => undefined, setAside: () => undefined, rewritten: () => undefined }
    })

  it('needs words quoted from the story or the memory, and then marks the issue ignored', async () => {
    const { db, storyId, chapterId, s1 } = world()
    repo.saveSceneText(db, s1, null, 'Mara stood at the rail. Her eyes were grey in the lamplight.')
    cdb.saveFound(
      db,
      [],
      [{ sceneId: s1, storyId, kind: 'fact', severity: 'warning', quote: 'Her eyes were grey', message: 'Mara’s eyes are blue in the memory.', key: 'k1', payload: { key: 'k1', by: 'check', check: 'facts' } }],
      () => false
    )
    const row = cdb.sceneIssueRows(db, s1).find((r) => r.status === 'open')!
    const f: Finding = { id: 'F1', sceneId: s1, from: 'check', issueId: row.id as ID, kind: 'worth a look · facts', what: 'Eyes', quote: 'Her eyes were grey', advice: '', status: 'open' }
    const s = session(db, storyId, chapterId, s1, [f])
    const call = (args: Record<string, unknown>) => s.runAll([{ id: 'c', name: 'not_a_problem', arguments: JSON.stringify(args) }])
    let r = await call({ finding: 'F1', why: 'It is fine.' })
    expect(r.results[0].content).toMatch(/^Not set aside: quote/)
    r = await call({ finding: 'F1', why: 'The memory says "made up words here" so it fits.' })
    expect(r.results[0].content).toMatch(/aren’t in the story or the memory/)
    r = await call({ finding: 'F1', why: 'The scene says "eyes were grey in the lamplight" so it is the light.' })
    expect(r.results[0].content).toMatch(/is set aside/)
    expect(f.status).toBe('set-aside')
    expect(cdb.issueRow(db, row.id as ID)?.status).toBe('ignored')
  })

  it('turns done down while findings are open, twice, then lets it end', async () => {
    const { db, storyId, chapterId, s1 } = world()
    const f: Finding = { id: 'F1', sceneId: s1, from: 'critic', issueId: null, kind: 'critic · pacing · high', what: 'Slow', quote: '', advice: '', status: 'open' }
    const s = session(db, storyId, chapterId, s1, [f])
    const done = () => s.runAll([{ id: 'd', name: 'done', arguments: '{"summary":"All done."}' }])
    expect((await done()).results[0].content).toMatch(/^Not done: still open: F1/)
    expect((await done()).results[0].content).toMatch(/^Not done/)
    expect((await done()).results[0].content).toMatch(/^Done\./)
    expect(s.ended()).toBe('All done.')
  })
})
