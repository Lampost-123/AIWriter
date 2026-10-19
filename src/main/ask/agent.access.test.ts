// Adam (2026-10-19): "I was getting an error with the chat saying it could not access something to edit." Each refusal
// the chat's tools can give about reaching something is either put right (it wasn't a real refusal) or said in plain
// words with what to do. Invented words only.
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { writerReason } from '@shared/askTruth'
import type { ToolCall } from '@shared/types'
import { dbWorld } from '../../../tests/unit/testWorld'
import { chatSwitches, memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { EditorAgent } from './agent'

afterEach(() => chatSwitches(null))

let n = 0
const run = (agent: EditorAgent, name: string, args: Record<string, unknown>): string => agent.run({ id: `a${++n}`, name, arguments: JSON.stringify(args) } as ToolCall).result

/** Sable Thorn first comes in Book 1, Ch 3; asked from a what-if that leaves Book 1 before then, only her name is known. */
function whatIf() {
  const v = dbWorld()
  const sable = repo.createEntry(v.db, 'character', { name: 'Sable Thorn', description: 'Betrays the Duke at the weir.' }, { origin: 'adam', originStoryId: v.id('b1') })
  mem.setDefaultExistsPoints(v.db, sable.id, [{ kind: 'scene', storyId: v.id('b1'), sceneId: v.id('b1.c3.s1') }])
  const agent = new EditorAgent(v.db, { storyId: v.id('keep'), sceneId: v.id('keep.c1.s1'), prefs: defaultWritingPrefs() }, () => undefined, () => undefined)
  return { v, agent }
}

describe('what the chat can’t change from here is said plainly, with what to do', () => {
  it('an entry known here only by name: from which story, and to ask there', () => {
    const { agent } = whatIf()
    const out = run(agent, 'propose_changes', { changes: [{ kind: 'entry', name: 'Sable Thorn', summary: 'A traitor.', why: 'As asked.' }] })
    expect(out).toContain('Sable Thorn is from Book 1, not in this story so far: it can\'t be changed from this story. Tell the writer to ask in the story it comes from.')
    expect(writerReason(agent.lastFailure()!)).toBe('Sable Thorn isn’t in this story so far, so it can’t be changed from here')
  })

  it('a card naming someone known here only by name: never "there is no character called…"', () => {
    const { agent } = whatIf()
    const out = run(agent, 'propose_changes', { changes: [{ kind: 'card', pov: 'Sable Thorn', why: 'As asked.' }] })
    expect(out).toMatch(/Sable Thorn is from Book 1, not in this story so far, so it can't be set on a card here/)
    expect(out).not.toMatch(/There is no character called/)
  })
})

describe('what the chat can reach is never turned down', () => {
  it('read_passage of the open scene is answered with its words, not "only earlier scenes can be read"', async () => {
    const db = memoryWorld()
    const story = repo.listStories(db)[0]
    const sceneId = repo.getOutline(db, story.id).scenes[0].id
    const words = 'The tide came in over the flats. The gulls went quiet.'
    repo.saveSceneText(db, sceneId, { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p1' }, content: [{ type: 'text', text: words }] }] }, words)
    const agent = new EditorAgent(db, { storyId: story.id, sceneId, prefs: defaultWritingPrefs() }, () => undefined, () => undefined)
    const { results, steps } = await agent.runAll([{ id: 'r1', name: 'read_passage', arguments: JSON.stringify({ scene: 'Ch 1, Sc 1', around: 'gulls' }) }])
    expect(String(results[0].content)).toContain(words)
    expect(String(results[0].content)).not.toMatch(/only earlier scenes can be read/)
    expect(steps[0].status).toBe('done')
    // The words count as read: a change to them may now be forced.
    expect(agent.knowsWords()).toBe(true)
  })
})
