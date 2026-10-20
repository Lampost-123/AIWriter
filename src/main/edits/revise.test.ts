// Change it… ("Keep this, change that", 2026-10-19): what the writer model is sent to revise a passage. The passage as
// it is now, Adam's note, the sentences he marked Keep (said once in the system prompt as a rule, listed once in the
// briefing), the scene card in full, the plan and where things stand when there are, and his own writing as the sample.
import { describe, expect, it } from 'vitest'
import type { EditInput } from '@shared/contracts/edits'
import { defaultStyleGuide, emptySceneCard } from '@shared/defaults'
import type { SceneState } from '@shared/continuity'
import { estimateTokens } from '../keeper/text'
import { editBriefing, KEEP_LEAD, PASSAGE_LEAD, STAND_LEAD_PASSAGE, type EditWorld } from './briefing'
import { editInput } from './input'
import { EDIT_MARKER, KEEP_RULE, REVISION_RULE } from './prompts'

const style = { ...defaultStyleGuide(), pov: 'Close third person', tense: 'Past tense', spelling: 'UK' as const }

function world(o: Partial<EditWorld> = {}): EditWorld {
  return {
    style,
    scene: {
      title: 'The Gilded Eel',
      card: { ...emptySceneCard(), goal: 'Mara wants the ledger back.', outcome: 'She leaves without it.', beats: ['Mara arrives', 'Tobin lies'] }
    },
    entries: [],
    contextLength: 32000,
    ...o
  }
}

const PASSAGE = 'Rain hammered the shutters. Mara pushed through the crowd.\n\n“The ledger,” Tobin said. He did not look up.'
const KEPT = '“The ledger,” Tobin said.'

const input = (o: Partial<EditInput> = {}): EditInput => ({
  taskId: 't1',
  sceneId: 's1',
  tool: 'revise',
  direction: 'Closer, but shorter.',
  selection: PASSAGE,
  before: 'The door banged shut behind her.\n\n',
  after: '',
  keep: [KEPT],
  ...o
})

const userOf = (b: ReturnType<typeof editBriefing>): string => (b.ok ? b.messages[1].content : '')
const systemOf = (b: ReturnType<typeof editBriefing>): string => (b.ok ? b.messages[0].content : '')

describe('Change it… as the window sends it', () => {
  it('needs a note, and keeps only the kept sentences the passage has, in its order, once', () => {
    expect(() => editInput(input({ direction: ' ' }))).toThrow('Say what to change first.')
    const out = editInput(input({ keep: ['He did not look up.', 'Not in the passage.', KEPT, 'He did not look up.', 42 as unknown as string] }))
    expect(out.keep).toEqual([KEPT, 'He did not look up.'])
    expect(editInput(input({ keep: undefined })).keep).toBeUndefined()
    // The other tools never carry kept sentences.
    expect(editInput(input({ tool: 'condense' })).keep).toBeUndefined()
  })
})

describe('what Change it… sends', () => {
  it('sends the passage as it is now, the note and the kept sentences, with the revision and keep rules', () => {
    const b = editBriefing(input(), world())
    expect(b.ok).toBe(true)
    const system = systemOf(b)
    const user = userOf(b)
    expect(system.startsWith(`${EDIT_MARKER} revise`)).toBe(true)
    // The note, as the change asked for, and that it is a revision of what is there.
    expect(system).toContain('The change: revise the passage as the author\'s note asks:\n"""\nCloser, but shorter.\n"""')
    expect(system).toContain(REVISION_RULE)
    expect(system).toContain(KEEP_RULE)
    // The old version, whole, once.
    expect(user).toContain(`${PASSAGE_LEAD}\n"""\n${PASSAGE}\n"""`)
    expect(user.split('He did not look up.').length - 1).toBe(1)
    // The kept sentence, listed right after the passage.
    expect(user).toContain(`${KEEP_LEAD}\n- ${KEPT}`)
    expect(user.indexOf(KEEP_LEAD)).toBeGreaterThan(user.indexOf(PASSAGE_LEAD))
    // Said again last of all, with how many to keep.
    expect(user.trimEnd().endsWith('Revise the passage as the author asked (“Closer, but shorter”), keeping everything else as it is. Keep the marked sentence word for word. Reply with only the revised passage.')).toBe(true)
    // The scene card in full (a revision keeps to where the scene is going).
    expect(user).toContain('Goal: Mara wants the ledger back.')
    expect(user).toContain('Beats, in order:')
    if (b.ok) {
      expect(b.blocks.map((x) => x.id)).toEqual(['instructions', 'scene', 'before', 'selection', 'keep', 'ask'])
      // A revision keeps close to what is there.
      expect(b.temperature).toBeLessThan(0.8)
    }
  })

  it('with nothing kept, has no list and no keep rule', () => {
    const b = editBriefing(input({ keep: [] }), world())
    expect(systemOf(b)).not.toContain(KEEP_RULE)
    expect(userOf(b)).not.toContain(KEEP_LEAD)
    expect(userOf(b)).toContain('keeping everything else as it is. Reply with only the revised passage.')
  })

  it('gives the plan and where things stand before the passage when there are', () => {
    const stand = {
      time: 'night',
      weather: '',
      light: '',
      characters: [{ name: 'Mara', where: 'by the door', wearing: '', posture: 'standing', holding: 'a lamp', condition: '', mood: '', lastAction: '' }]
    } as SceneState
    const b = editBriefing(input(), world({ plan: 'The plan for this scene:\n1. Mara arrives (next)', stand }))
    const user = userOf(b)
    expect(user).toContain('The plan for this scene:\n1. Mara arrives (next)')
    expect(user).toContain(STAND_LEAD_PASSAGE)
  })

  it('uses Adam’s own writing as the voice sample when it is given', () => {
    const own = { passages: [{ text: 'Short. Sharp. The way Adam writes it.', from: 'Ch 1, Sc 2' }], words: 7 } as unknown as EditWorld['ownSample']
    const system = systemOf(editBriefing(input(), world({ ownSample: own })))
    expect(system).toContain('Short. Sharp. The way Adam writes it.')
    // The other tools stay as they were.
    expect(systemOf(editBriefing(input({ tool: 'condense', keep: [] }), world({ ownSample: own })))).not.toContain('The way Adam writes it.')
  })

  it('costs about what a Rewrite of the same words does, plus the kept sentences and two rules', () => {
    const passage = Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} has a sentence of some length in it, and then another one after that. ${'Words '.repeat(30).trim()}.`).join('\n\n')
    const size = (b: ReturnType<typeof editBriefing>): number => (b.ok ? b.messages.reduce((n, m) => n + estimateTokens(m.content), 0) : 0)
    const rewrite = size(editBriefing(input({ tool: 'rewrite', selection: passage, keep: [] }), world()))
    const keeps = passage.split('\n\n').map((p) => p.split('. ')[0] + '.')
    const revise = size(editBriefing(input({ selection: passage, keep: keeps }), world()))
    const extra = keeps.reduce((n, k) => n + estimateTokens(`- ${k}`), 0)
    expect(revise - rewrite).toBeLessThan(extra + 260)
    expect(revise).toBeGreaterThan(rewrite)
  })
})
