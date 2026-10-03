// The editor chat's tools: proposals that never overlap (one applied can't lose the words of another), a change
// revised in place, a proposal that didn't go through saying so, and the last words listing what was proposed.
import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import type { Proposal } from '@shared/contracts/ask'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import { EditorAgent } from './agent'

const TEXT = 'The tide came in over the flats. Teh gulls went quiet. Mara waited.'

function setup(): { agent: EditorAgent; shown: Proposal[][] } {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const sceneId = repo.getOutline(db, story.id).scenes[0].id
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { pid: 'p0' }, content: [{ type: 'text', text: TEXT }] }] }
  repo.saveSceneText(db, sceneId, doc, TEXT)
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
})
