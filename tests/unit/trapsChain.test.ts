// Probes v4 of the trap harness (tests/traps/chain.ts): the drift checks a chain runs at every step, with invented
// lines, the slips and the lines that only look like slips (said aloud, a mention, a negation), and the bookkeeping
// of which plants are in force. No model.
import { describe, expect, it } from 'vitest'
import { CHAINS, CHAIN_FAR, CHAIN_PLANTS, endedBy, endedIn, inForce, landed, stepChecks, type ChainPlant } from '../traps/chain'
import { patternVerdict } from '../traps/patterns'
import { firstBreak } from '../traps/patterns'
import { summariseChains, type ChainResult, type CheckResult } from '../traps/score'

const plant = (id: string): ChainPlant => [...CHAIN_PLANTS, ...CHAIN_FAR].find((p) => p.id === id)!
const drift = (id: string, text: string): string => {
  const p = plant(id)
  return patternVerdict({ ...p.drift!, id: p.id, trap: p.id }, text).verdict
}
const wire = (id: string, text: string): boolean => {
  const p = plant(id)
  return !!firstBreak({ broken: p.judge!.tripwire!, unlessBefore: p.change, outsideQuotes: true }, text)
}

describe('chain drift checks: slips', () => {
  it('boots and coat back on with no words', () => {
    expect(drift('boots-off', 'Her boots rang on the flagstones as she crossed to the window.')).toBe('broken')
    expect(drift('boots-off', 'She stood there in her boots, listening.')).toBe('broken')
    expect(drift('coat-off', 'She pulled her oilskin tighter around her shoulders.')).toBe('broken')
  })
  it('the gone person speaking or acting in the room', () => {
    expect(drift('ash-out', '"Lock it after me," Ash said, and laughed.')).toBe('broken')
    expect(drift('ash-out', 'Ash leaned back against the wall and watched her.')).toBe('broken')
  })
  it('the locked door opening without being unlocked', () => {
    expect(drift('door-locked', 'The door opened and Mother Rook came in with a tray.')).toBe('broken')
    expect(drift('door-locked', 'Mother Rook bustled in with the candles.')).toBe('broken')
  })
  it('the wrong hand, the compass in use, the burn on the other side', () => {
    expect(drift('hand-cut', 'Blood welled from the cut on her left palm.')).toBe('broken')
    expect(drift('hand-cut', 'She wrapped her bleeding left hand in a napkin.')).toBe('broken')
    expect(drift('compass', 'She took out her compass and held it to the lamp.')).toBe('broken')
    expect(drift('burn', 'The burn on her right forearm throbbed in the heat.')).toBe('broken')
  })
  it('the case in her arms, and Wren standing, when last on the sill and lying down', () => {
    expect(wire('case-down', 'She held the survey case in her lap and turned it over.')).toBe(true)
    expect(wire('case-down', 'She clutched the case to her.')).toBe(true)
    expect(wire('lie-down', 'Wren stood by the window, listening to the rain.')).toBe(true)
  })
})

describe('chain drift checks: not slips', () => {
  it('said aloud is not the narration', () => {
    expect(drift('ash-out', '"Ash said he would be an hour," Wren told the landlady.')).not.toBe('broken')
    expect(drift('door-locked', '"Did the door open?" she asked.')).not.toBe('broken')
    expect(drift('compass', '"I gave my compass away," she said. "I took out the compass every morning, once."')).not.toBe('broken')
    expect(drift('boots-off', '"In her boots she\'d have frozen," Mother Rook said.')).not.toBe('broken')
  })
  it('a mention, a memory, a wish or a negation is not a slip', () => {
    expect(drift('boots-off', 'Her boots steamed by the fire.')).not.toBe('broken')
    expect(drift('coat-off', 'Her coat dripped on its peg behind the door.')).not.toBe('broken')
    expect(drift('ash-out', 'Ash would be at the stable a while yet.')).not.toBe('broken')
    expect(drift('door-locked', 'Nobody came in; the door was locked.')).not.toBe('broken')
    expect(drift('door-locked', 'Someone tried the door and it rattled in its frame.')).not.toBe('broken')
    expect(drift('compass', 'She wished she still had her grandmother’s compass.')).not.toBe('broken')
    expect(drift('hand-cut', 'She held the cloth to her right hand, where the cut still bled.')).not.toBe('broken')
    expect(drift('burn', 'The old burn on her left arm itched.')).not.toBe('broken')
    expect(wire('case-down', 'The survey case sat on the windowsill where she had left it.')).toBe(false)
    expect(wire('lie-down', 'Lying on the settle, she watched the fire.')).toBe(false)
  })
  it('a change shown on the page excuses what follows it', () => {
    expect(drift('boots-off', 'She pulled on her boots. Her boots rang on the flagstones.')).not.toBe('broken')
    expect(drift('door-locked', 'She turned the key in the lock. The door opened on the dark yard.')).not.toBe('broken')
    expect(drift('ash-out', 'Ash came back in, shaking the rain off. "They\'re fed," Ash said.')).not.toBe('broken')
    expect(wire('lie-down', 'She got up and went to the window. Wren stood by the window, listening.')).toBe(false)
    expect(wire('case-down', 'She took the case from the sill. She held the survey case in her lap.')).toBe(false)
  })
})

describe('chain bookkeeping', () => {
  const spec = CHAINS[0]
  it('checks a plant only after its step, until a change ends it, and the far facts always', () => {
    const at = new Map([
      ['boots-off', 1],
      ['ash-out', 3]
    ])
    expect(inForce(spec, at, new Set(), 1).map((p) => p.id)).toEqual(['compass', 'burn'])
    expect(inForce(spec, at, new Set(), 2).map((p) => p.id)).toEqual(['boots-off', 'compass', 'burn'])
    expect(inForce(spec, at, new Set(['boots-off']), 4).map((p) => p.id)).toEqual(['ash-out', 'compass', 'burn'])
  })
  it('asks the judge only what a pattern can’t decide, with its tripwire', () => {
    const sc = stepChecks([plant('lie-down'), plant('boots-off'), plant('case-down')])
    expect(sc.checks.map((c) => c.id)).toEqual(['Q1', 'Q2'])
    expect([...sc.judgeIds.values()]).toEqual(['lie-down', 'case-down'])
    expect(sc.patterns.map((p) => p.id)).toEqual(['boots-off'])
    expect(sc.tripwires).toHaveLength(2)
    expect(sc.facts).toHaveLength(3)
  })
  it('ends a plant on a change in the narration, not on one said aloud', () => {
    expect(endedBy('She sat up and swung her legs off the settle.', [plant('lie-down')])).toEqual(['lie-down'])
    expect(endedBy('"Get up," Ash said.', [plant('lie-down')])).toEqual([])
    expect(endedBy('She unlocked the door.', [plant('door-locked'), plant('boots-off')])).toEqual(['door-locked'])
  })
  it('finds where a step planted its events, a paragraph at a time', () => {
    const text = 'She sat on the bench.\n\nShe pulled off her wet boots and set them by the hearth.\n\nShe hung her oilskin on the peg behind the door.'
    expect(landed(spec, ['boots-off', 'coat-off'], text)).toMatchObject({ ok: true, missing: [] })
    expect(landed(spec, ['ash-out'], text)).toMatchObject({ ok: false, missing: ['ash-out'] })
  })
  it('the chain is long, aims every plant early, and never says a truth again', () => {
    expect(spec.steps.length).toBeGreaterThanOrEqual(8)
    expect(spec.steps.length).toBeLessThanOrEqual(12)
    const planted = spec.steps.flatMap((s) => s.plants ?? [])
    expect(new Set(planted)).toEqual(new Set(CHAIN_PLANTS.map((p) => p.id)))
    // Each step's own words would be found where they plant (as the fake run relies on).
    for (const s of spec.steps) if (s.plants) expect(landed(spec, s.plants, s.direction!).ok, s.direction).toBe(true)
  })
})

describe('chain summary', () => {
  const r = (trap: string, verdict: CheckResult['verdict']): CheckResult => ({ id: trap, trap, ask: '', verdict, by: 'pattern', answer: '', quote: '' })
  const step = (n: number, results: CheckResult[], resolved: string[] = []) => ({
    step: n,
    kind: 'continue' as const,
    direction: '',
    status: 'complete' as const,
    error: null,
    tries: 1,
    generationId: null,
    words: 100,
    text: '',
    planted: [],
    results,
    judge: { status: 'skipped' as const, raw: '' },
    resolved
  })
  it('counts by plant and by step, and when each chain first slipped', () => {
    const chain: ChainResult = {
      id: 'K1',
      scene: 'k1',
      title: 'T',
      opening: [],
      plants: [],
      steps: 3,
      samples: [
        { index: 0, status: 'complete', why: null, firstSlip: 2, steps: [step(1, [r('boots-off', 'kept')]), step(2, [r('boots-off', 'broken')]), step(3, [r('boots-off', 'kept')], ['boots-off'])] },
        { index: 1, status: 'complete', why: null, firstSlip: null, steps: [step(1, [r('boots-off', 'kept')]), step(2, [r('boots-off', 'silent')]), step(3, [])] }
      ]
    }
    const s = summariseChains([chain])
    expect(s.total).toMatchObject({ kept: 3, broken: 1, silent: 1, steps: 6, samples: 2 })
    expect(s.byPlant['boots-off']).toMatchObject({ kept: 3, broken: 1, resolved: 1 })
    expect(s.byStep['2']).toMatchObject({ broken: 1, silent: 1 })
    expect(s.firstSlip).toEqual([
      { step: 1, slipped: 0, of: 2 },
      { step: 2, slipped: 1, of: 2 },
      { step: 3, slipped: 1, of: 2 }
    ])
  })
})

describe('round 6 false positives', () => {
  const steps = 'She heard Ash cross the cobbles, then his step at the door, then the bar lifting, and she shut her eyes and kept them shut while he came in and stood a moment over the settle.'
  it('Ash coming back, and the door unbarred, in that wording, end their plants', () => {
    expect(endedBy(steps, [plant('ash-out'), plant('door-locked')])).toEqual(['ash-out', 'door-locked'])
    // The unbarring comes before "he came in" in the same sentence: the door check is excused.
    expect(drift('door-locked', steps)).not.toBe('broken')
    expect(endedBy('Someone let him in from the yard.', [plant('ash-out')])).toEqual(['ash-out'])
    expect(endedBy('There was a knock, and Mother Rook drew back the bolt.', [plant('door-locked')])).toEqual(['door-locked'])
  })
  it('words Ash said before, told in the narration, are not Ash speaking now', () => {
    expect(drift('ash-out', '‘Ah,’ she said, which was what Ash said, and she stood with her hand open and the blood coming up out of it in a line and running down to her wrist.')).not.toBe('broken')
    expect(drift('ash-out', 'Ash had said the same at the ford.')).not.toBe('broken')
    // Still a slip when Ash speaks in the room.
    expect(drift('ash-out', '‘It’s your right hand,’ Ash said.')).toBe('broken')
  })
  it('a coat pocket is not the coat on her; wearing needs a wearing cue', () => {
    expect(drift('coat-off', 'It was a small key with a ring on it and she put it in her coat pocket, in the pocket on the inside, and stood with her hand in there a moment, feeling the cold of it against her fingers.')).not.toBe('broken')
    expect(drift('coat-off', 'She shivered in her coat by the window.')).toBe('broken')
    expect(drift('coat-off', 'She pulled her coat tighter around her.')).toBe('broken')
    expect(endedBy('She took her coat from the peg and put it on.', [plant('coat-off')])).toEqual(['coat-off'])
  })
})

describe('plants ended in the step that planted them', () => {
  it('ends a plant by a change after its own paragraph, never by the planting itself', () => {
    const goneAndBack = "Ash went out to the stable to see to the horses.\n\nA while later Ash came back in, shaking off the rain."
    expect(endedIn(goneAndBack, [], [plant('ash-out')])).toEqual(['ash-out'])
    // Locking with the key isn't unlocking: the planting paragraph itself is never read as the change.
    expect(endedIn('She locked the door and turned the key, and put it in her pocket.', [], [plant('door-locked')])).toEqual([])
  })
})

describe('round 6: Ash at the door and let in', () => {
  it('his voice through the door, the key turned back, him coming through', () => {
    const t = "The knock came, three raps, unhurried, and then Ash's voice through the door, mild. She got up and crossed the flags in her stockings and took the key from her coat pocket and turned it back, and the door came in on a slant of rain before he did. He came through sideways, hat first."
    expect(endedBy(t, [plant('ash-out'), plant('door-locked')])).toEqual(['ash-out', 'door-locked'])
    expect(drift('door-locked', t)).not.toBe('broken')
  })
})
