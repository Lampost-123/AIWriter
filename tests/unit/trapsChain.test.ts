// Probes v4 of the trap harness (tests/traps/chain.ts): the drift checks a chain runs at every step, with invented
// lines, the slips and the lines that only look like slips (said aloud, a mention, a negation), and the bookkeeping
// of which plants are in force. No model.
import { describe, expect, it } from 'vitest'
import {
  CHAINS,
  CHAIN_FAR,
  CHAIN_PLANTS,
  DEFAULT_CHAINS,
  K2_PLANTS,
  changeAt,
  confirmSlips,
  confirmedEnds,
  endedBy,
  endedIn,
  excusedByChange,
  inForce,
  landed,
  landedByJudge,
  landingChecks,
  savedEnded,
  stepChecks,
  stepOfChange,
  wordsSince,
  type ChainPlant
} from '../traps/chain'
import type { App } from '../traps/app'
import { findAcross, patternVerdict, refersTo } from '../traps/patterns'
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

describe('round 7: plants that landed but were not found', () => {
  const spec = CHAINS[0]
  it('Ash named once, then "he": the going out spread over neighbouring paragraphs', () => {
    const a = [
      'Ash drank off what was in his cup and set it down and got up.',
      '‘I’ll see to the horses,’ he said. ‘Cinder’s had a long day of it.’',
      'Wren said nothing.',
      '‘I’ve been in a yard before.’ He pulled his collar up and went out, and the rain came in on the flags.'
    ].join('\n\n')
    expect(landed(spec, ['ash-out'], a)).toMatchObject({ ok: true, missing: [] })
    const b = [
      '‘The day after,’ Ash said. He put his bowl on the bench and stood. ‘I’ll see to the horses before I sit down again or I won’t get up.’',
      'He pulled his boots on, one and then the other, stamping each heel down.',
      '‘I know,’ he said, and went out.'
    ].join('\n\n')
    expect(landed(spec, ['ash-out'], b)).toMatchObject({ ok: true, missing: [] })
    // More than three paragraphs apart is not one event.
    expect(landed(spec, ['ash-out'], ['Ash looked at the fire.', 'Rain.', 'More rain.', 'The horses went out.'].join('\n\n')).ok).toBe(false)
    // "He" is Ash only while Ash was the last man named in the narration; a name said aloud doesn't count.
    const who = plant('ash-out').who!
    expect(refersTo(['Ash got up.', '‘Cinder wants rubbing,’ he said.', 'Cinder stamped in the yard. He was hungry.', 'She waited.'], who)).toEqual([true, true, false, false])
  })
  it('places a spread event where it is first complete', () => {
    const t = ['Ash got up.', '‘The horses,’ he said, and went out.', 'Wren waited.', 'Ash came back from the horses, out of the wet.'].join('\n\n')
    expect(findAcross(paragraphsOfText(t), plant('ash-out').find)).toMatchObject({ paragraph: 0, last: 1 })
    expect(endedIn(t, [], [plant('ash-out')])).toEqual(['ash-out'])
  })
  it('the door locked in the wordings the patterns missed', () => {
    for (const line of [
      'The key was in the lock. She turned it, and the wards grated, and she took the key out and put it in her coat pocket.',
      'Then she lifted the latch and set the door properly into its frame, and found the key on the inside and turned it, and the lock went over with a sound like something being put down.',
      'The bar was a good oak one, worn bright along the top where hands had been. She dropped it into the brackets and set it home with the heel of her hand.',
      'The bar was a length of oak worn pale in the middle; she lifted it into its keep and dropped it, and it went home with a knock.',
      'It went stiff and then gave, and the bolt came home with a small hard knock.',
      'Then she took the key from the inside of the lock, where Mother Rook had left it, and put it in her breeches pocket.'
    ])
      expect(landed(spec, ['door-locked'], line).ok, line).toBe(true)
    expect(landed(spec, ['door-locked'], 'She looked at the door and thought about the key.').ok).toBe(false)
  })
  it('the bar dropped and then the key turned is one locking, not a lock and an unlock', () => {
    const t = [
      'The bar was a length of oak worn pale in the middle; she lifted it into its keep and dropped it, and it went home with a knock.',
      'The key was in the lock. She turned it, and the wards grated, and she took the key out and put it in her coat pocket.',
      'Then she went back to the settle and sat down beside the case.'
    ].join('\n\n')
    expect(endedIn(t, [], [plant('door-locked')])).toEqual([])
    // An unlocking after the locking, past other paragraphs, still ends it.
    expect(endedIn(`${t}\n\nAt the knock she took the key from her pocket and turned the key back, and let him in.`, [], [plant('door-locked')])).toEqual(['door-locked'])
  })
  it('asks the judge once for what the patterns missed, and takes a yes only with words in the passage', () => {
    const text = 'Ash shrugged into his coat. ‘Cinder wants rubbing down,’ he said, and left them to it.'
    const land = landed(spec, ['ash-out', 'door-locked'], text)
    expect(land.missing).toEqual(['ash-out', 'door-locked'])
    const checks = landingChecks(spec, land.missing)
    expect(checks.map((c) => [c.id, c.trap, c.bad])).toEqual([
      ['L1', 'ash-out', 'no'],
      ['L2', 'door-locked', 'no']
    ])
    expect(checks[0].ask).toMatch(/^Does Ash go out/)
    const yes = landedByJudge(land, checks, [{ id: 'L1', answer: 'yes', quote: 'he said, and left them to it' }, { id: 'L2', answer: 'no', quote: '' }], text)
    expect(yes).toMatchObject({ ok: false, missing: ['door-locked'], planted: [{ id: 'ash-out', quote: 'he said, and left them to it', by: 'judge' }] })
    const madeUp = landedByJudge(land, checks, [{ id: 'L1', answer: 'yes', quote: 'he went out to the stable' }, { id: 'L2', answer: 'yes', quote: 'she locked the door' }], text)
    expect(madeUp).toMatchObject({ ok: false, missing: ['ash-out', 'door-locked'], planted: [] })
    expect(landedByJudge(land, checks, null, text).ok).toBe(false)
  })
})

describe('round 7 (b): Wren getting up is the change, not a slip', () => {
  const brokenAt = (quote: string): CheckResult => ({ id: 'lie-down', trap: 'lie-down', ask: plant('lie-down').judge!.ask, verdict: 'broken', by: 'judge', answer: 'yes', quote })
  const judged = (text: string, quote: string): string => excusedByChange([plant('lie-down')], [brokenAt(quote)], text)[0].verdict
  const chain4 = [
    '‘It’s me,’ he said through the door. ‘Unless you’ve a fancy to keep me in the yard.’',
    'She got up and turned the key and drew the bolts, and he came in with his hat dripping and his shoulders dark with wet, and stood on the flags and shook himself like a dog, carefully, so that the water went on the stones and not on her.'
  ].join('\n\n')
  const chain5 = [
    "She woke to the lamp guttering and Ash's voice low at the door, talking to someone on the far side of it. She lay still and listened. A man's voice, not Mother Rook's, asking whether the young one with the case had come in yet.",
    'Ash shot the bolt again, quietly, and came back and sat. He did not say anything, and after a moment she sat up, and they looked at each other across the red core of the fire.'
  ].join('\n\n')
  it('the judge quoting the getting up itself is kept', () => {
    expect(judged(chain4, 'She got up and turned the key and drew the bolts')).toBe('kept')
    expect(judged(chain5, 'she sat up, and they looked at each other across the red core of the fire')).toBe('kept')
    expect(endedBy(chain4, [plant('lie-down')])).toEqual(['lie-down'])
    expect(endedBy(chain5, [plant('lie-down')])).toEqual(['lie-down'])
  })
  it('getting up in other words, and "she" followed across paragraphs', () => {
    for (const t of [
      'Wren swung her feet to the floor and crossed to the window.',
      'She was up before she had her eyes open, the case off the floor and against her chest.',
      'Wren lay and listened to the rain.\n\nThe fire settled.\n\nThen she got to her feet.',
      'She pushed herself up on the settle and put her feet to the flags.',
      'Wren threw off the blanket and went to the door.'
    ])
      expect(changeAt(t, plant('lie-down')), t).toBeGreaterThanOrEqual(0)
  })
  it('someone else getting up, or a getting up said aloud or after the slip, is not hers', () => {
    expect(endedBy('Ash got up and went to the door.', [plant('lie-down')])).toEqual([])
    expect(endedBy('Wren lay still.\n\nMother Rook came in with a candle. She got up from the table and set it down.', [plant('lie-down')])).toEqual([])
    expect(endedBy('‘Get up,’ Ash said. ‘She sat up all night at the last inn.’', [plant('lie-down')])).toEqual([])
    expect(judged('Wren stood at the window and looked out at the rain.', 'Wren stood at the window')).toBe('broken')
    expect(judged('Wren stood at the window and looked out at the rain. Later she sat up.', 'Wren stood at the window')).toBe('broken')
  })
  it('the judge question says a shown get-up is not a slip', () => {
    expect(plant('lie-down').judge!.ask).toMatch(/getting up, sitting up, rising/)
    expect(plant('lie-down').judge!.ask).toMatch(/never quote it/)
  })
})

const paragraphsOfText = (t: string): string[] => t.split(/\n\s*\n/)

// Chain K2 (lab branch): the open road in fog, on foot, a twisted ankle, a thing handed over, and who knows what.
describe('chain K2: outdoors, on the move, who knows what', () => {
  const k2 = CHAINS.find((c) => c.id === 'K2')!
  const p2 = (id: string): ChainPlant => [...K2_PLANTS, ...CHAIN_FAR].find((p) => p.id === id)!
  const drift2 = (id: string, text: string): string => {
    const p = p2(id)
    return patternVerdict({ ...p.drift!, id: p.id, trap: p.id }, text).verdict
  }
  const wire2 = (id: string, text: string): boolean => {
    const p = p2(id)
    // As the scoring tries a tripwire (score.ts judgeCheck): what is said aloud counts too.
    return !!firstBreak({ broken: p.judge!.tripwire!, unlessBefore: p.change }, text)
  }
  it('is a chain like K1: 10 to 12 steps, Add below and Continue in turn, every plant aimed early, and K1 runs by default', () => {
    expect(k2.steps.length).toBeGreaterThanOrEqual(10)
    expect(k2.steps.length).toBeLessThanOrEqual(12)
    k2.steps.forEach((s, i) => expect(s.kind).toBe(i % 2 ? 'continue' : 'addBelow'))
    expect(new Set(k2.steps.flatMap((s) => s.plants ?? []))).toEqual(new Set(K2_PLANTS.map((p) => p.id)))
    for (const s of k2.steps) if (s.plants) expect(landed(k2, s.plants, s.direction!).ok, s.direction).toBe(true)
    expect(K2_PLANTS.map((p) => p.id).filter((id) => CHAIN_PLANTS.some((p) => p.id === id))).toEqual([])
    expect(DEFAULT_CHAINS).toEqual(['K1'])
  })
  it('slips: far views in the fog, riding while on foot, the wrong ankle, Ash with the claim again', () => {
    expect(drift2('fog', 'Far below them the sea glittered in the morning light.')).toBe('broken')
    expect(drift2('fog', 'She could see for miles along the cliffs.')).toBe('broken')
    expect(drift2('on-foot', 'They rode on in silence towards the ford.')).toBe('broken')
    expect(drift2('ankle', 'Her right ankle throbbed with every step.')).toBe('broken')
    expect(drift2('ankle', 'She favoured her twisted right foot.')).toBe('broken')
    expect(drift2('claim-handed', 'Ash patted the claim in his coat pocket and smiled.')).toBe('broken')
    expect(wire2('limp', 'Wren ran to the edge of the track.')).toBe(true)
    expect(wire2('limp', 'She ran a few limping steps after the horse.')).toBe(false)
    // One check a plant: a drift or a judge question, never both (saved answers re-score by plant).
    for (const p of K2_PLANTS) expect(!!p.drift && !!p.judge, p.id).toBe(false)
    expect(stepChecks([p2('limp'), p2('ash-stays')]).checks.map((c) => c.trap)).toEqual(['limp', 'ash-stays'])
    expect(wire2('ash-stays', 'Hale nodded. "So you are not going back, then," the carter said, as if he had always known.')).toBe(true)
    expect(wire2('ash-stays', 'Hale knew that Ash would not go home; it was in his face.')).toBe(true)
    expect(wire2('ash-stays', '"I am not going back that way," Ash told the carter, and asked about the ford.')).toBe(false)
  })
  it('not slips: a change shown first, what is said aloud, a wish, a negation, the right side', () => {
    expect(drift2('fog', 'The fog lifted at last, and far below them the sea glittered.')).not.toBe('broken')
    expect(drift2('fog', '"On a clear day you could see for miles," Hale said.')).not.toBe('broken')
    expect(drift2('fog', 'She could not see the sea, only hear it somewhere below.')).not.toBe('broken')
    expect(drift2('on-foot', 'Ash swung himself back into the saddle. They rode on towards the ford.')).not.toBe('broken')
    expect(drift2('on-foot', 'Hale lifted her up onto the cart, and she rode the last mile sitting on a sack.')).not.toBe('broken')
    expect(drift2('on-foot', 'They had ridden this road before, in better weather.')).not.toBe('broken')
    expect(drift2('ankle', 'Her left ankle throbbed with every step.')).not.toBe('broken')
    expect(drift2('claim-handed', 'The claim was a stiff square against her ribs, inside her jacket.')).not.toBe('broken')
    expect(drift2('claim-handed', 'Ash had carried the claim from Carrow, but no longer.')).not.toBe('broken')
    expect(wire2('ash-stays', 'Hale asked where they were bound. Ash said Linmouth, maybe, and looked away.')).toBe(false)
  })
  it('ends the fog and being on foot on a change in the narration, not on one said aloud', () => {
    const before = [p2('fog'), p2('on-foot')]
    expect(endedBy('By noon the fog had thinned to a pale haze.', before)).toEqual(['fog'])
    expect(endedBy('"The fog lifted by noon yesterday," Hale said.', before)).toEqual([])
    expect(endedBy('Ash climbed back into the saddle.', before)).toEqual(['on-foot'])
  })
  it('a foot put in the stirrup is getting back on (round G K2-2/12); a foot put anywhere else is not', () => {
    expect(drift2('on-foot', 'Ash put his foot in the stirrup. A little later they rode on towards the ford.')).not.toBe('broken')
    expect(drift2('on-foot', 'Wren put her foot into the stirrup, and then they rode on.')).not.toBe('broken')
    expect(endedBy('Ash put his foot in the stirrup.', [p2('on-foot')])).toEqual(['on-foot'])
    expect(drift2('on-foot', 'Ash put his foot in the stream. A little later they rode on towards the ford.')).toBe('broken')
    expect(drift2('on-foot', 'Wren put her foot on the stirrup leather to buckle it. Then they rode on.')).toBe('broken')
    expect(endedBy('Ash put his foot in the mud.', [p2('on-foot')])).toEqual([])
  })
})

describe('combo run (2026-10-08): end-of-plant and drift gaps, each with what must still be a slip', () => {
  it('the case picked up in other words ends case-down; looking at it, or saying so, does not', () => {
    const c = plant('case-down')
    expect(endedBy('The case came up off it into her arms and she held it to her side.', [c])).toEqual(['case-down'])
    expect(endedBy('The survey case came away from the sill with a scrape.', [c])).toEqual(['case-down'])
    expect(endedBy('She gathered the case up and stood with it.', [c])).toEqual(['case-down'])
    expect(endedBy('Her fingers closed round the survey case on the windowsill.', [c])).toEqual(['case-down'])
    expect(endedBy('She carried the case to the table.', [c])).toEqual(['case-down'])
    // Not a pickup: she looks at it, it stays put, or someone only says it.
    expect(endedBy('She looked at the survey case on the sill and thought of the map inside.', [c])).toEqual([])
    expect(endedBy('The case sat on the windowsill, its straps undone.', [c])).toEqual([])
    expect(endedBy('"I’ll take the case up with me," she said.', [c])).toEqual([])
    // The slip itself, with no pickup first, is still caught.
    expect(wire('case-down', 'The case sat on the sill. Later she held the survey case in her lap.')).toBe(true)
  })
  it('Ash back in these wordings ends ash-out; the door opening as he goes out does not', () => {
    const a = plant('ash-out')
    const back = 'She woke to the bar lifting. The bar grated, and then the door swinging back and the rain coming in, and a boot on the flagstone, and Ash shaking his hat out with the door open behind him.'
    expect(endedBy(back, [a])).toEqual(['ash-out'])
    expect(endedBy('A boot on the step, and Ash in the doorway with the rain behind him.', [a])).toEqual(['ash-out'])
    expect(endedBy('‘It’s me.’ He shut the door and dropped the bar back with his shoulder.', [a])).toEqual(['ash-out'])
    expect(endedBy('Ash stood by the hearth, shaking the rain off his hat.', [a])).toEqual(['ash-out'])
    // Going out is not coming back: neither in the step that plants it nor later.
    const goes = "'I'll see to the horses,' Ash said.\n\nThe door swung open and Ash went out into the rain, and he shut the door behind him."
    expect(endedIn(goes, [], [a])).toEqual([])
    expect(endedBy('The door swung open in the wind and banged against the wall.', [a])).toEqual([])
    // A door opening with no sign of him, then Ash in the room: still the slip.
    expect(drift('ash-out', 'The door swung open in the wind. Ash poured the tea.')).toBe('broken')
  })
  it('the re-score review: more ways back in, and the ways out that must not count', () => {
    const a = plant('ash-out')
    expect(endedBy('Not the bar: she heard the bar lift, the iron drag of it, and Ash in the gap with the lamp.', [a])).toEqual(['ash-out'])
    expect(endedBy('Then the bar lifted under her hand, and he was in the doorway with the rain coming off him.', [a])).toEqual(['ash-out'])
    expect(endedBy('Ash stood on the step with his hat down and his jumper dark across the shoulders.', [a])).toEqual(['ash-out'])
    expect(endedBy('He set the lamp on the table and shut the door and dropped the bar back into the iron himself.', [a])).toEqual(['ash-out'])
    // Not back: she bars it after he went out; he stands in the doorway on his way out; the bar lifts for someone else.
    expect(endedBy('He went out and she shut the door and dropped the bar into its keep.', [a])).toEqual([])
    expect(endedBy('Ash stood in the doorway a moment, then went out into the rain.', [a])).toEqual([])
    expect(endedBy('The bar lifted and Mother Rook came in with the candles.', [a])).toEqual([])
    // And the slip after a false start is still the slip.
    expect(drift('ash-out', 'She lifted the bar and looked out at the empty yard. Ash sat down by the fire.')).toBe('broken')
  })
  it('the re-score review: the case picked up as "it", Wren up in other words, a coming in still to come', () => {
    const c = plant('case-down')
    const w = plant('lie-down')
    expect(endedBy('The case was on the windowsill behind her, and she turned and took it by the strap and put it under her arm.', [c])).toEqual(['case-down'])
    expect(endedBy('The case was on the sill where she had left it, its brass corners square to the frame, and she took it up under her arm.', [c])).toEqual(['case-down'])
    // "it" that is something else, near the case: not a pickup.
    expect(endedBy('The case was on the sill and she took the cup and drank from it.', [c])).toEqual([])
    expect(endedBy('She sat all the way up and put the blanket aside.', [w])).toEqual(['lie-down'])
    expect(endedBy('She got her feet under her and crossed to the table.', [w])).toEqual(['lie-down'])
    expect(endedBy('Wren was off the settle before she had decided to move.', [w])).toEqual(['lie-down'])
    // Someone else's getting up is not hers; a blanket off the settle is not her.
    expect(endedBy('Ash got his feet under him and stood.', [w])).toEqual([])
    expect(endedBy('The blanket was off the settle and on the floor.', [w])).toEqual([])
    // The tripwire still fires when she stands with no getting up.
    expect(wire('lie-down', 'The blanket was off the settle. She stood at the window.')).toBe(true)
    expect(drift('door-locked', 'She left his share on the board for him to see to when he came in.')).not.toBe('broken')
    expect(drift('door-locked', 'When Ash came in he was wet to the elbows.')).toBe('broken')
  })
  it('Ash heard through the shut door is not Ash in the room; through his teeth, or muffled by a cup, still is', () => {
    expect(drift('ash-out', "'It's me,' Ash said, muffled through the boards.")).not.toBe('broken')
    expect(drift('ash-out', "'Open up,' Ash called through the door.")).not.toBe('broken')
    expect(drift('ash-out', "'Bed,' Ash said through the wood.")).not.toBe('broken')
    expect(drift('ash-out', "'Fine,' Ash said through his teeth.")).toBe('broken')
    expect(drift('ash-out', "'Fine,' Ash said, muffled by his cup.")).toBe('broken')
    expect(drift('ash-out', 'Ash said he was cold, standing in the doorway.')).toBe('broken')
  })
  it('"the cut hand" after the left hand is the other hand, unless the left is said to be the cut one', () => {
    expect(drift('hand-cut', 'She pulled it wide with her left hand, the cut hand held behind her.')).not.toBe('broken')
    expect(drift('hand-cut', 'She took the cup in her left hand and kept the bandaged hand in her lap.')).not.toBe('broken')
    // The left said to be cut: slips, as before.
    expect(drift('hand-cut', 'Her left hand, the cut one, throbbed.')).toBe('broken')
    expect(drift('hand-cut', 'Her left hand, the cut hand, throbbed.')).toBe('broken')
    expect(drift('hand-cut', 'She held up her left hand, bleeding hard.')).toBe('broken')
    expect(drift('hand-cut', 'Her left palm stung where the shard had gone in.')).toBe('broken')
    expect(drift('hand-cut', 'She wrapped her bleeding left hand in a napkin.')).toBe('broken')
  })
  it('boots off: her boot catching the hearth, water between her boots, are slips; boots by the hearth are not', () => {
    expect(drift('boots-off', "Wren's boot caught the edge of the hearth and she caught herself on the table.")).toBe('broken')
    expect(drift('boots-off', 'Her boot struck the leg of the table.')).toBe('broken')
    expect(drift('boots-off', 'The blood ran down and dripped on the flags between her boots.')).toBe('broken')
    // Not slips.
    expect(drift('boots-off', 'Her boots caught the firelight where they stood.')).not.toBe('broken')
    expect(drift('boots-off', 'She set the cup down between her boots on the hearth.')).not.toBe('broken')
    expect(drift('boots-off', 'The case stood on its edge between her boots, the strap scorched.')).not.toBe('broken')
    expect(drift('boots-off', "Ash's boot caught the leg of the settle.")).not.toBe('broken')
    expect(drift('boots-off', 'She pulled her boots back on. Her boot caught the edge of the hearth.')).not.toBe('broken')
  })
  it('the re-score reuses a live "Ended?" yes only with its words in the passage, before the slip', () => {
    const text = 'He put his hand on the key and the iron turned, and the door came open. "Cold," Ash said.'
    const was: CheckResult = { id: 'ash-out', trap: 'ash-out', ask: 'Ended? Ash speaks or acts in the room without coming back first.', verdict: 'kept', by: 'judge', answer: 'yes', quote: 'He put his hand on the key and the iron turned' }
    expect(savedEnded(was, text, '"Cold," Ash said.')).toBe(was.quote)
    // Words that aren't in this passage, a change after the slip, or a judge's no: not reused.
    expect(savedEnded({ ...was, quote: 'He drew back the bolt' }, text, '"Cold," Ash said.')).toBeNull()
    expect(savedEnded({ ...was, quote: '"Cold," Ash said.' }, 'Ash said nothing. "Cold," Ash said.', 'Ash said nothing.')).toBeNull()
    expect(savedEnded({ ...was, answer: 'no', verdict: 'broken' }, text, '"Cold," Ash said.')).toBeNull()
    expect(savedEnded(undefined, text, '"Cold," Ash said.')).toBeNull()
  })
})

describe('round E (20261008-100105): checker gaps, each with what must still be a slip', () => {
  // An invented chain stretch: Tam goes out at step 3, is let back in at step 4 in words no pattern knows, and talks at
  // step 6. (The checks are K1's, with K1's people: "Ash" is the one who went out.)
  const step3 = "'I'll see to the horses,' Ash said, and he went out to the stable.\n\nWren sat on by the fire."
  const step4 = 'The latch went and the cold came in, and boots crossed the flags to the hearth.'
  const step5 = 'The kettle began to tick on the hob.'
  const step6 = 'Ash said the grey was favouring her off fore.'
  const steps = [
    { step: 3, text: step3 },
    { step: 4, text: step4 },
    { step: 5, text: step5 }
  ]
  const slip = (): CheckResult => ({ id: 'ash-out', trap: 'ash-out', ask: 'Ash speaks or acts in the room without coming back first.', verdict: 'broken', by: 'pattern', answer: '', quote: step6 })
  const judge = (answer: 'yes' | 'no', quote: string, seen: string[] = []): Pick<App, 'askJudge'> => ({
    askJudge: async (_probe, text) => {
      seen.push(text)
      return { status: 'ok', raw: '', answers: [{ id: 'E1', answer, quote }] }
    }
  })
  const look = { steps, landedAt: new Map([['ash-out', 3]]), planted: new Map([['ash-out', "'I'll see to the horses,' Ash said, and he went out to the stable."]]), step: 6 }

  it('confirmSlips asks over the scene since the plant, and ends the plant at the step its words are in', async () => {
    const seen: string[] = []
    const got = await confirmSlips(judge('yes', 'The latch went and the cold came in', seen), [plant('ash-out')], [slip()], step6, look)
    expect(seen[0]).toBe([step3, step4, step5, step6].join('\n\n'))
    expect(got.results[0]).toMatchObject({ verdict: 'kept', by: 'judge', quote: 'The latch went and the cold came in' })
    expect(got.endedAt.get('ash-out')).toBe(4)
    expect(confirmedEnds(got.results, got.endedAt, 6)).toEqual({ here: [], earlier: new Map([[4, ['ash-out']]]) })
    // With no look back (as before): only the words being checked.
    const alone: string[] = []
    await confirmSlips(judge('no', '', alone), [plant('ash-out')], [slip()], step6)
    expect(alone[0]).toBe(step6)
  })

  it('confirmSlips: a no, words in no step, the planting itself, or words after the slip leave the slip counted', async () => {
    const still = async (answer: 'yes' | 'no', quote: string) => (await confirmSlips(judge(answer, quote), [plant('ash-out')], [slip()], step6, look)).results[0].verdict
    expect(await still('no', 'The latch went and the cold came in')).toBe('broken')
    expect(await still('yes', 'He drew back the bolt and let him in')).toBe('broken')
    expect(await still('yes', 'he went out to the stable')).toBe('broken')
    const after = 'Ash said the grey was favouring her off fore. Then the latch lifted and he came in.'
    expect((await confirmSlips(judge('yes', 'Then the latch lifted and he came in'), [plant('ash-out')], [slip()], after, look)).results[0].verdict).toBe('broken')
    // The step a change is in, and the plant's own step after the planting.
    const since = wordsSince(steps, 3, step6, 6)
    expect(stepOfChange(since, 'Wren sat on by the fire', { plantStep: 3, plantQuote: look.planted.get('ash-out'), now: 6, slipQuote: step6 })).toBe(3)
    expect(stepOfChange(since, 'The kettle began to tick', { plantStep: 3, now: 6, slipQuote: step6 })).toBe(5)
    // The re-score reuses a saved yes from an earlier step the same way.
    const was: CheckResult = { ...slip(), verdict: 'kept', by: 'judge', answer: 'yes', ask: 'Ended? x', quote: 'The latch went and the cold came in' }
    expect(savedEnded(was, step6, step6, { steps, plantStep: 3, now: 6 })).toBe(was.quote)
    expect(savedEnded(was, step6, step6)).toBeNull()
  })

  it('Ash back: "then there was Ash", the bar lifted and he came in, "When Ash came back", "before Ash was through"', () => {
    const a = plant('ash-out')
    expect(endedBy('The door to the yard opened and shut and then there was Ash, coatless, hair flat with rain.', [a])).toEqual(['ash-out'])
    expect(endedBy('She lifted the bar and he came in sideways with a bucket in each hand.', [a])).toEqual(['ash-out'])
    expect(endedBy('When Ash came back his hair was flat and dripping.', [a])).toEqual(['ash-out'])
    expect(endedBy('Wren sat up.\n\nWhen he came back the fire had caught.', [a])).toEqual(['ash-out'])
    expect(endedBy('When the door opened she had the map folded away before Ash was through.', [a])).toEqual(['ash-out'])
    // Not back: going out with the bar lifted, a coming back still to come, someone else's things, still busy outside.
    expect(endedBy('He lifted the bar and went out, and the rain came in at the door.', [a])).toEqual([])
    expect(endedBy('She would keep the stew hot for when he came back.', [a])).toEqual([])
    expect(endedBy('Then there was Ash’s coat on the peg, dripping.', [a])).toEqual([])
    expect(endedBy('It would be an hour before Ash was through with the horses.', [a])).toEqual([])
    // The slip with none of these before it still counts.
    expect(drift('ash-out', 'The bar stayed where it was. Ash said the grey was lame.')).toBe('broken')
  })

  it('door locked: "the door to the yard opened" and "When Ash came back" are the door opening; a past perfect elsewhere is not', () => {
    expect(drift('door-locked', 'The door to the yard opened and shut.')).toBe('broken')
    expect(drift('door-locked', 'The yard door opened with a groan.')).toBe('broken')
    expect(drift('door-locked', 'When Ash came back his collar was dark at the neck.')).toBe('broken')
    expect(drift('door-locked', 'When the outer door opened again, the cold came down the passage ahead of him.')).toBe('broken')
    // A memory of another door, long ago, or the inn's front door opening for a caller: not this one.
    expect(drift('door-locked', 'In Linmouth she had opened the door on a good grey coat and no mud on it.')).not.toBe('broken')
    expect(drift('door-locked', 'Out in the passage the landlady’s step crossed the boards, and the front door opened on a man’s voice.')).not.toBe('broken')
    // Unlocked first, or a coming back still to come: not a slip, as before.
    expect(drift('door-locked', 'She turned the key back. When Ash came back his collar was dark.')).not.toBe('broken')
    expect(drift('door-locked', 'She left his share for him to see to when he came back.')).not.toBe('broken')
    // The plain slip still counts.
    expect(drift('door-locked', 'The door opened and Ash came in out of the rain.')).toBe('broken')
  })

  it('boots off: stockings in her boots are not her feet; walking in her boots still is', () => {
    expect(drift('boots-off', 'Her stockings were in her boots and her boots were soaked.')).not.toBe('broken')
    expect(drift('boots-off', 'Her socks were balled up in her boots by the fender.')).not.toBe('broken')
    expect(drift('boots-off', 'She crossed to the window in her boots.')).toBe('broken')
    expect(drift('boots-off', 'She walked to the door in her boots and her heavy stockings.')).toBe('broken')
  })

  it('on foot: "rode" needs a rider ("it rode against her side" is the packet); a rider riding still counts', () => {
    const onFoot = K2_PLANTS.find((p) => p.id === 'on-foot')!
    const v = (text: string) => patternVerdict({ ...onFoot.drift!, id: onFoot.id, trap: onFoot.id }, text).verdict
    expect(v('The packet was under her shirt. It rode against her side and did not shift.')).not.toBe('broken')
    expect(v('The strap rode up on her shoulder.')).not.toBe('broken')
    expect(v('Ash rode ahead into the grey.')).toBe('broken')
    expect(v('They rode on in silence.')).toBe('broken')
    expect(v('Hale clicked his tongue and rode beside them.')).toBe('broken')
  })

  it('case down: the judge is told remembering the ride in does not count; the tripwire still asks', () => {
    expect(plant('case-down').judge!.ask).toContain('remembering how she had it earlier (on the ride in, before she put it down)')
    expect(wire('case-down', 'She held the survey case in her lap.')).toBe(true)
  })
})
