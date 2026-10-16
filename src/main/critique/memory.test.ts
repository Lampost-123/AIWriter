// The critic knows the story and remembers (2026-10-16): the facts it is told, what Adam said (kept in meta), the
// guard that keeps a new critique to it, Critique again, and the chapter writer's re-read said as such.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CritiqueNote, CritiqueWant } from '@shared/contracts/critique'
import type { ThreadDue } from '@shared/types'
import { defaultStyleGuide } from '@shared/defaults'
import * as repo from '../db/repo'
import { purgeTrash } from '../db/trash'
import { saveContractCheck } from '../checks/report'
import { memoryWorld } from '../../../tests/unit/helpers'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import type { JobModel } from '../ai/jobModel'
import { fitBlocks } from '../outline/brief'
import {
  addWant,
  carryEarlier,
  earlierForms,
  earlierIndex,
  guardNotes,
  loadWants,
  saidForms,
  sameNote,
  settledCount,
  withoutNote,
  type ReadNote
} from './memory'
import { critiqueFrom, readCritiqueReply } from './parse'
import { critiqueAsk, critiqueSystem, dueForCritic, factsForms, storyLines, NO_FACTS, SECOND_LINE, type CritiqueFacts } from './prompts'
import { critiqueBriefing, fitCritique, runCritique, type CritiqueDeps } from './run'
import { critiqueKey, dropWant, loadCritique, saveCritique, savedCritique, settleNote, textsHash } from './store'

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
const deps = (db: CritiqueDeps['db'], m = model()): CritiqueDeps => ({ db, model: m, prefs: PREFS, emit: () => undefined, retryDelays: [] })

const SCENE = `The ferry came in late. Mara stood at the rail and counted the lamps on the shore.

"You're late," said Tobin. He did not look up from the rope.`

function world() {
  const db = memoryWorld()
  const [story] = repo.listStories(db)
  const outline = repo.getOutline(db, story.id)
  const chapterId = outline.chapters[0].id
  const s1 = outline.scenes[0].id
  repo.createEntry(db, 'character', { name: 'Mara', summary: 'Runs the ferry.' })
  repo.saveSceneText(db, s1, null, SCENE)
  return { db, storyId: story.id, chapterId, s1 }
}

const note = (o: Partial<CritiqueNote> & Pick<CritiqueNote, 'id' | 'title'>): CritiqueNote => ({
  category: 'pacing',
  weight: 'medium',
  quote: '',
  sceneId: null,
  occurrence: 0,
  suggestion: 'Do something.',
  ...o
})

const base = { strengths: [], at: '2026-10-16T10:00:00.000Z', shortened: false, generationId: null }

describe('the facts the critic must respect', () => {
  const facts: CritiqueFacts = {
    premise: 'A ferrywoman smuggles a stolen heir across a river at war.',
    themes: 'Duty against love.',
    content: ['Romance: when adults have sex on the page, write the acts in full.', 'Violence: graphic detail is acceptable.'],
    limits: 'No harm to children.',
    card: {
      goal: 'Mara gets the boy across.',
      conflict: 'The patrol boat.',
      outcome: 'She lies to Tobin.',
      beats: ['The lamps', 'Tobin’s question', 'The lie'],
      notes: 'Keep her terse.',
      setsUp: ['The drowned bell'],
      paysOff: []
    },
    chapterGoal: 'Get everyone to the inn.',
    scenes: [],
    threads: [
      { name: 'The drowned bell', promise: 'Who rang it?', when: 'this scene sets it up' },
      { name: 'The debt', promise: 'Mara owes Osric.', when: dueForCritic({ chapterId: 'c9', label: 'Ch 7', from: 'adam', state: 'later' }) },
      { name: 'The key', promise: '', when: dueForCritic({ chapterId: 'c1', label: 'Ch 1', from: 'adam', state: 'now' }) }
    ],
    contract: [
      { part: 'change', text: 'Mara lies to Tobin about the boy.' },
      { part: 'keep', text: 'Tobin still blames her for the drowning.' }
    ],
    mustFix: [{ where: '', quote: 'He did not look up', message: 'Tobin is blind by now.' }]
  }

  it('say the premise, themes, content level and limits, the card’s plan, the chapter’s goal, threads with when they are due, the contract and the open must-fix problems', () => {
    const [full, short, smallest] = factsForms(facts, 'scene')
    for (const words of [
      'Premise: A ferrywoman smuggles',
      'Themes: Duty against love.',
      'The content level the author chose:\n- Romance: when adults have sex on the page',
      'Content limits (always respect these): No harm to children.',
      'What the scene card plans:\n- Goal: Mara gets the boy across.',
      '- Beats: (1) The lamps; (2) Tobin’s question; (3) The lie',
      '- Notes: Keep her terse.',
      '- Sets up: The drowned bell',
      "The chapter's goal: Get everyone to the inn.",
      '- The drowned bell (Who rang it?): this scene sets it up',
      '- The debt (Mara owes Osric.): to be paid off by the end of Ch 7, later: not a missing pay-off here',
      '- The key: due to be paid off by the end of this chapter',
      "This scene's contract (what its latest draft was written to):\n- Must change: Mara lies to Tobin about the boy.\n- Must not change: Tobin still blames her",
      '- “He did not look up”: Tobin is blind by now.'
    ])
      expect(full).toContain(words)
    // The smallest form keeps the content level, the card's plan, what must change and the urgent threads.
    expect(smallest).not.toContain('Premise')
    expect(smallest).toContain('Romance:')
    expect(smallest).toContain('- Goal: Mara gets the boy across.')
    expect(smallest).toContain('Must change: Mara lies')
    expect(smallest).not.toContain('Must not change')
    expect(smallest).toContain('The key: due')
    expect(smallest).not.toContain('The debt')
    expect(short.length).toBeLessThanOrEqual(full.length)
    expect(smallest.length).toBeLessThan(short.length)
    expect(factsForms({ ...facts, premise: 'Long premise. '.repeat(40) }, 'scene')[1].length).toBeLessThan(factsForms({ ...facts, premise: 'Long premise. '.repeat(40) }, 'scene')[0].length)
    expect(factsForms(NO_FACTS, 'scene')).toEqual([''])
  })

  it('say when a thread is due in the critic’s words: a set-up for later is no missing pay-off', () => {
    const due = (o: Partial<ThreadDue>): ThreadDue => ({ chapterId: 'c', label: 'Ch 4', from: 'adam', state: 'later', ...o })
    expect(dueForCritic(undefined)).toBe('still open, with no pay-off planned yet')
    expect(dueForCritic(due({ state: 'now' }))).toBe('due to be paid off by the end of this chapter')
    expect(dueForCritic(due({ state: 'overdue' }))).toBe('overdue: it was to be paid off by the end of Ch 4')
    expect(dueForCritic(due({ from: 'card', sceneLabel: 'Ch 7, Sc 2' }))).toBe('its pay-off is planned for Ch 7, Sc 2, later: not a missing pay-off here')
  })

  it('come with rules: keep to the card, the contract and due threads; a later pay-off isn’t missing; respect the content level and what the author said', () => {
    const system = critiqueSystem('scene')
    expect(system).toMatch(/never suggest cutting or changing what the scene card, the chapter's goal, the scene's contract or a plot thread due now requires/)
    expect(system).toMatch(/A set-up whose pay-off is planned for later is not a missing pay-off/)
    expect(system).toMatch(/never ask to tone down, cut, fade out or soften the sex, violence or language it allows/)
    expect(system).toMatch(/never raise a note he said isn't needed/)
    expect(storyLines({ title: 'T', style: { ...defaultStyleGuide(), notes: 'Short chapters.' }, tone: '' })).toContain("The author's other notes: Short chapters.")
  })

  it('reach a scene’s critic from the story, the card, the chapter, the contract and the open must-fix problems, and are never left out', () => {
    const { db, storyId, chapterId, s1 } = world()
    repo.updateStory(db, storyId, {
      premise: 'A ferrywoman smuggles a stolen heir.',
      themes: 'Duty against love.',
      style: { intensity: { romance: 4 }, contentLimits: 'No harm to children.' }
    })
    repo.updateChapter(db, chapterId, { goal: 'Get everyone to the inn.' })
    const bell = repo.createEntry(db, 'thread', { name: 'The drowned bell', fields: { promise: 'Who rang it?' } })
    repo.updateSceneCard(db, s1, {
      ...repo.getScene(db, s1).card,
      goal: 'Mara gets the boy across.',
      beats: ['The lamps', 'The lie'],
      notes: 'Keep her terse.',
      setsUpIds: [bell.id]
    })
    saveContractCheck(db, s1, { at: '2026-10-16T09:00:00.000Z', asks: 'scene', items: [{ part: 'change', text: 'Mara lies to Tobin.', result: 'kept' }] })
    const at = '2026-10-16T09:00:00.000Z'
    const add = db.prepare(
      "INSERT INTO issues (id, scene_id, story_id, kind, severity, status, quote, message, payload_json, created_at, updated_at) VALUES (?, ?, ?, 'fact', ?, ?, ?, ?, '{}', ?, ?)"
    )
    add.run('i1', s1, storyId, 'must-fix', 'open', 'He did not look up from the rope.', 'Tobin is blind by now.', at, at)
    add.run('i2', s1, storyId, 'warning', 'open', 'counted the lamps', 'Only worth a look.', at, at)
    add.run('i3', s1, storyId, 'must-fix', 'open', 'Words no longer in the scene.', 'Gone since.', at, at)
    const b = critiqueBriefing(db, { scope: 'scene', id: s1 }, PREFS)
    const facts = b.drafts.find((d) => d.id === 'facts')!
    expect(facts.keep).toBe(true)
    const text = facts.forms[0]
    expect(text).toContain('Premise: A ferrywoman smuggles a stolen heir.')
    expect(text).toContain('Themes: Duty against love.')
    expect(text).toMatch(/Romance: when adults have sex on the page/)
    expect(text).toContain('Content limits (always respect these): No harm to children.')
    expect(text).toContain('- Goal: Mara gets the boy across.')
    expect(text).toContain('- Beats: (1) The lamps; (2) The lie')
    expect(text).toContain('- Notes: Keep her terse.')
    expect(text).toContain("The chapter's goal: Get everyone to the inn.")
    expect(text).toContain('- The drowned bell (Who rang it?): this scene sets it up')
    expect(text).toContain('- Must change: Mara lies to Tobin.')
    expect(text).toContain('Tobin is blind by now.')
    expect(text).not.toContain('Only worth a look.')
    expect(text).not.toContain('Gone since.')
    // The card's block keeps who, where and when only: the plan is in the facts, said once.
    expect(b.drafts.find((d) => d.id === 'card')!.forms[0]).not.toContain('Mara gets the boy across.')
    // A small model shortens the facts, but never leaves them out.
    const fitted = fitCritique(b, model('fake/6k', 6000))
    const block = fitted.blocks.find((x) => x.id === 'facts')!
    expect(block.dropped).toBe(false)
  })

  it('a part to keep stops at its last form; another is left out past it', () => {
    const drafts = [
      { id: 'a', title: 'A', priority: 3, keep: true, forms: ['a '.repeat(400), 'a short'] },
      { id: 'b', title: 'B', priority: 3, forms: ['b '.repeat(400), 'b short'] },
      { id: 'c', title: 'C', priority: 0, forms: ['c'] }
    ]
    const out = fitBlocks(drafts, 'system', 40, 'test model')
    expect(out.blocks.find((x) => x.id === 'a')).toMatchObject({ dropped: false, short: true, text: 'a short' })
    expect(out.blocks.find((x) => x.id === 'b')!.dropped).toBe(true)
  })

  it('the scene before is told at more length, shortened before it is left out', () => {
    const { db, chapterId } = world()
    const long = Array.from({ length: 80 }, (_, i) => `Sentence ${i} of the scene before, about the river and the rain.`).join(' ')
    const [first] = repo.getOutline(db, repo.getChapter(db, chapterId).storyId).scenes
    repo.saveSceneText(db, first.id, null, long)
    const next = repo.createScene(db, chapterId, { title: 'The inn' }).id
    repo.saveSceneText(db, next, null, 'The inn was full. Nobody made room for her at the fire.')
    const before = critiqueBriefing(db, { scope: 'scene', id: next }, PREFS).drafts.find((d) => d.id === 'before')!
    expect(before.forms[0].split(/\s+/).length).toBeGreaterThan(280)
    expect(before.forms[1].split(/\s+/).length).toBeLessThan(170)
  })
})

describe('what Adam has said', () => {
  const lamps = note({ id: 'n1', title: 'The middle slows', quote: 'counted the lamps on the shore', sceneId: 's1' })

  it('notes the same thing: the same kind and words, or with no words the same title', () => {
    expect(sameNote(lamps, { ...lamps, title: 'Other', quote: 'Mara stood at the rail and counted the lamps on the shore.' })).toBe(true)
    expect(sameNote(lamps, { ...lamps, category: 'prose' })).toBe(false)
    expect(sameNote(note({ id: 'a', title: 'Too terse' }), note({ id: 'b', title: 'too terse.' }))).toBe(true)
  })

  it('carries what he acted on or set aside to the next critique, newest first, once each', () => {
    const prev = {
      notes: [
        { ...lamps, status: 'done' as const, newWords: 'In the end she counted them.' },
        note({ id: 'n2', title: 'Too terse', category: 'prose', status: 'dismissed' }),
        note({ id: 'n3', title: 'Not this', status: 'unwanted' }),
        note({ id: 'n4', title: 'Still to do' })
      ],
      earlier: [note({ id: 'n9', title: 'Too terse', category: 'prose', status: 'dismissed' }), note({ id: 'n8', title: 'Older', status: 'done' })]
    }
    expect(carryEarlier(prev).map((n) => n.title)).toEqual(['The middle slows', 'Too terse', 'Older'])
    expect(carryEarlier(null)).toEqual([])
  })

  it('tells the critic what isn’t for the story, what isn’t needed here and what he acted on', () => {
    const wants: CritiqueWant[] = [{ id: 'w1', category: 'prose', title: 'Sentences too terse', suggestion: 'Vary the length.', at: '' }]
    const [full, short] = saidForms('scene', wants, [
      note({ id: 'n1', title: 'Cut the dream', status: 'dismissed', quote: 'She dreamt of the sea.' }),
      { ...lamps, status: 'done', newWords: 'In the end she counted them.' }
    ])
    expect(full).toContain("He said these kinds of note aren't for this story")
    expect(full).toContain('- Prose: “Sentences too terse” (Vary the length.)')
    expect(full).toContain("He said these notes aren't needed for this scene: don't raise them again.\n- Pacing: “Cut the dream” on “She dreamt of the sea.”")
    expect(full).toContain('never give the opposite note on the words he put in.\n- Pacing: “The middle slows”; the words are now “In the end she counted them.”')
    expect(short).not.toContain('Vary the length.')
    expect(saidForms('scene', [], [])).toEqual([''])
  })

  it('on a re-read, lists the notes last time with P ids and what became of each', () => {
    const [full] = earlierForms(
      [
        { ...lamps, status: 'done', newWords: 'In the end she counted them.' },
        note({ id: 'n2', title: 'Too terse', status: 'dismissed' }),
        note({ id: 'n3', title: 'Not this', status: 'unwanted' }),
        note({ id: 'n4', title: 'Words changed', quote: 'old words' }),
        note({ id: 'n5', title: 'Still here', quote: 'Tobin' })
      ],
      new Set(['n4'])
    )
    expect(full).toContain('- [P1] Pacing: “The middle slows” on “counted the lamps on the shore”. You said: Do something. — The author acted on it: he accepted a rewrite. The words are now “In the end she counted them.”')
    expect(full).toContain('[P2] Pacing: “Too terse”. You said: Do something. — He said it isn’t needed.')
    expect(full).toContain('[P3] Pacing: “Not this”. You said: Do something. — He said this kind of note isn’t for this story.')
    expect(full).toContain('[P4] Pacing: “Words changed” on “old words”. You said: Do something. — Still to do, but its words have changed since.')
    expect(full).toContain('[P5] Pacing: “Still here” on “Tobin”. You said: Do something. — Still to do: its words are as they were.')
    expect(earlierForms([], new Set())).toEqual([''])
    expect(earlierIndex('P2', 3)).toBe(1)
    expect(earlierIndex('p1', 3)).toBe(0)
    expect(earlierIndex(3, 3)).toBe(2)
    expect(earlierIndex('P4', 3)).toBeNull()
    expect(earlierIndex('n1', 3)).toBeNull()
  })

  it('keeps a new critique to it: nothing he set aside comes back, and the opposite of what he acted on is left out', () => {
    const previous = [
      { ...lamps, status: 'done' as const, newWords: 'In the end, Mara stood at the rail and counted every lamp.' },
      note({ id: 'n2', title: 'Too terse', category: 'prose', quote: 'said Tobin', sceneId: 's1', status: 'dismissed' }),
      note({ id: 'n3', title: 'Still to do', category: 'dialogue', quote: 'You’re late', sceneId: 's1' })
    ]
    const wants: CritiqueWant[] = [{ id: 'w1', category: 'voice', title: 'Mara is too cold', suggestion: '', at: '' }]
    const fresh: ReadNote[] = [
      // The opposite of the note he acted on, on the words he put in: left out.
      note({ id: 'n1', title: 'Now it rushes', quote: 'counted every lamp', sceneId: 's1' }),
      // The same again, said to be that note still standing: kept.
      { ...note({ id: 'n2', title: 'The middle still slows', quote: 'Mara stood at the rail', sceneId: 's1' }), earlierRef: 0 },
      // Like the one he said isn't needed: left out.
      note({ id: 'n3', title: 'Terse again', category: 'prose', quote: '"You\'re late," said Tobin.', sceneId: 's1' }),
      // A kind he said isn't for this story: left out.
      note({ id: 'n4', title: 'Mara is too cold', category: 'voice' }),
      // Given again from last time: kept, and said so.
      { ...note({ id: 'n5', title: 'Still to do', category: 'dialogue' }), earlierRef: 2 },
      // Given again but he set it aside: left out.
      { ...note({ id: 'n6', title: 'Anything', category: 'clarity' }), earlierRef: 1 },
      note({ id: 'n7', title: 'New', category: 'ending' })
    ]
    const kept = guardNotes(fresh, { previous, earlier: [], wants })
    expect(kept.map((n) => [n.id, n.title, n.repeated ?? false])).toEqual([
      ['n1', 'The middle still slows', true],
      ['n2', 'Still to do', true],
      ['n3', 'New', false]
    ])
    expect(kept.some((n) => 'earlierRef' in n)).toBe(false)
    // How many of last time's notes are settled: those he dealt with, and those the critic says are, unless given again.
    expect(settledCount(previous, [2], fresh)).toBe(1)
    expect(settledCount(previous, [], [note({ id: 'x', title: 'x' })])).toBe(2)
  })

  it('reads "settled" and "earlier" from a re-read’s reply', () => {
    const reply = readCritiqueReply(
      JSON.stringify({ summary: 'Better.', settled: ['P1', 'p3', 'P9'], notes: [{ title: 'Still slow', category: 'pacing', earlier: 'P2', suggestion: 'Cut.' }] })
    )
    if (!reply.ok) throw new Error(reply.why)
    const read = critiqueFrom(reply.value, [{ sceneId: 's1', text: SCENE }], { scope: 'scene', id: 's1' }, 3)
    expect(read.settled).toEqual([0, 2])
    expect(read.notes[0].earlierRef).toBe(1)
    // Without notes last time, an "earlier" means nothing.
    expect(critiqueFrom(reply.value, [{ sceneId: 's1', text: SCENE }], { scope: 'scene', id: 's1' }).notes[0].earlierRef).toBeUndefined()
  })

  it('a kind of note not for the story is kept newest first, once, and goes when its note is brought back', () => {
    const from = { scope: 'scene' as const, targetId: 's1', noteId: 'n1' }
    let wants = addWant([], note({ id: 'n1', title: 'Too terse', category: 'prose' }), from, 'at', 'w1')
    wants = addWant(wants, note({ id: 'n2', title: 'too terse', category: 'prose' }), undefined, 'at', 'w2')
    expect(wants.map((w) => w.id)).toEqual(['w2'])
    wants = addWant(wants, note({ id: 'n1', title: 'Cold', category: 'voice' }), from, 'at', 'w3')
    expect(withoutNote(wants, from).map((w) => w.id)).toEqual(['w2'])
  })
})

describe('keeping what Adam did', () => {
  it('marks a note done with the words its rewrite put in, not needed, or back; and says which notes’ words have changed', () => {
    const { db, s1 } = world()
    const target = { scope: 'scene' as const, id: s1 }
    saveCritique(db, {
      ...base,
      scope: 'scene',
      targetId: s1,
      summary: 'S.',
      textHash: textsHash([{ sceneId: s1, text: SCENE }]),
      notes: [
        note({ id: 'n1', title: 'The middle slows', quote: 'counted the lamps on the shore', sceneId: s1 }),
        note({ id: 'n2', title: 'Too terse', quote: 'He did not look up from the rope.', sceneId: s1 })
      ]
    })
    expect(savedCritique(db, target)).toMatchObject({ changed: false, gone: [], wants: [] })
    const done = settleNote(db, { target, noteId: 'n1', status: 'done', newWords: '  In the end   she counted them. ', at: base.at })
    expect(done?.critique.notes[0]).toMatchObject({ status: 'done', newWords: 'In the end she counted them.' })
    // A note's words gone from the scene: said, unless it is dealt with.
    repo.saveSceneText(db, s1, null, 'The ferry came in late. In the end she counted them.')
    expect(savedCritique(db, target)).toMatchObject({ changed: true, gone: ['n2'] })
    settleNote(db, { target, noteId: 'n2', status: 'dismissed' })
    expect(savedCritique(db, target)?.gone).toEqual([])
    // Back to still to do.
    expect(settleNote(db, { target, noteId: 'n2', status: null })?.critique.notes[1].status).toBeUndefined()
    // A note of a critique written again since is left alone.
    expect(settleNote(db, { target, noteId: 'n2', status: 'done', at: 'another time' })?.critique.notes[1].status).toBeUndefined()
    expect(settleNote(db, { target, noteId: 'n9', status: 'done' })).toBeNull()
    // Unknown statuses read as none.
    const raw = JSON.parse(repo.getMeta(db, critiqueKey(target))!)
    raw.notes[1].status = 'weird'
    repo.setMeta(db, critiqueKey(target), JSON.stringify(raw))
    expect(loadCritique(db, target)?.notes[1].status).toBeUndefined()
  })

  it('"Not for this story" is kept for the story and told to every later critique; allowed again, it goes', () => {
    const { db, storyId, s1, chapterId } = world()
    const target = { scope: 'scene' as const, id: s1 }
    saveCritique(db, {
      ...base,
      scope: 'scene',
      targetId: s1,
      summary: 'S.',
      textHash: '',
      notes: [note({ id: 'n1', title: 'Sentences too terse', category: 'prose', suggestion: 'Vary the length.' })]
    })
    const after = settleNote(db, { target, noteId: 'n1', status: 'unwanted' })
    expect(after?.wants.map((w) => w.title)).toEqual(['Sentences too terse'])
    expect(loadWants(db, storyId)[0]).toMatchObject({ category: 'prose', from: { scope: 'scene', targetId: s1, noteId: 'n1' } })
    // Another scene of the story is critiqued knowing it.
    const other = repo.createScene(db, chapterId, { title: 'The inn' }).id
    repo.saveSceneText(db, other, null, 'The inn was full.')
    const said = critiqueBriefing(db, { scope: 'scene', id: other }, PREFS).drafts.find((d) => d.id === 'said')!
    expect(said.forms[0]).toContain('- Prose: “Sentences too terse” (Vary the length.)')
    // Brought back, it goes from the story too.
    settleNote(db, { target, noteId: 'n1', status: null })
    expect(loadWants(db, storyId)).toEqual([])
    // Allowed again from the list: gone, and its note is still to do again.
    settleNote(db, { target, noteId: 'n1', status: 'unwanted' })
    const [want] = loadWants(db, storyId)
    expect(dropWant(db, target, want.id)).toEqual([])
    expect(loadCritique(db, target)?.notes[0].status).toBeUndefined()
    expect(repo.getMeta(db, `critique_wants:${storyId}`)).toBeNull()
  })

  it('goes with its scene, chapter or story once they are gone for good', () => {
    const { db, storyId, s1, chapterId } = world()
    saveCritique(db, { ...base, scope: 'scene', targetId: s1, summary: 'S.', textHash: '', notes: [note({ id: 'n1', title: 'X' })] })
    saveCritique(db, { ...base, scope: 'chapter', targetId: chapterId, summary: 'C.', textHash: '', notes: [] })
    settleNote(db, { target: { scope: 'scene', id: s1 }, noteId: 'n1', status: 'unwanted' })
    repo.deleteStory(db, storyId)
    purgeTrash(db, 0, Date.now() + 60_000)
    expect(repo.getMeta(db, critiqueKey({ scope: 'scene', id: s1 }))).toBeNull()
    expect(repo.getMeta(db, critiqueKey({ scope: 'chapter', id: chapterId }))).toBeNull()
    expect(repo.getMeta(db, `critique_wants:${storyId}`)).toBeNull()
  })
})

describe('Critique again, end to end', () => {
  it('sends the notes last time with what became of each, never reverses one acted on, and keeps what was set aside', async () => {
    const { db, s1 } = world()
    const target = { scope: 'scene' as const, id: s1 }
    const first = await runCritique(deps(db), { taskId: 't1', target })
    if (first.status !== 'complete') throw new Error(first.status)
    expect(first.critique.reread).toBeUndefined()
    // Adam rewrites the noted words and accepts; sets the other aside.
    const rewritten = SCENE.replace('Mara stood at the rail', 'In the end, mara stood at the rail')
    repo.saveSceneText(db, s1, null, rewritten)
    settleNote(db, { target, noteId: 'n1', status: 'done', newWords: 'In the end, mara stood at the rail and counted the lamps on the shore.' })
    settleNote(db, { target, noteId: 'n2', status: 'dismissed' })

    const b = critiqueBriefing(db, target, PREFS, true)
    const sent = b.drafts.find((d) => d.id === 'earlier')!.forms[0]
    expect(sent).toContain('[P1] Pacing: “The middle slows”')
    expect(sent).toContain('The author acted on it')
    expect(sent).toMatch(/\[P2\] Prose: “A quote from nowhere”\. You said: .* — He said it isn’t needed\./)
    const ask = b.drafts.find((d) => d.id === 'ask')!.forms[0]
    expect(ask).toContain(SECOND_LINE('scene'))
    expect(ask).toContain('"settled"')
    expect(ask).not.toContain('This is a re-read')

    const again = await runCritique(deps(db), { taskId: 't2', target, again: true })
    if (again.status !== 'complete') throw new Error(again.status)
    // The fake gives "The middle slows" again on the new words without saying it still stands, and the note from
    // nowhere again: the first is the note he acted on, the second one he set aside.
    expect(again.critique.notes).toEqual([])
    expect(again.critique).toMatchObject({ reread: true, settledSince: 2 })
    expect(again.critique.earlier?.map((n) => [n.title, n.status])).toEqual([
      ['The middle slows', 'done'],
      ['A quote from nowhere', 'dismissed']
    ])
    // What was carried is told next time, too.
    const next = critiqueBriefing(db, target, PREFS, true).drafts.find((d) => d.id === 'said')!
    expect(next.forms[0]).toContain('never give the opposite note on the words he put in')
  })

  it('the chapter writer’s re-read is kept saying so, and asks leniently', async () => {
    const { db, s1 } = world()
    const target = { scope: 'scene' as const, id: s1 }
    expect(critiqueBriefing(db, target, PREFS, true, { by: 'chapter-writer' }).drafts.find((d) => d.id === 'ask')!.forms[0]).toMatch(/This is a re-read/)
    const out = await runCritique(deps(db), { taskId: 't3', target, again: true, by: 'chapter-writer' })
    if (out.status !== 'complete') throw new Error(out.status)
    expect(out.critique).toMatchObject({ reread: true, by: 'chapter-writer', notes: [] })
    expect(loadCritique(db, target)).toMatchObject({ reread: true, by: 'chapter-writer' })
    expect(critiqueAsk('scene', 'X', true, { adam: true, earlier: true })).toContain('"earlier": its id')
  })
})
