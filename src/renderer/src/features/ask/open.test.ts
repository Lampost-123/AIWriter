// Make this change in the story (chat-truth R6): Ask opens beside the page with the request sent, in a new chat; when
// an answer is still coming, the request waits in the box instead.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const s = vi.hoisted(() => ({ calls: [] as string[], running: null as unknown, asked: true }))

vi.mock('@/lib/store', async () => {
  const { create } = await import('zustand')
  return {
    useApp: create(() => ({
      world: { id: 'w' },
      storyId: 'st',
      sceneId: 'sc',
      view: { kind: 'plan' },
      navigate: () => void s.calls.push('navigate'),
      setAskOpen: (open: boolean) => void s.calls.push(`open:${open}`)
    }))
  }
})
vi.mock('./askStore', async () => {
  const { create } = await import('zustand')
  const useAsk = create(() => ({ loading: false, running: s.running, turns: [] as unknown[], draft: '' }))
  return {
    useAsk,
    requestBoxFocus: () => undefined,
    setQuote: () => undefined,
    setDraft: (d: string) => void s.calls.push(`draft:${d}`),
    showStory: async (p: { storyId: string }) => void s.calls.push(`show:${p.storyId}`),
    newChat: () => void s.calls.push('new'),
    ask: async (q: string, p: { storyId: string; sceneId: string }) => {
      s.calls.push(`ask:${q}:${p.storyId}:${p.sceneId}`)
      return s.asked
    }
  }
})

import { askInStory } from './open'
import { useAsk } from './askStore'

beforeEach(() => {
  s.calls = []
  useAsk.setState({ running: null, loading: false })
})

describe('askInStory', () => {
  it('opens Ask on the page and sends the request in a new chat', async () => {
    await askInStory('Make chapter 3 shorter')
    expect(s.calls).toEqual(['navigate', 'open:true', 'show:st', 'new', 'ask:Make chapter 3 shorter:st:sc'])
  })

  it('leaves the request in the box while an answer is still coming', async () => {
    useAsk.setState({ running: { taskId: 't', stopping: false, retrying: null } })
    await askInStory('Make chapter 3 shorter')
    expect(s.calls).toContain('draft:Make chapter 3 shorter')
    expect(s.calls.some((c) => c.startsWith('ask:'))).toBe(false)
  })
})
