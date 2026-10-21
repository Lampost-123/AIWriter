import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import type { ChapterWriterProgress, ChapterWritingPlan } from '@shared/contracts/chapterWriter'
import { ALL_CHECKS } from '@shared/contracts/checks'
import { writerTemperature } from '@shared/defaults'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as gens from '../db/generations'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { JobModel } from '../ai/jobModel'
import { checkScene } from '../checks/run'
import { runCritique } from '../critique/run'
import { loadCritique } from '../critique/store'
import { sceneWords } from '../ask/agent'
import { dropRepeats, pageFrom, proseBlocks } from './page'
import { ProgressGuard, Tries, findingKey, sameFinding, wordsOverlap } from './progress'
import { ChapterRun, FOLLOW_ON_CHECKS, LATER_START, STATE_CHECKS, cardReady, chapterScenes, contractMisses, issueFindings, placeLabel, planMisses, type RunDeps } from './run'
import { CHAPTER_NAMES_MOST, NAME_MOST, chapterLine, chapterNames, chapterPlanText, checkChapterPlan, keptFacts, planName, readChapterPlan, withAnswer } from './plan'
import { passageFor, replyPassage } from './fix'
import { CHAPTER_MARKER, PLAN_STEPS } from './prompts'
import { sceneNamed } from './tools'
import { loadBefore, loadReport, titleToPutBack } from './store'
import { critiqueAsk } from '../critique/prompts'
import { CHAPTER_WRITER_LIMITS } from '@shared/contracts/chapterWriter'

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
  const mara = repo.createEntry(db, 'character', { name: 'Mara', summary: 'Runs the ferry.' }).id
  repo.createEntry(db, 'character', { name: 'Tobin', summary: 'A ferryman.' })
  repo.updateSceneCard(db, s1, { ...repo.getScene(db, s1).card, goal: 'Mara meets Tobin at the ferry.' })
  repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, beats: ['Mara finds no room at the inn.'] })
  repo.saveSceneText(db, s1, null, 'Old words in the first scene.')
  return { db, storyId: story.id, chapterId, s1, s2, mara }
}

function deps(db: RunDeps['db'], o: { agent?: string; fixer?: string; progress?: ChapterWriterProgress[] } = {}): RunDeps {
  let n = 0
  const order = new Map<ID, number>()
  return {
    db,
    agentModel: model(o.agent ?? 'fake/writer'),
    writer: { model: model(o.fixer ?? 'fake/writer', 'writer'), temperature: writerTemperature('balanced'), topP: 0.95 },
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
    check: async (sceneId, _signal, checks = ALL_CHECKS) => {
      const r = await checkScene({ db, model: model('fake/writer', 'check'), prefs: PREFS, stopped: () => false, retryDelays: [], together: true }, sceneId, checks)
      return r.status === 'error' ? { status: 'error', error: r.error } : { status: r.status }
    },
    critique: (target, again) =>
      runCritique({ db, model: model('fake/writer', 'writer'), prefs: PREFS, emit: () => undefined, retryDelays: [] }, { taskId: crypto.randomUUID(), target, again, by: 'chapter-writer' }),
    limitNote: () => null,
    closed: () => false,
    retryDelays: []
  }
}

/** The run's own requests (the plan and the fixes), as kept: system prompt, first user message, and params. */
function chapterRecords(db: RunDeps['db']) {
  return (db.prepare("SELECT id FROM generations WHERE job = 'chapter' ORDER BY created_at").all() as { id: ID }[]).map((r) => {
    const g = gens.getGeneration(db, r.id)
    return { system: g.messages[0]?.content ?? '', user: g.messages[1]?.content ?? '', params: g.params }
  })
}

/**
 * A check that finds a slip about these words of a scene each time it reads it (the words, what it says and which check
 * found it, as given at each read).
 */
function slipEachTime(
  d: RunDeps,
  db: RunDeps['db'],
  storyId: ID,
  sceneId: ID,
  words: (k: number) => string,
  message: (k: number) => string,
  by: (k: number) => 'facts' | 'timeline' | 'knowledge' = () => 'facts'
): void {
  const check = d.check
  let k = 0
  d.check = async (id, signal, checks) => {
    if (id !== sceneId) return check(id, signal, checks)
    k++
    cdb.saveFound(
      db,
      cdb.sceneIssueRows(db, sceneId),
      [{ sceneId, storyId, kind: 'fact', severity: 'warning', quote: words(k), message: message(k), key: `k-${k}`, payload: { key: `k-${k}`, by: 'check', check: by(k) } }],
      () => false
    )
    return { status: 'done' }
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

  it('is given twice at most, once when it is on words the AI wrote', () => {
    const t = new Tries()
    expect(t.verdict(f(), false)).toBe('give')
    t.given(f())
    expect(t.verdict(f({ what: 'Still late.' }), false)).toBe('give')
    expect(t.verdict(f({ what: 'Still late.' }), true)).toBe('leave')
    t.given(f({ what: 'Still late.' }))
    expect(t.verdict(f(), false)).toBe('leave')
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

describe('the planner’s instruction packs (overhaul phase 2)', () => {
  it('lists check-continuity in its instructions and loads it with its look-ups, once, not as a look-up', { timeout: 30_000 }, async () => {
    const { db, chapterId } = world()
    const run = new ChapterRun(deps(db, { agent: 'fake/agent-packs' }), 'run-packs', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    const plan = chapterRecords(db)[0]
    expect(plan.system).toContain('Instruction packs')
    expect(plan.system).toContain('- check-continuity: ')
    expect(plan.system).not.toContain('- plan-a-scene: ')
    const steps = (plan.params as { steps?: { label: string; tool: string; result: string }[] }).steps ?? []
    const loaded = steps.filter((s) => s.tool === 'load_instructions')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].label).toBe('Reading the instructions for checking continuity')
    expect(loaded[0].result.startsWith('Checking continuity')).toBe(true)
    // The look-up made beside it was answered as usual.
    expect(steps.some((s) => s.tool === 'state_of' && s.label === 'Looking up Mara')).toBe(true)
    expect(report.brief).toContain('Sc 1 moves the chapter on.')
  })
})

describe('the chapter plan, read and checked', () => {
  const scenes = [
    { id: 's1', n: 1, title: 'The ferry', label: 'Sc 1 “The ferry”' },
    { id: 's2', n: 2, title: 'The inn', label: 'Sc 2 “The inn”' }
  ]

  it('names scenes however the AI writes them', () => {
    expect(sceneNamed(scenes, 'Sc 2')).toBe('s2')
    expect(sceneNamed(scenes, 'Sc 1 “The ferry”')).toBe('s1')
    expect(sceneNamed(scenes, 'Ch 3, Sc 2')).toBe('s2')
    expect(sceneNamed(scenes, 'The inn')).toBe('s2')
    expect(() => sceneNamed(scenes, 'Sc 9')).toThrow(/isn't a scene of this chapter/)
  })

  it('asks for the number when two scenes share a title', () => {
    const twins = [...scenes, { id: 's3', n: 3, title: 'The inn', label: 'Sc 3 “The inn”' }]
    expect(() => sceneNamed(twins, 'The inn')).toThrow(/“Sc 2” or “Sc 3”/)
    expect(sceneNamed(twins, 'Sc 3 “The inn”')).toBe('s3')
  })

  it('keeps a part for every scene, in order, plans a scene left out from its card, and keeps only people who exist', () => {
    const { db, s1, s2 } = world()
    const refs = [
      { ...scenes[0], id: s1 },
      { ...scenes[1], id: s2 }
    ]
    const raw = readChapterPlan(
      `Here it is: {"overview": "Mara crosses.", "scenes": [{"scene": "Sc 1", "does": "Mara meets Tobin.", "threads": ["The ledger: Mara hears of it"], "changes": [{"who": "Mara", "change": "ends up on the ferry"}, {"who": "Nobody Real", "change": "arrives"}, "Tobin: learns she is late"], "keep": ["Mara's coat is grey (since Ch 1, Sc 1)"]}], "questions": ["Is Tobin her brother?"]}`
    )!
    const plan = checkChapterPlan(raw, { db, scenes: refs, people: repo.listEntries(db).filter((e) => e.kind === 'character') })!
    expect(plan.overview).toBe('Mara crosses.')
    expect(plan.scenes.map((s) => s.sceneId)).toEqual([s1, s2])
    expect(plan.scenes[0].changes).toEqual([
      { who: 'Mara', change: 'ends up on the ferry' },
      { who: 'Tobin', change: 'learns she is late' }
    ])
    expect(plan.scenes[0].text).toBe(
      "What it must do: Mara meets Tobin.\nThreads it moves on:\n- The ledger: Mara hears of it\nWhat changes by its end:\n- Mara: ends up on the ferry\n- Tobin: learns she is late\nKeep to:\n- Mara's coat is grey (since Ch 1, Sc 1)"
    )
    // Sc 2 was left out: planned from its card.
    expect(plan.scenes[1].does).toBe('Mara finds no room at the inn.')
    expect(plan.questions).toEqual(['Is Tobin her brother?'])
    expect(readChapterPlan('Not JSON at all.')).toBeNull()
  })

  it('takes Adam’s changes to a part as his words, keeping what changes only for people they still name', () => {
    const plan: ChapterWritingPlan = {
      overview: 'Mara crosses.',
      questions: [],
      scenes: [
        { sceneId: 's1', label: 'Sc 1', does: 'Mara meets Tobin.', threads: [], changes: [{ who: 'Mara', change: 'ends on the ferry' }, { who: 'Tobin', change: 'learns she is late' }], keep: [], text: 'What it must do: Mara meets Tobin.' },
        { sceneId: 's2', label: 'Sc 2', does: 'The inn.', threads: [], changes: [], keep: [], text: 'What it must do: The inn.' }
      ]
    }
    const changed = withAnswer(plan, { scenes: [{ sceneId: 's1', text: 'Mara misses the ferry and walks.' }], overview: 'Mara walks.' })
    expect(changed.overview).toBe('Mara walks.')
    expect(changed.scenes[0]).toMatchObject({ text: 'Mara misses the ferry and walks.', changed: true, changes: [{ who: 'Mara', change: 'ends on the ferry' }] })
    expect(changed.scenes[1]).toBe(plan.scenes[1])
    // What the chapter does, in its parts: each changed part is his, the rest as they were.
    const three = withAnswer({ ...plan, lead: 'Mara', wants: 'To cross.', against: 'The river.', turn: 'She swims.' }, { wants: '  To cross   tonight. ' })
    expect([three.wants, three.against, three.turn]).toEqual(['To cross tonight.', 'The river.', 'She swims.'])
  })

  it('reads what the chapter does in three parts, and how each scene ends; a plan made before them reads as it was', () => {
    const { db, s1, s2 } = world()
    const refs = [
      { ...scenes[0], id: s1 },
      { ...scenes[1], id: s2 }
    ]
    const people = repo.listEntries(db).filter((e) => e.kind === 'character')
    const raw = readChapterPlan(
      JSON.stringify({
        overview: 'Mara crosses.',
        lead: 'mara',
        wants: 'To reach the ferry before dark.',
        against: 'Tobin’s questions.',
        turn: 'She tells him the truth.',
        scenes: [
          { scene: 'Sc 1', does: 'Mara meets Tobin.', ends: 'Mara soaked to the knee, boots off by the fire.' },
          { scene: 'Sc 2', does: 'The inn.', endsWith: 'The key in her pocket.' }
        ]
      })
    )!
    const plan = checkChapterPlan(raw, { db, scenes: refs, people })!
    expect(plan).toMatchObject({ lead: 'Mara', wants: 'To reach the ferry before dark.', against: 'Tobin’s questions.', turn: 'She tells him the truth.' })
    expect(plan.scenes.map((s) => s.ends)).toEqual(['Mara soaked to the knee, boots off by the fire.', 'The key in her pocket.'])
    expect(plan.scenes[0].text).toBe('What it must do: Mara meets Tobin.\nEnds with: Mara soaked to the knee, boots off by the fire.')
    expect(chapterLine(plan)).toBe('Mara crosses.\nMara wants: To reach the ferry before dark.\nAgainst Mara: Tobin’s questions.\nHow it turns: She tells him the truth.')
    expect(chapterPlanText(plan).startsWith('Mara crosses.\nMara wants:')).toBe(true)
    // A name the codex doesn't have isn't whose chapter it is; the rest stays.
    expect(checkChapterPlan({ ...raw, lead: 'Nobody Real' }, { db, scenes: refs, people })!.lead).toBeUndefined()
    // A plan as it was before (2026-10-19): no parts, no endings, and its text as before.
    const old = checkChapterPlan(readChapterPlan('{"overview": "Mara crosses.", "scenes": [{"scene": "Sc 1", "does": "Mara meets Tobin."}]}')!, { db, scenes: refs, people })!
    expect(old.wants).toBeUndefined()
    expect(old.scenes[0].ends).toBe('')
    expect(old.scenes[0].text).toBe('What it must do: Mara meets Tobin.')
    expect(chapterLine(old)).toBe('Mara crosses.')
  })

  it('says what it keeps true from the story so far, each with where it was set, the plain facts first, a few a person', () => {
    const core = {
      people: [
        'Ash: at the ford (since Ch 1, Sc 1)',
        'Ash: burn on the left forearm (since Ch 1, Sc 2)',
        'Ash: carrying the lamp (since Ch 1, Sc 2)',
        'Ash: wearing a grey coat (since Ch 1, Sc 1)',
        'Ash knows: the silver is in the case (since Ch 1, Sc 3)',
        'Ash and Wren: wary friends (since Ch 1, Sc 1)',
        'Wren: carrying the survey case (since Ch 1, Sc 1)',
        'Bryn: no place given'
      ]
    }
    const kept = keptFacts(core, { scenes: [{ keep: ['Edric’s letter: never take the coast road', 'Ash: burn on the left forearm (since Ch 1, Sc 2)'] }] as never })
    expect(kept).toEqual([
      'Ash: at the ford (since Ch 1, Sc 1)',
      'Ash: burn on the left forearm (since Ch 1, Sc 2)',
      'Ash: carrying the lamp (since Ch 1, Sc 2)',
      'Wren: carrying the survey case (since Ch 1, Sc 1)',
      'Edric’s letter: never take the coast road'
    ])
  })
})

describe('a flagged passage', () => {
  it('is the whole paragraphs its words are in, found tolerantly, and the writer’s reply is its words alone', () => {
    const { db, s1 } = world()
    repo.saveSceneText(db, s1, null, 'One two three. Four five six.\n\nSeven eight nine. Ten eleven twelve.\n\nThirteen.')
    const s = sceneWords(db, s1)!
    expect(passageFor(s, 'four five six')?.marked).toBe('One two three. Four five six.')
    expect(passageFor(s, 'Six.\n\nSeven eight')?.marked).toBe('One two three. Four five six.\n\nSeven eight nine. Ten eleven twelve.')
    expect(passageFor(s, 'Nowhere in the scene at all')).toBeNull()
    expect(passageFor(s, '')).toBeNull()
    expect(replyPassage('```\nNew words.\n```')).toBe('New words.')
    expect(replyPassage('"""\nNew words.\n"""')).toBe('New words.')
    expect(replyPassage('Here is the new passage:\n\nNew words.')).toBe('New words.')
  })
})

describe('writing a whole chapter', () => {
  it('says how it goes for the progress card: what it is doing, each scene with its words, its retries, and when writing began', { timeout: 30_000 }, async () => {
    const { db, chapterId, s1, s2 } = world()
    const progress: ChapterWriterProgress[] = []
    const d = deps(db, { progress })
    d.target = (id) => (id === s1 ? 1500 : null)
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      // The writer's words come in, and once a request is tried again.
      o.onRetry?.('Fake is busy')
      o.onRetry?.(null)
      o.onWords?.(12)
      return draft(sceneId, o)
    }
    const run = new ChapterRun(d, 'run-card', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    // Every event says what it is doing and lists the scenes; the plan first, with nothing written.
    expect(progress.every((p) => !!p.doing && p.scenes?.length === 2 && typeof p.startedMs === 'number')).toBe(true)
    expect(progress[0].doing).toBe('plan')
    expect(progress[0].scenes?.map((s) => s.state)).toEqual(['waiting', 'waiting'])
    expect(progress[0].scenes?.map((s) => s.target)).toEqual([1500, null])
    expect(progress[0].writingMs).toBeNull()
    // Writing Sc 1: it is being written, Sc 2 waits; its live words, then a retry said and cleared.
    const first = progress.find((p) => p.doing === 'draft' && p.sceneId === s1)!
    expect(first.scenes?.map((s) => s.state)).toEqual(['writing', 'waiting'])
    expect(typeof first.writingMs).toBe('number')
    expect(progress.some((p) => p.retrying === 'Fake is busy')).toBe(true)
    // Writing Sc 2: Sc 1 is written, with its words counted.
    const second = progress.find((p) => p.doing === 'draft' && p.sceneId === s2)!
    expect(second.scenes?.[0]).toMatchObject({ state: 'written', words: 33 })
    expect(second.scenes?.[1].state).toBe('writing')
    // Then the checks of each scene and the critic, each said as itself.
    expect(progress.some((p) => p.doing === 'check' && p.sceneId === s1)).toBe(true)
    expect(progress.some((p) => p.doing === 'critic')).toBe(true)
    const last = progress.at(-1)!
    expect(last.scenes?.every((s) => s.state === 'written' && s.words > 0)).toBe(true)
  })

  it('plans the chapter first, writes each scene to its part, checks it, fixes only what was flagged, and ends clean', { timeout: 30_000 }, async () => {
    const { db, storyId, chapterId, s1, s2 } = world()
    repo.updateStory(db, storyId, { style: { proseStyle: 'Spare and wry, with salt in it.', samplePassage: 'The estuary kept its own hours.' } })
    const progress: ChapterWriterProgress[] = []
    const d = deps(db, { progress })
    const notes = new Map<ID, string>()
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      notes.set(sceneId, o.notes)
      return draft(sceneId, o)
    }
    const checked: string[] = []
    const check = d.check
    d.check = async (sceneId, signal, checks) => {
      checked.push(`${sceneId === s1 ? 's1' : 's2'}: ${checks?.join(', ')}`)
      return check(sceneId, signal, checks)
    }
    const asked: string[] = []
    const critique = d.critique
    d.critique = (target, again, signal) => {
      asked.push(`${target.scope}${again ? ' again' : ''}`)
      return critique(target, again, signal)
    }
    const run = new ChapterRun(d, 'run-1', chapterId)
    run.prepare()
    // The words before the run are kept for Undo.
    expect(loadBefore(db, chapterId).find((b) => b.sceneId === s1)?.text).toBe('Old words in the first scene.')
    const report = await run.run()
    expect(report.status).toBe('done')
    expect(report.message).toBe('')
    // 1. The plan, first: a part for each scene, with what it looked up; Adam's cards' questions kept.
    expect(progress[0].stage).toBe('planning')
    expect(report.plan?.scenes.map((s) => s.sceneId)).toEqual([s1, s2])
    expect(report.brief).toContain('Sc 1 moves the chapter on.')
    expect(report.questions).toEqual(["Sc 1's card has Mara at the inn; the memory has her at the ferry."])
    const records = chapterRecords(db)
    expect(records[0].system.startsWith(`${CHAPTER_MARKER} plan`)).toBe(true)
    expect(records[0].user).toContain('### Sc 1 “The ferry”\nGoal: Mara meets Tobin at the ferry.')
    // 2. Each scene is written to its part of the plan; a later one starts where the scene before ends.
    expect(notes.get(s1)).toContain('The chapter: A fake chapter plan.')
    expect(notes.get(s1)).toContain('What it must do: Sc 1 moves the chapter on.')
    expect(notes.get(s1)).toContain('Keep Sc 1 true to the memory.')
    expect(notes.get(s1)).not.toContain(LATER_START)
    expect(notes.get(s2)).toContain('What it must do: Sc 2 moves the chapter on.')
    expect(notes.get(s2)).toContain(LATER_START)
    // 3. The state check reads each scene once, in one request; the critic reads the chapter once, never again.
    expect(checked.slice(0, 2)).toEqual([`s1: ${STATE_CHECKS.join(', ')}`, `s2: ${STATE_CHECKS.join(', ')}`])
    expect(asked).toEqual(['chapter'])
    // 4. Only the flagged passages were rewritten, in the writer's voice: the critic's notes on Sc 1's second sentence
    // and Sc 2's first; the small note and the one with no words are left for Adam.
    expect(report.rounds).toBe(2)
    expect(repo.getScene(db, s1).text).toBe(
      'The ferry came in late under a low sky. Mara stood at the rail and counted the lamps on the shore. The rain went on.\n\n"You\'re late," said Tobin. He did not look up from the rope.'
    )
    expect(repo.getScene(db, s2).text.startsWith('The inn was full and loud. Nobody made room for her at the fire. The rain went on.')).toBe(true)
    expect(report.scenes.find((s) => s.sceneId === s1)?.fixed).toEqual([
      { why: 'The critic: The middle slows', words: 'The ferry came in late under a low sky. Mara stood at the rail and counted the lamps on the shore. The rain went on.' }
    ])
    const fixes = records.filter((r) => r.system.startsWith(`${CHAPTER_MARKER} fix`))
    expect(fixes).toHaveLength(2)
    expect(fixes[0].system).toContain('Spare and wry, with salt in it.')
    expect(fixes[0].system).toContain('The estuary kept its own hours.')
    expect(fixes[0].params.temperature).toBe(writerTemperature('balanced'))
    expect(fixes[0].user).toContain('## This scene’s part of the chapter plan\nWhat it must do: Sc 1 moves the chapter on.')
    expect(fixes[0].user).toContain('The words it is about: “Mara stood at the rail and counted the lamps on the shore.”')
    // The notes acted on are marked done in the Critique tab.
    expect(loadCritique(db, { scope: 'chapter', id: chapterId })?.notes.filter((n) => n.status === 'done').map((n) => n.title)).toEqual([
      'The middle slows',
      'The ending could pull harder'
    ])
    expect(report.notes?.at(-1)).toBe('The critic has one more note on the chapter that the AI didn\'t act on (“A quote from nowhere”). They are in the Critique tab for you to weigh.')
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['planning', 'drafting', 'checking', 'fixing']))
    expect(loadReport(db, chapterId)?.status).toBe('done')
  })

  it('shows Adam the plan before writing, writes to his changes, and doesn’t count the time he takes', { timeout: 30_000 }, async () => {
    const { db, chapterId, s1, s2 } = world()
    const d = deps(db)
    let t = 0
    d.clock = () => t
    const shown: ChapterWritingPlan[] = []
    const progress: ChapterWriterProgress[] = []
    d.progress = (p) => progress.push(p)
    d.review = async (plan) => {
      shown.push(plan)
      // Two hours over the plan: not counted against the hour.
      t += 120 * 60_000
      return { scenes: [{ sceneId: s2, text: 'Mara sleeps in the stable instead.' }] }
    }
    const notes = new Map<ID, string>()
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      notes.set(sceneId, o.notes)
      return draft(sceneId, o)
    }
    d.estimate = (ids) => ({ minutes: ids.length * 2, cost: 0.09, free: false })
    const run = new ChapterRun(d, 'run-review', chapterId)
    run.prepare()
    const report = await run.run()
    expect(shown).toHaveLength(1)
    expect(shown[0].scenes.map((s) => s.sceneId)).toEqual([s1, s2])
    // The window was given the plan while it waited, and only then, with what writing it takes.
    const review = progress.find((p) => p.stage === 'review')
    expect(review?.plan?.scenes).toHaveLength(2)
    expect(review?.estimate).toEqual({ minutes: 4, cost: 0.09, free: false })
    expect(review?.plan?.kept).toContain('Keep Sc 1 true to the memory.')
    expect(review?.plan?.scenes[0].ends).toBe('Sc 1 ends on the far bank.')
    // The drafts are told what the chapter does, in its parts.
    expect(notes.get(s1)).toContain('How it turns: The ferry leaves without them.')
    expect(progress.filter((p) => p.stage !== 'review').every((p) => !p.plan)).toBe(true)
    expect(notes.get(s1)).toContain('Sc 1 moves the chapter on.')
    expect(notes.get(s2)).toContain('Mara sleeps in the stable instead.')
    expect(notes.get(s2)).not.toContain('Sc 2 moves the chapter on.')
    expect(report.plan?.scenes[1]).toMatchObject({ text: 'Mara sleeps in the stable instead.', changed: true })
    expect(report.status).toBe('done')
  })

  it('changes nothing when Adam cancels at the plan', async () => {
    const { db, chapterId, s1 } = world()
    const d = deps(db)
    let drafted = 0
    d.draft = async () => {
      drafted++
      return { status: 'complete', text: 'Never written.', error: null }
    }
    d.review = async () => null
    const run = new ChapterRun(d, 'run-cancel', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('cancelled')
    expect(report.message).toBe('Cancelled before writing: nothing in the chapter changed.')
    expect(drafted).toBe(0)
    expect(repo.getScene(db, s1).text).toBe('Old words in the first scene.')
  })

  it('makes the plan from the cards when the AI never writes one, and goes on', { timeout: 30_000 }, async () => {
    const { db, chapterId, s1 } = world()
    const d = deps(db, { agent: 'fake/agent-words' })
    const notes = new Map<ID, string>()
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      notes.set(sceneId, o.notes)
      return draft(sceneId, o)
    }
    const run = new ChapterRun(d, 'run-words', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    expect(notes.get(s1)).toContain('What it must do: Mara meets Tobin at the ferry.')
    expect(report.questions).toContain('The AI couldn’t make a plan for this chapter, so each scene is planned from its card alone.')
    // A request with the tools, the nudge's, then the last one: within its steps.
    expect(chapterRecords(db).filter((r) => r.system.startsWith(`${CHAPTER_MARKER} plan`))).toHaveLength(1)
    expect(PLAN_STEPS).toBeLessThanOrEqual(4)
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

  it('never asks the critic when Adam has switched it off, and still checks and finishes the chapter (2026-10-17)', async () => {
    const { db, chapterId } = world()
    const d = deps(db)
    let asked = 0
    let checked = 0
    const check = d.check
    d.critique = () => {
      asked++
      throw new Error('the critic should not be asked')
    }
    d.check = (sceneId, signal, checks) => {
      checked++
      return check(sceneId, signal, checks)
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

  it(`stops after ${CHAPTER_WRITER_LIMITS.fixRounds} rounds of fixes, listing what is still open`, async () => {
    const { db, storyId, chapterId, s1 } = world()
    const d = deps(db)
    d.critic = () => false
    // A check that finds something new in Sc 1 every time it reads it, of another kind, on words the fixes before haven't
    // touched: its second paragraph, then its first, then its second again.
    slipEachTime(
      d,
      db,
      storyId,
      s1,
      (k) => (k % 2 ? 'He did not look up from the rope.' : 'The ferry came in late'),
      (k) => `Slip number ${k} of many.`,
      (k) => (['facts', 'timeline', 'knowledge'] as const)[(k - 1) % 3]
    )
    const run = new ChapterRun(d, 'run-cap', chapterId)
    run.prepare()
    const report = await run.run()
    expect(CHAPTER_WRITER_LIMITS.fixRounds).toBe(2)
    expect(report.status).toBe('stuck')
    expect(report.rounds).toBe(3)
    expect(report.message).toMatch(/^The AI stopped after 2 rounds of fixes, as it always does, so it never runs on for hours\. (One thing is|\d+ things are) still open: listed below, and in the Issues and Critique tabs\.$/)
    expect(report.left.some((l) => l.includes('Slip number 3 of many.'))).toBe(true)
  }, 30_000)

  it('tries each problem twice at most, then leaves it for Adam', async () => {
    const { db, storyId, chapterId, s1 } = world()
    // The writer sends every fix back unchanged: the slip stays.
    const d = deps(db, { fixer: 'fake/fix-same' })
    d.critic = () => false
    slipEachTime(d, db, storyId, s1, () => 'The ferry came in late', () => 'The ferry can’t be late here.')
    let fixes = 0
    const run = new ChapterRun(d, 'run-twice-tried', chapterId)
    run.prepare()
    const report = await run.run()
    fixes = chapterRecords(db).filter((r) => r.system.startsWith(`${CHAPTER_MARKER} fix`)).length
    expect(fixes).toBe(2)
    expect(report.status).toBe('stuck')
    expect(report.message).toBe('The AI fixed what it could, but one thing came back after it had tried, so it left it for you: listed below, and in the Issues and Critique tabs.')
    expect(report.left).toHaveLength(1)
    expect(report.left[0]).toContain('The ferry can’t be late here.')
  }, 30_000)

  it('starts no round of fixes after an hour of work', async () => {
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
    expect(chapterRecords(db).some((r) => r.system.startsWith(`${CHAPTER_MARKER} fix`))).toBe(false)
  }, 30_000)

  it('leaves for Adam a finding that comes back on words the AI itself wrote', async () => {
    const { db, storyId, chapterId, s1 } = world()
    const d = deps(db)
    d.critic = () => false
    // The checks find the same thing about the opening every time, each time in other words; the fix keeps the words.
    slipEachTime(d, db, storyId, s1, () => 'The ferry came in late under a low sky.', (k) => `The ferry can't be late here (${k}).`)
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

  it('writes a scene that misses its part of the plan again, once, and leaves what it still misses for Adam', { timeout: 30_000 }, async () => {
    const { db, chapterId, s2, mara } = world()
    // Sc 2's card has Mara there: the plan has her change there, and its draft never names her.
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, presentIds: [mara] })
    const d = deps(db)
    d.critic = () => false
    const directions: string[] = []
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      if (sceneId === s2) directions.push(o.direction)
      return draft(sceneId, o)
    }
    const run = new ChapterRun(d, 'run-miss', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.plan?.scenes[1].changes).toEqual([{ who: 'Mara', change: 'ends Sc 2 further on her way' }])
    expect(directions).toEqual([
      '',
      'The scene as first written missed its part of the chapter plan. Write it again so that it does all of its part, above all: The chapter plan has Mara here (ends Sc 2 further on her way), but the scene never names Mara.'
    ])
    expect(report.scenes.find((s) => s.sceneId === s2)?.rewritten).toHaveLength(1)
    // Written again, it still never names her: not written a third time.
    expect(report.status).toBe('stuck')
    expect(report.left).toHaveLength(1)
    expect(report.left[0]).toContain('plan · who is there')
    expect(planMisses(db, s2, report.plan!, 'Mara walks in.')).toEqual([])
    // The point of view may tell a scene without once being named: never a miss.
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, presentIds: [], povId: mara })
    expect(planMisses(db, s2, report.plan!, 'I walk in.')).toEqual([])
  })

  it('writes again a scene whose contract says what it must change and its words don’t show (a plan miss), never patching it in', () => {
    const { db, storyId, s1 } = world()
    repo.saveSceneText(db, s1, null, 'Mara stood at the rail.')
    cdb.saveFound(
      db,
      [],
      [
        {
          sceneId: s1,
          storyId,
          kind: 'fact',
          severity: 'warning',
          quote: '',
          message: 'This scene was planned to show: Mara finds the ledger.',
          key: 'contract:change:mara finds the ledger',
          payload: { key: 'contract:change:mara finds the ledger', by: 'check', check: 'facts', contract: { part: 'change', text: 'Mara finds the ledger', missing: true } }
        }
      ],
      () => false
    )
    expect(contractMisses(db, s1)).toEqual([
      expect.objectContaining({ from: 'plan', kind: 'plan · not shown', what: 'This scene was planned to show: Mara finds the ledger.', quote: '' })
    ])
    // Never a passage to patch.
    expect(issueFindings(db, s1)).toEqual([])
  })

  it('takes out a sentence printed twice in a row before checking, and says so', async () => {
    const { db, chapterId, s2 } = world()
    const d = deps(db)
    d.critic = () => false
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

  it('checks the scene after one a fix changed, and the next chapter’s first scene, noting what it finds there', { timeout: 30_000 }, async () => {
    const { db, storyId, chapterId, s1, s2 } = world()
    const next = repo.createChapter(db, storyId, { title: 'The road' })
    // An empty scene first: the one after it looks back past it, so it is the one checked.
    repo.createScene(db, next.id)
    const road = repo.createScene(db, next.id).id
    repo.saveSceneText(db, road, null, 'Mara walked on in the blue dress, wet through.')
    const d = deps(db)
    const real = { check: d.check, critique: d.critique }
    const checked: ID[] = []
    const asked: string[] = []
    d.check = async (sceneId, signal, checks = ALL_CHECKS) => {
      checked.push(sceneId)
      asked.push(checks.join(', '))
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
      return real.check(sceneId, signal, checks)
    }
    // The critic's note on Sc 1 alone (its second sentence): only Sc 1 is fixed.
    d.critique = async (target, again, signal) => {
      const c = await real.critique(target, again, signal)
      return c.status === 'complete' ? { ...c, critique: { ...c.critique, notes: c.critique.notes.filter((n) => n.sceneId === s1) } } : c
    }
    const run = new ChapterRun(d, 'run-5', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    // Round 1 checks both scenes, then the next chapter's first scene with words (its last scene was just written);
    // round 2 checks Sc 2 again although only Sc 1 changed: its opening follows on from Sc 1's new end.
    expect(checked).toEqual([s1, s2, road, s1, s2])
    // A scene that didn't change itself is checked for what is so only (token audit, 2026-10-19).
    const state = STATE_CHECKS.join(', ')
    const follow = FOLLOW_ON_CHECKS.join(', ')
    expect(asked).toEqual([state, state, follow, state, follow])
    // The next chapter's scene is never changed: what its check found is noted for Adam.
    expect(repo.getScene(db, road).text).toBe('Mara walked on in the blue dress, wet through.')
    expect(report.notes?.[0]).toBe('Ch 2, Sc 2 may no longer follow on: Mara took the blue dress off at the inn. (“in the blue dress”)')
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

  it('notes for Adam what a scene’s draft said about how it was written', async () => {
    const { db, chapterId } = world()
    const d = deps(db)
    const draft = d.draft
    d.draft = async (sceneId, o) => ({ ...(await draft(sceneId, o)), note: 'Where everyone was wasn’t ready in time.' })
    const run = new ChapterRun(d, 'run-7', chapterId)
    run.prepare()
    // Stopped once both scenes are written: the notes are kept with the report.
    const check = d.check
    d.check = async (id, signal, checks) => {
      void run.stop()
      return check(id, signal, checks)
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

describe('a chapter with only its number gets a name that fits the story’s other chapters (Adam, 2026-10-20)', () => {
  /** The two-scene chapter ("Chapter 1"), with a second chapter that has a name of its own. */
  function named() {
    const w = world()
    const next = repo.createChapter(w.db, w.storyId, { title: 'The Road North' })
    return { ...w, next: next.id }
  }

  it('lists the story’s chapters by name in the brief, the nearest a dozen, and asks for a name only when one is needed', () => {
    const { db, storyId, chapterId, next } = named()
    repo.createChapter(db, storyId)
    expect(chapterNames(db, storyId, chapterId)).toEqual({ lines: ['Ch 1 (this chapter)', 'Ch 2 “The Road North”', 'Ch 3'], trimmed: false, ask: true, styled: true })
    // A chapter with a name of its own is never named again.
    expect(chapterNames(db, storyId, next).ask).toBe(false)
    // When no other chapter has a name, it is still named, to fit the story (every chapter written with AI gets one).
    repo.updateChapter(db, next, { title: 'Chapter 2' })
    expect(chapterNames(db, storyId, chapterId)).toMatchObject({ ask: true, styled: false })
    // A long story: the twelve nearest this chapter, in order.
    const long = world()
    for (let i = 2; i <= 20; i++) repo.createChapter(long.db, long.storyId, { title: `Name ${i}` })
    const at = repo.getOutline(long.db, long.storyId).chapters[14].id
    const l = chapterNames(long.db, long.storyId, at)
    expect(l.lines).toHaveLength(CHAPTER_NAMES_MOST)
    expect(l.trimmed).toBe(true)
    expect([l.lines[0], l.lines.at(-1)]).toEqual(['Ch 9 “Name 9”', 'Ch 20 “Name 20”'])
    expect(l.lines).toContain('Ch 15 “Name 15” (this chapter)')
  })

  it('keeps a name the planner gives only when one was asked for, one line, without quotes, number or full stop', () => {
    expect(planName('  “Chapter 3: The Far   Bank.” ')).toBe('The Far Bank')
    expect(planName('Ch. 4 – Salt')).toBe('Salt')
    expect(planName('"Chapter Three"')).toBe('')
    expect(planName('Chapter and Verse')).toBe('Chapter and Verse')
    expect(planName(null)).toBe('')
    const long = planName(`The ${'very '.repeat(30)}end`)
    expect(long.length).toBeLessThanOrEqual(NAME_MOST)
    expect(long.endsWith('very')).toBe(true)
    const { db, s1, s2 } = world()
    const refs = [
      { id: s1, n: 1, title: 'The ferry', label: 'Sc 1 “The ferry”' },
      { id: s2, n: 2, title: 'The inn', label: 'Sc 2 “The inn”' }
    ]
    const raw = readChapterPlan('{"title": "“The Far Bank”", "overview": "Mara crosses.", "scenes": [{"scene": "Sc 1", "does": "Mara meets Tobin."}]}')!
    expect(raw.title).toBe('“The Far Bank”')
    expect(checkChapterPlan(raw, { db, scenes: refs, people: [], nameWanted: true })!.title).toBe('The Far Bank')
    expect(checkChapterPlan(raw, { db, scenes: refs, people: [] })!.title).toBeUndefined()
    expect(checkChapterPlan({ ...raw, title: 'Chapter 1' }, { db, scenes: refs, people: [], nameWanted: true })!.title).toBeUndefined()
  })

  it('takes the name as Adam kept it: changed, cleared (the title stays), or left as the plan had it', () => {
    const plan: ChapterWritingPlan = { title: 'The Far Bank', overview: 'Mara crosses.', questions: [], scenes: [] }
    expect(withAnswer(plan, {}).title).toBe('The Far Bank')
    expect(withAnswer(plan, { title: '  Across the   Water ' }).title).toBe('Across the Water')
    expect('title' in withAnswer(plan, { title: '' })).toBe(false)
    expect('title' in withAnswer(plan, { title: 'Chapter 1' })).toBe(false)
    // A plan that named nothing is never given a name.
    expect('title' in withAnswer({ ...plan, title: undefined }, { title: 'Sneaked in' })).toBe(false)
  })

  it('names the chapter as Adam says write, before any scene is written, says so in the report, and Undo puts the title back', { timeout: 30_000 }, async () => {
    const { db, chapterId, s1 } = named()
    const d = deps(db)
    const progress: ChapterWriterProgress[] = []
    d.progress = (p) => progress.push(p)
    const shown: ChapterWritingPlan[] = []
    d.review = async (plan) => {
      shown.push(plan)
      // Nothing is renamed while the plan waits.
      expect(repo.getChapter(db, chapterId).title).toBe('Chapter 1')
      return {}
    }
    const renamed: string[] = []
    d.rename = (id, title) => {
      renamed.push(title)
      repo.updateChapter(db, id, { title })
    }
    const titles: string[] = []
    const draft = d.draft
    d.draft = async (sceneId, o) => {
      titles.push(repo.getChapter(db, chapterId).title)
      return draft(sceneId, o)
    }
    const run = new ChapterRun(d, 'run-named', chapterId)
    run.prepare()
    const report = await run.run()
    expect(report.status).toBe('done')
    // The brief lists the other chapters' names and asks for one in their style; the plan brings it to the review.
    const plan = chapterRecords(db)[0]
    expect(plan.user).toContain("## The story's chapters, in order\n- Ch 1 (this chapter)\n- Ch 2 “The Road North”")
    expect(plan.user).toContain("This chapter has no name of its own yet: give it one in `title`, in the same style as the other chapters' names above")
    expect(plan.system).toContain('- title: a name for this chapter, only when the brief asks for one.')
    expect(shown[0].title).toBe('The Far Bank')
    // Saved once, through the rename, before the first draft; the run then calls the chapter by it.
    expect(renamed).toEqual(['The Far Bank'])
    expect(titles[0]).toBe('The Far Bank')
    expect(repo.getChapter(db, chapterId).title).toBe('The Far Bank')
    expect(progress.some((p) => p.note === 'The critic is reading Ch 1 “The Far Bank”')).toBe(true)
    expect(report.named).toEqual({ from: 'Chapter 1', to: 'The Far Bank' })
    expect(loadReport(db, chapterId)?.named).toEqual({ from: 'Chapter 1', to: 'The Far Bank' })
    expect(report.plan?.title).toBe('The Far Bank')
    // Undo puts the title back while the chapter still has the run's name; never over a name Adam gave it since.
    expect(titleToPutBack(db, chapterId)).toBe('Chapter 1')
    repo.updateChapter(db, chapterId, { title: 'Adam’s Own' })
    expect(titleToPutBack(db, chapterId)).toBeNull()
    repo.updateChapter(db, chapterId, { title: 'The Far Bank' })
    // A new run forgets what the last one named.
    new ChapterRun(deps(db), 'run-again', chapterId).prepare()
    expect(titleToPutBack(db, chapterId)).toBeNull()
    expect(repo.getScene(db, s1).text).toContain('The rain went on.')
  })

  it('saves the name Adam changed, keeps the title when he cleared it, and changes nothing when he cancels', { timeout: 30_000 }, async () => {
    for (const [answer, title] of [
      [{ title: 'Across the Water' }, 'Across the Water'],
      [{ title: '' }, 'Chapter 1'],
      [null, 'Chapter 1']
    ] as const) {
      const { db, chapterId } = named()
      const d = deps(db)
      d.critic = () => false
      d.review = async () => answer
      const run = new ChapterRun(d, 'run-kept', chapterId)
      run.prepare()
      const report = await run.run()
      expect(report.status).toBe(answer ? 'done' : 'cancelled')
      expect(repo.getChapter(db, chapterId).title).toBe(title)
      expect(report.named?.to).toBe(title === 'Chapter 1' ? undefined : title)
      expect(titleToPutBack(db, chapterId)).toBe(title === 'Chapter 1' ? null : 'Chapter 1')
    }
  })

  it('never renames a chapter with a name of its own, nor one Adam named while the plan waited; names a story’s only chapter', { timeout: 30_000 }, async () => {
    // Its own name: the brief lists the chapters but asks for none, and the plan names nothing.
    const own = named()
    repo.updateChapter(own.db, own.chapterId, { title: 'The Crossing' })
    const report = await (async () => {
      const run = new ChapterRun({ ...deps(own.db), critic: () => false }, 'run-own-name', own.chapterId)
      run.prepare()
      return run.run()
    })()
    expect(chapterRecords(own.db)[0].user).toContain('- Ch 1 “The Crossing” (this chapter)')
    expect(chapterRecords(own.db)[0].user).not.toContain('give it one in `title`')
    expect(report.plan?.title).toBeUndefined()
    expect(report.named).toBeUndefined()
    expect(repo.getChapter(own.db, own.chapterId).title).toBe('The Crossing')
    // Named by Adam (in the binder, say) while the plan waited: his name stays.
    const mid = named()
    const d = deps(mid.db)
    d.critic = () => false
    d.review = async () => {
      repo.updateChapter(mid.db, mid.chapterId, { title: 'Adam’s Own' })
      return {}
    }
    const run = new ChapterRun(d, 'run-mid', mid.chapterId)
    run.prepare()
    expect((await run.run()).named).toBeUndefined()
    expect(repo.getChapter(mid.db, mid.chapterId).title).toBe('Adam’s Own')
    // The story's only chapter: no others to list, and still named, to fit the story.
    const alone = world()
    const lone = new ChapterRun({ ...deps(alone.db), critic: () => false }, 'run-alone', alone.chapterId)
    lone.prepare()
    expect((await lone.run()).named).toEqual({ from: 'Chapter 1', to: 'The Far Bank' })
    expect(chapterRecords(alone.db)[0].user).not.toContain("## The story's chapters")
    expect(chapterRecords(alone.db)[0].user).toContain('a few words that fit the story and what this chapter does')
    expect(repo.getChapter(alone.db, alone.chapterId).title).toBe('The Far Bank')
  })
})

describe('a chapter’s new scenes (repo.createScene)', () => {
  it('calls the first one “Scene 1” and leaves later ones untitled, so the writer labels them by number only', () => {
    const db = memoryWorld()
    const [story] = repo.listStories(db)
    const outline = repo.getOutline(db, story.id)
    const chapterId = outline.chapters[0].id
    expect(outline.scenes[0].title).toBe('Scene 1')
    const second = repo.createScene(db, chapterId)
    const third = repo.createScene(db, chapterId)
    expect([second.title, third.title]).toEqual(['', ''])
    // A new chapter's first scene is its "Scene 1" again.
    const next = repo.createChapter(db, story.id, {})
    expect(repo.createScene(db, next.id).title).toBe('Scene 1')

    const refs = chapterScenes(db, chapterId).map((s) => s.ref)
    expect(refs.map((r) => r.label)).toEqual(['Sc 1 “Scene 1”', 'Sc 2', 'Sc 3'])
    expect(placeLabel(db, third.id)).toBe('Ch 1, Sc 3')
    // Two untitled scenes are told apart by number, never by an empty title.
    expect(sceneNamed(refs, 'Sc 2')).toBe(second.id)
    expect(sceneNamed(refs, 'Sc 3')).toBe(third.id)
    expect(() => sceneNamed(refs, 'Untitled scene')).toThrow(/isn't a scene of this chapter/)
  })
})
