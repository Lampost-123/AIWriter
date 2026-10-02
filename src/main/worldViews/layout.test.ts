import { describe, expect, it } from 'vitest'
import { layoutGraph, MIN_GAP, type LayoutGraph, type Positions } from './layout'

/** A small, repeatable random number generator. */
function random(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function graph(n: number, links: number, seed = 3): LayoutGraph {
  const rnd = random(seed)
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Character ${i}` }))
  const edges: [string, string][] = []
  for (let i = 0; i < links; i++) {
    // A few busy characters, as in a real cast.
    const a = rnd() < 0.3 ? Math.floor(rnd() * Math.min(5, n)) : Math.floor(rnd() * n)
    const b = Math.floor(rnd() * n)
    if (a !== b) edges.push([`c${a}`, `c${b}`])
  }
  return { nodes, edges }
}

const dist = (p: Positions, a: string, b: string): number => Math.hypot(p.get(a)!.x - p.get(b)!.x, p.get(a)!.y - p.get(b)!.y)

describe('the relationship map layout', () => {
  it('is the same every time, whatever order the characters and relationships come in', () => {
    const g = graph(30, 45)
    const one = layoutGraph(g)
    const two = layoutGraph({ nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse().map(([a, b]) => [b, a] as [string, string]) })
    expect([...two.entries()].sort()).toEqual([...one.entries()].sort())
    expect(one.size).toBe(30)
  })

  it('keeps everyone already placed exactly where they were when relationships are added', () => {
    const g = graph(20, 30)
    const before = layoutGraph(g)
    const more: LayoutGraph = {
      nodes: [...g.nodes, { id: 'new1', name: 'Wren' }, { id: 'new2', name: 'Ilse' }],
      edges: [...g.edges, ['new1', 'c0'], ['new2', 'new1'], ['c3', 'c7']]
    }
    const after = layoutGraph(more, before)
    for (const [id, p] of before) expect(after.get(id)).toEqual(p)
    // The newcomer sits near the character it is linked to.
    expect(dist(after, 'new1', 'c0')).toBeLessThan(dist(after, 'new1', 'c19') + 400)
  })

  it('never puts two characters on top of each other', () => {
    const p = layoutGraph(graph(60, 90))
    const list = [...p.values()]
    let closest = Infinity
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) closest = Math.min(closest, Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y))
    expect(closest).toBeGreaterThanOrEqual(MIN_GAP - 2)
  })

  it('draws linked characters closer together than the rest', () => {
    const g = graph(40, 50)
    const p = layoutGraph(g)
    const linked = g.edges.map(([a, b]) => dist(p, a, b))
    const ids = g.nodes.map((n) => n.id)
    const all: number[] = []
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) all.push(dist(p, ids[i], ids[j]))
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
    expect(mean(linked)).toBeLessThan(mean(all) * 0.7)
  })

  it('places a lone pair and an empty map', () => {
    expect(layoutGraph({ nodes: [], edges: [] }).size).toBe(0)
    const p = layoutGraph({
      nodes: [
        { id: 'a', name: 'Mara' },
        { id: 'b', name: 'Tobin' }
      ],
      edges: [['a', 'b']]
    })
    expect(dist(p, 'a', 'b')).toBeGreaterThanOrEqual(MIN_GAP - 2)
    expect(dist(p, 'a', 'b')).toBeLessThan(400)
  })

  it('fits newcomers into a crowded cast without putting them on top of anyone', () => {
    const g = graph(330, 700)
    const before = layoutGraph(g)
    const more: LayoutGraph = {
      nodes: [...g.nodes, ...Array.from({ length: 10 }, (_, i) => ({ id: `new${i}`, name: `Newcomer ${i}` }))],
      edges: [...g.edges, ...Array.from({ length: 10 }, (_, i) => [`new${i}`, `c${i % 5}`] as [string, string])]
    }
    const t = performance.now()
    const after = layoutGraph(more, before)
    const ms = performance.now() - t
    console.log(`ten newcomers fitted into 330 characters: ${ms.toFixed(1)} ms`)
    expect(ms).toBeLessThan(40)
    for (const [id, p] of before) expect(after.get(id)).toEqual(p)
    for (let i = 0; i < 10; i++) {
      const id = `new${i}`
      for (const other of after.keys()) if (other !== id) expect(dist(after, id, other)).toBeGreaterThanOrEqual(MIN_GAP - 2)
    }
  })

  it('lays out a few hundred characters quickly', () => {
    const g = graph(400, 1200)
    const t = performance.now()
    layoutGraph(g)
    const ms = performance.now() - t
    console.log(`layout of 400 characters and 1,200 relationships: ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(1500)
  })
})
