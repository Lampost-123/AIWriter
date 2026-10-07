import { describe, expect, it } from 'vitest'
import { voicesFrom } from './voices'

describe('the voice list', () => {
  it('marks the studio voices, and Adam’s own voices brought over from MCreader as his', () => {
    const list = voicesFrom(
      [
        { id: 'narrator', name: 'Narrator', engine: 'breeze', gender: '', traits: 'designed · warm', recommended: true },
        { id: 'clip:library/p001.wav', name: 'Clara · Woman, 18-25 · mid voice (studio)', engine: 'breeze', traits: 'studio recording · 18-25 · mid pitch', studio: true },
        { id: 'clip:library/c001.wav', name: 'Mom · Woman, 34 · mid voice (your voice)', engine: 'breeze', traits: 'your voice · 34 · mid pitch', studio: true, own: true },
        { id: 'clip:mcreader/0c1abb18.wav', name: 'From MCreader · A low voice', engine: 'breeze', traits: 'your voice · A low voice', own: true }
      ],
      'breeze'
    )
    expect(list.map((v) => [v.name, v.clip, !!v.studio])).toEqual([
      ['Narrator', false, false],
      ['Clara · Woman, 18-25 · mid voice', false, true],
      ['Mom · Woman, 34 · mid voice', true, false],
      ['From MCreader · A low voice', true, false]
    ])
    expect(list[1].about).toBe('Studio recording · 18-25 · mid pitch')
  })
})
