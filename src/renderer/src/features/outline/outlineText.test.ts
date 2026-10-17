// The suggestions written back out in the outline form (the Story builder, 2026-10-17): reading it back gives every
// act, chapter and scene the same key, so one can be swapped for a new version and the rest keep Adam's decisions.

import { describe, expect, it } from 'vitest'
import { parseOutline } from './parse'
import {
  applyPlanChanges,
  firstOfKind,
  keysUnder,
  nodeText,
  openText,
  outlineText,
  spliceText,
  splitPlanAnswer,
  splitPlanReply,
  stripTags,
  taggedText,
  titleOfTag,
  touchesOf
} from './outlineText'
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

  it('splits at the changes’ line', () => {
    expect(splitPlanReply('Done.\n=== Changes ===\n### Scene: X [#c0s0]')).toEqual({ answer: 'Done.', changes: '### Scene: X [#c0s0]', plan: null })
    expect(splitPlanReply('Done.\n=== Revised plan ===\n## Chapter: X')).toEqual({ answer: 'Done.', changes: null, plan: '## Chapter: X' })
  })
})

describe('a talk’s changes', () => {
  const current = outlineText(parseOutline(REPLY, true))
  const at = (text: string, ...path: number[]): TreeNode => path.reduce<TreeNode>((n, i) => n.children[i], { children: tree(text) } as unknown as TreeNode)

  it('tags every heading with its key, and reads back the same', () => {
    const t = taggedText(current)
    expect(t).toContain('### Scene: Salvage [#a0c0s1]')
    expect(t).toContain('# Act: The Light [#a1]')
    expect(tree(stripTags(t))).toEqual(tree(current))
  })

  it('changes only the scene given, keeping everything else word for word', () => {
    const out = applyPlanChanges(current, '### Scene: Salvage in the Kitchen [#a0c0s1]\nWhen: Day 1, evening\nSummary: Bram counts his luck in the kitchen.\nLocation: The kitchen\n- He smiles')!
    expect(out.lost).toBe(0)
    expect(at(out.text, 0, 0, 1)).toMatchObject({ title: 'Salvage in the Kitchen', text: 'Bram counts his luck in the kitchen.' })
    expect(out.text).toContain('Location: The kitchen')
    expect(at(out.text, 0, 0, 0).title).toBe('The Cold Lamp')
    expect(keys(tree(out.text))).toEqual(keys(tree(current)))
  })

  it('a chapter given with one scene keeps the scenes left out', () => {
    const out = applyPlanChanges(current, '## Chapter: Grey Dawn [#a0c0]\nGoal: Ada wakes.\n\n### Scene: Cold [#a0c0s0]\n- She shivers')!
    const ch = at(out.text, 0, 0)
    expect(ch.title).toBe('Grey Dawn')
    expect(ch.children.map((c) => c.title)).toEqual(['Cold', 'Salvage'])
    expect(ch.children[0].beats).toEqual(['She shivers'])
  })

  it('puts a new one where it says, and takes one out', () => {
    const out = applyPlanChanges(current, '### Scene: The Kettle [new after #a0c0s0]\n- It whistles\n\nRemove: #a1c0s0')!
    expect(at(out.text, 0, 0).children.map((c) => c.title)).toEqual(['The Cold Lamp', 'The Kettle', 'Salvage'])
    expect(out.text).not.toContain('### Scene: Lit')
  })

  it('reads the Touches line, and says which parts it changed and how', () => {
    const reply = '=== Changes ===\nTouches: #a0c0s0, #a0c0s1\n### Scene: The Cold Lamp [#a0c0s0]\nLocation: The kitchen\n- She climbs\n- The lamp is cold'
    expect(touchesOf(reply)).toEqual(['a0c0s0', 'a0c0s1'])
    const out = applyPlanChanges(current, reply.split('=== Changes ===')[1])!
    expect([...out.done]).toEqual(['a0c0s0'])
    expect(out.changes).toHaveLength(1)
    expect(out.changes[0]).toMatchObject({ kind: 'scene', mark: 'changed', where: 'Grey Water' })
    expect(titleOfTag(current, 'a0c0s1')).toBe('Salvage')
    // A second round's changes put together with the first.
    const both = applyPlanChanges(current, `${reply.split('=== Changes ===')[1]}\n\n### Scene: Salvage [#a0c0s1]\nLocation: The kitchen`)!
    expect([...both.done].sort()).toEqual(['a0c0s0', 'a0c0s1'])
  })

  it('a chapter given only to hold a changed scene isn’t listed as changed', () => {
    const out = applyPlanChanges(current, '## Chapter: Grey Water [#a0c0]\n\n### Scene: Salvage [#a0c0s1]\nSummary: Bram counts his luck in the kitchen.')!
    expect(out.changes.map((c) => c.kind)).toEqual(['scene'])
  })

  it('says nothing when nothing could be used', () => {
    expect(applyPlanChanges(current, '### Scene: Nowhere [#a9c9s9]\n- x')).toBeNull()
    expect(applyPlanChanges(current, 'Just words.')).toBeNull()
  })
})
