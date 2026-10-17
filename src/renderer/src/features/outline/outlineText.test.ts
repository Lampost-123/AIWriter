// The suggestions written back out in the outline form (the Story builder, 2026-10-17): reading it back gives every
// act, chapter and scene the same key, so one can be swapped for a new version and the rest keep Adam's decisions.

import { describe, expect, it } from 'vitest'
import { parseOutline } from './parse'
import { firstOfKind, keysUnder, nodeText, openText, outlineText, spliceText, splitPlanAnswer } from './outlineText'
import { outlineTree, type TreeNode } from './tree'

const REPLY = `Premise: A keeper's daughter hunts a wrecker.

# Act: The Dark
Purpose: The light goes out.

## Chapter: Grey Water
Goal: Ada finds the lamp cold.
Point of view: Ada Lorne
Characters: Ada Lorne, Bram Holt
Location: Gull Harbour
When: Day 1, morning
Mood: Wary

### Scene: The Cold Lamp
When: Day 1, morning
Summary: Ada climbs the tower.
Sets up: Who wrecks the ships
- She climbs
- The lamp is cold

### Scene: Salvage
When: Day 1, evening
Summary: Bram counts his luck.
- He smiles

## Chapter: Long Night
Goal: The wreck.

### Scene: The Wreck
When: Day 2, night
Summary: A ship hits the reef.
Pays off: Who wrecks the ships
- It sinks

# Act: The Light
Purpose: Ada wins.

## Chapter: Dawn
Goal: Light again.

### Scene: Lit
When: Day 3, dawn
Summary: The lamp burns.
- It burns`

const keys = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => [n.key, ...keys(n.children)])
const tree = (text: string): TreeNode[] => outlineTree(parseOutline(text, true))

describe('writing suggestions back out', () => {
  it('reads back with the same keys, titles, beats, cards and threads', () => {
    const p = parseOutline(REPLY, true)
    const again = parseOutline(outlineText(p), true)
    expect(keys(outlineTree(again))).toEqual(keys(outlineTree(p)))
    expect(again).toEqual(p)
  })

  it('swaps one scene and leaves every other key as it was, with the premise kept', () => {
    const fresh = firstOfKind('### Scene: A New Night\nWhen: Day 1, night\nSummary: Ada waits.\n- She waits\n- He comes', 'scene')!
    const next = spliceText(REPLY, 'a0c0s1', fresh)!
    expect(next.startsWith("Premise: A keeper's daughter hunts a wrecker.")).toBe(true)
    expect(keys(tree(next))).toEqual(keys(tree(REPLY)))
    const scene = tree(next)[0].children[0].children[1]
    expect(scene).toMatchObject({ key: 'a0c0s1', title: 'A New Night', when: 'Day 1, night', beats: ['She waits', 'He comes'] })
    expect(tree(next)[0].children[0].children[0].title).toBe('The Cold Lamp')
  })

  it('swaps a chapter with a different number of scenes, changing keys only inside it', () => {
    const fresh = firstOfKind('## Chapter: Storm\nGoal: Wind.\n\n### Scene: One\n- a\n\n### Scene: Two\n- b\n\n### Scene: Three\n- c', 'chapter')!
    const next = spliceText(REPLY, 'a0c0', fresh)!
    const all = keys(tree(next))
    expect(all).toContain('a0c0s2')
    expect(all.filter((k) => !k.startsWith('a0c0'))).toEqual(keys(tree(REPLY)).filter((k) => !k.startsWith('a0c0')))
  })

  it('says nothing for a suggestion that isn’t there', () => {
    expect(spliceText(REPLY, 'a9', firstOfKind('# Act: X', 'act')!)).toBeNull()
    expect(nodeText(REPLY, 'a9c9', {})).toBe('')
  })

  it('writes one suggestion with Adam’s changes, for doing it again', () => {
    const text = nodeText(REPLY, 'a0c0s0', { a0c0s0: { title: 'My Title', text: 'Mine.', beats: ['one'] } })
    expect(text).toContain('### Scene: My Title')
    expect(text).toContain('Summary: Mine.')
    expect(text).toContain('- one')
  })

  it('talks over only what is still waiting: what was discarded goes, a kept chapter stays only for what is open in it', () => {
    const text = openText(REPLY, { a0c0: { status: 'kept', id: 'c1' }, a0c0s0: { status: 'kept', id: 's1' }, a1: { status: 'discarded' } }, {})
    expect(text).toContain('## Chapter: Grey Water')
    expect(text).not.toContain('The Cold Lamp')
    expect(text).toContain('### Scene: Salvage')
    expect(text).not.toContain('# Act: The Light')
    // Everything in a kept chapter kept: the chapter goes too.
    const all = openText(REPLY, { a0c0: { status: 'kept', id: 'c1' }, a0c0s0: { status: 'kept', id: 's1' }, a0c0s1: { status: 'kept', id: 's2' } }, {})
    expect(all).not.toContain('Grey Water')
  })

  it('finds what a suggestion holds', () => {
    expect(keysUnder('a0c1', ['a0', 'a0c1', 'a0c1s0', 'a0c10', 'a0c10s0', 'a1c1'])).toEqual(['a0c1', 'a0c1s0'])
  })

  it('reads an act given as chapters with no act heading', () => {
    const act = firstOfKind('## Chapter: One\n### Scene: A\n- x', 'act')
    expect(act && 'chapters' in act ? act.chapters.length : 0).toBe(1)
  })
})

describe('a talk’s answer', () => {
  it('splits at the revised plan’s line, however it is marked', () => {
    expect(splitPlanAnswer('Done.\n=== Revised plan ===\n## Chapter: X')).toEqual({ answer: 'Done.', plan: '## Chapter: X' })
    expect(splitPlanAnswer('Done.\n**Revised plan:**\n## Chapter: X')).toEqual({ answer: 'Done.', plan: '## Chapter: X' })
    expect(splitPlanAnswer('Only words.')).toEqual({ answer: 'Only words.', plan: null })
  })
})
