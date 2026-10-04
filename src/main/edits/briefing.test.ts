import { describe, expect, it } from 'vitest'
import type { EntryState } from '@shared/types'
import type { EditInput } from '@shared/contracts/edits'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import { editBriefing, replyRoom, type EditWorld } from './briefing'
import { EDIT_MARKER } from './prompts'
import { NARRATION_TAG_LINE, SPEAKER_TAG_LINE } from '../ai/speakerTags'

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
    const tagged = ok(editBriefing(input('continue', { selection: '' }), world({ speakerTags: { narration: true } })))
    expect(tagged.blocks.at(-1)!.text).toContain(SPEAKER_TAG_LINE)
    expect(tagged.blocks.at(-1)!.text).toContain(NARRATION_TAG_LINE)
    expect(tagged.reply).toBe(Math.ceil(plain.reply * 1.15))
    const linesOnly = ok(editBriefing(input('tone', { direction: 'colder' }), world({ speakerTags: { narration: false } })))
    expect(user(linesOnly)).toContain(SPEAKER_TAG_LINE)
    expect(user(linesOnly)).not.toContain(NARRATION_TAG_LINE)
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
    expect(b.blocks.at(-1)!.text).toBe(
      'Write the next paragraph or two of the scene, about 120 to 250 words. Reply with only the new words.'
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
    expect(user(b)).toContain('Sample lines of dialogue:\n    Doors are for people with nothing to hide.\n    Move.')
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
