import { describe, expect, it } from 'vitest'
import type { EntryState } from '@shared/types'
import type { EditInput } from '@shared/contracts/edits'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { STAND_LEAD_HERE, editBriefing, replyRoom, type EditWorld } from './briefing'
import { EDIT_MARKER } from './prompts'
import { SPEAKER_TAG_LINE } from '../ai/speakerTags'
import { OPEN_THREADS_LEAD } from '../ai/openThreads'

function entry(id: string, name: string, o: Partial<EntryState> = {}): EntryState {
  return {
    id,
    kind: 'character',
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
    originStoryId: null,
    originSceneId: null,
    originStart: false,
    byHand: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: `2026-01-02T00:00:00.000Z-${id}`,
    happened: [],
    changed: [],
    ...o
  }
}

const MARA = entry('mara', 'Mara', {
  summary: 'A courier who lost her hand at the bridge.',
  fields: {
    pronouns: 'she/her',
    speech: 'Short, flat sentences. Never wastes a word.',
    sampleLines: 'Doors are for people with nothing to hide.\nMove.'
  }
})
const TOBIN = entry('tobin', 'Tobin', { fields: { pronouns: 'he/him' } })
const OLD_ROSE = entry('rose', 'Rose', { fields: { pronouns: 'she/her', speech: 'Rambling, warm, full of questions.' } })
const TAVERN = entry('eel', 'The Gilded Eel', { kind: 'place', summary: 'A smoky tavern in Lowtown.' })

const style = {
  ...defaultStyleGuide(),
  pov: 'Close third person',
  tense: 'Past tense',
  spelling: 'UK' as const,
  avoidPhrases: ['a shiver ran down']
}

function world(o: Partial<EditWorld> = {}): EditWorld {
  return {
    style,
    scene: {
      title: 'The Gilded Eel',
      card: {
        ...emptySceneCard(),
        povId: 'mara',
        presentIds: ['tobin'],
        locationId: 'eel',
        mood: 'Tense',
        beats: ['Mara arrives', 'Tobin lies', 'The knock']
      }
    },
    entries: [MARA, TOBIN, OLD_ROSE, TAVERN],
    contextLength: 32000,
    ...o
  }
}

const BEFORE = 'The rain had not let up since noon.\n\nMara pushed the door open. '
const SELECTION = 'The tavern was warm and loud and it smelled of wet pine and old tallow and spilled beer.'
const AFTER = ' Nobody looked up.\n\nTobin was waiting.'

function input(tool: EditInput['tool'], o: Partial<EditInput> = {}): EditInput {
  return { taskId: 't1', sceneId: 's1', tool, selection: SELECTION, before: BEFORE, after: AFTER, ...o }
}

function ok(b: ReturnType<typeof editBriefing>) {
  if (!b.ok) throw new Error(`expected a briefing, got: ${b.problem}`)
  return b
}

const system = (b: ReturnType<typeof ok>) => b.messages[0].content
const user = (b: ReturnType<typeof ok>) => b.messages[1].content

describe('what each tool sends', () => {
  it('starts every system prompt with the marker and the tool, then the job, how to reply and the style guide', () => {
    for (const tool of ['rewrite', 'expand', 'condense', 'vivid', 'tone', 'voice', 'alternatives', 'continue'] as const) {
      const sel = tool === 'voice' ? '“We leave at dawn,” said Mara.' : tool === 'continue' ? '' : SELECTION
      const b = ok(editBriefing(input(tool, { selection: sel, direction: 'make it sadder' }), world()))
      expect(system(b).split('\n')[0]).toBe(`${EDIT_MARKER} ${tool}`)
      expect(system(b)).toContain('Point of view: Close third person')
      expect(system(b)).toContain('Tense: Past tense')
      expect(system(b)).toContain('UK English')
      expect(system(b)).toContain('- a shiver ran down')
      expect(b.messages).toHaveLength(2)
      // The job again, last.
      expect(b.blocks.at(-1)!.id).toBe('ask')
      expect(user(b).endsWith(b.blocks.at(-1)!.text)).toBe(true)
    }
  })

  it('asks the writer to tag who says each line and how only when reading aloud wants it, with room for the tags', () => {
    const plain = ok(editBriefing(input('continue', { selection: '' }), world()))
    expect(user(plain)).not.toContain(SPEAKER_TAG_LINE)
    const tagged = ok(editBriefing(input('continue', { selection: '' }), world({ speakerTags: true })))
    expect(tagged.blocks.at(-1)!.text).toContain(SPEAKER_TAG_LINE)
    expect(tagged.reply).toBe(Math.ceil(plain.reply * 1.15))
    expect(user(ok(editBriefing(input('tone', { direction: 'colder' }), world({ speakerTags: true }))))).toContain(SPEAKER_TAG_LINE)
  })

  it('sends the selected words with the text around them, and where they sit in their paragraph', () => {
    const b = ok(editBriefing(input('condense'), world()))
    expect(user(b)).toContain(`The selected words (your reply takes their place):\n"""\n${SELECTION}\n"""`)
    expect(user(b)).toContain(
      'The text just before the selected words:\n"""\nThe rain had not let up since noon.\n\nMara pushed the door open.\n"""'
    )
    expect(user(b)).toContain('The text just after the selected words:\n"""\nNobody looked up.\n\nTobin was waiting.\n"""')
    expect(user(b)).toContain('The selected words sit inside a paragraph')
    expect(system(b)).toContain('condense the selected words to about half to two thirds of their length')
    expect(b.blocks.map((x) => x.id)).toEqual(['instructions', 'scene', 'characters', 'before', 'selection', 'after', 'ask'])
    expect(b.blocks.every((x) => x.tokens > 0 && !x.dropped)).toBe(true)
  })

  it('gives the point of view, the place and the mood, and the characters here (their voices too)', () => {
    const b = ok(editBriefing(input('vivid'), world()))
    expect(user(b)).toContain('Point-of-view character: Mara')
    expect(user(b)).toContain('Where: The Gilded Eel (A smoky tavern in Lowtown.)')
    expect(user(b)).toContain('Mood: Tense')
    expect(user(b)).toContain('### Mara\nIn short: A courier who lost her hand at the bridge.')
    expect(user(b)).toContain('How they speak: Short, flat sentences.')
    expect(user(b)).toContain('### Tobin')
    // Rose isn't in the scene or named near the words.
    expect(user(b)).not.toContain('### Rose')
    expect(b.entries.map((e) => e.entryId).sort()).toEqual(['eel', 'mara', 'tobin'])
    expect(b.entries.find((e) => e.entryId === 'mara')!.version).toBe(MARA.updatedAt)
    // A character named near the words comes in too.
    const named = ok(editBriefing(input('vivid', { after: ' Rose waved from the bar.' }), world()))
    expect(user(named)).toContain('### Rose')
  })

  it("puts Adam's instruction or tone in the job, and sizes the reply to the tool", () => {
    const rewrite = ok(editBriefing(input('rewrite', { direction: 'Make it about the smell, and sadder.' }), world()))
    expect(system(rewrite)).toContain('rewrite the selected words as the author asks:\n"""\nMake it about the smell, and sadder.\n"""')
    expect(rewrite.blocks.at(-1)!.text).toContain('(“Make it about the smell, and sadder”)')
    const tone = ok(editBriefing(input('tone', { direction: 'Eerie' }), world()))
    expect(system(tone)).toContain('give the selected words this tone: Eerie.')
    expect(replyRoom('expand', 300)).toBeGreaterThan(replyRoom('condense', 300))
    expect(replyRoom('condense', 300)).toBeGreaterThan(300 * 1.35)
    // Never less than a few hundred, however few the words.
    expect(replyRoom('condense', 3)).toBe(400)
    expect(replyRoom('alternatives', 200)).toBeGreaterThan(replyRoom('vivid', 200) * 2)
    expect(ok(editBriefing(input('condense'), world())).temperature).toBeLessThan(
      ok(editBriefing(input('alternatives'), world())).temperature
    )
  })

  it('asks for line breaks inside a paragraph to stay line breaks, when the words have them', () => {
    const verse = 'Roses are red,\nviolets are blue.\n\nThe end.'
    const rule = 'The text has line breaks inside paragraphs (as in a letter or a verse): write them as single line breaks too'
    expect(system(ok(editBriefing(input('condense', { selection: verse }), world())))).toContain(rule)
    expect(system(ok(editBriefing(input('alternatives', { selection: verse }), world())))).toContain(rule)
    expect(system(ok(editBriefing(input('condense'), world())))).not.toContain(rule)
    // Continue: the paragraph it carries on from.
    const letter = input('continue', { selection: '', before: 'Rain.\n\nDear Tobin,\nI am well', after: '', continueAs: 'inline' })
    expect(system(ok(editBriefing(letter, world())))).toContain(rule)
    const plain = input('continue', { selection: '', before: 'Dear Tobin,\nI am well.\n\nShe sealed it', after: '', continueAs: 'inline' })
    expect(system(ok(editBriefing(plain, world())))).not.toContain(rule)
  })

  it('asks Alternatives for three versions in a shape the interface can read', () => {
    const b = ok(editBriefing(input('alternatives'), world()))
    expect(system(b)).toContain('=== Version 1 ===, === Version 2 === and === Version 3 ===')
    expect(b.blocks.at(-1)!.text).toContain('three versions')
  })

  it('refuses a selection that is too long, in plain words', () => {
    const long = Array.from({ length: 3100 }, () => 'word').join(' ')
    const b = editBriefing(input('condense', { selection: long }), world())
    expect(b).toEqual({ ok: false, problem: 'The AI tools work on up to about 3,000 words at a time. Select fewer words and try again.' })
    const alt = editBriefing(input('alternatives', { selection: long.slice(0, 1300 * 5) }), world())
    expect(alt.ok).toBe(false)
  })

  it('fits a model that reads little by sending less of the text around, or says the words are too many', () => {
    const before = Array.from(
      { length: 40 },
      (_, i) => `Paragraph ${i} of the scene, with a few more words to make it long enough to matter.`
    ).join('\n\n')
    const big = ok(editBriefing(input('condense', { before }), world()))
    // A model that reads a little less than all of that.
    const full = big.blocks.reduce((n, x) => n + x.tokens + 4, 0)
    const small = ok(editBriefing(input('condense', { before }), world({ contextLength: Math.floor((full + big.reply) / 0.85) - 60 })))
    expect(user(small).length).toBeLessThan(user(big).length)
    expect(user(small)).toContain(SELECTION)
    expect(small.blocks.find((x) => x.id === 'before')!.text.length).toBeLessThan(big.blocks.find((x) => x.id === 'before')!.text.length)
    const huge = Array.from({ length: 2000 }, () => 'word').join(' ')
    const tooMuch = editBriefing(input('condense', { selection: huge }), world({ contextLength: 3000 }))
    expect(tooMuch.ok).toBe(false)
    if (!tooMuch.ok) expect(tooMuch.problem).toContain('Select fewer words, or pick a model that can read more in Settings › Models.')
  })
})

describe('Continue', () => {
  it('sends the scene so far and the scene card’s plan, and asks for a paragraph or two', () => {
    const b = ok(editBriefing(input('continue', { selection: '', before: BEFORE.trim(), after: '', continueAs: 'paragraph' }), world()))
    expect(user(b)).toContain(
      'The scene so far, up to where you carry on:\n"""\nThe rain had not let up since noon.\n\nMara pushed the door open.\n"""'
    )
    expect(user(b)).toContain('It stops at the end of a paragraph.')
    expect(user(b)).toContain('Beats, in order:\n1. Mara arrives\n2. Tobin lies\n3. The knock')
    expect(user(b)).not.toContain('The selected words')
    expect(system(b)).toContain('Start a new paragraph after the last one.')
    // With no "what happens next", the ask ends on the last paragraph (CARRY_ON_LAST).
    expect(b.blocks.at(-1)!.text).toBe(
      'Write the next paragraph or two of the scene, about 180 to 280 words. Reply with only the new words.\nCarry on from the last paragraph: what is happening there is what happens next.'
    )
  })

  it('carries on an unfinished paragraph, and leads into the text after the cursor', () => {
    const b = ok(
      editBriefing(
        input('continue', { selection: '', before: 'Mara pushed the door and', after: '\n\nTobin was waiting.', continueAs: 'inline' }),
        world()
      )
    )
    expect(system(b)).toContain('carry it on from exactly where it stops')
    expect(system(b)).toContain('The scene already has text after this point: lead into it')
    expect(user(b)).toContain('It stops part-way through a paragraph.')
    expect(user(b)).toContain('The text that comes after (lead into it; don\'t repeat it):\n"""\nTobin was waiting.\n"""')
  })

  it('says where things stand at the point it carries on from, right before the ask', () => {
    const stand = {
      time: 'night',
      weather: '',
      light: '',
      characters: [
        {
          name: 'Mara',
          where: 'by the hearth',
          wearing: 'shirt untucked, boots off',
          posture: 'kneeling',
          holding: '',
          condition: '',
          mood: '',
          lastAction: ''
        }
      ]
    }
    const b = ok(
      editBriefing(input('continue', { selection: '', before: BEFORE.trim(), after: '', continueAs: 'paragraph' }), world({ stand }))
    )
    const at = b.blocks.findIndex((x) => x.id === 'stand')
    expect(at).toBe(b.blocks.length - 2)
    expect(b.blocks[at].text.startsWith(STAND_LEAD_HERE)).toBe(true)
    expect(user(b)).toContain('- Mara: where: by the hearth; position: kneeling\n  - wearing: shirt untucked\n  - wearing: boots off')
    // Not known, or another tool: no such part.
    expect(
      ok(editBriefing(input('continue', { selection: '', before: BEFORE.trim(), after: '' }), world())).blocks.some((x) => x.id === 'stand')
    ).toBe(false)
    expect(ok(editBriefing(input('rewrite'), world({ stand }))).blocks.some((x) => x.id === 'stand')).toBe(false)
  })

  it('what must stay true goes right before the closing ask, for Continue and the other tools alike (step 4)', () => {
    const blank = { where: '', wearing: '', posture: '', holding: '', condition: '', mood: '', lastAction: '' }
    const stand = {
      time: 'night',
      weather: '',
      light: '',
      characters: [{ ...blank, name: 'Mara', where: 'by the hearth', condition: 'soaked through' }],
      said: { 'mara|condition': { quote: 'water ran off her', sceneId: 'earlier' } }
    }
    const marked = world({ entries: [{ ...MARA, fields: { ...MARA.fields, marks: 'no left hand' } }, TOBIN, OLD_ROSE, TAVERN] })
    const must = { facts: [{ factId: 'f', fact: 'The ledger is forged', knownBy: ['mara'] }], sceneId: 's1', storyTitle: 'Book 1', places: { earlier: 'Book 1, Ch 2, Sc 1' } }
    const cont = ok(editBriefing(input('continue', { selection: '', before: BEFORE.trim(), after: '' }), { ...marked, stand, must }))
    expect(cont.blocks.map((x) => x.id).slice(-3)).toEqual(['stand', 'must', 'ask'])
    const text = cont.blocks.find((x) => x.id === 'must')!.text
    // Where things stand is right above it, at this same moment: the list doesn't say it again (Adam, 2026-10-08).
    expect(cont.blocks.find((x) => x.id === 'stand')!.text).toContain('condition: soaked through')
    expect(text).not.toContain('soaked through')
    expect(text).not.toContain('Where Mara is')
    expect(text).toContain('- Mara: no left hand')
    expect(text).toContain('- Kept from Tobin: The ledger is forged (Mara knows it). Tobin must not learn, guess or think it here unless the scene card says so')
    // Another tool, where things stand not known there: the codex's facts still go in.
    const rewrite = ok(editBriefing(input('rewrite', { direction: 'Sadder' }), { ...marked, must }))
    expect(rewrite.blocks.map((x) => x.id).slice(-2)).toEqual(['must', 'ask'])
    expect(rewrite.blocks.find((x) => x.id === 'must')!.text).not.toContain('Where Mara is')
    // Nothing to keep to: no such part.
    expect(ok(editBriefing(input('rewrite'), world({ must: { ...must, facts: [] } }))).blocks.some((x) => x.id === 'must')).toBe(false)
    // A model with little room: the list goes short, then out, before the edit is refused, so an edit that fitted
    // before it came still fits.
    const at = (contextLength: number) => editBriefing(input('continue', { selection: '', before: BEFORE.trim(), after: '' }), { ...marked, stand, must, contextLength })
    const plain = (contextLength: number) => editBriefing(input('continue', { selection: '', before: BEFORE.trim(), after: '' }), { ...marked, stand, contextLength })
    let smallest = 0
    for (let n = 400; n < 20_000 && !smallest; n += 20) if (plain(n).ok) smallest = n
    expect(smallest).toBeGreaterThan(0)
    const tight = ok(at(smallest))
    expect(tight.blocks.some((x) => x.id === 'must')).toBe(false)
    expect(ok(at(32_000)).blocks.some((x) => x.id === 'must')).toBe(true)
  })

  it('what must stay true says what Mara gave away scenes back, from her notes and the ties at the scene', () => {
    const ledger = entry('ledger', 'The forged ledger', { kind: 'item' })
    const mara = { ...MARA, happened: [{ note: 'handed the forged ledger to Tobin', where: 'Book 1, Ch 1, Sc 3', changeId: 'c1', at: 3 }] }
    const must = { facts: [], sceneId: 's1', storyTitle: 'Book 1', places: {}, relationships: [] }
    const b = ok(editBriefing(input('rewrite'), world({ entries: [mara, TOBIN, OLD_ROSE, TAVERN, ledger], must })))
    const text = b.blocks.find((x) => x.id === 'must')!.text
    expect(text).toContain('- Mara: no longer has the forged ledger (handed the forged ledger to Tobin; since Ch 1, Sc 3)')
    expect(text).toContain('- Tobin: has the forged ledger (Mara handed the forged ledger to Tobin; since Ch 1, Sc 3)')
  })

  it('what must stay true says nothing of the marks or lost things of someone only named near the words, only that the dead are dead', () => {
    // The trap run (Adam, 2026-10-07): Continue's list spent five of its twelve lines on a dead master and a horse in
    // the stable, both only named in the scene so far.
    const ledger = entry('ledger', 'The forged ledger', { kind: 'item' })
    const seal = entry('seal', 'The harbour seal', { kind: 'item' })
    const rose = {
      ...OLD_ROSE,
      fields: { ...OLD_ROSE.fields, marks: 'a burn scar on her wrist' },
      happened: [{ note: 'lost the harbour seal', where: 'Book 1, Ch 1, Sc 2', changeId: 'c0', at: 2 }]
    }
    const edric = entry('edric', 'Edric', {
      fields: { marks: 'burned in his chair' },
      happened: [
        { note: 'handed the forged ledger to Mara', where: 'Book 1, Ch 1, Sc 1', changeId: 'c1', at: 1 },
        { note: 'died in his chair', where: 'Book 1, Ch 1, Sc 1', changeId: 'c2', at: 2 }
      ]
    })
    const must = { facts: [], sceneId: 's1', storyTitle: 'Book 1', places: {}, relationships: [] }
    const before = 'Mara thought of Rose, and of the ledger Edric had left her.'
    const b = ok(
      editBriefing(input('continue', { selection: '', before, after: '' }), world({ entries: [MARA, TOBIN, rose, edric, TAVERN, ledger, seal], must }))
    )
    const text = b.blocks.find((x) => x.id === 'must')!.text
    expect(text).toContain('- Mara: has the forged ledger (Edric handed the forged ledger to Mara; since Ch 1, Sc 1)')
    expect(text).toContain('- Edric is dead: died in his chair (since Ch 1, Sc 1)')
    expect(text).not.toContain('Edric: burned in his chair')
    expect(text).not.toContain('Edric: no longer has')
    expect(text).not.toContain('Rose:')
    // On the scene card, she is in the scene: her lines come back.
    const there = world({ entries: [MARA, TOBIN, rose, edric, TAVERN, ledger, seal], must })
    there.scene.card.presentIds = ['tobin', 'rose']
    const withRose = ok(editBriefing(input('continue', { selection: '', before, after: '' }), there)).blocks.find((x) => x.id === 'must')!.text
    expect(withRose).toContain('- Rose: a burn scar on her wrist')
    expect(withRose).toContain('- Rose: no longer has the harbour seal (lost the harbour seal; since Ch 1, Sc 2)')
  })
})

describe('Fix voice', () => {
  const dialogue = '“We leave at dawn,” said Mara.\n\n“Not a chance,” said Tobin.\n\n“Who goes there?”'

  it('says who says each line, and sends the speakers’ voices', () => {
    const b = ok(
      editBriefing(input('voice', { selection: dialogue, before: '', after: '' }), world({ scene: { title: 'X', card: emptySceneCard() } }))
    )
    const who = b.blocks.find((x) => x.id === 'speakers')!.text
    expect(who).toContain('1. Mara: “We leave at dawn,”')
    expect(who).toContain('2. Tobin, who has no voice profile yet (leave it as it is): “Not a chance,”')
    // Turn-taking gives the third line back to Mara.
    expect(who).toContain('3. Mara: “Who goes there?”')
    expect(user(b)).toContain('The speakers and their voices')
    expect(user(b)).toContain('Sample lines of dialogue:\n    "Doors are for people with nothing to hide."\n    "Move."')
    expect(b.note).toBe('Matching the voice of Mara. Tobin has no voice profile yet, so those lines stay as they are.')
  })

  it('says plainly when no speaker can be found, or no speaker has a voice', () => {
    const none = editBriefing(input('voice', { selection: '“Who goes there?”', before: '', after: '' }), world())
    expect(none).toEqual({
      ok: false,
      problem:
        'Couldn’t tell who says this line. Fix voice needs the speaker named nearby: in a speech tag such as “said Mara”, or in the same paragraph.'
    })
    const voiceless = editBriefing(input('voice', { selection: '“Not a chance,” said Tobin.', before: '', after: '' }), world())
    expect(voiceless).toEqual({
      ok: false,
      problem:
        'Tobin has no voice profile yet. Add how they speak or a few sample lines under Voice on Tobin’s page, then try Fix voice again.',
      entryId: 'tobin',
      entryName: 'Tobin'
    })
    const noLines = editBriefing(input('voice', { selection: 'She waited.', before: '', after: '' }), world())
    expect(noLines.ok).toBe(false)
  })
})

describe("Continue's memory core (Adam, 2026-10-08)", () => {
  const said = [
    { kind: 'promise' as const, by: 'Mara', heard: ['Tobin'], words: '“I’ll pay you at the turn of the tide.”', fact: 'Mara will pay Tobin', where: 'Ch 2, Sc 1', here: true, found: false },
    ...Array.from({ length: 6 }, (_, i) => ({ kind: 'threat' as const, by: 'Rose', heard: [], words: `Line ${i}`, fact: '', where: 'Ch 1, Sc 1', here: false, found: true }))
  ]
  const recalled = [
    { id: 'r1', name: 'The ledger', kind: 'item' as const, summary: 'Proof of the forgery.' },
    { id: 'r2', name: 'The night bell', kind: 'lore' as const, summary: 'No boats after it.' },
    { id: 'r3', name: 'Lowtown', kind: 'place' as const, summary: 'The docks.' },
    { id: 'r4', name: 'The weir', kind: 'place' as const, summary: 'Below the mill.' }
  ]
  const marked = { ...MARA, fields: { ...MARA.fields, marks: 'no left hand' } }
  const core = { timeline: 'Canon: what has already happened.\n- Ch 1, Sc 1: Mara crossed the river.', recalled, said }
  const go = (o: Partial<EditInput> = {}, w: Partial<EditWorld> = {}) =>
    ok(editBriefing(input('continue', { selection: '', before: `${BEFORE.trim()} The rain went on. The rain went on.`, after: '', ...o }), world({ entries: [marked, TOBIN, OLD_ROSE, TAVERN], core, ...w })))

  it('sends the timeline first (the same from one Continue to the next), then a few entries recalled and what was said, capped', () => {
    const b = go()
    const ids = b.blocks.map((x) => x.id)
    expect(ids[1]).toBe('timeline')
    expect(ids.indexOf('recalled')).toBeLessThan(ids.indexOf('before'))
    expect(ids.indexOf('said')).toBeLessThan(ids.indexOf('before'))
    const text = user(b)
    expect(text).toContain('- Ch 1, Sc 1: Mara crossed the river.')
    expect(text).toContain('- The ledger: Proof of the forgery.')
    expect(text).not.toContain('The weir')
    expect(text).toContain('Mara’s promise to Tobin (Ch 2, Sc 1)')
    expect(text.match(/^- .*Line \d/gm) ?? []).toHaveLength(3)
    // The point of view's facts to keep: the marks anyone would notice.
    expect(text).toContain('- Distinguishing marks: no left hand')
    // The other tools get none of it.
    const rewrite = ok(editBriefing(input('rewrite', { direction: 'Sadder' }), world({ core })))
    expect(rewrite.blocks.some((x) => x.id === 'timeline' || x.id === 'said' || x.id === 'recalled')).toBe(false)
  })

  it("says Adam's \"what happens next\" last, and names no phrase not to use", () => {
    const b = go({ direction: 'Tobin admits he lied' })
    const text = user(b)
    expect(text.trimEnd().endsWith('What happens next, as the author asks:\nTobin admits he lied')).toBe(true)
    expect(system(b)).toContain('The author says what happens next')
    expect(text).not.toContain('“the rain went on”')
    expect(text).not.toContain('This scene has used these already')
    // Without one: what is under way plays out first, then the card's next beat; the last paragraph is said last.
    expect(system(go())).toContain("Whatever is under way in the last paragraphs plays out first, at the scene's own pace; only once it has, move towards the card's next beat.")
    expect(user(go()).trimEnd().endsWith('Carry on from the last paragraph: what is happening there is what happens next.')).toBe(true)
  })

  it('stays compact: the core adds at most a few thousand tokens, and goes before the edit is refused', () => {
    const big = { ...core, timeline: Array.from({ length: 120 }, (_, i) => `- Ch ${i}, Sc 1: Something happened at the ford.`).join('\n') }
    const without = go({}, { core: undefined })
    const withCore = go({}, { core: big })
    const extra = withCore.blocks.reduce((n, x) => n + x.tokens, 0) - without.blocks.reduce((n, x) => n + x.tokens, 0)
    expect(extra).toBeGreaterThan(0)
    expect(extra).toBeLessThan(4000)
    // A small model: the core goes first.
    const small = go({}, { core: big, contextLength: 3000 })
    expect(small.blocks.some((x) => x.id === 'timeline')).toBe(false)
  })

  it('gives the open plot threads short, at most 4, next to the timeline, with the gentle rule (2026-10-08)', () => {
    const threads = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `The drowned bell ${i}`, promise: `Who rang it ${i}?`, clue: i === 0 ? 'a coin on the bell' : '' }))
    const b = go({}, { core: { ...core, threads } })
    const ids = b.blocks.map((x) => x.id)
    expect(ids.indexOf('threads')).toBe(ids.indexOf('timeline') + 1)
    const text = b.blocks.find((x) => x.id === 'threads')!.text
    expect(text).toContain(OPEN_THREADS_LEAD)
    expect(text).toContain('- The drowned bell 0 — Who rang it 0? — last clue: a coin on the bell')
    expect(text.match(/^- The drowned bell/gm)).toHaveLength(4)
    // None open: no block.
    expect(go().blocks.some((x) => x.id === 'threads')).toBe(false)
  })
})
