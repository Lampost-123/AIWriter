import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { WritingPrefs } from '@shared/types'
import { SOUND_BLOCK } from '@shared/ownSample'
import { migrate } from '../db/migrations'
import * as repo from '../db/repo'
import { chatTexts, proseMarks, proseTexts } from '../db/ownWords'
import { gatherContextInput } from '../ai/gather'
import { assembleContext, MUST_BLOCK } from '../ai/context'
import { countRaw } from '../ai/tokens'
import { ownWritingFor, readScenes } from './ownWriting'

// Invented prose only: Adam's own scenes are plain and salty; the AI's are generic.
const OWN_1 = [
  'Rain came sideways off the estuary. Bryn had the shutters half down before the second squall and swore at the latch, which stuck, as it always stuck, because nobody had oiled it since the flood year.',
  '"Get the lamp, girl," Bryn said. "No. The other one. Aye, that one."',
  'Wren fetched it. The glass was cracked down one side and somebody had mended it with fish glue, so the light came out yellow and smelled faintly of the harbour.',
  '"Why do we keep a lamp that stinks?" Wren said.',
  '"Because it works, girl," said Bryn. "Aye. Mostly."',
  'Outside the gulls had given up. Only the bell on the channel buoy kept on, two notes, the second flat, as if it had a cold.',
  '"Shut the door, girl," Bryn said. "Aye. Bolt it."',
  '"Tide turns at four," said Bryn. "We go then. Aye."',
  'They ate standing. Herring, bread gone hard at the corners, a rind of cheese Bryn cut into two exact halves with the knife he used for everything.'
].join('\n\n')
const OWN_2 =
  'Morning came grey and stayed grey. The tide had gone out in the night and left the slip shining, weed laid flat across it like wet hair, and three crabs arguing over something dead.'
const AI_DRAFT = [
  'The morning sun cast long shadows across the bustling harbour, painting the water in shades of gold and amber.',
  '"We need to talk," Wren said, her voice barely above a whisper as she turned to face him.',
  'Bryn felt a wave of unease wash over him, his heart pounding in his chest as he considered her words carefully.'
].join('\n\n')
const AI_CHAT = 'A heavy silence settled over the room like a thick blanket, broken only by the crackle of the dying fire.'

const prefs = (over: Partial<WritingPrefs> = {}): WritingPrefs => ({
  spelling: 'UK',
  pov: 'Close third person',
  tense: 'Past tense',
  voiceNotes: '',
  avoidWords: [],
  ...over
})

let rec = 0
function record(db: Database.Database, sceneId: string, job: string, response: string, params: object = {}): void {
  db.prepare(
    `INSERT INTO generations (id, scene_id, job, status, provider_id, provider_name, model_id, params_json, blocks_json, messages_json, budget_json, response, created_at)
     VALUES (?, ?, ?, 'done', 'p', 'P', 'm', ?, '[]', '[]', '{}', ?, ?)`
  ).run(`g${++rec}`, sceneId, job, JSON.stringify(params), response, `2026-10-19T10:00:${String(rec).padStart(2, '0')}.000Z`)
}

function setup() {
  const db = new Database(':memory:')
  migrate(db)
  repo.initWorld(db, 'w1', 'Test world')
  const story = repo.listStories(db)[0]
  const outline = repo.getOutline(db, story.id)
  const chapter = outline.chapters[0]
  const first = outline.scenes[0]
  const second = repo.createScene(db, chapter.id, { title: 'The slip' })
  const third = repo.createScene(db, chapter.id, { title: 'The bell' })
  const bryn = repo.createEntry(db, 'character', { name: 'Bryn' })
  const wren = repo.createEntry(db, 'character', { name: 'Wren' })
  // Scene 1: all Adam's own (no AI records) but one paragraph the editor chat proposed and he applied.
  repo.saveSceneText(db, first.id, null, `${OWN_1}\n\n${AI_CHAT}`)
  record(db, '', 'chat', '', {
    proposals: [{ id: '1', status: 'applied', why: 'Mood', kind: 'passage', sceneId: first.id, sceneLabel: 'Sc 1', start: 'x', end: 'y', original: '', replace: AI_CHAT }]
  })
  // Scene 2: an AI draft, kept as it came, and one paragraph of Adam's own after it.
  record(db, second.id, 'draft', AI_DRAFT)
  repo.saveSceneText(db, second.id, null, `${AI_DRAFT}\n\n${OWN_2}`)
  repo.updateSceneCard(db, third.id, { ...repo.getScene(db, third.id).card, povId: wren.id, presentIds: [wren.id, bryn.id], beats: ['The bell rings'] })
  return { db, story, first, second, third, bryn, wren }
}

describe('Adam’s own writing in the world', () => {
  it('reads what the AI wrote for each scene from its records and the editor chat’s applied proposals', () => {
    const w = setup()
    expect(proseTexts(w.db, w.second.id)).toEqual([AI_DRAFT])
    expect(proseMarks(w.db, [w.first.id, w.second.id]).has(w.first.id)).toBe(false)
    expect(chatTexts(w.db).get(w.first.id)?.texts).toEqual([AI_CHAT])
    // Nearest first: scene 2 then scene 1; never the scene being written.
    const scenes = readScenes(w.db, w.third.id)
    expect(scenes.map((s) => s.sceneId)).toEqual([w.second.id, w.first.id])
    expect(scenes[0].where).toBe('Ch 1, Sc 2')
    expect(scenes[0].paragraphs.map((p) => p.own)).toEqual([false, false, false, true])
    expect(scenes[1].paragraphs.at(-1)).toMatchObject({ own: false })
    expect(scenes[1].paragraphs.slice(0, -1).every((p) => p.own)).toBe(true)
  })

  it('picks a sample of his own words only, and how each character’s lines read', () => {
    const w = setup()
    const own = ownWritingFor(w.db, w.third.id, { sample: true, people: repo.listEntries(w.db) })
    const text = own.sample!.passages.map((p) => p.text).join('\n')
    expect(own.sample!.words).toBeGreaterThanOrEqual(150)
    expect(own.sample!.words).toBeLessThanOrEqual(500)
    expect(text).toContain('Rain came sideways')
    expect(text).toContain('Morning came grey')
    for (const ai of ['bustling harbour', 'barely above a whisper', 'heavy silence']) expect(text).not.toContain(ai)
    // Bryn's lines are all Adam's: terse, "girl", "aye".
    expect(own.voices[w.bryn.id]).toMatchObject({ own: true })
    expect(own.voices[w.bryn.id].text).toMatch(/short sentences/)
    expect(own.voices[w.bryn.id].text).toContain('calls people "girl"')
    expect(own.voices[w.bryn.id].text).toContain('often says "aye"')
    // Not asked for, or in the sample world: no sample (the marks still come).
    expect(ownWritingFor(w.db, w.third.id, { sample: false, people: repo.listEntries(w.db) }).sample).toBeNull()
    repo.setMeta(w.db, 'sample_world', '1')
    expect(ownWritingFor(w.db, w.third.id, { sample: true, people: repo.listEntries(w.db) }).sample).toBeNull()
  })

  it('reads a scene again only when its words or the AI’s records for it change', () => {
    const w = setup()
    const before = readScenes(w.db, w.third.id)
    expect(readScenes(w.db, w.third.id)[1].paragraphs).toBe(before[1].paragraphs)
    // Adam's paragraph in scene 1 turns out to be the AI's after all (an AI edit was recorded for it).
    record(w.db, w.first.id, 'edit', OWN_1.split('\n\n')[0])
    const after = readScenes(w.db, w.third.id)
    expect(after[1].paragraphs).not.toBe(before[1].paragraphs)
    expect(after[1].paragraphs[0].own).toBe(false)
  })

  it('too little of his own: the writer goes on as before', () => {
    const w = setup()
    repo.saveSceneText(w.db, w.first.id, null, AI_CHAT)
    expect(ownWritingFor(w.db, w.third.id, { sample: true, people: [] }).sample).toBeNull()
  })
})

describe('the writer’s briefing with Adam’s own writing', () => {
  const brief = (w: ReturnType<typeof setup>, p: WritingPrefs = prefs()) =>
    assembleContext(gatherContextInput(w.db, w.third.id, undefined, { prefs: p, contextLength: 64_000, creativity: 'balanced' }), countRaw)

  it('takes the place of an empty sample passage, is said again just above the closing instruction, and says so', () => {
    const w = setup()
    const preview = brief(w)
    const instructions = preview.blocks.find((b) => b.id === 'instructions')!
    expect(instructions.text).toContain("These passages are the author's own writing, from the story so far.")
    expect(instructions.text).toContain('Rain came sideways')
    expect(instructions.text).not.toContain('bustling harbour')
    expect(instructions.ownWriting!.words).toBeGreaterThanOrEqual(150)
    expect(instructions.ownWriting!.from).toEqual(['Ch 1, Sc 2', 'Ch 1, Sc 1'])
    // "Sound like this": the last part before the closing instruction, about 120 words.
    const sound = preview.blocks.find((b) => b.id === SOUND_BLOCK.id)!
    expect(sound.title).toBe('Sound like this')
    expect(sound.ownWriting!.words).toBeLessThanOrEqual(121)
    const user = preview.messages[1].content as string
    const at = user.indexOf('## Sound like this')
    expect(at).toBeGreaterThan(user.indexOf(`## `))
    expect(user.indexOf('Write the scene now.')).toBeGreaterThan(at)
    const sent = preview.blocks.filter((b) => !b.dropped && b.priority > 1)
    expect(sent.at(-1)!.id).toBe(SOUND_BLOCK.id)
    expect(sent.some((b) => b.id === MUST_BLOCK) ? sent.at(-2)!.id : MUST_BLOCK).toBe(MUST_BLOCK)
    // How they sound: Bryn's marks from his lines.
    const voices = preview.blocks.find((b) => b.id === 'voices')!
    expect(voices.text).toContain("How their lines so far read (the author's own lines where there are enough):")
    expect(voices.text).toMatch(/- Bryn: short sentences .*calls people "girl"/)
  })

  it('a sample passage of the style guide wins unless Adam ticks the switch; off means never', () => {
    const w = setup()
    repo.setMeta(w.db, 'style', JSON.stringify({ ...repo.getWorldStyle(w.db), samplePassage: 'The kettle sang. Nobody moved to lift it.' }))
    const kept = brief(w).blocks.find((b) => b.id === 'instructions')!
    expect(kept.text).toContain('This passage is by the author.')
    expect(kept.text).toContain('The kettle sang.')
    expect(kept.ownWriting).toBeUndefined()
    const ticked = brief(w, prefs({ ownSample: true })).blocks.find((b) => b.id === 'instructions')!
    expect(ticked.text).toContain("the author's own writing")
    expect(ticked.text).not.toContain('The kettle sang.')
    repo.setMeta(w.db, 'style', JSON.stringify({ ...repo.getWorldStyle(w.db), samplePassage: '' }))
    const off = brief(w, prefs({ ownSample: false }))
    expect(off.blocks.find((b) => b.id === 'instructions')!.text).not.toContain('Sample passage')
    expect(off.blocks.some((b) => b.id === SOUND_BLOCK.id)).toBe(false)
  })
})
