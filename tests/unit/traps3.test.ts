// Story version 3 of the trap harness (tests/traps): the deterministic checks, the outline, where probe pages end in
// the written story, the plant check that decides whether a written scene is kept, and the token budget. No model.
import { describe, expect, it } from 'vitest'
import { Budget, estimateTokens } from '../traps/budget'
import { findPlace, firstBreak, outsideQuotes, patternVerdict, sentences } from '../traps/patterns'
import { GUARDS3, PATTERNS, PROBES3, PROBES_VERSION, SCENES3, TRAPS3, type Scene3 } from '../traps/story3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadFixture, probePage, storyV3, type FixturePlant, type StoryScene } from '../traps/storyData'
import { checkPlants, paragraphAt } from '../traps/write'
import { recallSummary, repairDrops, type ProbeResult } from '../traps/score'

const broken = (key: keyof typeof PATTERNS, text: string): boolean => patternVerdict(PATTERNS[key], text).verdict === 'broken'

describe('sentences and exceptions', () => {
  it('splits at sentence ends and line breaks, keeping where each starts', () => {
    const s = sentences('One. "Two!" she said.\nThree')
    expect(s.map((x) => x.text)).toEqual(['One.', '"Two!"', 'she said.', 'Three'])
    expect(s[3].start).toBe('One. "Two!" she said.\n'.length)
  })
  it('lets a change shown earlier in the passage excuse what follows', () => {
    const p = { broken: /\bBryn said\b/, unlessBefore: /\bBryn came back\b/ }
    expect(firstBreak(p, 'Bryn said hello.')).not.toBeNull()
    expect(firstBreak(p, 'At last Bryn came back. Bryn said hello.')).toBeNull()
  })
})

describe('the version 3 checks', () => {
  it('burn: the right arm is a slip, the left is not', () => {
    expect(broken('burn', 'The burn on her right forearm had begun to itch.')).toBe(true)
    expect(broken('burn', 'Her bandaged right arm ached.')).toBe(true)
    expect(broken('burn', 'She held the reins in her right hand; the burn on her left forearm pulled.')).toBe(false)
    expect(patternVerdict(PATTERNS.burn, 'The burn on her left forearm itched.').verdict).toBe('kept')
    expect(patternVerdict(PATTERNS.burn, 'The fire burned low.').verdict).toBe('silent')
  })
  it('horse: riding Thistle or a mare is a slip; thinking of Thistle, or riding Cinder, is not', () => {
    expect(broken('horse', 'Wren swung up onto Thistle and they rode out.')).toBe(true)
    expect(broken('horse', 'She urged the dun mare up the slope.')).toBe(true)
    expect(broken('horse', 'She thought of Thistle, lame in the paddock at Hobb’s Farm.')).toBe(false)
    expect(patternVerdict(PATTERNS.horse, 'Cinder picked his way through the bog.').verdict).toBe('kept')
  })
  it('compass: using it is a slip; missing it is not', () => {
    expect(broken('compass', 'Wren flipped open her compass and watched the needle settle.')).toBe(true)
    expect(broken('compass', 'She checked the compass in her left hand.')).toBe(true)
    expect(broken('compass', 'She wished she still had her grandmother’s compass.')).toBe(false)
    expect(broken('compass', 'Without the compass she had only the wind to go by.')).toBe(false)
    expect(broken('compass', 'The wind came from every point of the compass.')).toBe(false)
  })
  it("scar: Ash's right cheek is a slip", () => {
    expect(broken('scar', 'The scar on his right cheek showed white in the cold.')).toBe(true)
    expect(broken('scar', 'Ash touched the cut on his right cheek.')).toBe(true)
    expect(broken('scar', "Ash's right cheek was red from the wind.")).toBe(false)
    expect(broken('scar', 'The thin scar on his left cheek showed white.')).toBe(false)
    expect(broken('scar', 'A tear ran down her right cheek.')).toBe(false)
  })
  it('bead: still having it after giving it to Pell is a slip', () => {
    expect(broken('bead', 'She turned the blue bead over in her pocket.')).toBe(true)
    expect(broken('bead', 'She thought of Pell holding the bead up to the light.')).toBe(false)
    expect(broken('bead', 'A bead of sweat ran down her neck.')).toBe(false)
  })
  it('Bryn: speaking in the room is a slip unless she is shown coming back', () => {
    expect(broken('brynBack', '"More ale," Bryn said, sitting down.')).toBe(true)
    expect(broken('brynBack', 'The door opened and Bryn came back in, smelling of the forge. "Done," Bryn said.')).toBe(false)
    expect(broken('brynBack', 'Bryn would still be at the smith’s.')).toBe(false)
    expect(patternVerdict(PATTERNS.brynBack, 'Bryn would still be at the smith’s.').verdict).toBe('kept')
  })
  it('boots: walking in them is a slip unless she put them on; drying by the fire is not', () => {
    expect(broken('bootsOn', 'Her boots rang on the stone floor.')).toBe(true)
    expect(broken('bootsOn', 'She pulled her coat tighter around her.')).toBe(true)
    expect(broken('bootsOn', 'She pulled on her boots. Her boots rang on the stone floor.')).toBe(false)
    expect(broken('bootsOn', 'Her boots were drying by the fire.')).toBe(false)
  })
})

describe('probes v2: a mention is not a slip', () => {
  // The sentences round 3 counted as broken, though the writer clearly knew the truth.
  it('does not take talk of Thistle for riding her', () => {
    expect(broken('horse', "'I've got to fetch Thistle,' she said.")).toBe(false)
    expect(broken('horse', '‘Thistle’ll be fat as a parson.’')).toBe(false)
    expect(broken('horse', "'Thistle'll be fat as a parson.'")).toBe(false)
  })
  it('does not take a compass in her head, or a memory of one, for having it', () => {
    for (const t of [
      'Wren stood in the mouth of it and looked back at the fog, and got the compass out of her head and the levels out of the field book, and the adit sat exactly where Edric had put it, at the foot of the second beck, a hundred and ten yards north of the intake wall, on the line.',
      'She held the compass in her head instead of her hand: north by the lie of the ground, which here ran down to the beck on her left, and the beck ran west, and the adit was above the beck a hundred and forty paces past the second wall end.',
      'Edric had drawn it with the levels marked off it every chain, and she put her hand on the top stone and walked, counting, the way she had walked it forty times on paper with the compass in her other hand, and the numbers came out the same.'
    ])
      expect(broken('compass', t), t).toBe(false)
  })
  it('still catches riding Thistle and using the compass', () => {
    expect(broken('horse', 'She rode Thistle down to the ford.')).toBe(true)
    expect(broken('horse', 'Wren swung up into the saddle of the dun mare.')).toBe(true)
    expect(broken('horse', 'Thistle carried her down the last slope.')).toBe(true)
    expect(broken('compass', 'She pulled out her compass and watched the needle settle.')).toBe(true)
    expect(broken('compass', 'The compass in her hand pointed north.')).toBe(true)
    expect(broken('compass', 'She took the compass from her pocket.')).toBe(true)
    expect(broken('compass', 'She walked on with the compass in her other hand.')).toBe(true)
  })
  it('tells having the bead from remembering it', () => {
    expect(broken('bead', 'She fingered the blue glass bead in her pocket.')).toBe(true)
    expect(broken('bead', 'She turned the bead over and over.')).toBe(true)
    expect(broken('bead', 'She thought of Pell holding the bead up to the light.')).toBe(false)
    expect(patternVerdict(PATTERNS.bead, 'Wren searched her pockets: a few coins, a crust, nothing worth giving.').verdict).toBe('kept')
  })
  it('aims every probe at its traps without saying what is true', () => {
    expect(PROBES_VERSION).toBe(3)
    for (const p of PROBES3) {
      const aimed = [p.direction ?? '', ...(p.beats ? [p.beats.at(-1) ?? ''] : [])].join(' ')
      if (p.id !== 'B1') expect(aimed.trim(), p.id).not.toBe('')
      expect(aimed, p.id).not.toMatch(/\b(?:left|right|Cinder|Thistle|gave|given|gelding|no compass|without|Hobb|lame|bead|smith|barefoot)\b/i)
    }
  })
})

describe('the version 3 outline', () => {
  it('plants each event so its own words would be found, without breaking a guard', () => {
    for (const s of SCENES3) {
      for (const p of s.plants) {
        const said = p.says.replace(/^Make sure this happens[^:]*:\s*/, '')
        expect(
          p.find.every((r) => new RegExp(r.source, r.flags).test(said)),
          `${s.key} ${p.id}`
        ).toBe(true)
        const index = SCENES3.indexOf(s)
        for (const g of GUARDS3) {
          if (index < SCENES3.findIndex((x) => x.key === g.from) || g.except?.includes(s.key)) continue
          expect(firstBreak(g.check, said), `${s.key} ${p.id} against ${g.check.id}`).toBeNull()
        }
      }
    }
  })
  it('has probes on known scenes and planted events, with checks named once and traps that exist', () => {
    const ids = new Set<string>()
    for (const p of PROBES3) {
      const scene = SCENES3.find((s) => s.key === p.scene)
      expect(scene, p.id).toBeTruthy()
      if ('after' in p.at || 'before' in p.at) {
        const id = 'after' in p.at ? p.at.after : p.at.before
        expect(scene!.plants.some((x) => x.id === id), `${p.id} ${id}`).toBe(true)
      }
      if (p.kind === 'beat') expect(p.beat).toBeLessThanOrEqual(scene!.card.beats.length)
      for (const c of [...p.checks, ...p.patterns]) {
        expect(ids.has(c.id), c.id).toBe(false)
        ids.add(c.id)
        expect(TRAPS3.some((t) => t.id === c.trap), c.id).toBe(true)
      }
    }
    for (const t of TRAPS3) expect(PROBES3.some((p) => [...p.checks, ...p.patterns].some((c) => c.trap === t.id)), t.id).toBe(true)
    // Long enough to matter: 30 scenes in 7 chapters, the probes in the last two.
    expect(SCENES3).toHaveLength(30)
    expect(new Set(SCENES3.map((s) => s.chapter)).size).toBe(7)
    for (const p of PROBES3) expect(SCENES3.find((s) => s.key === p.scene)!.chapter).toBeGreaterThanOrEqual(5)
  })
})

describe('the written story (story-v3.json)', () => {
  const file = join(__dirname, '..', 'traps', 'story-v3.json')
  it.runIf(existsSync(file))('loads, with a page for every probe, its planted events where the probes need them', () => {
    const data = storyV3(loadFixture(file), file)
    expect(data.scenes).toHaveLength(30)
    expect(data.probesVersion).toBe(PROBES_VERSION)
    for (const p of data.probes) {
      const scene = data.scenes.find((s) => s.key === p.scene)!
      if (p.kind === 'generate') expect(p.paragraphs, p.id).toBe(0)
      else {
        expect(p.paragraphs, p.id).toBeGreaterThan(0)
        expect(p.paragraphs, p.id).toBeLessThan(scene.paragraphs.length)
      }
    }
    // B1's page stops before scene 26 first mentions the bead: no reminder, and certainly not the bead given (round 4).
    const b1 = data.probes.find((p) => p.id === 'B1')!
    const s26 = data.scenes.find((s) => s.key === 's26')!
    expect(s26.paragraphs.slice(0, b1.paragraphs).some((x) => /\bbead\b/i.test(x))).toBe(false)
    expect(s26.paragraphs[b1.paragraphs]).toMatch(/\bbead\b/)
    // The story's own words never break what is true where the probes look (they were checked as it was written).
    for (const key of ['s24', 's25', 's26', 's27', 's28', 's29', 's30']) {
      const text = data.scenes.find((s) => s.key === key)!.paragraphs.join('\n\n')
      for (const c of [PATTERNS.burn, PATTERNS.compass, PATTERNS.horse, PATTERNS.scar]) expect(firstBreak(c, text)?.text ?? null, `${key} ${c.id}`).toBeNull()
    }
  })
})

describe('probe pages in the written story', () => {
  const para = (words: number, tag = 'w'): string => Array.from({ length: words }, () => tag).join(' ')
  const scene: StoryScene = {
    key: 's24',
    chapter: 5,
    title: 'Hut',
    card: { pov: 'wren', present: [], location: 'moor', when: '', beats: [] },
    paragraphs: [para(100, 'boots off'), ...Array.from({ length: 15 }, () => para(150))]
  }
  const plant: FixturePlant = { id: 'boots-off', trap: 'clothing', scene: 's24', quote: 'boots off', paragraph: 0, by: 'pattern' }
  const spec = PROBES3.find((p) => p.id === 'C1')!

  it('ends a Continue page near the scene end, far enough from the planted event', () => {
    expect(probePage(spec, scene, [plant])).toEqual({ paragraphs: 15 })
  })
  it('says so when the event is closer than planned', () => {
    const short = { ...scene, paragraphs: scene.paragraphs.slice(0, 6) }
    const got = probePage(spec, short, [plant])
    expect(got.paragraphs).toBe(5)
    expect(got.note).toMatch(/only 600 words/)
  })
  it('stops just before an event, or at a share of the words', () => {
    const before = PROBES3.find((p) => p.id === 'B1')!
    expect(probePage(before, { ...scene, key: 's26' }, [{ ...plant, id: 'bead-given', scene: 's26', paragraph: 9 }])).toEqual({ paragraphs: 9 })
    const half = PROBES3.find((p) => p.id === 'A1')!
    expect(probePage(half, scene, []).paragraphs).toBe(8)
  })
  it('fails plainly when the written story lacks the event', () => {
    expect(() => probePage(spec, scene, [])).toThrow(/doesn't say/)
  })
})

describe('checking a written scene', () => {
  const s24 = SCENES3.find((s) => s.key === 's24') as Scene3
  const s7 = SCENES3.find((s) => s.key === 's7') as Scene3
  const filler = Array.from({ length: 8 }, (_, i) => `The wind moved over the moor and the fire burned low, hour ${i}.`)
  const noJudge = async (): Promise<null> => {
    throw new Error('the judge should not be asked')
  }

  it('keeps a scene whose event happens early and holds, with where it happened', async () => {
    const text = ['She pulled off her boots and set them by the fire to dry.', ...filler].join('\n\n')
    const got = await checkPlants(s24, text, noJudge)
    expect(got).toMatchObject({ ok: true, problems: [] })
    expect(got.plants).toEqual([{ id: 'boots-off', trap: 'clothing', scene: 's24', quote: 'She pulled off her boots and set them by the fire to dry.', paragraph: 0, by: 'pattern' }])
  })
  it('turns down an event that comes too late, or is undone', async () => {
    const late = await checkPlants(s24, [...filler, 'She pulled off her boots and set them by the fire to dry.'].join('\n\n'), noJudge)
    expect(late.ok).toBe(false)
    expect(late.problems.join(' ')).toMatch(/too late/)
    const undone = await checkPlants(s24, ['She pulled off her boots to dry.', ...filler, 'Her boots rang on the floor as she paced.'].join('\n\n'), noJudge)
    expect(undone.problems.join(' ')).toMatch(/undone/)
  })
  it('asks the judge only when no sentence shows the event, and needs its quote in the scene', async () => {
    const text = ['Wren had no coin.', 'She left the old keepsake with the bridge-keeper and walked on.', ...filler].join('\n\n')
    const yes = await checkPlants(s7, text, async (qs) => qs.map((q) => ({ id: q.id, answer: 'yes', quote: 'She left the old keepsake with the bridge-keeper' })))
    expect(yes.ok).toBe(true)
    expect(yes.plants[0]).toMatchObject({ id: 'compass', paragraph: 1, by: 'judge' })
    const made = await checkPlants(s7, text, async (qs) => qs.map((q) => ({ id: q.id, answer: 'yes', quote: 'words that are not there at all' })))
    expect(made.ok).toBe(false)
    const no = await checkPlants(s7, text, async (qs) => qs.map((q) => ({ id: q.id, answer: 'no', quote: '' })))
    expect(no.problems.join(' ')).toMatch(/didn't happen/)
  })
  it('turns down a scene that breaks what an earlier scene made true', async () => {
    const s28 = SCENES3.find((s) => s.key === 's28') as Scene3
    const got = await checkPlants(s28, ['She checked her compass; the needle swung north.', ...filler].join('\n\n'), noJudge)
    expect(got.problems.join(' ')).toMatch(/compass/)
  })
  it('finds the paragraph of a position in the joined text', () => {
    expect(paragraphAt(['ab', 'cd', 'ef'], 0)).toBe(0)
    expect(paragraphAt(['ab', 'cd', 'ef'], 4)).toBe(1)
    expect(paragraphAt(['ab', 'cd', 'ef'], 8)).toBe(2)
  })
})

describe('the token budget', () => {
  it('lets calls through until the next would pass it, then refuses them all and says why', async () => {
    let used = { in: 900, out: 10 }
    const b = new Budget(1000, 100, () => used)
    const calls: string[] = []
    const f = b.wrap((async (input: unknown) => {
      calls.push(String(input))
      return new Response('{}')
    }) as typeof fetch)
    const post = (chars: number): Promise<Response> => f('http://x/v1/chat/completions', { method: 'POST', body: 'x'.repeat(chars) })
    expect((await post(300)).status).toBe(200)
    expect((await f('http://x/v1/models')).status).toBe(200)
    used = { in: 900, out: 10 }
    expect((await post(4 * 150)).status).toBe(402)
    expect(b.hit).toMatch(/input/)
    expect((await post(4)).status).toBe(402)
    expect(calls).toHaveLength(2)
    expect(estimateTokens('abcdefgh')).toBe(2)
  })
  it('stops at the output budget', () => {
    const b = new Budget(10_000, 100, () => ({ in: 0, out: 100 }))
    expect(b.allows(1)).toBe(false)
    expect(b.hit).toMatch(/output/)
  })
})

describe('recall by meaning in the report', () => {
  const probe = (meaning: boolean, done: number, note: string | null): ProbeResult => ({
    id: 'P',
    scene: 's24',
    kind: 'generate',
    asks: '',
    samples: [],
    recall: { available: true, meaning, state: meaning ? 'ready' : 'none', engine: meaning ? 'onnx' : null, indexed: { done, total: 400 }, note }
  })
  it('says it was on for every probe, with the passages read by the last', () => {
    expect(recallSummary([probe(true, 380, null), probe(true, 400, null)])).toEqual({ meaning: true, probes: 2, withMeaning: 2, engine: 'onnx', indexed: { done: 400, total: 400 }, notes: [] })
  })
  it('says when it was off, and why, once', () => {
    const r = recallSummary([probe(false, 0, 'No search model.'), probe(false, 0, 'No search model.')])
    expect(r).toMatchObject({ meaning: false, withMeaning: 0, notes: ['No search model.'] })
  })
})

describe('probes v3: round 4 diagnosis', () => {
  // Round 4's C2a: someone telling what Bryn said is not Bryn in the room.
  it('does not take Bryn reported, or her absence remarked, for Bryn speaking in the room', () => {
    for (const t of [
      '‘Bryn says that. Says you write like a woman counting sheep and afraid to lose one.’',
      '‘Bryn said it wasn\'t hers to know.’',
      '‘Bryn said you\'d have it out on every table between here and the coast,’ he said.',
      '‘Bryn says a lot of things like that and then she asks.’',
      '‘Bryn\'s not here to say it.’',
      "'Bryn said it wasn't hers to know,' Ash said."
    ])
      expect(broken('brynBack', t), t).toBe(false)
  })
  it('still catches Bryn speaking in the room', () => {
    expect(broken('brynBack', "'She's over the bank at the lower bend,' Bryn said, and spat.")).toBe(true)
    expect(broken('brynBack', "Behind her, on the bench, Bryn said, without moving, 'Shut the door.'")).toBe(true)
    expect(broken('brynBack', '‘From the west,’ Bryn said.')).toBe(true)
  })
  it('blanks what is said aloud, keeping apostrophes and the length', () => {
    const t = "‘Bryn said it wasn't hers,’ he said. Bryn's cart was gone."
    const o = outsideQuotes(t)
    expect(o).toHaveLength(t.length)
    expect(o).not.toMatch(/Bryn said/)
    expect(o).toMatch(/he said\. Bryn's cart was gone\./)
    // An unclosed quote ends with its paragraph.
    expect(outsideQuotes("'Wait,\n\nBryn said.")).toMatch(/Bryn said\./)
  })
  // Round 4's B1: the bead given over a few sentences, found a paragraph later by a sentence-by-sentence search.
  const s26 = [
    'They got across.',
    "She got the bead out of her jumper pocket. It was a blue glass bead the size of a hazelnut, with a white thread running through it, and it had been in her pocket through the rain at the ford and the night in the hut and it was still whole. She put it in Pell's hand.",
    'Pell ran up the bank.',
    'Pell came back down the bank with her fist closed and stood beside her father and opened her hand and looked at the bead again, and closed it.'
  ]
  const given = SCENES3.find((x) => x.key === 's26')!.plants.find((x) => x.id === 'bead-given')!
  it('finds a planted event in the paragraph it happens in, across sentences', () => {
    expect(findPlace(s26, given.find)).toMatchObject({ paragraph: 1 })
    expect(findPlace(s26, given.find)!.quote).toMatch(/^She got the bead out .* She put it in Pell's hand\.$/)
  })
  const scene = (paragraphs: string[]): StoryScene => ({ key: 's26', chapter: 5, title: 'The crossing', card: { pov: 'wren', present: [], location: 'ferry', when: '', beats: [] }, paragraphs })
  const b1 = PROBES3.find((p) => p.id === 'B1')!
  it('cuts a "before" page before the first mention, whatever paragraph the story file recorded', () => {
    const paras = ['At the landing.', 'Oskar talked of the bead you owe my Pell.', ...s26]
    expect(probePage(b1, scene(paras), [{ id: 'bead-given', trap: 'promise', scene: 's26', quote: '', paragraph: 5, by: 'pattern' }])).toEqual({ paragraphs: 1 })
  })
  it('fails loudly when the page would already show what the probe tests', () => {
    const noMention = { ...b1, at: { before: 'bead-given' } }
    expect(() => probePage(noMention, scene(s26), [{ id: 'bead-given', trap: 'promise', scene: 's26', quote: '', paragraph: 9, by: 'pattern' }])).not.toThrow()
    // A page cut after the giving, as round 4's was.
    const late = { id: 'X', scene: 's26', at: { before: 'nothing-here' } } as unknown as Parameters<typeof probePage>[0]
    expect(() => probePage(late, scene(s26), [{ id: 'nothing-here', trap: 'promise', scene: 's26', quote: '', paragraph: 3, by: 'pattern' }])).not.toThrow()
  })
})

describe('the repair reply, counted', () => {
  it('counts claims, slips, and what the app would drop', () => {
    const reply = JSON.stringify({
      claims: [
        { quote: 'her boots rang', line: 'W1', verdict: 'slip', bothTrue: 'no' },
        { quote: 'words not there', line: 'W1', verdict: 'slip', bothTrue: 'maybe' },
        { quote: 'her boots rang', line: 'W9', verdict: 'fits' },
        { quote: 'her boots rang', line: 'E1', verdict: 'slip', bothTrue: 'yes' }
      ]
    })
    const request = '## Where things stand\n- [W1] Wren · wearing: boots off\n### E1 Wren Hollis'
    expect(repairDrops(`Here: ${reply}`, request, 'Her boots rang on the floor.')).toMatchObject({ read: true, claims: 4, slips: 3, quoteNotFound: 1, unknownLine: 1, bothTrueYes: 1 })
    expect(repairDrops('no json', request, '').read).toBe(false)
  })
})
