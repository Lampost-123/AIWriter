import { describe, expect, it } from 'vitest'
import { MAX_SHOWN, addToast, type ToastInput, type ToastItem } from './toastQueue'

const plain = (message: string, tone: ToastInput['tone'] = 'neutral'): ToastInput => ({ message, tone })
const undo = (message: string): ToastInput => ({ message, tone: 'neutral', action: { label: 'Undo', run: () => undefined } })

function show(inputs: ToastInput[]): { items: ToastItem[]; ids: number[] } {
  let items: ToastItem[] = []
  const ids: number[] = []
  inputs.forEach((t, i) => {
    const next = addToast(items, t, i + 1)
    items = next.items
    ids.push(next.id)
  })
  return { items, ids }
}

describe('addToast', () => {
  it('shows the same message once, giving it its full time again, rather than stacking copies', () => {
    const { items, ids } = show([
      plain('This scene is already marked done.'),
      plain('This scene is already marked done.'),
      plain('This scene is already marked done.')
    ])
    expect(items.map((i) => i.message)).toEqual(['This scene is already marked done.'])
    expect(items[0].rev).toBe(2)
    expect(ids).toEqual([1, 1, 1])
  })

  it('still shows different messages, and the same words in another tone, separately', () => {
    const { items } = show([plain('Saved'), plain('Not saved'), plain('Saved', 'danger')])
    expect(items.map((i) => `${i.tone}:${i.message}`)).toEqual(['neutral:Saved', 'neutral:Not saved', 'danger:Saved'])
  })

  it('never merges toasts with a button (each Undo acts on its own thing)', () => {
    const { items } = show([undo('Scene deleted.'), undo('Scene deleted.')])
    expect(items).toHaveLength(2)
  })

  it('keeps at most a few plain messages, oldest out first, and never pushes out an Undo', () => {
    const { items } = show([undo('Scene deleted.'), plain('a'), plain('b'), plain('c'), plain('d')])
    expect(items.map((i) => i.message)).toEqual(['Scene deleted.', 'c', 'd'])
    expect(items.length).toBe(MAX_SHOWN)
  })
})
