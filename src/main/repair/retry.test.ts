// Asking again after a reply that couldn't be used (2026-10-19): the same request, with the line at the end of its last
// message, never the reply.
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { withCorrection } from './retry'

describe('asking again', () => {
  it('sends the same messages, with the line after the last one’s words, and leaves the request asked first as it was', () => {
    const asked: ChatMessage[] = [
      { role: 'system', content: 'The instructions.' },
      { role: 'user', content: 'The material.\n\nThe task.', cacheUpTo: 13 }
    ]
    const again = withCorrection(asked, 'Your last reply to this couldn’t be used: it had no "issues" list.')
    expect(again).toEqual([
      { role: 'system', content: 'The instructions.' },
      { role: 'user', content: 'The material.\n\nThe task.\n\nYour last reply to this couldn’t be used: it had no "issues" list.', cacheUpTo: 13 }
    ])
    expect(again.some((m) => m.role === 'assistant')).toBe(false)
    expect(asked[1].content).toBe('The material.\n\nThe task.')
  })
})
