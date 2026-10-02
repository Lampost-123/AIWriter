import { describe, expect, it } from 'vitest'
import { parseOutline } from './parse'
import {
  countLine,
  countNodes,
  describeCounts,
  discardKeys,
  discardedMessage,
  goneIds,
  keepPlan,
  keptMessage,
  lastNodeKey,
  outlineTree,
  withDiscarded,
  withKept,
  withoutDiscarded,
  withoutGone,
  withoutKept,
  type Decisions
} from './tree'

const REPLY = `# Act: The Arrival
Purpose: Mara reaches the city.

## Chapter: Rain on the Narrows
Goal: Mara finds her footing.

### Scene: Arrival at the docks
Summary: Mara lands.
- She comes in out of the rain
- She spots the watcher

### Scene: A bargain at the docks
Summary: Tobin offers a deal.
- Tobin names his price

## Chapter: The Ferryman's Price
Goal: The debt comes due.

### Scene: The crossing
Summary: They cross at night.
- The fog comes down

# Act: The Turning
Purpose: Her loyalties split.

## Chapter: Lanterns at Low Tide
Goal: Mara follows the trail.

### Scene: Pursuit through the market
Summary: The guild gives chase.
- A shout behind her
`

const tree = outlineTree(parseOutline(REPLY, true))

/** Each item as one line: kind, key, title, and where it goes. */
const show = (items: ReturnType<typeof keepPlan>): string[] =>
  items.map((i) => {
    const ref = (name: string, r?: { id?: string | null; key?: string | null }): string =>
      r ? ` ${name}=${r.id ? `#${r.id}` : r.key}` : ''
    return `${i.kind} ${i.key} ${i.title}${ref('in', i.parent)}${ref('after', i.after)}${ref('before', i.before)}`
  })

describe('the suggestions as a tree', () => {
  it('holds acts, their chapters and their scenes, with keys that stay put', () => {
    expect(tree.map((n) => [n.kind, n.key, n.title, n.children.length])).toEqual([
      ['act', 'a0', 'The Arrival', 2],
      ['act', 'a1', 'The Turning', 1]
    ])
    expect(tree[0].children[0]).toMatchObject({ kind: 'chapter', key: 'a0c0', text: 'Mara finds her footing.' })
    expect(tree[0].children[0].children[1]).toMatchObject({
      kind: 'scene',
      key: 'a0c0s1',
      text: 'Tobin offers a deal.',
      beats: ['Tobin names his price']
    })
  })

  it('knows which suggestion is being written while the answer arrives', () => {
    const at = (end: string): string | null => lastNodeKey(outlineTree(parseOutline(REPLY.slice(0, REPLY.indexOf(end)), false)))
    expect(at('Purpose: Mara reaches')).toBe('a0')
    expect(at('Goal: Mara finds')).toBe('a0c0')
    expect(at('- Tobin names')).toBe('a0c0s1')
    expect(at('# Act: The Turning')).toBe('a0c1s0')
    expect(at('Goal: Mara follows')).toBe('a1c0')
    expect(lastNodeKey([])).toBe(null)
  })

  it('puts chapters with no act at the top', () => {
    const flat = outlineTree(parseOutline('## Chapter: One\n### Scene: A\n- Beat\n## Chapter: Two', true))
    expect(flat.map((n) => [n.kind, n.key])).toEqual([
      ['chapter', 'c0'],
      ['chapter', 'c1']
    ])
  })
})

describe('what Keep adds', () => {
  it('keeps a scene with the chapter and act it needs, and nothing beside it', () => {
    expect(show(keepPlan(tree, {}, {}, ['a0c0s1']))).toEqual([
      'act a0 The Arrival',
      'chapter a0c0 Rain on the Narrows in=a0',
      'scene a0c0s1 A bargain at the docks in=a0c0'
    ])
  })

  it('puts the next one kept beside what is kept already: before a kept scene after it, after a kept chapter before it', () => {
    let d: Decisions = withKept({}, [
      { key: 'a0', kind: 'act', id: 'A0' },
      { key: 'a0c0', kind: 'chapter', id: 'C0' },
      { key: 'a0c0s1', kind: 'scene', id: 'S1' }
    ])
    expect(show(keepPlan(tree, d, {}, ['a0c0s0']))).toEqual(['scene a0c0s0 Arrival at the docks in=#C0 before=#S1'])
    expect(show(keepPlan(tree, d, {}, ['a0c1']))).toEqual([
      "chapter a0c1 The Ferryman's Price in=#A0 after=#C0",
      'scene a0c1s0 The crossing in=a0c1'
    ])
    d = withKept(d, [{ key: 'a0c0s0', kind: 'scene', id: 'S0' }])
    expect(countNodes(tree, d, 'kept')).toEqual({ acts: 1, chapters: 1, scenes: 2 })
    expect(countNodes(tree, d, 'open')).toEqual({ acts: 1, chapters: 2, scenes: 2 })
  })

  it('keeps all that is left in reading order, after what is kept, and never what was discarded', () => {
    let d: Decisions = withKept({}, [{ key: 'a0', kind: 'act', id: 'A0' }])
    const gone = discardKeys(tree, d, 'a0c1')
    expect(gone).toEqual(['a0c1', 'a0c1s0'])
    d = withDiscarded(d, gone)
    expect(show(keepPlan(tree, d, {}, 'all'))).toEqual([
      'chapter a0c0 Rain on the Narrows in=#A0',
      'scene a0c0s0 Arrival at the docks in=a0c0',
      'scene a0c0s1 A bargain at the docks in=a0c0 after=a0c0s0',
      'act a1 The Turning after=#A0',
      'chapter a1c0 Lanterns at Low Tide in=a1',
      'scene a1c0s0 Pursuit through the market in=a1c0'
    ])
    // Discarding what is already decided does nothing, and Undo brings it back.
    expect(discardKeys(tree, d, 'a0c1s0')).toEqual([])
    d = withoutDiscarded(d, gone)
    expect(countNodes(tree, d, 'open').chapters).toBe(3)
  })

  it('keeps nothing when what was clicked is already decided', () => {
    const d = withDiscarded({}, ['a1', 'a1c0', 'a1c0s0'])
    expect(keepPlan(tree, d, {}, ['a1c0s0'])).toEqual([])
    expect(keepPlan(tree, withKept({}, [{ key: 'a1', kind: 'act', id: 'A1' }]), {}, ['a1'])).toEqual([])
  })

  it("uses Adam's words where he changed them, tidied", () => {
    const items = keepPlan(tree, {}, { a0c0s0: { title: '  The docks at night ', text: ' She lands. ', beats: ['  One ', '', 'Two'] } }, [
      'a0c0s0'
    ])
    expect(items[2]).toMatchObject({ key: 'a0c0s0', title: 'The docks at night', text: 'She lands.', beats: ['One', 'Two'] })
    expect(items[1]).toMatchObject({ key: 'a0c0', title: 'Rain on the Narrows', text: 'Mara finds her footing.' })
    expect(items[0].beats).toBeUndefined()
  })

  it('keeps each scene’s When, Adam’s where he changed it, and leaves it out when there is none', () => {
    const dated = outlineTree(
      parseOutline('## Chapter: One\n### Scene: A\nWhen: Day 1, morning\n### Scene: B\nWhen: Day 1, dusk\n### Scene: C\n- Beat', true)
    )
    expect(dated[0].children.map((n) => n.when)).toEqual(['Day 1, morning', 'Day 1, dusk', ''])
    expect(dated[0].when).toBe('')
    const edits = { c0s1: { title: 'B', text: '', beats: [], when: '  Day 2, night ' }, c0s0: { title: 'A', text: '', beats: [] } }
    const items = keepPlan(dated, {}, edits, 'all')
    expect(items.map((i) => [i.key, i.when])).toEqual([
      ['c0', undefined],
      ['c0s0', 'Day 1, morning'],
      ['c0s1', 'Day 2, night'],
      ['c0s2', undefined]
    ])
    // Cleared by Adam: the story fills it in.
    expect(keepPlan(dated, {}, { c0s0: { title: 'A', text: '', beats: [], when: ' ' } }, ['c0s0'])[1].when).toBeUndefined()
  })

  it('keeps a chapter of a reply with no acts on its own, for the story to place', () => {
    const flat = outlineTree(parseOutline('## Chapter: One\n### Scene: A\n- Beat\n## Chapter: Two\n### Scene: B', true))
    expect(show(keepPlan(flat, {}, {}, ['c1s0']))).toEqual(['chapter c1 Two', 'scene c1s0 B in=c1'])
    const d = withKept({}, [{ key: 'c1', kind: 'chapter', id: 'C1' }])
    expect(show(keepPlan(flat, d, {}, ['c0']))).toEqual(['chapter c0 One before=#C1', 'scene c0s0 A in=c0'])
  })

  it('opens what Undo takes back', () => {
    const kept = [
      { key: 'a1', kind: 'act' as const, id: 'A1' },
      { key: 'a1c0', kind: 'chapter' as const, id: 'C9' }
    ]
    const d = withoutKept(withKept({ a0: { status: 'discarded' } }, kept), kept)
    expect(d).toEqual({ a0: { status: 'discarded' } })
    // An older Undo leaves alone what was kept again since, as something new.
    const again = withKept({}, [{ key: 'a1', kind: 'act', id: 'A2' }])
    expect(withoutKept(again, kept)).toEqual(again)
  })

  it('makes anew what was kept but deleted from the story since, with what is still open inside it', () => {
    const kept = withKept({ a1: { status: 'discarded' } }, [
      { key: 'a0', kind: 'act', id: 'A0' },
      { key: 'a0c0', kind: 'chapter', id: 'C0' },
      { key: 'a0c0s1', kind: 'scene', id: 'S1' }
    ])
    // The act was deleted in the binder, with its chapter and scene.
    const gone = goneIds(kept, new Set(['X']))
    expect(gone).toEqual(['A0', 'C0', 'S1'])
    const d = withoutGone(kept, gone)
    expect(d).toEqual({ a1: { status: 'discarded' } })
    expect(show(keepPlan(tree, d, {}, ['a0c0s0']))).toEqual([
      'act a0 The Arrival',
      'chapter a0c0 Rain on the Narrows in=a0',
      'scene a0c0s0 Arrival at the docks in=a0c0'
    ])
    // Only the scene was deleted: it alone waits again, and goes back beside what is still there.
    const one = withoutGone(kept, goneIds(kept, new Set(['A0', 'C0'])))
    expect(show(keepPlan(tree, one, {}, ['a0c0s1']))).toEqual(['scene a0c0s1 A bargain at the docks in=#C0'])
    expect(withoutGone(kept, [])).toBe(kept)
  })
})

describe('the words for what happened', () => {
  it('says what one Keep added', () => {
    expect(keptMessage(tree, 'a0c0s1', keepPlan(tree, {}, {}, ['a0c0s1']))).toBe(
      'Added “A bargain at the docks” to the story, in a new chapter and act.'
    )
    expect(keptMessage(tree, 'a0', keepPlan(tree, {}, {}, ['a0']))).toBe('Added “The Arrival” to the story, with 2 chapters and 3 scenes.')
    expect(keptMessage(tree, 'a1c0', keepPlan(tree, {}, {}, ['a1c0']))).toBe(
      'Added “Lanterns at Low Tide” to the story, in a new act, with a scene.'
    )
    const d = withKept({}, [
      { key: 'a0c0', kind: 'chapter', id: 'C0' },
      { key: 'a0', kind: 'act', id: 'A0' }
    ])
    expect(keptMessage(tree, 'a0c0s0', keepPlan(tree, d, {}, ['a0c0s0']))).toBe('Added “Arrival at the docks” to the story.')
  })

  it('says what one Discard took away', () => {
    expect(discardedMessage(tree, discardKeys(tree, {}, 'a0c1'), {})).toBe("Discarded “The Ferryman's Price” and its scene.")
    expect(discardedMessage(tree, discardKeys(tree, {}, 'a0'), {})).toBe('Discarded “The Arrival” and its 2 chapters and 3 scenes.')
    expect(discardedMessage(tree, ['a1c0s0'], { a1c0s0: { title: 'The chase', text: '', beats: [] } })).toBe('Discarded “The chase”.')
  })

  it('counts in plain words', () => {
    expect(describeCounts({ acts: 1, chapters: 3, scenes: 9 })).toBe('an act, 3 chapters and 9 scenes')
    expect(describeCounts({ acts: 0, chapters: 1, scenes: 0 })).toBe('a chapter')
    expect(describeCounts({ acts: 0, chapters: 0, scenes: 0 })).toBe('')
    expect(countLine({ acts: 1, chapters: 0, scenes: 4 })).toBe('1 act and 4 scenes')
  })
})
