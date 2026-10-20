// What a scene's check asks and keeps since the book's live run (checkfix, 2026-10-20). DeepSeek Flash on the trap
// harness's 61,000-word book caught 6 of 13 planted slips on the overhaul against 10 of 12 on the released app:
// - both requests ask facts and who knows what again (context.ts checkRequests): the released app's two requests each
//   answered all six checks, so every slip had two looks;
// - what both requests find on their own is kept without the second opinion (run.ts corroborated): on X6 it ruled the
//   facts and the knowledge finding on Kit's "I heard her" not real;
// - the facts check has its own list of the facts the scene's words touch again, and each entry's backstory (how someone's
//   parents died, how far a place lies), which the briefing's short form leaves out.
// Invented text only: the trap book's own (tests/traps/book.ts) and the live run's replies to it, word for word.
import { describe, expect, it } from 'vitest'
import { ALL_CHECKS, DONE_CHECKS, type CheckKind } from '@shared/contracts/checks'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as cdb from '../db/checks'
import { memoryWorld } from '../../../tests/unit/helpers'
import { PLANTED } from '../../../tests/traps/book'
import type { JobModel } from '../ai/jobModel'
import { ASKED_IN_BOTH, CHECK_GROUPS, checkRequests, checkSections, entryText, gatherSceneCheck, TOUCHED_TITLE } from './context'
import { CHECK_SECOND_MARKER, checkScene, corroborated, findingsRuling, type CheckOptions } from './run'
import { CHECK_TASK_MARKER } from './prompts'
import { foundIssues, type ReadContext } from './parse'

const PREFS = { spelling: 'UK' as const, pov: '', tense: '', voiceNotes: '', avoidWords: [] }

// The live run of 2026-10-20 (the overhaul at 4eb7f834, DeepSeek Flash), planted passage X6, word for word: the request
// about what is so, the request about who knows what, and the second opinion on their three findings.
const X6_WHAT_IS_SO = `{"issues":[{"check":"continuity","severity":"warning","quote":"Kit read nothing over her shoulder, but he watched her face.","message":"Kit is given a line of dialogue in the same paragraph as the narration about him, so the speech has no speaker and reads as if the narration is talking; the line should be Kit's.","conflicts":{"scene":"S3"},"fix":"Kit read nothing over her shoulder, but he watched her face. When she put the pen down he said, ‘You’re writing to him as if he’ll come back.’","advice":"Give the second line to Kit explicitly, e.g. ‘Kit said, “The old woman told you his heart won’t last the summer. I heard her. I’m sorry.”’"},{"check":"facts","severity":"warning","quote":"The old woman told you his heart won’t last the summer","message":"Kit says Tamsin was told Leckie's heart is failing, but in the story it is Tamsin who told Kit, after Isla told her in Hollish; Kit did not hear Isla say it.","conflicts":{"entry":"E1"},"memory":"Tamsin heard it from Isla Thorne and said it to Kit","text":"Kit says the old woman told Tamsin, and that he heard her","fix":"You told me his heart won’t last the summer. I heard you. I’m sorry.","advice":"Have Kit say Tamsin told him, or that he heard it from her, rather than from Isla."}],"checked":[{"check":"facts","ok":false,"note":"Tamsin's knit wrist, her coat with the lining unpicked, Leckie's key and Slade's receipt, and Leckie's condition and whereabouts agree with the memory; the great clock going again and Pim keeping it agree with the story so far. Kit's account of who told Tamsin about Leckie's heart does not."},{"check":"timeline","ok":true,"note":"The scene is two days after the Fane's shop scene and three days after Thaw Day; Tamsin and Kit are both in the clock-house, with no one in two places and no travel that the time does not allow."},{"check":"continuity","ok":false,"note":"Tamsin and Kit come in from the step with the latch, Kit's hands were in his pockets and are not needed here, and the evening light fits the card; but the second line of dialogue is left without a speaker."}]}`
const X6_WHO_KNOWS = `{"issues": [{"check": "knowledge", "severity": "must-fix", "quote": "‘The old woman told you his heart won’t last the summer,’ Kit said. ‘I heard her. I’m sorry.’", "message": "Kit says Isla told Tamsin in Hollish that Leckie's heart is failing, but the memory has Isla telling Tamsin alone at the door, with Kit only seeing it from a distance and never hearing the words; nothing shows him learning it.", "conflicts": {"entry": "E2"}, "fix": "‘I saw the old woman take you to the door,’ Kit said. ‘I can guess what she said. I’m sorry.’", "advice": "Either have Tamsin tell Kit about Leckie's heart earlier (in Hollin or on the road), or make Kit only guess at it here."}], "checked": [{"check": "knowledge", "ok": false, "note": "Tamsin writing to Leckie about the house, his share and the clock going fits what she knows; Kit's claim to have heard Isla's words about Leckie's heart does not."}, {"check": "voice", "ok": true, "note": "Kit's two lines are easy, plain and gentle, in keeping with his sample lines; Tamsin says nothing, which fits her."}, {"check": "style", "ok": true, "note": "The scene stays in close third person past tense from Tamsin's side, and its quiet, held-back tone matches the scene card."}]}`
const X6_SECOND = `{"verdicts": [{"n": 1, "reason": "The paragraph reads 'Kit read nothing over her shoulder, but he watched her face. When she put the pen down he said, ...' — the speech is clearly attributed to Kit by 'he said', so there is no missing speaker.", "real": false}, {"n": 2, "reason": "The memory's 'who knows what' lists Kit as knowing Leckie's heart is failing since Ch 7, Sc 3, where he heard it from Tamsin, so Kit's line that the old woman told Tamsin and that he heard her is consistent with the material.", "real": false}, {"n": 3, "reason": "The memory records Kit as knowing Leckie's heart is failing since Ch 7, Sc 3 (heard it from Tamsin Orr), and Kit's line only says Isla told Tamsin and that he heard her — nothing contradicts his knowing.", "real": false}]}`

const X6 = PLANTED.find((x) => x.id === 'X6')!

/** A check model whose every request `answer` replies to (never the network). */
function stubbed(answer: (user: string) => string): { fetchImpl: typeof fetch; asked: string[] } {
  const asked: string[] = []
  const fetchImpl = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { messages: { role: string; content: string }[] }
    const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
    asked.push(user)
    const chunk = { choices: [{ index: 0, delta: { content: answer(user) }, finish_reason: 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }) as typeof fetch
  return { fetchImpl, asked }
}

const model: JobModel = {
  job: 'check',
  target: { id: 'p1', name: 'Stub', kind: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '' },
  choice: { providerId: 'p1', modelId: 'stub/check', label: 'stub', contextLength: 64000, promptPrice: null, completionPrice: null },
  thinking: 'off'
}

/** The X6 passage after a scene in which Kit learns of Leckie's heart from Tamsin, as the live run's memory had it. */
function x6World() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const before = outline.scenes[0].id
  const sceneId = repo.createScene(db, outline.chapters[0].id, { title: X6.card.title }).id
  const tamsin = repo.createEntry(db, 'character', { name: 'Tamsin Orr', aliases: ['Tamsin'] }).id
  const kit = repo.createEntry(db, 'character', { name: 'Kit Ansel', aliases: ['Kit'] }).id
  repo.createEntry(db, 'character', { name: 'Edwin Leckie', aliases: ['Leckie'] })
  repo.createEntry(db, 'character', { name: 'Isla Thorne', aliases: ['Isla'] })
  repo.saveSceneText(db, before, null, 'In Hollin the old woman took Tamsin aside at the door and spoke low in Hollish.')
  for (const id of [tamsin, kit]) {
    mem.insertChange(db, {
      entryId: id,
      anchor: 'scene',
      sceneId: before,
      storyId: story.id,
      kind: 'knowledge',
      payload: { factId: 'f-heart', fact: "Leckie's heart is failing; he won't last the summer" },
      origin: 'text'
    })
  }
  repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, povId: tamsin, presentIds: [tamsin, kit] })
  repo.saveSceneText(db, sceneId, null, X6.paragraphs.join('\n\n'))
  return { db, sceneId }
}

/** The live replies, each to its own request. */
const liveReplies = (user: string): string =>
  user.includes(CHECK_SECOND_MARKER)
    ? X6_SECOND
    : user.includes(`${CHECK_TASK_MARKER} facts`)
      ? X6_WHAT_IS_SO
      : user.includes(`${CHECK_TASK_MARKER} knowledge`)
        ? X6_WHO_KNOWS
        : '{"issues": [], "checked": []}'

const options = (db: CheckOptions['db'], fetchImpl: typeof fetch): CheckOptions => ({ db, model, prefs: PREFS, stopped: () => false, fetchImpl, retryDelays: [5] })

describe('X6: what both requests find on their own is kept (checkfix, 2026-10-20)', () => {
  it('keeps the facts and the knowledge finding on Kit’s line, puts only the other note to the second opinion, and it goes', async () => {
    const w = x6World()
    const { fetchImpl, asked } = stubbed(liveReplies)
    const out = await checkScene(options(w.db, fetchImpl), w.sceneId, ALL_CHECKS)
    expect(out.status).toBe('done')
    const open = cdb
      .sceneIssueRows(w.db, w.sceneId)
      .filter((r) => r.status === 'open' && cdb.payloadOf(r).by === 'check')
      .map((r) => [r.kind, r.quote])
    expect(open).toEqual(
      expect.arrayContaining([
        ['fact', 'The old woman told you his heart won’t last the summer'],
        ['knowledge', '‘The old woman told you his heart won’t last the summer,’ Kit said. ‘I heard her. I’m sorry.’']
      ])
    )
    // The continuity note (a speaker the scene does name) was the only one asked about, and it went.
    expect(open).toHaveLength(2)
    const second = asked.filter((u) => u.includes(CHECK_SECOND_MARKER))
    expect(second).toHaveLength(1)
    expect(second[0]).toContain('1. Quote: "Kit read nothing over her shoulder, but he watched her face."')
    expect(second[0]).not.toContain('2. Quote:')
  })

  it('without that (the overhaul as it was) the same replies leave nothing: the second opinion rules all three not real', async () => {
    const w = x6World()
    const { fetchImpl } = stubbed(liveReplies)
    const ctx = gatherSceneCheck(w.db, w.sceneId, PREFS)
    const read: ReadContext = {
      sceneId: w.sceneId,
      storyId: ctx.storyId,
      text: ctx.text,
      checks: ALL_CHECKS,
      entries: new Map(ctx.entries.map((c) => [c.code, c.entry])),
      scenes: new Map(ctx.earlier.map((s) => [s.code, { sceneId: s.sceneId, label: s.label }])),
      canUpdateMemory: () => false
    }
    const byRequest = [foundIssues(JSON.parse(X6_WHAT_IS_SO).issues, read), foundIssues(JSON.parse(X6_WHO_KNOWS).issues, read)]
    const found = byRequest.flat()
    expect(found.map((f) => f.kind)).toEqual(['continuity', 'fact', 'knowledge'])
    const asBefore = await findingsRuling(options(w.db, fetchImpl), w.sceneId, found, ctx, ALL_CHECKS)
    expect(asBefore.kept).toEqual([])
    const sure = corroborated(byRequest, ctx.text)
    expect([...sure].map((k) => found.find((f) => f.key === k)!.kind).sort()).toEqual(['fact', 'knowledge'])
    const now = await findingsRuling(options(w.db, fetchImpl), w.sceneId, found, ctx, ALL_CHECKS, undefined, sure)
    expect(now.kept.map((f) => f.kind)).toEqual(['fact', 'knowledge'])
  })
})

describe('which requests ask which checks (checkfix, 2026-10-20)', () => {
  it('asks facts and who knows what in both requests, each request’s own checks first', () => {
    expect(ASKED_IN_BOTH).toEqual(['facts', 'knowledge'])
    expect(checkRequests(ALL_CHECKS)).toEqual([
      ['facts', 'timeline', 'continuity', 'knowledge'],
      ['knowledge', 'voice', 'style', 'facts']
    ])
    expect(checkRequests(DONE_CHECKS)).toEqual([
      ['facts', 'timeline', 'continuity', 'knowledge'],
      ['knowledge', 'facts']
    ])
    expect(checkRequests(['timeline', 'voice'])).toEqual([['timeline'], ['voice']])
  })

  it('one request asks each check once: one group’s checks alone, or all together (Write the whole chapter)', () => {
    const one: CheckKind[][] = [['facts'], ['facts', 'timeline', 'continuity'], ['knowledge', 'style'], ['voice']]
    for (const checks of one) expect(checkRequests(checks)).toEqual([checks])
    expect(checkRequests(DONE_CHECKS, true)).toEqual([DONE_CHECKS])
    expect(checkRequests([], true)).toEqual([])
    expect(CHECK_GROUPS).toEqual([
      ['facts', 'timeline', 'continuity'],
      ['knowledge', 'voice', 'style']
    ])
  })
})

describe('what counts as found by both requests', () => {
  const text = 'Kit read nothing. ‘The old woman told you his heart won’t last the summer,’ Kit said. ‘I heard her.’ The lamp was low.'
  const at = (kind: 'fact' | 'knowledge' | 'continuity' | 'timeline', quote: string): cdb.FoundIssue => ({
    sceneId: 's' as ID,
    storyId: 'st' as ID,
    kind,
    severity: 'warning',
    quote,
    message: 'm',
    key: `check:${kind}:-:${quote}`,
    payload: { by: 'check', sources: [], fix: null, memoryFix: null, occurrence: 0 }
  })
  const line = '‘The old woman told you his heart won’t last the summer,’ Kit said.'
  it('a fact or a knowledge finding whose words overlap one of the other request’s', () => {
    const fact = at('fact', 'The old woman told you his heart')
    const knows = at('knowledge', line)
    expect([...corroborated([[fact], [knows]], text)].sort()).toEqual([fact.key, knows.key].sort())
    // Words that only overlap in part count too.
    const tail = at('fact', 'Kit said. ‘I heard her.’')
    expect(corroborated([[tail], [knows]], text).has(tail.key)).toBe(true)
  })
  it('never two findings of one request, other words of the same sentence, or continuity and the timeline (asked once)', () => {
    expect(corroborated([[at('fact', 'The old woman told you'), at('knowledge', line)], []], text).size).toBe(0)
    expect(corroborated([[at('fact', 'The lamp was low.')], [at('knowledge', 'Kit read nothing.')]], text).size).toBe(0)
    const cont = at('continuity', line)
    expect(corroborated([[cont], [at('knowledge', line)]], text).has(cont.key)).toBe(false)
    expect(corroborated([[at('timeline', line)], [at('fact', line)]], text).size).toBe(0)
    expect(corroborated([[at('fact', line)]], text).size).toBe(0)
  })
})

describe('what the facts check is told (checkfix, 2026-10-20)', () => {
  /** Tamsin at home with Pim; the memory knows how their father died and where Hollin lies, and many other facts. */
  function world() {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const outline = repo.getOutline(db, story.id)
    const before = outline.scenes[0].id
    const sceneId = repo.createScene(db, outline.chapters[0].id, { title: 'The map' }).id
    const tamsin = repo.createEntry(db, 'character', {
      name: 'Tamsin Orr',
      aliases: ['Tamsin'],
      fields: { eyes: 'dark brown', pastEvents: 'her father drowned eleven winters ago below Corran Weir', arcEnd: 'forgives the guild' }
    }).id
    const pim = repo.createEntry(db, 'character', { name: 'Pim Orr', aliases: ['Pim'] }).id
    repo.createEntry(db, 'place', { name: 'Hollin', fields: { geography: 'four days north of Callowmere on the ice' } })
    repo.saveSceneText(db, before, null, 'Pim never learned to read a word.')
    const facts = [
      ...Array.from({ length: 44 }, (_, i) => `The guild rule ${i} binds every house on Gilt Street`),
      'Pim cannot read words, though he reads numbers and faces perfectly'
    ]
    facts.forEach((fact, i) => {
      for (const id of [tamsin, pim]) {
        mem.insertChange(db, { entryId: id, anchor: 'scene', sceneId: before, storyId: story.id, kind: 'knowledge', payload: { factId: `f${i}`, fact }, origin: 'text' })
      }
    })
    repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, povId: tamsin, presentIds: [tamsin, pim] })
    repo.saveSceneText(db, sceneId, null, 'Pim broke the seal and read the letter aloud. It seemed impossible that a single day on the ice had carried her to Hollin.')
    return { db, sceneId }
  }

  it('lists the facts the words touch on their own, before who knows what, and never twice', () => {
    const w = world()
    const ctx = gatherSceneCheck(w.db, w.sceneId, PREFS)
    const sections = checkSections(ctx, ALL_CHECKS)
    const ids = sections.map((s) => s.id)
    expect(ids.indexOf('touched')).toBeGreaterThan(-1)
    expect(ids.indexOf('touched')).toBeLessThan(ids.indexOf('knowledge'))
    const touched = sections.find((s) => s.id === 'touched')!
    expect(touched.title).toBe(TOUCHED_TITLE)
    expect(touched.text).toContain('Pim cannot read words')
    const knows = sections.find((s) => s.id === 'knowledge')!
    expect(knows.text).not.toContain('Pim cannot read words')
    expect(knows.text.startsWith(`Besides what is listed under "${TOUCHED_TITLE}":`)).toBe(true)
    // The knowledge check alone is told who knows what as before; the facts check alone, its own list.
    expect(checkSections(ctx, ['knowledge']).find((s) => s.id === 'knowledge')!.text).toContain('Pim cannot read words')
    expect(checkSections(ctx, ['facts']).map((s) => s.id)).toContain('touched')
  })

  it('tells an entry’s backstory (how someone’s father died, how far a place lies), never the arc’s planned end', () => {
    const w = world()
    const ctx = gatherSceneCheck(w.db, w.sceneId, PREFS)
    const memory = checkSections(ctx, ['facts']).find((s) => s.id === 'memory')!.text
    expect(memory).toContain('Key past events: her father drowned eleven winters ago below Corran Weir')
    expect(memory).toContain('Geography: four days north of Callowmere on the ice')
    expect(memory).not.toContain('forgives the guild')
    // Told in a line (a big memory): its looks, as before.
    const tamsin = ctx.entries.find((c) => c.entry.name === 'Tamsin Orr')!
    expect(entryText(tamsin, true)).not.toContain('Key past events')
  })
})
