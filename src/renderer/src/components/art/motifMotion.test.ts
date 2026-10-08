import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOTIF_IDS } from '@shared/motifs'
import { MOTIF_MOTION, MOVE_PARTS, motifMotion, type MotifMove } from './motifMotion'
import { MOTIF_SHAPES, type MotifShape } from './motifShapes'

const css = readFileSync(join(__dirname, 'motifMotion.css'), 'utf8')

/** The parts a drawing marks as moving (data-part). */
function parts(shapes: MotifShape[], out = new Set<string>()): Set<string> {
  for (const [, attrs, kids] of shapes) {
    if (attrs['data-part']) out.add(attrs['data-part'])
    if (kids) parts(kids, out)
  }
  return out
}

describe('the drawings coming alive', () => {
  it('give every drawing in the library a movement on hover, and most of them an idle one too', () => {
    for (const id of MOTIF_IDS) expect(motifMotion(id).hover.length, id).toBeGreaterThan(0)
    const idle = MOTIF_IDS.filter((id) => motifMotion(id).idle.length > 0)
    expect(idle.length).toBeGreaterThanOrEqual(MOTIF_IDS.length / 2)
    expect(Object.keys(MOTIF_MOTION).sort()).toEqual([...MOTIF_IDS].sort())
  })

  it('only move parts the drawing has, and say where a glint shows', () => {
    for (const id of MOTIF_IDS) {
      const m = motifMotion(id)
      const has = parts(MOTIF_SHAPES[id])
      for (const move of [...m.idle, ...m.hover]) {
        const needs = MOVE_PARTS[move]
        // A part-move needs at least one of its parts in the drawing (the beam needs its light; its lamp is a bonus).
        if (needs) expect(needs.some((p) => has.has(p)), `${id}: ${move}`).toBe(true)
        if (move === 'glint') expect(m.glint, `${id}: where its glint shows`).toBeDefined()
      }
      // Every part it marks belongs to a move it makes.
      const moved = new Set([...m.idle, ...m.hover].flatMap((move) => MOVE_PARTS[move] ?? []))
      for (const p of has) expect(moved.has(p), `${id}: part ${p} moves`).toBe(true)
    }
  })

  it('never use two whole-drawing movements at once (one would cancel the other)', () => {
    const whole: MotifMove[] = ['bob', 'sway', 'swing', 'float', 'tilt', 'turn', 'spin', 'lift', 'blink']
    for (const id of MOTIF_IDS) {
      const m = motifMotion(id)
      expect(m.idle.filter((x) => whole.includes(x)).length, `${id} idle`).toBeLessThanOrEqual(1)
      expect(m.hover.filter((x) => whole.includes(x)).length, `${id} hover`).toBeLessThanOrEqual(1)
    }
  })

  it('have each movement drawn in the stylesheet, idle and hovered', () => {
    const moves = new Set(MOTIF_IDS.flatMap((id) => [...motifMotion(id).idle, ...motifMotion(id).hover]))
    for (const move of moves) {
      expect(css, `${move} idle`).toContain(`[data-live][data-idle~='${move}']`)
      expect(css, `${move} hover`).toContain(`[data-art-hover]:hover [data-hover~='${move}']`)
    }
  })

  it('move only by transform, opacity or the dashes of a line', () => {
    const frames = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) ?? []
    expect(frames.length).toBeGreaterThan(10)
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
      for (const p of props) expect(['transform', 'opacity', 'stroke-dashoffset', 'stroke-dasharray'], f.slice(0, 40)).toContain(p)
    }
  })
})
