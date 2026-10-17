import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { PageMenu } from '@shared/contracts/spelling'
import { pageItems } from './pageItems'

type Item = MenuItemConstructorOptions
const page = (o: Partial<PageMenu> = {}): PageMenu => ({ token: 1, selection: false, dialogue: false, listen: false, ...o })
const labels = (items: Item[]): (string | undefined)[] => items.map((i) => (i.type === 'separator' ? '---' : i.label))
const find = (items: Item[], label: string): Item => items.find((i) => i.label === label) as Item
const sub = (items: Item[], label: string): Item[] => find(items, label).submenu as Item[]
const click = (item: Item): void => (item.click as () => void)()

describe('pageItems', () => {
  it('offers nothing outside a scene’s words', () => {
    expect(pageItems(null, () => undefined)).toEqual([])
    expect(pageItems(undefined, () => undefined)).toEqual([])
  })

  it('offers Ask about this paragraph with nothing selected, and Listen from here when read aloud is on', () => {
    expect(labels(pageItems(page(), () => undefined))).toEqual(['Ask about this paragraph', '---'])
    expect(labels(pageItems(page({ listen: true }), () => undefined))).toEqual(['Ask about this paragraph', 'Listen from here', '---'])
  })

  it('offers the bar’s actions on selected words, with the AI tools under Rewrite', () => {
    const items = pageItems(page({ selection: true, listen: true }), () => undefined)
    expect(labels(items)).toEqual(['Ask about this', 'Edit this', 'Rewrite', 'Listen from here', '---'])
    const tools = sub(items, 'Rewrite')
    expect(labels(tools)).toEqual(['Expand', 'Condense', 'More vivid', 'Change tone', 'Alternatives', '---', 'Continue after these words'])
    expect(labels(sub(tools, 'Change tone'))).toEqual(['Tense', 'Warm', 'Cold', 'Playful', 'Dark', 'Gentle', 'Formal', 'Casual'])
  })

  it('offers Fix voice only when the words have dialogue', () => {
    expect(labels(sub(pageItems(page({ selection: true, dialogue: true }), () => undefined), 'Rewrite'))).toContain('Fix voice')
  })

  it('sends back the action picked', () => {
    const pick = vi.fn()
    const items = pageItems(page({ selection: true, listen: true }), pick)
    click(find(items, 'Ask about this'))
    click(find(items, 'Edit this'))
    click(find(items, 'Listen from here'))
    const tools = sub(items, 'Rewrite')
    click(find(tools, 'Condense'))
    click(find(tools, 'Continue after these words'))
    click(find(sub(tools, 'Change tone'), 'Dark'))
    expect(pick.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'ask' },
      { kind: 'edit' },
      { kind: 'listen' },
      { kind: 'tool', tool: 'condense' },
      { kind: 'tool', tool: 'continue' },
      { kind: 'tool', tool: 'tone', direction: 'Dark' }
    ])
  })
})
