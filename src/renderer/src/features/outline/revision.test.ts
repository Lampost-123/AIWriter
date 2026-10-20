// Applying a talk's revised plan (2026-10-19, after "Talk it over wipes work"): what was kept stays kept, in its place,
// and is never offered to keep twice; what Adam discarded since stays discarded; his changes stay his where the talk
// didn't change that part; and the keys the page goes by are the ones reading the new text back gives.

import { describe, expect, it } from 'vitest'
import { parseOutline } from './parse'
import { applyPlanChanges, openKeys, openText, outlineText, wholePlanChanges, taggedText } from './outlineText'
import { carryRevision } from './revision'
import { outlineTree, type Decisions, type Edits, type TreeNode } from './tree'

const PLAN = `Premise: A keeper's daughter hunts a wrecker.

# Act: The Dark
Purpose: The light goes out.

## Chapter: Grey Water
Goal: Ada finds the lamp cold.

### Scene: The Cold Lamp
Summary: Ada climbs the tower.
- She climbs

### Scene: Salvage
Summary: Bram counts his luck.
- He smiles

### Scene: The Ledger
Summary: Ada reads the harbour ledger.
- A page is missing

## Chapter: Long Night
Goal: The wreck.

### Scene: The Wreck
Summary: A ship hits the reef.
- It sinks

# Act: The Light
Purpose: Ada wins.

## Chapter: Dawn
Goal: Light again.

### Scene: Lit
Summary: The lamp burns.
- It burns`

const tree = (text: string): TreeNode[] => outlineTree(parseOutline(text, true))
/** Every part as "key kind title (state)", in reading order. */
const show = (text: string, decisions: Decisions): string[] => {
  const out: string[] = []
  const walk = (nodes: TreeNode[]): void =>
    nodes.forEach((n) => {
      const d = decisions[n.key]
      out.push(`${n.key} ${n.title}${d ? ` (${d.status})` : ''}`)
      walk(n.children)
    })
  walk(tree(text))
  return out
}

/** A talk on the open suggestions, as planTalk.ts makes it: what was sent, the changes, and their trail. */
function talk(decisions: Decisions, edits: Edits, changes: string) {
  const current = openText(PLAN, decisions, edits)
  const sentKeys = openKeys(PLAN, decisions)
  const made = applyPlanChanges(current, changes)!
  const from = Object.fromEntries(Object.entries(made.origin).map(([k, v]) => [k, sentKeys[v]]))
  return { text: made.text, from, changed: made.changed, sent: Object.values(sentKeys) }
}

describe('applying a talk’s revision', () => {
  // The Cold Lamp kept (its chapter and act with it); Lit discarded.
  const decisions: Decisions = {
    a0: { status: 'kept', id: 'act1' },
    a0c0: { status: 'kept', id: 'ch1' },
    a0c0s0: { status: 'kept', id: 'sc1' },
    a1c0s0: { status: 'discarded' }
  }

  it('keeps what was kept, in its place, and never offers it to keep twice', () => {
    const t = talk(decisions, {}, '### Scene: Salvage at Dusk [#a0c0s0]\nSummary: Bram counts his luck at dusk.\n- He smiles')
    const out = carryRevision(PLAN, decisions, {}, t.text, t)
    expect(show(out.text, out.decisions)).toEqual([
      'a0 The Dark (kept)',
      'a0c0 Grey Water (kept)',
      'a0c0s0 The Cold Lamp (kept)',
      'a0c0s1 Salvage at Dusk',
      'a0c0s2 The Ledger',
      'a0c1 Long Night',
      'a0c1s0 The Wreck',
      'a1 The Light',
      'a1c0 Dawn'
    ])
    expect(out.decisions.a0c0s0).toEqual({ status: 'kept', id: 'sc1' })
    // The premise stays at the top.
    expect(out.text.startsWith("Premise: A keeper's daughter hunts a wrecker.")).toBe(true)
  })

  it('carries Adam’s changes where the talk didn’t change that part, and lets the talk’s change stand where it did', () => {
    const edits: Edits = {
      a0c0s1: { title: 'Salvage', text: 'Bram counts his luck, twice.', beats: ['He smiles'] },
      a0c0s2: { title: 'The Missing Page', text: 'Ada reads the harbour ledger.', beats: ['A page is missing'] }
    }
    const t = talk(decisions, edits, '### Scene: The Missing Page [#a0c0s1]\nSummary: Ada finds the page torn out.\n- A page is torn')
    // Adam edits Salvage again while the talk is answering: his newest words stay.
    const later: Edits = { ...edits, a0c0s1: { ...edits.a0c0s1, text: 'Bram counts his luck, three times.' } }
    const out = carryRevision(PLAN, decisions, later, t.text, t)
    const keyOf = (title: string): string => show(out.text, {}).find((l) => l.endsWith(` ${title}`))!.split(' ')[0]
    expect(out.edits[keyOf('Salvage')]).toEqual(later.a0c0s1)
    // The ledger scene the talk changed: its new words, not his old ones.
    expect(out.edits[keyOf('The Missing Page')]).toBeUndefined()
    expect(tree(out.text)[0].children[0].children.find((s) => s.title === 'The Missing Page')!.text).toBe('Ada finds the page torn out.')
  })

  it('keeps kept what Adam kept while the talk was answering, and discarded what he discarded', () => {
    const t = talk(decisions, {}, '### Scene: Salvage [#a0c0s0]\nSummary: Bram counts in the dark.\n- He smiles')
    const since: Decisions = { ...decisions, a0c0s1: { status: 'kept', id: 'sc2' }, a0c1: { status: 'discarded' }, a0c1s0: { status: 'discarded' } }
    const out = carryRevision(PLAN, since, {}, t.text, t)
    const lines = show(out.text, out.decisions)
    expect(lines).toContain('a0c0s1 Salvage (kept)')
    expect(lines).toContain('a0c1 Long Night (discarded)')
    // Kept, it shows as it was kept (the story has it so), not as the talk would have changed it; the toast says so.
    expect(tree(out.text)[0].children[0].children[1].text).toBe('Bram counts his luck.')
    expect(out.keptAsWas).toEqual(['Salvage'])
  })

  it('takes a kept scene the AI sent again for the kept one, never a second to keep', () => {
    const t = talk(decisions, {}, '### Scene: The Cold Lamp [new after #a0c0s1]\nSummary: Ada climbs again.\n- She climbs')
    const out = carryRevision(PLAN, decisions, {}, t.text, t)
    expect(show(out.text, out.decisions).filter((l) => l.includes('The Cold Lamp'))).toEqual(['a0c0s0 The Cold Lamp (kept)'])
  })

  it('puts a kept act with nothing left to decide back where it was', () => {
    const all: Decisions = { a0: { status: 'kept', id: 'act1' }, a0c0: { status: 'kept', id: 'ch1' }, a0c0s0: { status: 'kept', id: 's1' }, a0c0s1: { status: 'kept', id: 's2' }, a0c0s2: { status: 'kept', id: 's3' }, a0c1: { status: 'kept', id: 'ch2' }, a0c1s0: { status: 'kept', id: 's4' } }
    const t = talk(all, {}, '## Chapter: First Light [#a0c0]\nGoal: Light at last.')
    expect(t.text).not.toContain('The Dark')
    const out = carryRevision(PLAN, all, {}, t.text, t)
    expect(show(out.text, out.decisions).slice(0, 8)).toEqual([
      'a0 The Dark (kept)',
      'a0c0 Grey Water (kept)',
      'a0c0s0 The Cold Lamp (kept)',
      'a0c0s1 Salvage (kept)',
      'a0c0s2 The Ledger (kept)',
      'a0c1 Long Night (kept)',
      'a0c1s0 The Wreck (kept)',
      'a1 The Light'
    ])
    expect(show(out.text, out.decisions)).toContain('a1c0 First Light')
  })

  it('with nothing known of where its parts came from, goes by their titles', () => {
    const current = openText(PLAN, decisions, {})
    const plan = taggedText(current).replace(/ \[#[acs0-9]+\]/g, '').replace('Summary: Bram counts his luck.', 'Summary: Bram counts his luck by the fire.')
    const whole = wholePlanChanges(current, plan)
    const out = carryRevision(PLAN, decisions, { a0c0s2: { title: 'The Ledger', text: 'Mine.', beats: [] } }, whole.text, {})
    expect(show(out.text, out.decisions).slice(0, 4)).toEqual(['a0 The Dark (kept)', 'a0c0 Grey Water (kept)', 'a0c0s0 The Cold Lamp (kept)', 'a0c0s1 Salvage'])
    // His words differ from the revised plan's, and nothing says which came later: the plan he applied stands.
    expect(out.edits.a0c0s2).toBeUndefined()
  })

  it('reads back with the keys its decisions and changes go by', () => {
    const t = talk(decisions, {}, '### Scene: A New Night [new after #a0c0s0]\n- Ada waits')
    const out = carryRevision(PLAN, decisions, {}, t.text, t)
    const again = parseOutline(outlineText(parseOutline(out.text, true)), true)
    expect(outlineTree(again).map((n) => n.key)).toEqual(tree(out.text).map((n) => n.key))
    for (const key of Object.keys(out.decisions)) expect(show(out.text, {}).some((l) => l.startsWith(`${key} `))).toBe(true)
  })
})
