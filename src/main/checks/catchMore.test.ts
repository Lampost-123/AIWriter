// The checker catches more (2026-10-16): a live run of the long test book's planted slips found "Check this scene" threw
// away every continuity finding, told the checks too few of the old facts and entries a scene touches, gave them none of
// the author's plan, the story calendar or the threads, and never asked what a scene says about the past. Invented test
// text only (the long test book's own, tests/traps).
import { describe, expect, it } from 'vitest'
import type { EntryState, FactState, ID, RelationshipState, SceneCard } from '@shared/types'
import { ALL_CHECKS, DONE_CHECKS } from '@shared/contracts/checks'
import { emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as cdb from '../db/checks'
import { memoryWorld } from '../../../tests/unit/helpers'
import { PLANTED } from '../../../tests/traps/book'
import { checkOf, foundIssues, readCheckReply } from './parse'
import {
  checkSections,
  factRelevance,
  factsThatMatter,
  factsTheWordsTouch,
  gatherSceneCheck,
  planText,
  relatedEntries,
  threadDueWords,
  MOST_RELATED
} from './context'
import { sceneSystem } from './prompts'
import { lessonsBefore, lessonsFrom, RECENT_SCENES } from './lessons'
import { codexLines, repairSystem } from '../repair/prompts'
import { meaningScores } from '../retrieval/recall'
import { stubEmbedder } from '../retrieval/stub'

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

const entry = (id: ID, kind: EntryState['kind'], name: string, more: Partial<EntryState> = {}): EntryState =>
  ({
    id,
    kind,
    name,
    aliases: [],
    summary: '',
    description: '',
    tags: [],
    notes: '',
    fields: {},
    parentId: null,
    hardRule: false,
    origin: 'adam',
    fieldOrigins: {},
    happened: [],
    changed: [],
    ...more
  }) as unknown as EntryState

const fact = (factId: ID, text: string, knownBy: ID[], at: number): FactState => ({ factId, fact: text, knownBy, at })

// The X6 reply of the live run on 2026-10-16 (the long test book, invented), word for word.
const X6_REPLY = `{"issues": [{"check": "continuity", "severity": "warning", "quote": "Kit read nothing over her shoulder, but he watched her face.", "message": "Kit was asleep beside Tamsin on Gilt Street when the previous scene ended, yet here he is awake and watching her write with no waking shown.", "conflicts": {"scene": "S3"}, "memory": "asleep beside Tamsin on Gilt Street", "text": "awake, watching her write", "fix": "Kit had woken and sat with her, reading nothing over her shoulder, but watching her face.", "advice": "Show Kit waking or arriving at the clock-house before he speaks, or cut his lines."}, {"check": "continuity", "severity": "warning", "quote": "‘The old woman told you his heart won’t last the summer,’ Kit said.", "message": "Kit says this to Tamsin, but the memory has Isla Thorne telling Tamsin of Leckie's failing heart and swearing her to secrecy, not telling Kit.", "conflicts": {"entry": "E2", "field": "pastEvents"}, "memory": "Isla told Tamsin, who was sworn to secrecy", "text": "Kit says the old woman told him", "fix": "‘The old woman told you his heart won’t last the summer,’ Kit said.", "advice": "Have Kit say he overheard Isla, or that Tamsin told him, or cut the line."}], "checked": [{"check": "facts", "ok": false, "note": "Tamsin's healed wrist, her coat and the letter to Leckie fit the memory; but Kit's knowledge of Leckie's heart is given to him by Isla, who told only Tamsin."}, {"check": "knowledge", "ok": false, "note": "Kit speaks of Leckie's failing heart as something the old woman told him, though the memory has Isla telling Tamsin and swearing her to secrecy."}, {"check": "timeline", "ok": true, "note": "The scene sits on Day 50, three days after Thaw Day, and the clock running again matches the scenes before."}, {"check": "continuity", "ok": false, "note": "The previous scene ended with Kit asleep beside Tamsin on Gilt Street; here he is awake and watching her write with no waking shown."}, {"check": "voice", "ok": true, "note": "Tamsin's plain, careful letter and Kit's easy, plain speech match their established voices."}, {"check": "style", "ok": true, "note": "The scene keeps the book's past-tense, close-third narration and its plain, concrete diction."}]}`

describe('continuity findings are kept (fix 1)', () => {
  it('reads continuity and the words a model may use for it, before the timeline ("stage" has "age" in it)', () => {
    expect(checkOf('continuity', DONE_CHECKS)).toBe('continuity')
    expect(checkOf('Continuity', ALL_CHECKS)).toBe('continuity')
    expect(checkOf('physical continuity', ALL_CHECKS)).toBe('continuity')
    expect(checkOf('staging', ALL_CHECKS)).toBe('continuity')
    expect(checkOf('stage', ALL_CHECKS)).toBe('continuity')
    expect(checkOf('where things stand', ALL_CHECKS)).toBe('continuity')
    expect(checkOf('clothing', ALL_CHECKS)).toBe('continuity')
    expect(checkOf('who knows what', ALL_CHECKS)).toBe('knowledge')
    // As before.
    expect(checkOf('timeline and place', ALL_CHECKS)).toBe('timeline')
    expect(checkOf('travel time', ALL_CHECKS)).toBe('timeline')
    // Not asked for: still dropped.
    expect(checkOf('continuity', ['facts', 'knowledge'])).toBeNull()
  })

  it('keeps both continuity findings of the long test book’s X6 reply (the live run kept neither)', () => {
    const x6 = PLANTED.find((p) => p.id === 'X6')!
    const text = x6.paragraphs.join('\n\n')
    const reply = readCheckReply(X6_REPLY)
    if (!reply.ok) throw new Error(reply.why)
    const tamsin = entry('tamsin', 'character', 'Tamsin Orr', { aliases: ['Tamsin'] })
    const found = foundIssues(reply.items, {
      sceneId: 'x6',
      storyId: 'book',
      text,
      checks: ALL_CHECKS,
      entries: new Map([['E2', tamsin]]),
      scenes: new Map([['S3', { sceneId: 's40', label: 'Ch 14, Sc 3' }]]),
      canUpdateMemory: () => false
    })
    expect(found.map((f) => [f.kind, f.quote])).toEqual([
      ['continuity', 'Kit read nothing over her shoulder, but he watched her face.'],
      ['continuity', '‘The old woman told you his heart won’t last the summer,’ Kit said.']
    ])
    expect(found[1].payload.sources).toEqual([{ kind: 'entry', entryId: 'tamsin', name: 'Tamsin Orr', field: 'pastEvents' }])
    expect(found[0].payload.sources).toEqual([{ kind: 'scene', sceneId: 's40', label: 'Ch 14, Sc 3' }])
  })
})

describe('the facts a scene touches come first, however old (fix 2)', () => {
  const tamsin = entry('tamsin', 'character', 'Tamsin Orr', { aliases: ['Tamsin'] })
  const kit = entry('kit', 'character', 'Kit Ansel', { aliases: ['Kit'] })
  const leckie = entry('leckie', 'character', 'Edwin Leckie', { aliases: ['Leckie'] })
  // 60 facts Tamsin learned lately, and the one the scene touches, learned long ago.
  const recent = Array.from({ length: 60 }, (_, i) => fact(`f${i}`, `Tamsin counted the ledger’s column ${i} again at the bench`, ['tamsin'], 100 + i))
  const heart = fact('heart', 'Isla told Tamsin that Leckie’s heart will not last the summer', ['tamsin'], 10)
  const facts = [heart, ...recent]
  const text = '‘The old woman told you his heart won’t last the summer,’ Kit said. Tamsin folded the letter to Leckie.'

  it('scores each fact by the scene’s own words, the names of the people here left out', () => {
    const rank = factRelevance(facts, text, ['Tamsin Orr', 'Tamsin', 'Kit Ansel', 'Kit', 'Leckie', 'Edwin Leckie'])
    expect(rank.get('heart')).toBe(1)
    // The rest share only a stray word, if any.
    expect([...rank.entries()].filter(([id]) => id !== 'heart').every(([, s]) => s < 1)).toBe(true)
    expect(factRelevance(facts, '', [])).toEqual(new Map())
  })

  it('keeps an old fact the words touch when there are more than the list holds; without a ranking, as before', () => {
    const rank = factRelevance(facts, text, ['Tamsin Orr', 'Tamsin', 'Kit Ansel', 'Kit'])
    const kept = factsThatMatter(facts, [tamsin, kit], [tamsin, kit, leckie], 40, undefined, rank)
    expect(kept.map((f) => f.factId)).toContain('heart')
    // By recency alone (the live run) it was cut.
    expect(factsThatMatter(facts, [tamsin, kit], [tamsin, kit], 40).map((f) => f.factId)).not.toContain('heart')
  })

  it('tells the facts check the facts the words touch, the most touched first, at most ten', () => {
    const rank = factRelevance(facts, text, ['Tamsin Orr', 'Tamsin', 'Kit Ansel', 'Kit'])
    const touched = factsTheWordsTouch(facts, [tamsin, kit], [tamsin, kit], rank)
    expect(touched[0].factId).toBe('heart')
    expect(touched.length).toBeLessThanOrEqual(10)
    expect(factsTheWordsTouch(facts, [tamsin, kit], [tamsin, kit], new Map())).toEqual([])
  })

  it('by meaning too, when the search model is on: the stand-in finds a vow in an oath sworn', async () => {
    const vow = fact('vow', 'Tobin swore an oath to come back for Mara', ['mara'], 1)
    const other = fact('rain', 'The mill race floods each spring', ['mara'], 2)
    const meaning = await meaningScores({ index: null, embedder: stubEmbedder() }, ['Mara thought of his vow.'], [
      { key: 'vow', text: vow.fact },
      { key: 'rain', text: other.fact }
    ])
    expect(meaning?.get('vow')).toBe(1)
    expect(meaning?.get('rain') ?? 0).toBeLessThan(0.3)
    // No keyword shared, but close in meaning: touched.
    expect(factRelevance([vow, other], 'Mara thought of his vow.', ['Mara']).has('vow')).toBe(false)
    expect(factRelevance([vow, other], 'Mara thought of his vow.', ['Mara'], meaning).get('vow')).toBe(1)
    // No search model: nothing by meaning.
    expect(await meaningScores({ index: null, embedder: null }, ['x'], [{ key: 'a', text: 'a' }])).toBeNull()
  })
})

describe('entries tied to the scene though it doesn’t name them (fix 3)', () => {
  const tamsin = entry('tamsin', 'character', 'Tamsin Orr', { aliases: ['Tamsin'] })
  const kit = entry('kit', 'character', 'Kit Ansel', { aliases: ['Kit'] })
  const bettany = entry('bettany', 'character', 'Bettany Leckie', { aliases: ['Bettany'], summary: 'Edwin Leckie’s widowed sister in Hollin.' })
  const sledge = entry('sledge', 'item', 'The Long Patience', { aliases: ['the sledge'], summary: 'Kit Ansel’s dog sledge, with a painted backboard.' })
  const hollin = entry('hollin', 'place', 'Hollin', { summary: 'A grey stone mining town four days north up the river.' })
  const aldous = entry('aldous', 'character', 'Aldous Orr', { summary: 'A clockmaker, drowned through the ice.' })
  const pim = entry('pim', 'character', 'Pim Orr', { aliases: ['Pim'], summary: 'Tamsin’s brother, seventeen.' })
  const thread = entry('bell', 'thread', 'The bell rope', { summary: 'Kit Ansel owes the guild a bell rope.' })
  const noise = Array.from({ length: 12 }, (_, i) => entry(`n${i}`, 'place', `Wharf ${i}`, { summary: 'A wharf of Callowmere.' }))
  const rels: RelationshipState[] = [{ aId: 'tamsin', bId: 'aldous', type: 'father and daughter', aFeels: '', bFeels: '', where: '' }]
  const memory = { entries: [tamsin, kit, bettany, sledge, hollin, aldous, pim, thread, ...noise], relationships: rels }

  it('brings what someone here owns though the words never name it, and never a plot thread', () => {
    const text = 'It stood on its runners in the yard, its backboard scrubbed for the journey home. Kit had been at it since noon.'
    const got = relatedEntries(memory, { taken: new Set(['tamsin', 'kit']), people: ['tamsin', 'kit'], povId: 'tamsin', text })
    expect(got[0]).toEqual({ id: 'sledge', why: 'tied to someone here' })
    expect(got.map((g) => g.id)).not.toContain('bell')
    // Naming only the point of view (as most of the codex does) isn't enough on its own.
    expect(got.map((g) => g.id)).not.toContain('pim')
    expect(got.length).toBeLessThanOrEqual(MOST_RELATED)
  })

  it('brings the town a named person’s entry names, one step away', () => {
    const text = 'Leckie would be sitting by Bettany’s stove.'
    const got = relatedEntries(memory, { taken: new Set(['tamsin', 'bettany']), people: ['tamsin', 'bettany'], povId: 'tamsin', text })
    expect(got.map((g) => g.id)).toContain('hollin')
  })

  it('brings the point of view’s family the words speak of, by a relationship or a summary that says so', () => {
    const father = relatedEntries(memory, { taken: new Set(['tamsin']), people: ['tamsin'], povId: 'tamsin', text: 'She thought of her father in his last illness.' })
    expect(father[0]).toEqual({ id: 'aldous', why: 'family of the point of view' })
    const brother = relatedEntries(memory, { taken: new Set(['tamsin']), people: ['tamsin'], povId: 'tamsin', text: 'She heard her brother on the stairs.' })
    expect(brother[0]).toEqual({ id: 'pim', why: 'family of the point of view' })
    expect(relatedEntries(memory, { taken: new Set(['tamsin']), people: ['tamsin'], povId: 'tamsin', text: '', most: 3 })).toEqual([])
  })

  it('in a real world: a check is told the sledge the scene never names, with why', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const s1 = repo.getOutline(db, story.id).scenes[0].id
    const kitE = repo.createEntry(db, 'character', { name: 'Kit Ansel', aliases: ['Kit'] })
    repo.createEntry(db, 'item', { name: 'The Long Patience', aliases: ['the sledge'], summary: 'Kit Ansel’s dog sledge.' })
    repo.updateSceneCard(db, s1, { ...repo.getScene(db, s1).card, povId: kitE.id })
    repo.saveSceneText(db, s1, null, 'The Steady Hope stood on its runners in the yard. Kit scrubbed its backboard.')
    const ctx = gatherSceneCheck(db, s1, PREFS)
    expect(ctx.entries.map((c) => [c.entry.name, c.why])).toContainEqual(['The Long Patience', 'tied to someone here'])
    expect(checkSections(ctx, ['facts']).find((s) => s.id === 'memory')!.text).toContain('The Long Patience (item; tied to someone here)')
  })
})

describe('the author’s plan, the story calendar and the threads (fix 4), and what a scene says of the past (fix 5)', () => {
  it('tells the plan as the author’s intent, short, with the threads the card sets up or pays off', () => {
    const card: SceneCard = {
      ...emptySceneCard(),
      goal: 'Tobin hides where he was last night.',
      beats: ['Mara asks Tobin where he was.', 'Tobin lies: he says he was at the ferry.'],
      outcome: 'Mara believes him, for now.',
      notes: 'Keep it quiet.',
      paysOffIds: ['t1']
    }
    expect(planText(card, (id) => (id === 't1' ? 'The missing barrels' : null))).toBe(
      [
        'Goal: Tobin hides where he was last night.',
        'Beats:',
        '1. Mara asks Tobin where he was.',
        '2. Tobin lies: he says he was at the ferry.',
        'By the end: Mara believes him, for now.',
        'Notes: Keep it quiet.',
        'Pays off: The missing barrels'
      ].join('\n')
    )
    expect(planText(emptySceneCard(), () => null)).toBe('')
    expect(sceneSystem(['facts'])).toContain('What the plan asks for (someone lying, mistaken, hiding something or changing) is not a slip')
  })

  it('says when an open thread is due', () => {
    expect(threadDueWords({ chapterId: 'c', label: 'Ch 7', from: 'adam', state: 'later' })).toBe('due to be paid off by the end of Ch 7')
    expect(threadDueWords({ chapterId: 'c', label: 'Ch 4', from: 'adam', state: 'overdue' })).toBe('overdue (due to be paid off by the end of Ch 4)')
    expect(threadDueWords({ chapterId: 'c', label: 'Ch 5', from: 'adam', state: 'now' })).toBe('due to be paid off by the end of this chapter')
    expect(threadDueWords({ chapterId: 'c', label: 'Ch 5', from: 'card', sceneLabel: 'Ch 5, Sc 2', state: 'later' })).toBe('planned to be paid off in Ch 5, Sc 2')
    expect(threadDueWords(undefined)).toBe('')
  })

  it('in a real world: the card’s plan, the scene’s date with the time since the scene before, and the threads still open', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const outline = repo.getOutline(db, story.id)
    const s1 = outline.scenes[0].id
    const s2 = repo.createScene(db, outline.chapters[0].id, { title: 'The ferry' }).id
    const mara = repo.createEntry(db, 'character', { name: 'Mara' })
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
    const barrels = repo.createEntry(db, 'thread', { name: 'The missing barrels', fields: { promise: 'Who took the barrels?' } })
    mem.insertChange(db, { kind: 'thread', payload: { status: 'open', note: '' }, entryId: barrels.id, anchor: 'scene', sceneId: s1, origin: 'adam' })
    repo.updateSceneCard(db, s1, { ...repo.getScene(db, s1).card, when: 'Day 3, evening', povId: mara.id })
    repo.saveSceneText(db, s1, null, 'Mara counted the barrels at the ferry.')
    repo.updateSceneCard(db, s2, { ...repo.getScene(db, s2).card, when: 'Day 5, morning', povId: mara.id, presentIds: [tobin.id], goal: 'Tobin lies about where he was.' })
    repo.saveSceneText(db, s2, null, '“I was at the ferry,” said Tobin. Mara watched him.')
    const ctx = gatherSceneCheck(db, s2, PREFS)
    const sections = checkSections(ctx, ['facts', 'timeline', 'continuity'])
    const card = sections.find((s) => s.id === 'scene-card')!.text
    expect(card).toContain('When: Day 5, morning')
    expect(card).toContain('Story date: Day 5, morning (2 days since the scene before)')
    expect(sections.find((s) => s.id === 'plan')).toMatchObject({ title: "The author's plan for this scene", text: 'Goal: Tobin lies about where he was.' })
    expect(sections.find((s) => s.id === 'threads')!.text).toBe('- The missing barrels — Who took the barrels?')
    // Voice and style alone aren't told the dates or the threads; every check is told the plan.
    const voice = checkSections(ctx, ['voice', 'style'])
    expect(voice.find((s) => s.id === 'scene-card')!.text).not.toContain('Story date')
    expect(voice.some((s) => s.id === 'threads')).toBe(false)
    expect(voice.some((s) => s.id === 'plan')).toBe(true)
  })

  it('asks the facts check what the scene says about the past', () => {
    const facts = sceneSystem(['facts'])
    for (const words of ['what the scene says about the past', 'which way a place lies', 'how long a journey took', 'how someone died', 'who heard or saw what', 'mistaken or lying'])
      expect(facts).toContain(words)
    expect(sceneSystem(['facts'])).toContain('The scene card\'s story date says how much time has passed since the scene before')
  })
})

describe('what the author meant, and what the chapter writer set aside (fixes 7 and 8)', () => {
  let n = 0
  const row = (sceneId: ID, status: string, kind: string, message: string, payload: cdb.IssuePayload = { entryId: 'mara' }): Record<string, unknown> => ({
    id: `r${++n}`,
    scene_id: sceneId,
    story_id: 'b1',
    kind,
    severity: 'warning',
    status,
    quote: '',
    message,
    payload_json: JSON.stringify(payload),
    created_at: `2026-10-16T00:00:${String(n).padStart(2, '0')}.000Z`,
    updated_at: `2026-10-16T00:00:${String(n).padStart(2, '0')}.000Z`
  })
  const order = Array.from({ length: 12 }, (_, i) => `s${i + 1}`)
  const where = (id: ID): string => `Ch 1, Sc ${id.slice(1)}`

  it('never takes the chapter writer’s set-aside for what the author meant', () => {
    const got = lessonsFrom(
      [
        row('s11', 'ignored', 'fact', 'Set aside by the chapter writer.', { entryId: 'mara', setAsideBy: 'chapter' }),
        row('s10', 'ignored', 'fact', 'Ignored by Adam.', { entryId: 'tobin' })
      ],
      order,
      where
    )
    expect(got.meant.map((l) => l.text)).toEqual(['Ignored by Adam.'])
  })

  it('keeps what the author meant about a voice however long ago, and about the style from the last few scenes', () => {
    const old = `s${12 - RECENT_SCENES}`
    const got = lessonsFrom(
      [
        row('s1', 'ignored', 'voice', 'Tobin swears here, though he never does.', { entryId: 'tobin' }),
        row(old, 'ignored', 'style', 'An old slip into the present tense.', {}),
        row('s11', 'ignored', 'style', 'The prologue is told in the present tense.', {}),
        // Fixed voice or style is never a slip for the writer.
        row('s11', 'fixed', 'voice', 'Mara never says “okay”.', { entryId: 'mara' })
      ],
      order,
      where
    )
    expect(got.meant.map((l) => [l.kind, l.text])).toEqual([
      ['style', 'The prologue is told in the present tense.'],
      ['voice', 'Tobin swears here, though he never does.']
    ])
    expect(got.slips).toEqual([])
  })

  it('in a real world: tells a later voice check and check and repair what the author meant; the chapter writer’s set-aside is labelled', () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const outline = repo.getOutline(db, story.id)
    const scenes = [outline.scenes[0].id, repo.createScene(db, outline.chapters[0].id).id, repo.createScene(db, outline.chapters[0].id).id]
    const mara = repo.createEntry(db, 'character', { name: 'Mara' })
    const tobin = repo.createEntry(db, 'character', { name: 'Tobin' })
    for (const s of scenes) {
      repo.updateSceneCard(db, s, { ...repo.getScene(db, s).card, povId: mara.id, presentIds: [tobin.id] })
      repo.saveSceneText(db, s, null, '“Damn the ferry,” said Tobin. Mara waited.')
    }
    const found = (sceneId: ID, kind: 'voice' | 'fact', message: string): cdb.FoundIssue => ({
      sceneId,
      storyId: story.id,
      kind,
      severity: 'warning',
      quote: '',
      message,
      key: `check:${kind}:${tobin.id}:${message}`,
      payload: { by: 'check', check: kind === 'voice' ? 'voice' : 'facts', entryId: tobin.id }
    })
    cdb.saveFound(db, [], [found(scenes[0], 'voice', 'Tobin swears, though he never does.'), found(scenes[0], 'fact', 'Tobin is a tanner, not a ferryman.')], () => false)
    const [voiceRow, factRow] = ['voice', 'fact'].map((k) => cdb.sceneIssueRows(db, scenes[0]).find((r) => r.kind === k)!)
    cdb.setIssueStatus(db, voiceRow.id as ID, 'ignored')
    cdb.setAsideByChapter(db, factRow.id as ID)

    // The chapter writer's set-aside: ignored, marked, never what the author meant.
    expect(cdb.issueRow(db, factRow.id as ID)!.status).toBe('ignored')
    expect(lessonsBefore(db, scenes[2]).meant.map((l) => l.text)).toEqual(['Tobin swears, though he never does.'])
    const names = { entry: () => null, sceneLabel: () => null, storyTitle: () => null } as unknown as cdb.IssueNames
    expect(cdb.readIssue(cdb.issueRow(db, factRow.id as ID)!, names).setAsideBy).toBe('chapter')
    expect(cdb.readIssue(cdb.issueRow(db, voiceRow.id as ID)!, names).setAsideBy).toBeUndefined()
    // Reopened, it is no longer the chapter writer's.
    cdb.setIssueStatus(db, factRow.id as ID, 'open')
    expect(cdb.payloadOf(cdb.issueRow(db, factRow.id as ID)!).setAsideBy).toBeUndefined()

    // A later voice check is told; a facts check isn't.
    const ctx = gatherSceneCheck(db, scenes[2], PREFS)
    expect(checkSections(ctx, ['voice']).find((s) => s.id === 'meant')!.text).toBe('- In Book 1, Ch 1, Sc 1: Tobin swears, though he never does.')
    expect(checkSections(ctx, ['facts']).some((s) => s.id === 'meant')).toBe(false)

    // Check and repair is told what was meant about what is so.
    cdb.setIssueStatus(db, factRow.id as ID, 'ignored')
    const codex = codexLines(gatherSceneCheck(db, scenes[2], PREFS), 'Tobin rowed on.')
    expect(codex.sections.find((s) => s.id === 'meant')!.text).toBe('- In Book 1, Ch 1, Sc 1: Tobin is a tanner, not a ferryman.')
    expect(repairSystem()).toContain('"What the author has said is meant"')
  })
})
