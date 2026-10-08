// The editor chat's tools: proposals that never overlap (one applied can't lose the words of another), a change
// revised in place, a proposal that didn't go through saying so, and the last words listing what was proposed.
import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { Proposal } from '@shared/contracts/ask'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { EditorAgent, LATER, markItalics, OPEN_MARK } from './agent'

const TEXT = 'The tide came in over the flats. Teh gulls went quiet. Mara waited.'

function setup(text = TEXT): { agent: EditorAgent; shown: Proposal[][] } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p0' }, content: [{ type: 'text', text }] }] }
  repo.saveSceneText(db, sceneId, doc, text)
  const shown: Proposal[][] = []
  const agent = new EditorAgent(db, { storyId: story.id, sceneId, prefs: defaultWritingPrefs() }, () => undefined, (p) => shown.push(p))
  return { agent, shown }
}

let n = 0
const call = (agent: EditorAgent, name: string, args: Record<string, unknown>): string =>
  agent.run({ id: `c${++n}`, name, arguments: JSON.stringify(args) }).result

describe('the editor chat’s proposals', () => {
  it('turns down a change that overlaps one waiting, and takes it as a revision of that one', () => {
    const { agent } = setup()
    expect(call(agent, 'propose_edit', { find: 'Teh gulls', replace: 'The gulls', why: 'Typo.' })).toMatch(/^Proposed to the writer as change 1\./)
    const clash = call(agent, 'propose_edit', { find: 'Teh gulls went quiet.', replace: 'The gulls fell silent.', why: 'Stronger.' })
    expect(clash).toMatch(/^Not proposed: nothing is waiting for the writer\. Those words overlap change 1/)
    expect(agent.proposals).toHaveLength(1)
    const revised = call(agent, 'propose_edit', { find: 'Teh gulls went quiet.', replace: 'The gulls fell silent.', why: 'Typo, and stronger.', revises: '1' })
    expect(revised).toMatch(/^Change 1 now proposes this instead\./)
    expect(agent.proposals).toMatchObject([{ id: '1', kind: 'text', find: 'Teh gulls went quiet.', replace: 'The gulls fell silent.' }])
    // Words elsewhere in the scene are fine.
    expect(call(agent, 'propose_edit', { find: 'Mara waited.', replace: 'Mara waited, cold.', why: 'Detail.' })).toMatch(/change 2\./)
  })

  it('says a change that didn’t go through isn’t waiting', () => {
    const { agent } = setup()
    expect(call(agent, 'propose_edit', { find: 'not in the scene', replace: 'x', why: '' })).toMatch(/^Not proposed: nothing is waiting/)
    expect(call(agent, 'propose_edit', { find: 'Mara waited.', replace: 'x', why: '', revises: '7' })).toMatch(/^Not proposed: .*no change 7/)
  })

  it('ends with what was proposed, or that nothing was', () => {
    const { agent } = setup()
    expect(agent.lastWords()).toMatch(/no changes were proposed, so there is nothing for the writer to apply/)
    call(agent, 'propose_edit', { find: 'Teh gulls', replace: 'The gulls', why: 'Typo.' })
    expect(agent.lastWords()).toMatch(/Proposed so far: change 1\. Answer the writer now, mentioning only these/)
  })

  it('turns down an edit inside a passage already proposed for a rewrite, and a rewrite over a waiting edit', () => {
    const { agent } = setup()
    const rewrite = call(agent, 'propose_rewrite', { start: 'The tide came', end: 'went quiet.', replace: 'The sea rolled in. The gulls hushed.', why: 'Tighter.' })
    expect(rewrite).toMatch(/^Proposed to the writer as change 1\./)
    const edit = call(agent, 'propose_edit', { find: 'Teh gulls', replace: 'The gulls', why: 'Typo.' })
    expect(edit).toMatch(/^Not proposed: .*inside the passage change 1 rewrites/)
    // And the other way round: a waiting edit, then a rewrite over it.
    const other = setup().agent
    expect(call(other, 'propose_edit', { find: 'Mara waited.', replace: 'Mara waited, cold.', why: 'Detail.' })).toMatch(/change 1\./)
    expect(call(other, 'propose_rewrite', { start: 'Teh gulls', end: 'Mara waited.', replace: 'The gulls went quiet. Mara stood.', why: 'x' })).toMatch(
      /^Not proposed: .*overlaps change 1/
    )
    expect(agent.proposals).toHaveLength(1)
  })
})

describe('a rewrite’s end words', () => {
  it('are looked for after its start words, never inside them', () => {
    const { agent } = setup('Mara ran. The gulls ran. Mara ran home.')
    const r = call(agent, 'propose_rewrite', { start: 'Mara ran. The', end: 'Mara ran', replace: 'Mara fled. The gulls scattered. Mara fled', why: 'Stronger verbs.' })
    expect(r).toMatch(/^Proposed to the writer as change 1\./)
    expect(agent.proposals[0]).toMatchObject({ kind: 'passage', start: 'Mara ran. The', end: 'Mara ran', original: 'Mara ran. The gulls ran. Mara ran' })
  })
})

// ---------- Rule C6: an invented world of two stories ----------

/** Two stories that never meet: The Salt Road (three scenes) and Glass Harbour, which starts at the world's beginning. */
function twoStories(): { db: ReturnType<typeof memoryWorld>; road: string; harbour: string; sc: string[]; harbourScene: string; ids: Record<string, string> } {
  const db = memoryWorld()
  const road = repo.listStories(db)[0]
  repo.updateStory(db, road.id, { title: 'The Salt Road' })
  const o = repo.getOutline(db, road.id)
  const ch = o.chapters[0]
  const sc1 = o.scenes[0].id
  repo.updateScene(db, sc1, { title: 'Arrival' })
  const sc2 = repo.createScene(db, ch.id, { title: 'The Ford' }).id
  const sc3 = repo.createScene(db, ch.id, { title: 'The Tower' }).id
  // Scene 1 has italics: "*Too late,* she thought."
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Wren crossed the salt flats. ' },
          { type: 'text', marks: [{ type: 'italic' }], text: 'Too late,' },
          { type: 'text', text: ' she thought.' }
        ]
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'The gulls went quiet.' }] }
    ]
  }
  repo.saveSceneText(db, sc1, doc, 'Wren crossed the salt flats. Too late, she thought.\n\nThe gulls went quiet.')
  repo.saveSceneText(db, sc2, null, 'At the ford the lantern guttered and Wren lost the map.')
  repo.saveSceneText(db, sc3, null, 'The tower bell rang for the lantern keeper.')

  const harbour = repo.createStory(db, { title: 'Glass Harbour', startStoryId: null })
  const hch = repo.createChapter(db, harbour.id, { title: 'Blue Fire' })
  const harbourScene = repo.createScene(db, hch.id, { title: 'Harbour' }).id
  repo.saveSceneText(db, harbourScene, null, 'In the glass harbour the lantern burned blue for Quill.')

  const wren = repo.createEntry(db, 'character', { name: 'Wren', summary: 'A courier on the salt road.', fields: { role: 'courier' } })
  mem.insertChange(db, { entryId: wren.id, anchor: 'scene', storyId: null, sceneId: sc2, kind: 'update', payload: { note: 'lost the map', fields: { role: 'disgraced courier' } }, origin: 'adam' })
  const mara = repo.createEntry(db, 'character', { name: 'Mara', summary: 'A ferrywoman.' })
  const marek = repo.createEntry(db, 'character', { name: 'Marek', summary: 'A toll keeper.' })
  // Tobin first appears in scene 3 of The Salt Road: later, from scene 1.
  const tobin = repo.createEntry(db, 'character', { name: 'Tobin', summary: 'The lantern keeper.' }, { origin: 'text', originSceneId: sc3 })
  // Quill belongs to Glass Harbour, which The Salt Road never meets.
  const quill = repo.createEntry(db, 'character', { name: 'Quill', summary: 'Keeper of the blue lantern.' }, { origin: 'adam', originStoryId: harbour.id })
  // Vesper is kept out of The Salt Road's briefings.
  const vesper = repo.createEntry(db, 'character', { name: 'Vesper', summary: 'Smuggles lanterns past the toll.' })
  mem.setPin(db, vesper.id, 'story', road.id, 'hide')
  return {
    db,
    road: road.id,
    harbour: harbour.id,
    sc: [sc1, sc2, sc3],
    harbourScene,
    ids: { wren: wren.id, mara: mara.id, marek: marek.id, tobin: tobin.id, quill: quill.id, vesper: vesper.id }
  }
}

const agentAt = (w: ReturnType<typeof twoStories>, storyId: string | null, sceneId: string | null): EditorAgent =>
  new EditorAgent(w.db, { storyId, sceneId, prefs: defaultWritingPrefs() }, () => undefined, () => undefined)

describe('the chat’s look-ups keep to this story’s point (rule C6)', () => {
  it('searches only this story’s line: never the other story, never a hidden entry unless named', () => {
    const w = twoStories()
    const agent = agentAt(w, w.road, w.sc[0])
    const found = call(agent, 'search', { query: 'lantern' })
    expect(found).toContain('Ch 1, Sc 2 “The Ford”')
    expect(found).toContain('Ch 1, Sc 3 “The Tower”')
    expect(found).not.toMatch(/Harbour|Quill/)
    expect(found).not.toContain('Vesper')
    expect(found).toContain('Tobin (character; not in the story yet at this point)')
    // Named, a hidden entry is found.
    expect(call(agent, 'search', { query: 'Vesper lanterns' })).toContain('Vesper (character)')
    expect(found.length).toBeLessThanOrEqual(3_000 + 80)
  })

  it('labels scenes after the open one as later, and marks the open one', () => {
    const w = twoStories()
    const agent = agentAt(w, w.road, w.sc[0])
    const found = call(agent, 'search', { query: 'lantern' })
    expect(found).toMatch(/Sc 2 “The Ford” \(later — after the open scene; characters don't know these events yet\)/)
    expect(call(agent, 'search', { query: 'gulls' })).toContain(`Ch 1, Sc 1 “Arrival” ${OPEN_MARK}`)
    const outline = call(agent, 'outline', {})
    expect(outline).toMatch(/Sc 1: Arrival .*◀ open scene/)
    expect(outline).toMatch(/Sc 2: The Ford .*\(later\)/)
    const read = call(agent, 'read_scene', { scene: 'Ford' })
    expect(read).toMatch(/^Using Ch 1, Sc 2 “The Ford” for “Ford”\./)
    expect(read).toContain(LATER)
    // From the last scene, nothing is later.
    expect(call(agentAt(w, w.road, w.sc[2]), 'search', { query: 'lantern' })).not.toContain('later')
  })

  it('finds an entry by what it is at the point, not by what another scene does to it later', () => {
    const w = twoStories()
    expect(call(agentAt(w, w.road, w.sc[0]), 'search', { query: 'disgraced' })).toMatch(/^Nothing found\./)
    expect(call(agentAt(w, w.road, w.sc[1]), 'search', { query: 'disgraced' })).toContain('- Wren (character)')
  })

  it('tries fewer words when nothing has them all, and says so', () => {
    const w = twoStories()
    const found = call(agentAt(w, w.road, w.sc[0]), 'search', { query: 'lantern zebra' })
    expect(found).toContain('Nothing matched all 2 words; these match 1 of 2.')
    expect(found).toContain('The Tower')
    expect(found).not.toContain('Harbour')
  })

  it('gives an entry as of the open scene, with the labels the briefing uses', () => {
    const w = twoStories()
    const first = call(agentAt(w, w.road, w.sc[0]), 'get_entry', { name: 'Wren' })
    expect(first).toContain('Role in the story [role]: courier')
    expect(first).not.toContain('disgraced')
    const second = call(agentAt(w, w.road, w.sc[1]), 'get_entry', { name: 'Wren' })
    expect(second).toMatch(/Role in the story \[role\] \(changed in .*Sc 2\): disgraced courier/)
    expect(second).toContain('lost the map')
    expect(call(agentAt(w, w.road, w.sc[0]), 'get_entry', { name: 'Tobin' })).toContain('Character: Tobin (not in the story yet at this point)')
    // Another story's entry isn't there; a hidden one only when named whole.
    expect(call(agentAt(w, w.road, w.sc[0]), 'get_entry', { name: 'Quill' })).toMatch(/no entry called “Quill”/)
    expect(call(agentAt(w, w.road, w.sc[0]), 'get_entry', { name: 'Vesp' })).toMatch(/no entry called “Vesp”/)
    expect(call(agentAt(w, w.road, w.sc[0]), 'get_entry', { name: 'Vesper' })).toContain('Character: Vesper')
    // With no story open: the world as set up.
    expect(call(agentAt(w, null, null), 'get_entry', { name: 'Wren' })).toContain('As the world was set up')
  })

  it('asks which entry a part of a name means, and an exact name wins', () => {
    const w = twoStories()
    const agent = agentAt(w, w.road, w.sc[0])
    expect(call(agent, 'get_entry', { name: 'Mar' })).toMatch(/Did you mean Mara or Marek\?/)
    expect(call(agent, 'get_entry', { name: 'Mara' })).toMatch(/^Character: Mara\n/)
    expect(call(agent, 'get_entry', { name: 'Mare' })).toMatch(/^Using Marek for “Mare”\./)
  })

  it('reads only this story’s scenes', () => {
    const w = twoStories()
    expect(call(agentAt(w, w.road, w.sc[0]), 'read_scene', { scene: 'Glass Harbour, Ch 1, Sc 1' })).toMatch(/That scene is in Glass Harbour/)
  })
})

describe('italics', () => {
  it('are shown as *asterisks*, and words copied with or without them are found', () => {
    const w = twoStories()
    const agent = agentAt(w, w.road, w.sc[0])
    expect(call(agent, 'read_scene', {})).toContain('Wren crossed the salt flats. *Too late,* she thought.')
    // An edit across the italics' edge can't keep them: it goes to propose_rewrite.
    expect(call(agent, 'propose_edit', { find: '*Too late,* she thought.', replace: 'Too late, she knew.', why: 'x' })).toMatch(
      /^Not proposed: .*italics.*Use propose_rewrite/
    )
    // Inside the italics, the plain words are kept for the page to find.
    expect(call(agent, 'propose_edit', { find: '*Too late,*', replace: '*Far too late,*', why: 'x' })).toMatch(/^Proposed/)
    expect(agent.proposals[0]).toMatchObject({ kind: 'text', find: 'Too late,', replace: 'Far too late,' })
  })

  it('come back in a rewrite’s old passage, so only real changes show', () => {
    const w = twoStories()
    const agent = agentAt(w, w.road, w.sc[0])
    expect(call(agent, 'propose_rewrite', { start: 'Wren crossed', end: 'went quiet.', replace: 'Wren crossed. *Too late.*\n\nThe gulls hushed.', why: 'x' })).toMatch(/^Proposed/)
    expect(agent.proposals[0]).toMatchObject({
      kind: 'passage',
      start: 'Wren crossed',
      end: 'went quiet.',
      original: 'Wren crossed the salt flats. *Too late,* she thought.\n\nThe gulls went quiet.'
    })
  })

  it('round-trip through markItalics: each run wrapped, spaces at its edges left outside', () => {
    const plain = 'a bc d'
    const { marked } = markItalics(plain, [false, true, true, true, false, false])
    expect(marked).toBe('a *bc* d')
  })
})
