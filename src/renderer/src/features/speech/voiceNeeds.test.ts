import { describe, expect, it } from 'vitest'
import { VOICES_NEEDS, voicesChecks } from './voiceNeeds'

const GB = 1024 ** 3
const card = (name: string | null, memoryMb: number | null = null, computeCap: number | null = null) => ({
  nvidia: name,
  nvidiaMemoryMb: memoryMb,
  nvidiaComputeCap: computeCap
})

describe('what the voices need', () => {
  it('says it plainly: the card, its memory, the processor, and the disk space', () => {
    expect(VOICES_NEEDS).toBe(
      'They need an NVIDIA graphics card (RTX 20 series or newer) with at least 10 GB of memory. Without one they run on the ' +
        'processor, far too slowly for reading aloud. They take about 12 GB of disk space, and need about 15 GB free while they download.'
    )
  })

  it('says nothing about this computer until something is known', () => {
    expect(voicesChecks({ nvidia: null })).toEqual([])
    expect(voicesChecks({ ...card(null), freeSpace: null })).toEqual([])
  })

  it('says when this computer has what they need', () => {
    expect(voicesChecks({ ...card('NVIDIA GeForce RTX 5070 Ti', 16303, 12), freeSpace: 412.4 * GB })).toEqual([
      { ok: true, text: 'NVIDIA GeForce RTX 5070 Ti with 16 GB of memory' },
      { ok: true, text: '412 GB free on the disk' }
    ])
    // A 10 GB card reports a little under 10240 MiB.
    expect(voicesChecks(card('NVIDIA GeForce RTX 3080', 10236, 8.6))).toEqual([{ ok: true, text: 'NVIDIA GeForce RTX 3080 with 10 GB of memory' }])
    // An older driver that can't say how new the card is, or how much memory it has: the name alone.
    expect(voicesChecks(card('NVIDIA GeForce RTX 2080'))).toEqual([{ ok: true, text: 'NVIDIA GeForce RTX 2080' }])
  })

  it('says when there is no NVIDIA card', () => {
    expect(voicesChecks(card(''))).toEqual([
      { ok: false, text: 'No NVIDIA graphics card was found on this computer, so the voices would be far too slow here.' }
    ])
  })

  it('says when the card is too old or too small', () => {
    expect(voicesChecks(card('NVIDIA GeForce GTX 1080', 8192, 6.1))).toEqual([
      { ok: false, text: 'This computer’s NVIDIA GeForce GTX 1080 is too old for the voices: they need an RTX card, the 20 series or newer.' }
    ])
    expect(voicesChecks(card('NVIDIA GeForce RTX 3060 Laptop GPU', 6144, 8.6))).toEqual([
      {
        ok: false,
        text: 'This computer’s NVIDIA GeForce RTX 3060 Laptop GPU has 6 GB of memory, and the voices need about 10 GB, so they won’t fit on it.'
      }
    ])
    // An 8 GB card is too small now the voices are known to hold about 9.5 GB.
    expect(voicesChecks(card('NVIDIA GeForce RTX 3070', 8188, 8.6))[0]).toMatchObject({ ok: false })
    // The GTX 16 series is as new as the RTX 20s.
    expect(voicesChecks(card('NVIDIA GeForce GTX 1660 Ti', 6144, 7.5))[0].text).toContain('has 6 GB of memory')
  })

  it('says when the disk is too full, rounding down so it never reads as more than is there', () => {
    expect(voicesChecks({ nvidia: null, freeSpace: 14.9 * GB })).toEqual([
      { ok: false, text: 'Only 14 GB is free on the disk the voices go on, and they need about 15 GB. Free up some space first.' }
    ])
    expect(voicesChecks({ nvidia: null, freeSpace: 0.4 * GB })[0].text).toBe(
      'Less than 1 GB is free on the disk the voices go on, and they need about 15 GB. Free up some space first.'
    )
    expect(voicesChecks({ nvidia: null, freeSpace: 15 * GB })).toEqual([{ ok: true, text: '15 GB free on the disk' }])
  })
})
