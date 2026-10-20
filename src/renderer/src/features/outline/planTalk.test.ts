// The Plan talk tells the truth (chat-truth R1, R2, R6, edge case 6): a reply whose changes all name parts that aren't in
// the plan, one that doesn't read as a plan, or a claim with no change sent (after its asks again) changes nothing and
// says why, its claim put right by the shared check; a valid change waits, said as waiting; on the Plan hub while
// writing, a request for the story's own chapters is handed to Ask.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const main = vi.hoisted(() => ({
  replies: [] as string[],
  asked: [] as string[],
  run: null as null | { taskId: string; decisions: Record<string, unknown>; edits: Record<string, unknown>; text: string },
  handlers: {} as Record<string, (p: { taskId: string; status?: string; text: string; error?: string | null }) => void>
}))

vi.mock('@/components/ui', () => ({ toast: () => undefined }))
vi.mock('@/lib/api', () => ({
  onEvent: (name: string, fn: (p: { taskId: string; text: string }) => void) => void (main.handlers[name] = fn),
  api: {
    stopTask: async () => undefined,
    startPlanChat: async (input: { taskId: string; message: string }) => {
      main.asked.push(input.message)
      const text = main.replies.shift() ?? 'Nothing more.'
      setTimeout(() => main.handlers['task:done']?.({ taskId: input.taskId, status: 'complete', text, error: null }), 0)
      return { generationId: 'g' }
    }
  }
}))
vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand')
  return { useApp: create(() => ({ world: { id: 'w' }, storyId: 'st' })) }
})
vi.mock('./helperStore', () => ({
  talkBusy: () => false,
  settledRun: () => main.run,
  fullText: (run: { text: string }) => run.text,
  treeOf: () => [],
  applyRevision: () => true,
  applyRedo: () => true
}))

import { talkOf, useTalks } from '@/features/planning/talkStore'
import { talkOutcome } from '@/features/planning/talkTruth'
import { asksStoryChange, planScope, talkPlan } from './planTalk'

const PLAN = `## Chapter: Grey Water
Goal: Ada finds the lamp cold.

### Scene: The Cold Lamp
Summary: Ada climbs the tower.
- She climbs`

const last = () => {
  const turns = talkOf(planScope('st')).turns
  return turns[turns.length - 1]
}
const line = (): string | null => talkOutcome(last(), 'The plan below').words

beforeEach(() => {
  useTalks.setState({ talks: {} })
  main.replies = []
  main.asked = []
  main.run = { taskId: 'r1', decisions: {}, edits: {}, text: PLAN }
})

const WRONG = 'I’ve moved those scenes to the kitchen.\n=== Changes ===\nTouches: c9s9\n### Scene: The Kitchen [#c9s9]\nSummary: They talk in the kitchen.\n- A beat'

describe('talkPlan', () => {
  it('changes whose tags are all wrong: nothing changed, the claim put right (edge case 6)', async () => {
    main.replies = [WRONG]
    await talkPlan('st', 'Move them to the kitchen')
    expect(talkOf(planScope('st')).preview).toBeNull()
    expect(line()).toBe('Nothing was changed: the parts it named aren’t in the plan.')
    expect(last().text).not.toMatch(/I[’']ve moved/)
    expect(last().text).toMatch(/^No change was made/)
  })

  it('a whole plan that doesn’t read as one: nothing changed, with why', async () => {
    main.replies = ['I’ve reworked the plan.\n=== Revised plan ===\nJust some words, no headings.']
    await talkPlan('st', 'Rework it all')
    expect(line()).toBe('Nothing was changed: its reply didn’t read as a plan.')
    expect(last().text).not.toMatch(/I[’']ve reworked/)
  })

  it('a claim with no change sent is asked again, then says it didn’t send the change', async () => {
    main.replies = ['I’ve moved those scenes to the kitchen.', 'Sorry.', 'Sorry again.']
    await talkPlan('st', 'Move them to the kitchen')
    // Asked again once for the changes it forgot (the shared claim check), and it sent none.
    expect(main.asked).toHaveLength(2)
    expect(line()).toBe('Nothing was changed: it didn’t send the change.')
    expect(last().text).toMatch(/^No change was made/)
  })

  it('a valid change waits in the preview, said as waiting', async () => {
    const tag = /\[#(\w+)\]/.exec((await import('./outlineText')).taggedText(PLAN).split('\n').find((l) => l.startsWith('### Scene')) ?? '')?.[1]
    main.replies = [`I’ve moved the scene to the kitchen.\n=== Changes ===\nTouches: ${tag}\n### Scene: The Kitchen [#${tag}]\nSummary: Ada climbs to the kitchen.\n- She climbs`]
    await talkPlan('st', 'Move it to the kitchen')
    expect(talkOf(planScope('st')).preview).not.toBeNull()
    expect(line()).toBe('The plan below has 1 change waiting: press Apply.')
    expect(last().text).toMatch(/ready to apply/)
    expect(last().text).not.toMatch(/I[’']ve moved/)
  })

  it('a question is just answered: nothing changed', async () => {
    main.replies = ['The second chapter is where Ada catches the wrecker.']
    await talkPlan('st', 'Where does she catch him?')
    expect(main.asked).toHaveLength(1)
    expect(line()).toBe('Nothing was changed.')
    expect(last().text).toBe('The second chapter is where Ada catches the wrecker.')
  })
})

describe('the Plan hub while writing (R6)', () => {
  beforeEach(() => {
    main.run = null
  })

  it('a request for the story’s own chapter is handed to Ask, and the talk still answers', async () => {
    main.replies = ['Chapter 3 could end on the storm instead.']
    await talkPlan('st', 'Make chapter 3 shorter', undefined, { handOff: true })
    expect(last().handOff).toBe('Make chapter 3 shorter')
    expect(line()).toBe('This talk changes suggestions only.')
    expect(last().text).toBe('Chapter 3 could end on the storm instead.')
  })

  it('a claim of a change to the story with nothing sent is handed on too, and put right', async () => {
    main.replies = ['I’ve tightened the opening scene.', 'Sorry.', 'Sorry.']
    await talkPlan('st', 'The opening drags', undefined, { handOff: true })
    expect(last().handOff).toBe('The opening drags')
    expect(last().text).toMatch(/^No change was made/)
  })

  it('a question, or new suggestions, are not handed on', async () => {
    main.replies = ['It is about the storm.']
    await talkPlan('st', 'What is chapter 3 about?', undefined, { handOff: true })
    expect(last().handOff).toBeUndefined()
    expect(line()).toBe('Nothing was changed.')
  })

  it('reads a request for a change to chapters or scenes conservatively', () => {
    expect(asksStoryChange('Make chapter 3 shorter')).toBe(true)
    expect(asksStoryChange('Rewrite this scene so Mara arrives late')).toBe(true)
    expect(asksStoryChange('What happens in chapter 3?')).toBe(false)
    expect(asksStoryChange('Add a twist in the middle')).toBe(false)
  })
})
