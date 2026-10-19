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
import { dropRepeats, pageFrom, proseBlocks } from './page'
import { ProgressGuard, Tries, findingKey, sameFinding, wordsOverlap } from './progress'
import { ChapterRun, LATER_START, cardReady, type RunDeps } from './run'
import { LOOKUPS_ALLOWED, STEPS, studySystem } from './prompts'
import { ChapterSession, type Finding, type SessionDeps } from './tools'
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
      runCritique({ db, model: model('fake/writer', 'writer'), prefs: PREFS, emit: () => undefined, retryDelays: [] }, { taskId: crypto.randomUUID(), target, again: o.again === false ? false : again, by: 'chapter-writer' }),
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

describe('a finding that keeps coming back', () => {
  const f = (o: Partial<Parameters<typeof sameFinding>[0]> = {}) => ({ sceneId: 's', from: 'check', kind: 'must fix · timeline', what: 'The ferry is late.', quote: 'The ferry came in late under a low sky.', ...o })

  it('is the same finding when said in other words about the same words, whatever its severity', () => {
    expect(sameFinding(f(), f({ what: 'Late ferry again.', kind: 'worth a look · timeline' }))).toBe(true)
    expect(sameFinding(f(), f({ what: 'Late ferry again.', kind: 'must fix · facts' }))).toBe(false)
    expect(sameFinding(f(), f({ what: 'Late ferry again.', quote: 'Tobin did not look up.' }))).toBe(false)
    expect(sameFinding(f(), f({ sceneId: 't' }))).toBe(false)
    expect(sameFinding(f({ from: 'critic', kind: 'critic · pacing · high' }), f({ from: 'critic', kind: 'critic · pacing · low', what: 'Slow' }))).toBe(true)
    expect(wordsOverlap('He said the ferry came in late under a low sky, and left.', 'The ferry came in late under a low sky.')).toBe(true)
    expect(wordsOverlap('The ferry came in.', 'A ferry went out.')).toBe(false)
  })

  it('is given twice at most, once when it is on words the AI wrote, and never again once set aside', () => {
    const t = new Tries()
    expect(t.verdict(f(), false)).toBe('give')
    t.given(f())
    expect(t.verdict(f({ what: 'Still late.' }), false)).toBe('give')
    expect(t.verdict(f({ what: 'Still late.' }), true)).toBe('leave')
    t.given(f({ what: 'Still late.' }))
    expect(t.verdict(f(), false)).toBe('leave')
    const other = f({ what: 'Her eyes are grey.', kind: 'must fix · facts', quote: 'Her eyes were grey.' })
    t.setAside(other)
    expect(t.verdict(other, false)).toBe('skip')
  })
})

describe('a sentence printed twice in a row', () => {
  const once = 'She got the cord up over her collar and freed it.'
  it('is taken out the second time, within a paragraph or at the start of the next', () => {
    expect(dropRepeats(`${once} ${once} Come here.`)).toEqual({ text: `${once} Come here.`, dropped: [once] })
    expect(dropRepeats(`Before. ${once}\n\n${once} Come here.`).text).toBe(`Before. ${once}\n\nCome here.`)
    expect(dropRepeats(`${once}\n\n${once}\n\nAfter.`).text).toBe(`${once}\n\nAfter.`)
    expect(dropRepeats(`${once} ${once} ${once}`).text).toBe(once)
    // Italics and curly quotes don't hide a copy.
    expect(dropRepeats(`‘I said *no* to him today,’ she said. ‘I said no to him today,’ she said.`).text).toBe('‘I said *no* to him today,’ she said.')
  })

  it('is left when short, not next to its copy, or when taking it out would leave italics open', () => {
    expect(dropRepeats('No. No. Not now.').dropped).toEqual([])
    expect(dropRepeats(`${once} Then she waited. ${once}`).dropped).toEqual([])
    expect(dropRepeats(`*${once} ${once}* After.`).dropped).toEqual([])
  })
})

describe('how far each session goes', () => {
  it('keeps sessions short (token audit, 2026-10-19), with requests left to act after every look-up it may make', () => {
    expect(STEPS).toEqual({ study: 10, review: 12, chapter: 14, proofread: 6 })
    expect(LOOKUPS_ALLOWED).toEqual({ study: 15, review: 8, chapter: 10, proofread: 0 })
    // A model asks for about three look-ups a request; then it still has two requests to write the brief or fix.
    for (const job of ['study', 'review', 'chapter', 'proofread'] as const) expect(Math.ceil(LOOKUPS_ALLOWED[job] / 3) + 2).toBeLessThanOrEqual(STEPS[job])
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

  it('waits for the memory to finish the scene before drafting the next, and says so', async () => {
    const { db, chapterId, s2 } = world()
    const progress: ChapterWriterProgress[] = []
    const d = deps(db, { progress })
    const waited: string[] = []
    d.catchUp = async (sceneId) => {
      await new Promise((r) => setTimeout(r, 20))
      waited.push(sceneId)
    }
    const drafted: string[] = []
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      drafted.push(`${sceneId}:${waited.join(',')}`)
      return draft(sceneId, o)
    }
    const run = new ChapterRun(d, 'run-wait', chapterId)
    run.prepare()
    await run.run()
    // Only before the second scene (the first has nothing of this run before it), and before its draft began.
    expect(waited[0]).toBe(s2)
    expect(drafted).toContain(`${s2}:${s2}`)
    expect(progress.some((p) => /^Updating memory with .+ before writing /.test(p.note))).toBe(true)
  })

  it('asks the critic in the first round only, then once more at the end for Adam, so a critic never satisfied still settles', async () => {
    const { db, chapterId, s1, s2 } = world()
    // A critic that never finds the chapter ready (live test, 2026-10-16: new notes at every re-read, 14 rounds).
    const d = deps(db, { again: false })
    const asked: string[] = []
    const critique = d.critique
    d.critique = (target, again, signal) => {
      asked.push(`${target.scope === 'chapter' ? 'chapter' : target.id === s1 ? 's1' : 's2'}${again ? ' again' : ''}`)
      return critique(target, again, signal)
    }
    const run = new ChapterRun(d, 'run-2', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    expect(report.rounds).toBe(2)
    // Round 1 reads every scene and the chapter; round 2 none; the last read, the scenes changed and the chapter.
    expect(asked).toEqual(['s1', 's2', 'chapter', 's1 again', 's2 again', 'chapter again'])
    expect(report.notes?.at(-1)).toMatch(/^The critic read the changed scenes once more at the end and has \d+ more notes \(Sc 1 “The ferry”: \d+, Sc 2 “The inn”: \d+, the chapter: \d+\)\. They are in the Critique tab for you to weigh: the AI didn't act on them\.$/)
    expect(repo.getScene(db, s2).text).toContain('The rain went on.')
  }, 30_000)

  it('never asks the critic when Adam has switched it off, and still checks and finishes the chapter (2026-10-17)', async () => {
    const { db, chapterId } = world()
    const d = deps(db, { again: false })
    let asked = 0
    let checked = 0
    const check = d.check
    d.critique = () => {
      asked++
      throw new Error('the critic should not be asked')
    }
    d.check = (sceneId, signal) => {
      checked++
      return check(sceneId, signal)
    }
    d.critic = () => false
    const progress: ChapterWriterProgress[] = []
    d.progress = (p) => progress.push(p)
    const run = new ChapterRun(d, 'run-no-critic', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    expect(asked).toBe(0)
    expect(checked).toBeGreaterThan(0)
    expect(progress.some((p) => /critic/i.test(p.note))).toBe(false)
    expect(report.notes?.some((n) => /critic/i.test(n)) ?? false).toBe(false)
  }, 30_000)

  it('stops after three rounds of fixes, listing what is still open', async () => {
    const { db, storyId, chapterId, s1 } = world()
    const d = deps(db)
    const check = d.check
    let k = 0
    // A check that finds something new in Sc 1 every time it reads it.
    d.check = async (sceneId, signal) => {
      if (sceneId !== s1) return check(sceneId, signal)
      k++
      cdb.saveFound(
        db,
        cdb.sceneIssueRows(db, s1),
        [{ sceneId: s1, storyId, kind: 'fact', severity: 'warning', quote: '', message: `Slip number ${k} of many.`, key: `k-${k}`, payload: { key: `k-${k}`, by: 'check', check: 'facts' } }],
        () => false
      )
      return { status: 'done' }
    }
    const run = new ChapterRun(d, 'run-cap', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('stuck')
    expect(report.rounds).toBe(4)
    expect(report.message).toMatch(/^The AI stopped after 3 rounds of fixes, as it always does, so it never runs on for hours\. (One thing is|\d+ things are) still open: listed below, and in the Issues and Critique tabs\.$/)
    expect(report.left.some((l) => l.includes('Slip number 4 of many.'))).toBe(true)
  }, 30_000)

  it('starts no round of fixes after an hour', async () => {
    const { db, chapterId } = world()
    const d = deps(db)
    let t = 0
    d.clock = () => t
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      t += 31 * 60_000
      return draft(sceneId, o)
    }
    const run = new ChapterRun(d, 'run-late', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('stuck')
    expect(report.rounds).toBe(1)
    expect(report.message).toMatch(/^The AI stopped after about an hour of work, as it always does/)
    expect(report.left.length).toBeGreaterThan(0)
  }, 30_000)

  it('leaves for Adam a finding that comes back on words the AI itself wrote', async () => {
    const { db, storyId, chapterId, s1 } = world()
    const d = deps(db)
    const check = d.check
    let k = 0
    // The checks find the same thing about the opening every time, each time in other words; the fix keeps them.
    d.check = async (sceneId, signal) => {
      if (sceneId !== s1) return check(sceneId, signal)
      k++
      cdb.saveFound(
        db,
        cdb.sceneIssueRows(db, s1),
        [{ sceneId: s1, storyId, kind: 'timeline', severity: 'warning', quote: 'The ferry came in late under a low sky.', message: `The ferry can't be late here (${k}).`, key: `t-${k}`, payload: { key: `t-${k}`, by: 'check', check: 'timeline' } }],
        () => false
      )
      return { status: 'done' }
    }
    const run = new ChapterRun(d, 'run-own', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('stuck')
    // Round 1 gave it to the AI; round 2 found it on the AI's own new words, so it is left (and the run ends).
    expect(report.rounds).toBe(2)
    expect(report.message).toBe(
      'The AI fixed what it could, but one thing came back after it had tried, so it left it for you: listed below, and in the Issues and Critique tabs.'
    )
    expect(report.left).toHaveLength(1)
    expect(report.left[0]).toContain("The ferry can't be late here (2).")
  }, 30_000)

  it('takes out a sentence printed twice in a row before checking, and says so', async () => {
    const { db, chapterId, s2 } = world()
    const d = deps(db)
    const draft = d.draft
    const twice = 'Nobody made room for her at the fire.'
    d.draft = async (sceneId, o) => {
      const r = await draft(sceneId, o)
      return sceneId === s2 ? { ...r, text: r.text.replace(twice, `${twice} ${twice}`) } : r
    }
    const run = new ChapterRun(d, 'run-twice', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    expect(repo.getScene(db, s2).text.split(twice)).toHaveLength(2)
    expect(report.scenes.find((s) => s.sceneId === s2)?.fixed[0]).toEqual({ why: 'A sentence was printed twice in a row: the second copy is taken out.', words: twice })
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

  it('checks the scene after one a review changed, and the next chapter’s first scene, noting what it finds there', { timeout: 30_000 }, async () => {
    const { db, storyId, chapterId, s1, s2 } = world()
    const next = repo.createChapter(db, storyId, { title: 'The road' })
    // An empty scene first: the one after it looks back past it, so it is the one checked.
    repo.createScene(db, next.id)
    const road = repo.createScene(db, next.id).id
    repo.saveSceneText(db, road, null, 'Mara walked on in the blue dress, wet through.')
    const d = deps(db)
    const real = { check: d.check, critique: d.critique }
    const checked: ID[] = []
    d.check = async (sceneId, signal) => {
      checked.push(sceneId)
      // The next chapter's scene: the check finds its opening no longer follows on.
      if (sceneId === road) {
        cdb.saveFound(
          db,
          cdb.sceneIssueRows(db, road),
          [{ sceneId: road, storyId, kind: 'continuity', severity: 'warning', quote: 'in the blue dress', message: 'Mara took the blue dress off at the inn.', key: 'k-road', payload: { key: 'k-road', by: 'check', check: 'continuity' } }],
          () => false
        )
        return { status: 'done' }
      }
      return real.check(sceneId, signal)
    }
    // The critic has notes for Sc 1 only, so only Sc 1's review changes anything.
    d.critique = (target, again, signal) => {
      if (target.scope === 'chapter' || target.id !== s1) {
        return Promise.resolve({ status: 'complete', critique: { scope: target.scope, targetId: target.id, summary: '', strengths: [], notes: [], at: '', textHash: '', shortened: false, generationId: null } })
      }
      return real.critique(target, again, signal)
    }
    const run = new ChapterRun(d, 'run-5', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    // Round 1 checks both scenes, then the next chapter's first scene with words (its last scene was just written);
    // round 2 checks Sc 2 again although only Sc 1 changed: its opening follows on from Sc 1's new end.
    expect(checked).toEqual([s1, s2, road, s1, s2])
    // The next chapter's scene is never changed: what its check found is noted for Adam.
    expect(repo.getScene(db, road).text).toBe('Mara walked on in the blue dress, wet through.')
    expect(report.notes).toEqual(['Ch 2, Sc 2 may no longer follow on: Mara took the blue dress off at the inn. (“in the blue dress”)'])
  })

  it('never keeps a cut-off draft or a refusal as the scene', async () => {
    for (const [end, words] of [
      [{ cutOff: true }, /stopped partway through Sc 1 “The ferry”: it ran out of room/],
      [{ refused: true }, /wouldn't write Sc 1 “The ferry” and sent back a refusal/]
    ] as const) {
      const { db, chapterId, s1 } = world()
      const d = deps(db)
      d.draft = async () => ({ status: 'complete', text: 'Half a scene, cut off mid', error: null, ...end })
      const run = new ChapterRun(d, 'run-6', chapterId)
      run.prepare()
      const report = await run.run()
      expect(report.status).toBe('error')
      expect(report.message).toMatch(words)
      expect(repo.getScene(db, s1).text).toBe('Old words in the first scene.')
    }
  })

  it('asks the study where everyone starts for the first scene only, and tells later scenes to start where the one before ends', async () => {
    expect(studySystem()).toMatch(/for the chapter's first scene only, where everyone and everything starts/)
    expect(studySystem()).not.toMatch(/who knows what, where everyone and everything starts/)
    const { db, chapterId, s1, s2 } = world()
    const d = deps(db)
    const notes = new Map<ID, string>()
    const draft = d.draft
    let run: ChapterRun | null = null
    d.draft = async (sceneId, o) => {
      notes.set(sceneId, o.notes)
      if (sceneId === s2) void run!.stop()
      return draft(sceneId, o)
    }
    run = new ChapterRun(d, 'run-8', chapterId)
    run.prepare()
    await run.run()
    expect(notes.get(s1)).toContain('Keep Sc 1 true to the memory.')
    expect(notes.get(s1)).not.toContain(LATER_START)
    expect(notes.get(s2)).toContain('Keep Sc 2 true to the memory.')
    expect(notes.get(s2)).toContain(LATER_START)
  })

  it('notes for Adam what a scene’s draft said about how it was written', async () => {
    const { db, chapterId } = world()
    const d = deps(db)
    const draft = d.draft
    d.draft = async (sceneId, o) => ({ ...(await draft(sceneId, o)), note: 'Where everyone was wasn’t ready in time.' })
    const run = new ChapterRun(d, 'run-7', chapterId)
    run.prepare()
    // Stopped once both scenes are written: the notes are kept with the report.
    const check = d.check
    d.check = async (id, signal) => {
      void run.stop()
      return check(id, signal)
    }
    const report = await run.run()
    expect(report.notes).toEqual(['Sc 1 “The ferry”: Where everyone was wasn’t ready in time.', 'Sc 2 “The inn”: Where everyone was wasn’t ready in time.'])
  })

  it('refuses to start without a scene card to write from', () => {
    const { db, chapterId, s1, s2 } = world()
    for (const id of [s1, s2]) repo.updateSceneCard(db, id, { ...repo.getScene(db, id).card, goal: '', beats: [] })
    expect(() => new ChapterRun(deps(db), 'run-4', chapterId).prepare()).toThrow(/scene card to write from/)
  })
})

describe('setting a finding aside', () => {
  const session = (db: RunDeps['db'], storyId: ID, chapterId: ID, s1: ID, findings: Finding[], more: Partial<SessionDeps> = {}) =>
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
      setAside: () => undefined,
      wrote: () => undefined,
      noted: { fix: () => undefined, setAside: () => undefined, rewritten: () => undefined },
      ...more
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

  it('never sends the scene it was shown again unchanged, and stops looking things up past its look-ups', async () => {
    const { db, storyId, chapterId, s1 } = world()
    repo.saveSceneText(db, s1, null, 'Mara stood at the rail. Her eyes were grey in the lamplight.')
    const s = session(db, storyId, chapterId, s1, [])
    const one = async (name: string, args: Record<string, unknown> = {}) => (await s.runAll([{ id: 'c', name, arguments: JSON.stringify(args) }])).results[0].content
    expect(await one('read_scene')).toBe("Sc 1 “The ferry” hasn't changed since you were last shown it: its words are above. Use them.")
    // A change: read again in full, then not again.
    expect(await one('revise', { start: 'Mara stood', end: 'the rail.', new_words: 'Mara leaned on the rail.', why: 'Tighter.' })).toMatch(/without reading the scene again/)
    repo.saveSceneText(db, s1, null, 'Mara leaned on the rail. Her eyes were grey in the lamplight. The rain went on.')
    expect(await one('read_scene')).toContain('The rain went on.')
    expect(await one('read_scene')).toMatch(/hasn't changed/)
    for (let i = 1; i < LOOKUPS_ALLOWED.review; i++) expect(await one('get_entry', { name: 'Mara' })).not.toMatch(/No more look-ups/)
    expect(await one('get_entry', { name: 'Mara' })).toMatch(/^No more look-ups in this session/)
    expect(await one('timeline')).toMatch(/^No more look-ups in this session/)
  })

  it('sends a scene again in full once the result that showed it was taken out to save room (token audit)', async () => {
    const { db, storyId, chapterId, s1, s2 } = world()
    repo.saveSceneText(db, s2, null, 'The inn was full and loud. Nobody made room for her at the fire.')
    const s = session(db, storyId, chapterId, s1, [], {
      scenes: [
        { id: s1, n: 1, title: 'The ferry', label: 'Sc 1 “The ferry”' },
        { id: s2, n: 2, title: 'The inn', label: 'Sc 2 “The inn”' }
      ]
    })
    const read = async (id: string) => (await s.runAll([{ id, name: 'read_scene', arguments: '{"scene":"Sc 2"}' }])).results[0].content
    expect(await read('c1')).toContain('Nobody made room for her')
    expect(await read('c2')).toMatch(/hasn't changed/)
    s.removed(['c0'])
    expect(await read('c3')).toMatch(/hasn't changed/)
    s.removed(['c1'])
    expect(await read('c4')).toContain('Nobody made room for her')
    // The scene being worked on is in the session's opening, which is never taken out.
    s.removed(['', 'c4'])
    expect((await s.runAll([{ id: 'c5', name: 'read_scene', arguments: '{}' }])).results[0].content).toMatch(/hasn't changed/)
  })

  it('never takes another chapter’s scene for this one’s: "Ch 2, Sc 1" read from Ch 1 is sent', async () => {
    const { db, storyId, chapterId, s1 } = world()
    const road = repo.createScene(db, repo.createChapter(db, storyId, { title: 'The road' }).id).id
    repo.saveSceneText(db, road, null, 'Mara walked on in the blue dress, wet through.')
    const s = session(db, storyId, chapterId, s1, [])
    const read = async () => (await s.runAll([{ id: 'r', name: 'read_scene', arguments: '{"scene":"Ch 2, Sc 1"}' }])).results[0].content
    expect(await read()).toContain('in the blue dress')
    expect(await read()).toContain('in the blue dress')
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
