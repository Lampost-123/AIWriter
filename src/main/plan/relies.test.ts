// What the plan rests on (its "relies"), checked against what the planner read and the scene so far: from a stand-in run
// (2026-10-19, trap story chain K1) where the planner listed nine facts and the writer's notes kept five. The boots on
// their sides at the hearth, the stockinged feet and the damp jumper, the door locked with the key drawn out, and the
// rain were all set up earlier in the same scene, in words spread over a paragraph, in other forms ("drew" for "drawn")
// or two facts in one value; each was dropped. Invented values and secrets are still left out. Invented test story.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState } from '@shared/types'
import type { SceneState } from '@shared/continuity'
import { checkPlan, latestSaysOtherwise, saysIn, type CheckWith, type RawPlan } from './plan'

let seq = 0
const entry = (kind: EntryKind, name: string, aliases: string[] = []): EntryState => ({
  id: `r${++seq}`,
  kind,
  name,
  aliases,
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields: {},
  parentId: null,
  hardRule: false,
  origin: 'adam',
  fieldOrigins: {},
  originStoryId: null,
  originSceneId: null,
  originStart: false,
  byHand: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  happened: [],
  changed: []
})

// The scene so far as the writer got it (some talk left out), and the end of the scene before.
const SO_FAR = [
  'The inn stood on its own where the coast road dropped towards the sea: a long low house with one lamp in the window and a yard full of puddles. The landlady, a broad woman called Mother Rook, looked at the state of them and put them in the back parlour, where the fire was.',
  'Wren stood dripping on the flagstones while Ash dragged the settle nearer the hearth. Her oilskin coat was soaked through, her boots squelched when she moved, and the survey case was under her arm, where it had been all day.',
  'She set the case down on the end of the settle, where she could put her hand on it, and sat beside it. The boots came hard. The leather had drunk the rain all afternoon and gripped her calves like something that did not mean to let go, and she had to hook the heel of one against the toe of the other and work it, and then do the second with her good hand alone, because the left arm would not take the pull. Water ran out of them onto the flags. She stood them on their sides at the edge of the hearth, the toes turned to the fire, and her stockinged feet left dark prints on the stone.',
  'The oilskin was worse. The buttons had swollen in their holes and she stood picking at them one-handed while Ash watched and, to his credit, did not offer. When the last one gave she shrugged the coat off her shoulders and caught it before it hit the floor, and the weight of it surprised her, as if she had been carrying half the road home on her back. There was a peg behind the door. She crossed the room and hung the coat there by its collar, and it swung once and settled, and began at once to drip, a slow patter onto the boards beneath it.',
  'Her jumper was damp at the cuffs and the shoulders, and the linen on her arm had gone grey with wet at the edges. She turned back to the fire. Steam was already rising off the boots in two thin threads, and behind her the coat went on dripping on its peg.',
  'She went back to the settle and sat with the case against her hip. Ash had his long legs out to the fire and his hat on his knee, turning it by the brim to let the water run off it onto the hearthstone.',
  'He looked at the fire a while. A log shifted and sent up a short rush of sparks, and out in the yard the rain came harder against the shutter.',
  "'I'm never long. I'm only slow.' He grinned at her from the doorway, and the coat on its peg swung out with the door and knocked against the wall, and then he was gone into the dark passage and the rain, and she heard his boots go across the yard and the stable latch lift.",
  'She got up. The flags were cold through her stockings and she went across them quickly and stood with her back to the door a moment, listening. Nothing but the rain, and the fire behind her, and a drip from the coat hem onto the boards. There was a key in the lock, an old black one with a ring for a bow. She turned it. It went over stiffly, the bolt shooting home with a sound she felt in her good hand, and she drew it out and put it in the pocket of her breeches, where it lay against the four pence, cold and heavy.',
  'She went back to the settle and drew the case onto her knees. The buckles were wet and she left them done up. Through the shutter she could hear Ash in the stable, the low running sound of his voice and now and then a horse stamping, and once a laugh, as if the mare had said something he liked.',
  'The fire settled. She put another stick on it with her good hand and watched the bark catch and curl. The steam had gone off the boots and they were darkening at the toes where the heat reached them, and she moved them back an inch with her foot.',
  'Across the yard the stable latch dropped. His boots came back through the puddles, unhurried, and then the handle of the door turned and stopped against the lock, and there was a knock, two knuckles, soft.',
  "'It's me,' Ash said. 'Or it's a man who sounds very like me.'",
  'She put her hand in her pocket for the key.'
].join('\n\n')
const PREVIOUS = [
  'They went on. Cinder had a long tireless walk on him and wanted to be at the front of it, and Wren kept him on a loose rein and let him take the road. Her arm ached under the grease and the fresh linen, the ache going up from the wrist to the elbow and settling there like a hand held over it.',
  'They rode on north, and the fog lifted off the fell behind them and lay along the top of it in a white band, and the sun came up over the flat land, thin and low and cold, and neither of them said anything else for a mile or more.'
].join('\n\n')

const CARD = [
  'Scene: The inn on the coast road',
  'When: Day 23, night, rain',
  'Point of view: Wren Hollis',
  'Also in the scene: Ash Penrose',
  'Where: The Drove Road',
  '',
  'Beats, in order:',
  '1. Wren and Ash stop for the night at a drovers’ inn on the coast road.',
  '2. They talk about what comes next.'
].join('\n')
const DIRECTION = 'Wren puts the survey case down on the windowsill, then lies down on the settle by the fire.'
// What the planner read (request 00010, trimmed): the card, where things stand (only the time), and the last few hundred
// words of the scene so far.
const MATERIAL = [
  `## The scene card\n${CARD}`,
  '## Where things stand at the end of the scene so far\nTime: evening',
  `## The end of the scene so far\n"""\n${SO_FAR.split('\n\n').slice(9).join('\n\n')}\n"""`,
  `## What is being written\nThe next stretch of the scene: what the author directs:\n${DIRECTION}`
].join('\n\n')

// The planner's "relies", word for word (reply 00010).
const RELIES: RawPlan['relies'] = [
  { who: 'Wren Hollis', what: 'holding', value: 'the key in the pocket of her breeches, against the four pence' },
  { who: '', what: 'thing', value: 'the door: locked, the key drawn out' },
  { who: 'Ash Penrose', what: 'where', value: 'at the door, the handle turned and stopped against the lock' },
  { who: 'Wren Hollis', what: 'holding', value: 'drew the case onto her knees; the buckles were wet and she left them done up' },
  { who: 'Wren Hollis', what: 'wearing', value: 'boots off, on their sides at the edge of the hearth' },
  { who: 'Wren Hollis', what: 'wearing', value: 'oilskin coat off, hung by its collar on the peg behind the door' },
  { who: 'Wren Hollis', what: 'wearing', value: 'stockinged feet; jumper damp at the cuffs and the shoulders' },
  { who: 'Wren Hollis', what: 'condition', value: 'the linen on her arm had gone grey with wet at the edges' },
  { who: '', what: 'weather', value: 'rain' }
]

const STAND: SceneState = { time: 'evening', weather: '', light: '', characters: [] }
const SECRET = { fact: 'The survey shows silver under the old workings', knownBy: ['Wren Hollis'], keptFrom: ['Ash Penrose'] }

function check(over: Partial<CheckWith> = {}): CheckWith {
  const wren = entry('character', 'Wren Hollis', ['Wren'])
  const ash = entry('character', 'Ash Penrose', ['Ash'])
  return {
    stand: STAND,
    reach: 'here',
    material: MATERIAL,
    card: CARD,
    calls: `${CARD}\n\nThe author's direction for this stretch:\n${DIRECTION}`,
    people: ['Wren Hollis', 'Ash Penrose'],
    secrets: [SECRET],
    entries: [wren, ash],
    inBriefing: new Set([wren.id, ash.id]),
    hidden: new Set(),
    soFar: SO_FAR,
    previous: PREVIOUS,
    ...over
  }
}

const raw = (relies: RawPlan['relies']): RawPlan => ({ relies, changes: [], needs: [] })

describe('what the plan rests on, from the scene so far (stand-in run, 2026-10-19)', () => {
  it('keeps every fact the scene so far set up, though the planner read only its last words', () => {
    const p = checkPlan(raw(RELIES), check())
    expect(p.keep).toEqual([
      'Wren Hollis is holding: the key in the pocket of her breeches, against the four pence',
      'The door: locked, the key drawn out',
      'Where Ash Penrose is: at the door, the handle turned and stopped against the lock',
      'Wren Hollis is holding: drew the case onto her knees; the buckles were wet and she left them done up',
      'Wren Hollis is wearing: boots off, on their sides at the edge of the hearth',
      'Wren Hollis is wearing: oilskin coat off, hung by its collar on the peg behind the door',
      'Wren Hollis is wearing: stockinged feet; jumper damp at the cuffs and the shoulders',
      'Wren Hollis: the linen on her arm had gone grey with wet at the edges',
      'Weather: rain'
    ])
    expect(p.checked.dropped).toBe(0)
  })

  it('still leaves out what is invented, a secret kept from someone here, and what the latest words undo', () => {
    const invented: RawPlan['relies'] = [
      { who: 'Wren Hollis', what: 'holding', value: 'a lit candle in a brass stick' },
      { who: '', what: 'thing', value: 'the window: open, the shutter thrown back' },
      { who: 'Wren Hollis', what: 'wearing', value: 'boots on, laced to the knee' },
      { who: '', what: 'fact', value: 'the survey shows silver under the old workings' },
      // Half of it true, half invented: left out.
      { who: 'Wren Hollis', what: 'wearing', value: 'stockinged feet; a red shawl over the shoulders' },
      { who: '', what: 'weather', value: 'snow' }
    ]
    const p = checkPlan(raw(invented), check())
    expect(p.keep).toEqual([])
    expect(p.checked.dropped).toBe(invented.length)
    // The door unlocked again later in the scene: "locked" no longer holds.
    const later = `${SO_FAR}\n\nShe turned the key back and the door swung open, and Ash came in out of the rain.`
    expect(checkPlan(raw([RELIES[1]]), check({ soFar: later })).keep).toEqual([])
  })

  it('finds a value over a few sentences of one paragraph, in other forms of its words, never across a contradiction', () => {
    const para = 'She got up and stood with her back to the door. There was a key in the lock. She turned it. She drew it out and put it away.'
    expect(saysIn('the door: locked, the key drawn out', '', para)).toBe(true)
    // Not across paragraphs: the door in one, the key in another.
    expect(saysIn('the door: locked, the key drawn out', '', 'She stood by the door.\n\nThere was a key in the lock. She turned it. She drew it out.')).toBe(false)
    expect(saysIn('lying on the settle', 'Wren', 'Wren lay down on the settle by the fire.')).toBe(true)
    expect(saysIn('boots on, by the hearth', 'Wren', 'She pulled her boots off. She stood them by the hearth to dry.')).toBe(false)
    // One word that matters: for the weather, that word is enough; for a person, it needs their name or how it is.
    expect(saysIn('rain', '', 'Out in the yard the rain came harder.', new Set(), { alone: true })).toBe(true)
    expect(saysIn('rain', '', 'Out in the yard the rain came harder.')).toBe(false)
    expect(latestSaysOtherwise('stockinged feet', SO_FAR)).toBe(false)
  })
})
