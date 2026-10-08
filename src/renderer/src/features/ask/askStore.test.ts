// Ask the world's conversation store, with the main process stood in for (the test plays its replies
// and task events): an answer asked to stop before it has started (Stop, a new chat, another chat or
// story) stops as soon as it starts, so none goes on being written where Adam can't see it; and a
// question the AI was asked stays in the chat even when no answer came, as it does in the chat's record;
// and a chat opened again while its answer is still finishing shows how it ended.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskInput, AskTurn, SavedNote } from '@shared/contracts/ask'
import type { TaskDone, TaskProgress } from '@shared/contracts/tasks'

const main = vi.hoisted(() => ({
  /** What happened, in order: "asked:<task>", "started:<task>" (askWorld came back), "stopTask:<task>". */
  log: [] as string[],
  listeners: new Map<string, (payload: unknown) => void>(),
  /** askWorld's replies, held until the test lets one go. */
  replies: [] as { input: AskInput; resolve: (t: AskTurn) => void; reject: (e: Error) => void }[],
  /** The chats' records, by chat. */
  chats: new Map<string, AskTurn[]>()
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code?: string
  },
  api: {
    askWorld: (input: AskInput) =>
      new Promise<AskTurn>((resolve, reject) => {
        main.log.push(`asked:${input.taskId}`)
        main.replies.push({ input, resolve, reject })
      }),
    stopTask: async (taskId: string) => {
      main.log.push(`stopTask:${taskId}`)
    },
    listChats: async () => [],
    getChat: async (chatId: string) => main.chats.get(chatId) ?? []
  },
  onEvent: (name: string, fn: (payload: unknown) => void) => {
    main.listeners.set(name, fn)
    return () => undefined
  }
}))
vi.mock('@/lib/flush', () => ({ registerDiscarder: () => () => undefined }))

import { setEditorBridge, type EditorBridge } from '@/lib/editorBridge'
import { ask, howFor, newChat, openChat, pickChoice, sendBox, showStory, stopAnswer, storyOfChat, useAsk, type AskPlace } from './askStore'

const place: AskPlace = { worldId: 'w', storyId: 's1', sceneId: null }
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Main's reply to the oldest question still waiting: its task has started. */
async function started(): Promise<string> {
  const r = main.replies.shift()
  if (!r) throw new Error('Nothing was asked')
  main.log.push(`started:${r.input.taskId}`)
  r.resolve({
    generationId: `g-${r.input.taskId}`,
    chatId: r.input.chatId ?? 'chat-1',
    question: r.input.question,
    answer: '',
    status: 'streaming',
    error: null,
    cost: null,
    costEstimated: false,
    cutOff: false,
    createdAt: '2026-10-02T15:00:00.000Z'
  })
  await settle()
  return r.input.taskId
}

/** True when the task was told to stop after it had started (before then, stopping it does nothing). */
function stoppedOnceStarted(taskId: string): boolean {
  const start = main.log.indexOf(`started:${taskId}`)
  return start >= 0 && main.log.slice(start).includes(`stopTask:${taskId}`)
}

const runningTask = (): string => {
  const r = useAsk.getState().running
  if (!r) throw new Error('Nothing is being answered')
  return r.taskId
}

beforeEach(() => {
  main.log.length = 0
  main.replies.length = 0
  main.chats.clear()
  useAsk.setState({ storyKey: 'w:s1', loading: false, loadError: null, chatId: null, turns: [], chats: [], running: null, saved: {} })
})

describe('an answer asked to stop before it has started', () => {
  it('stops as soon as it starts, after Stop', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = runningTask()
    stopAnswer()
    expect(useAsk.getState().running?.stopping).toBe(true)
    await started()
    expect(await asking).toBe(true)
    expect(stoppedOnceStarted(taskId)).toBe(true)
  })

  it('stops as soon as it starts, after a new chat', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = runningTask()
    newChat()
    expect(useAsk.getState().running).toBe(null)
    expect(useAsk.getState().turns).toEqual([])
    await started()
    await asking
    expect(stoppedOnceStarted(taskId)).toBe(true)
    // The new chat stays empty.
    expect(useAsk.getState().turns).toEqual([])
    expect(useAsk.getState().chatId).toBe(null)
  })

  it('stops as soon as it starts, after opening an earlier chat', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = runningTask()
    await openChat('chat-0')
    await started()
    await asking
    expect(stoppedOnceStarted(taskId)).toBe(true)
    expect(useAsk.getState().chatId).toBe('chat-0')
  })

  it('stops as soon as it starts, after another story shows', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = runningTask()
    await showStory({ worldId: 'w', storyId: 's2' })
    await started()
    await asking
    expect(stoppedOnceStarted(taskId)).toBe(true)
    expect(useAsk.getState().storyKey).toBe('w:s2')
  })

  it('is let be when nothing asked it to stop, and stops at once when asked while it is being written', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = await started()
    await asking
    expect(main.log).not.toContain(`stopTask:${taskId}`)
    expect(useAsk.getState().running?.taskId).toBe(taskId)
    stopAnswer()
    expect(main.log.at(-1)).toBe(`stopTask:${taskId}`)
  })
})

describe('a question that got no answer', () => {
  it('gives way to the next question when it never reached the AI', async () => {
    const asking = ask('Who is Mara?', place)
    main.replies.shift()?.reject(new Error('Choose a model for chats first.'))
    expect(await asking).toBe(false)
    expect(useAsk.getState().turns.map((t) => t.problem?.message)).toEqual(['Choose a model for chats first.'])
    void ask('Who is Mara?', place)
    const turns = useAsk.getState().turns
    expect(turns).toHaveLength(1)
    expect(turns[0].problem).toBeUndefined()
    expect(turns[0].status).toBe('streaming')
  })

  it('stays when the AI was asked: it is in the chat’s record', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = await started()
    await asking
    const done: TaskDone = {
      taskId,
      generationId: `g-${taskId}`,
      job: 'chat',
      text: '',
      status: 'error',
      error: 'OpenRouter has no credit left. Add some, then try again.',
      cost: null,
      cutOff: false
    }
    main.listeners.get('task:done')?.(done)
    expect(useAsk.getState().running).toBe(null)
    void ask('Who is Mara?', place)
    const turns = useAsk.getState().turns
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ generationId: `g-${taskId}`, status: 'error', error: done.error })
    expect(turns[1].status).toBe('streaming')
  })
})

describe('a chat opened again while its answer is still finishing', () => {
  it('shows the rest of the answer and how it ended', async () => {
    const asking = ask('Who is Mara?', place)
    const taskId = await started()
    await asking
    const generationId = `g-${taskId}`
    expect(useAsk.getState().chatId).toBe('chat-1')
    await openChat('chat-0')
    expect(stoppedOnceStarted(taskId)).toBe(true)
    // Back before the answer has finished stopping: its record still says it is being written.
    const record: AskTurn = {
      generationId,
      chatId: 'chat-1',
      question: 'Who is Mara?',
      answer: 'Mara is',
      status: 'streaming',
      error: null,
      cost: null,
      costEstimated: false,
      cutOff: false,
      createdAt: '2026-10-02T15:00:00.000Z'
    }
    main.chats.set('chat-1', [record])
    await openChat('chat-1')
    expect(useAsk.getState().turns[0].taskId).toBeUndefined()
    const progress: TaskProgress = { taskId, generationId, job: 'chat', text: 'Mara is a smith' }
    main.listeners.get('task:progress')?.(progress)
    expect(useAsk.getState().turns[0]).toMatchObject({ answer: 'Mara is a smith', status: 'streaming' })
    const done: TaskDone = { ...progress, text: 'Mara is a smith’s daughter', status: 'stopped', error: null, cost: 0.0004, cutOff: false }
    main.listeners.get('task:done')?.(done)
    expect(useAsk.getState().turns).toHaveLength(1)
    expect(useAsk.getState().turns[0]).toMatchObject({ answer: 'Mara is a smith’s daughter', status: 'stopped', cost: 0.0004 })
  })
})

describe('asking with a scene open', () => {
  it('saves the page first, so the chat reads what the page shows; the question shows meanwhile', async () => {
    let saved: () => void = () => undefined
    setEditorBridge({
      flush: () =>
        new Promise<void>((resolve) => {
          main.log.push('flush')
          saved = resolve
        })
    } as unknown as EditorBridge)
    try {
      const asking = ask('Is the tide too slow?', place)
      expect(useAsk.getState().turns.map((t) => t.question)).toEqual(['Is the tide too slow?'])
      await settle()
      expect(main.log).toEqual(['flush'])
      saved()
      await settle()
      expect(main.log[1]).toMatch(/^asked:/)
      await started()
      expect(await asking).toBe(true)
    } finally {
      setEditorBridge(null)
    }
  })
})

describe('the story a chat was asked in', () => {
  it('is read from the chat id', () => {
    expect(storyOfChat('s2:abc')).toBe('s2')
    expect(storyOfChat('world:abc')).toBe(null)
    expect(storyOfChat('')).toBeUndefined()
    expect(storyOfChat(undefined)).toBeUndefined()
  })
})

describe('a question with options (ask_user)', () => {
  const choice = { question: 'Which part do you mean?', options: [{ label: 'The opening' }, { label: 'The ending', detail: 'the last lines' }], recommended: 1 }

  it('shows as soon as the chat asks it, and a pick is sent as the next question in the same chat', async () => {
    const asking = ask('Make it better', place)
    const taskId = await started()
    await asking
    const generationId = `g-${taskId}`
    main.listeners.get('ask:choice')?.({ taskId, generationId, choice })
    expect(useAsk.getState().turns[0].choice).toEqual(choice)
    // Not while the answer is still being written.
    expect(pickChoice(generationId, [1], place)).toBe(false)
    main.listeners.get('task:done')?.({ taskId, generationId, job: 'chat', text: 'Which part do you mean?', status: 'complete', error: null, cost: null, cutOff: false })
    expect(pickChoice(generationId, [1], place)).toBe(true)
    await settle()
    const sent = main.replies.at(-1)!.input
    expect(sent).toMatchObject({ question: 'The ending — the last lines', chatId: 'chat-1' })
    expect(useAsk.getState().turns.map((t) => t.question)).toEqual(['Make it better', 'The ending — the last lines'])
    // Answered now: not picked from again.
    expect(pickChoice(generationId, [0], place)).toBe(false)
  })
})

describe('the box with a selection quoted (Ask about this, Edit this)', () => {
  const quote = { text: 'The lamp went out.', pids: ['p1'], mode: 'edit' as const }

  it('sends the selection beside the question, and "Edit this" as mode edit', async () => {
    useAsk.setState({ draft: `About this passage: “${quote.text}”\n\nMake it slower`, quote })
    expect(sendBox(place)).toBe(true)
    await settle()
    expect(main.replies.at(-1)!.input).toMatchObject({
      question: `About this passage: “${quote.text}”\n\nMake it slower`,
      mode: 'edit',
      selection: { text: quote.text, pids: ['p1'] }
    })
    expect(useAsk.getState()).toMatchObject({ draft: '', quote: null })
  })

  it('lets the quote go once the question no longer quotes it, and asks Ask about this without a mode', () => {
    expect(howFor('Make it slower', quote)).toEqual({})
    expect(howFor(`About this passage: “${quote.text}”\n\nWhy?`, { ...quote, mode: null, pids: [] })).toEqual({ selection: { text: quote.text } })
  })
})

describe('saved notes', () => {
  it('show "Saved" for an answer whose record keeps its note (saved before a restart)', async () => {
    const note: SavedNote = {
      entryId: 'e1',
      kind: 'character',
      name: 'Tobin',
      created: false,
      onlyIn: null,
      asOf: null,
      undo: { kind: 'added', entryId: 'e1', text: 'The ferryman.', before: '', origin: null, byHand: false }
    }
    const turn = (generationId: string, saved?: SavedNote): AskTurn => ({
      generationId,
      chatId: 'chat-2',
      question: 'Who is Tobin?',
      answer: 'The ferryman.',
      status: 'complete',
      error: null,
      cost: null,
      costEstimated: false,
      cutOff: false,
      createdAt: '2026-10-02T15:00:00.000Z',
      ...(saved ? { saved } : {})
    })
    main.chats.set('chat-2', [turn('g-a', note), turn('g-b')])
    await openChat('chat-2')
    expect(useAsk.getState().saved).toEqual({ 'g-a': note })
  })
})
