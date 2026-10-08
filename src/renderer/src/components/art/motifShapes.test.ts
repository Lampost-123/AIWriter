import { describe, expect, it } from 'vitest'
import { MOTIF_IDS } from '@shared/motifs'
import { MOTIF_SHAPES } from './motifShapes'

describe('the drawings', () => {
  it('draw every motif in the library, and nothing else', () => {
    expect(Object.keys(MOTIF_SHAPES).sort()).toEqual([...MOTIF_IDS].sort())
  })

  it('use only plain SVG shapes, in their 48 by 48 box, with no colours of their own', () => {
    const tags = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g'])
    const walk = (shapes: (typeof MOTIF_SHAPES)[string]): void => {
      for (const [tag, attrs, kids] of shapes) {
        expect(tags.has(tag), tag).toBe(true)
        expect(attrs.fill, 'no fill colour').toBeUndefined()
        expect(attrs.stroke, 'no stroke colour').toBeUndefined()
        if (attrs.class) expect(['soft', 'solid', 'fine']).toContain(attrs.class)
        if (kids) walk(kids)
      }
    }
    for (const id of MOTIF_IDS) walk(MOTIF_SHAPES[id])
  })
})
