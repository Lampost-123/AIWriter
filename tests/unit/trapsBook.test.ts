// The book (story version 4) of the trap harness (tests/traps): the frozen story keeps its own facts, every fact is set
// where book.ts says, every probe's page and its quiet scenes keep the tested facts out of reach, the probes ask in other
// words, and the checks and the planted-contradiction scoring behave. No model.
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { BOOK_PATTERNS, BOOK_PLANTS, BOOK_PROBES, BOOK_TRAPS, CONSTORY_KINDS, PLANTED } from '../traps/book'
import { firstBreak, patternVerdict } from '../traps/patterns'
import { quoteTouches, scorePlanted, summarisePlanted, type PlantedResult } from '../traps/planted'
import { summariseBook, type ProbeResult } from '../traps/score'
import { bookPage, loadBook, storyBook } from '../traps/storyData'

const book = loadBook(join(__dirname, '..', 'traps', 'story-v4.json'))
const scene = (key: string) => {
  const s = book.scenes.find((x) => x.key === key)
  if (!s) throw new Error(`no scene ${key}`)
  return s
}
const words = (s: string): number => (s.match(/\S+/g) ?? []).length
const text = (key: string): string => scene(key).paragraphs.join('\n\n')
const index = (key: string): number => book.scenes.findIndex((s) => s.key === key)
const broken = (key: keyof typeof BOOK_PATTERNS, t: string): boolean => patternVerdict(BOOK_PATTERNS[key], t).verdict === 'broken'

describe('the book', () => {
  it('is book-length: at least 50,000 words in 40 scenes and 10 chapters, every scene a real one', () => {
    const total = book.scenes.reduce((n, s) => n + words(s.paragraphs.join(' ')), 0)
    expect(total).toBeGreaterThanOrEqual(50_000)
    expect(book.scenes).toHaveLength(40)
    expect(book.chapters).toHaveLength(10)
    for (const s of book.scenes) {
      expect(words(s.paragraphs.join(' ')), s.key).toBeGreaterThan(1_200)
      expect(s.words, s.key).toBe(words(s.paragraphs.join(' ')))
    }
  })

  it('names only people and places its codex has, on every card', () => {
    const keys = new Set(book.entries.map((e) => e.key))
    for (const s of [...book.scenes.map((x) => ({ key: x.key, ...x.card })), ...PLANTED.map((x) => ({ key: x.id, pov: 'tamsin', ...x.card }))]) {
      for (const k of [s.pov, s.location, ...s.present]) expect(keys.has(k), `${s.key}: ${k}`).toBe(true)
    }
  })

  it('uses curly quotes only, as the app’s own pages do', () => {
    for (const s of book.scenes) expect(s.paragraphs.some((p) => /["']/.test(p)), s.key).toBe(false)
  })

  it('sets every fact word for word where book.ts says', () => {
    for (const p of BOOK_PLANTS) {
      expect(text(p.scene).includes(p.sentence), `${p.id} in ${p.scene}`).toBe(true)
      expect(BOOK_TRAPS.some((t) => t.id === p.trap), p.id).toBe(true)
    }
  })

  it('keeps its own facts: nothing in the story breaks a check the probes use', () => {
    for (const s of book.scenes) {
      const t = text(s.key)
      for (const k of ['sum', 'knee', 'river'] as const) expect(firstBreak(BOOK_PATTERNS[k], t)?.text ?? null, `${k} in ${s.key}`).toBeNull()
      expect(firstBreak(BOOK_PATTERNS.pov, t)?.text ?? null, `pov in ${s.key}`).toBeNull()
      expect(firstBreak(BOOK_PATTERNS.register, t)?.text ?? null, `register in ${s.key}`).toBeNull()
      if (index(s.key) > index('s18')) expect(firstBreak(BOOK_PATTERNS.dogs, t)?.text ?? null, `dogs in ${s.key}`).toBeNull()
      if (index(s.key) > index('s26')) expect(firstBreak(BOOK_PATTERNS.splintStill, t)?.text ?? null, `splint in ${s.key}`).toBeNull()
    }
  })

  it('never contains a planted slip', () => {
    const all = book.scenes.map((s) => s.paragraphs.join(' ')).join(' ')
    for (const x of PLANTED.filter((p) => p.flaw)) expect(all.includes(x.flaw!), x.id).toBe(false)
  })
})

describe('the book’s probes', () => {
  const data = storyBook(book, 'story-v4.json')

  it('all load, with their pages worked out and unique ids', () => {
    expect(data.version).toBe(4)
    expect(data.probes.map((p) => p.id)).toEqual(BOOK_PROBES.map((p) => p.id))
    expect(new Set([...data.probes.map((p) => p.id), ...PLANTED.map((x) => x.id)]).size).toBe(BOOK_PROBES.length + PLANTED.length)
    for (const p of BOOK_PROBES) {
      const n = bookPage(p, scene(p.scene))
      if ('start' in p.at) expect(n, p.id).toBe(0)
      else expect(n, p.id).toBeGreaterThan(2)
    }
  })

  it('sit late in the book (45% on), testing facts set or changed earlier', () => {
    for (const p of BOOK_PROBES) expect(index(p.scene), p.id).toBeGreaterThanOrEqual(17)
  })

  it('test only known traps, and cover every one of ConStory’s five kinds', () => {
    const traps = new Set(BOOK_TRAPS.map((t) => t.id))
    const used = BOOK_PROBES.flatMap((p) => [...p.checks.map((c) => c.trap), ...p.patterns.map((c) => c.trap)])
    for (const t of used) expect(traps.has(t), t).toBe(true)
    const kinds = new Set(used.map((t) => BOOK_TRAPS.find((x) => x.id === t)!.kind))
    for (const k of CONSTORY_KINDS) expect(kinds.has(k.id), k.id).toBe(true)
    for (const p of BOOK_PROBES) for (const w of p.tripwires) expect(p.checks.some((c) => c.id === w.check), `${p.id} ${w.check}`).toBe(true)
  })

  it('keep the facts they test off the page and out of the three scenes before', () => {
    for (const p of BOOK_PROBES) {
      const page = scene(p.scene).paragraphs.slice(0, bookPage(p, scene(p.scene))).join('\n\n')
      for (const q of p.quiet) {
        expect(q.words.test(page) ? page.match(q.words)?.[0] : null, `${p.id} page: ${q.trap}`).toBeNull()
        for (const k of q.scenes) expect(text(k).match(q.words)?.[0] ?? null, `${p.id} quiet ${q.trap} in ${k}`).toBeNull()
        expect(index(q.scenes[q.scenes.length - 1]), p.id).toBe(index(p.scene) - 1)
      }
    }
  })

  it('ask in other words: no direction or beat shares a word with the sentences that set what it tests', () => {
    for (const p of BOOK_PROBES) {
      const asked = [p.direction ?? '', ...(p.beats ?? [])].join('\n')
      const traps = new Set([...p.checks.map((c) => c.trap), ...p.patterns.map((c) => c.trap)])
      for (const id of traps) {
        const t = BOOK_TRAPS.find((x) => x.id === id)!
        if (!t.words) continue
        expect(asked.match(t.words)?.[0] ?? null, `${p.id} asks about ${id} in its own words`).toBeNull()
      }
    }
  })
})

describe('the book’s checks', () => {
  it('dogs: six, or Tansy running, is a slip; Tansy missed is not', () => {
    expect(broken('dogs', 'All six dogs leaned into the traces.')).toBe(true)
    expect(broken('dogs', 'Tansy ran at the back, ears flat.')).toBe(true)
    expect(broken('dogs', 'He missed Tansy at the back of the team.')).toBe(false)
    expect(broken('dogs', '‘We had six dogs once,’ Kit said.')).toBe(false)
  })
  it('sum: any other sum in crowns is a slip', () => {
    expect(broken('sum', 'The house owes four hundred and twenty crowns.')).toBe(true)
    expect(broken('sum', 'It comes to 420 crowns.')).toBe(true)
    expect(broken('sum', 'It owes four hundred crowns.')).toBe(true)
    expect(broken('sum', 'It owes four hundred and twelve crowns.')).toBe(false)
    expect(broken('sum', 'He offered her fifty crowns.')).toBe(false)
  })
  it('knee: Slade’s knee on the left is a slip', () => {
    expect(broken('knee', 'He leaned on the cane, his left knee stiff.')).toBe(true)
    expect(broken('knee', 'He favoured his right knee.')).toBe(false)
  })
  it('splint: still on after it came off is a slip; the old splint remembered is not', () => {
    expect(broken('splintStill', 'Her wrist ached in its splint.')).toBe(true)
    expect(broken('splintStill', 'Her wrist, a month out of the splint, held.')).toBe(false)
  })
  it('river: home to the north is a slip', () => {
    expect(broken('river', 'They pushed on north towards Callowmere.')).toBe(true)
    expect(broken('river', 'They pushed on south towards Callowmere.')).toBe(false)
  })
  it('style: first person or present tense narration, and modern words, are slips', () => {
    expect(broken('pov', 'I went down to the water.')).toBe(true)
    expect(broken('pov', 'She walks to the door and opens it.')).toBe(true)
    expect(broken('pov', '‘I went down,’ she said.')).toBe(false)
    expect(broken('register', '‘Okay,’ said Pim.')).toBe(true)
    expect(broken('register', 'The cool wind came off the river.')).toBe(false)
  })
  it('tripwires: swimming, Pim reading, a pigeon in the dark, the watch, the river ice', () => {
    const wire = (probe: string, check: string) => BOOK_PROBES.find((p) => p.id === probe)!.tripwires.find((t) => t.check === check)!
    const hit = (probe: string, check: string, t: string) => !!firstBreak({ broken: wire(probe, check).pattern, not: wire(probe, check).not, outsideQuotes: wire(probe, check).outsideQuotes }, t)
    expect(hit('B7', 'B7a', 'Tamsin swam the last yards with the rope.')).toBe(true)
    expect(hit('B7', 'B7a', 'Tamsin could not swim, so she clung to the rope.')).toBe(false)
    expect(hit('B10', 'B10a', 'Pim read the letter out slowly.')).toBe(true)
    expect(hit('B10', 'B10a', 'Orla had read it to him; Pim read nothing himself.')).toBe(false)
    expect(hit('B4', 'B4a', 'She released the pigeon into the dark.')).toBe(true)
    expect(hit('B4', 'B4a', 'The pigeon would not fly in the dark; she would wait for first light.')).toBe(false)
    expect(hit('B9', 'B9a', 'She took out her father’s watch and frowned at it.')).toBe(true)
    expect(hit('B9', 'B9a', 'She had no watch; it was sold at Dunmere.')).toBe(false)
    expect(hit('B9', 'B9c', 'Kit swung the sledge down onto the river ice.')).toBe(true)
    expect(hit('B9', 'B9c', 'Kit wanted to take them onto the river ice, but the bell had rung.')).toBe(false)
  })
})

describe('the planted contradictions', () => {
  it('each passage holds its slip or decoy word for word, and the right number of each', () => {
    for (const x of PLANTED) {
      const all = x.paragraphs.join('\n\n')
      if (x.flaw) expect(all.includes(x.flaw), x.id).toBe(true)
      if (x.decoy) expect(all.includes(x.decoy), x.id).toBe(true)
      expect(all.match(/["']/), x.id).toBeNull()
    }
    expect(PLANTED.filter((x) => x.flaw)).toHaveLength(13)
    expect(PLANTED.filter((x) => !x.flaw)).toHaveLength(6)
    for (const k of CONSTORY_KINDS) expect(PLANTED.filter((x) => x.flaw && x.kind === k.id).length, k.id).toBeGreaterThanOrEqual(2)
  })

  it('an issue quoting part of the slip, or a sentence and a half around it, is about it', () => {
    const flaw = 'Kit’s brown eyes creased at the corners when he saw the tea.'
    expect(quoteTouches('Kit’s brown eyes creased', flaw)).toBe(true)
    expect(quoteTouches('He took his cup. Kit’s brown eyes creased at the corners when he saw', flaw)).toBe(true)
    expect(quoteTouches('Hob’s chewed the trace again', flaw)).toBe(false)
    expect(quoteTouches('', flaw)).toBe(false)
  })

  it('scores a catch, a false alarm, a decoy and the live checks’ underlines', () => {
    const issue = (quote: string, kind = 'fact') => ({ kind, severity: 'warning', quote, message: 'm' })
    const slip = { flaw: 'Kit’s brown eyes creased at the corners when he saw the tea.' }
    expect(scorePlanted(slip, [issue('Kit’s brown eyes creased at the corners')])).toMatchObject({ caught: true, falseAlarms: 0 })
    expect(scorePlanted(slip, [issue('Hob’s chewed the trace again')])).toMatchObject({ caught: false, falseAlarms: 1 })
    expect(scorePlanted(slip, [issue('Hob', 'spelling')])).toMatchObject({ caught: false, falseAlarms: 0 })
    const control = { decoy: 'Kit’s five dogs lay in a heap by the yard wall.' }
    const s = scorePlanted(control, [issue('Kit’s five dogs lay in a heap')])
    expect(s).toMatchObject({ caught: null, falseAlarms: 1 })
    expect(s.issues[0].on).toBe('decoy')
  })

  it('counts a catch only when its reason names the planted fact (2026-10-16: X7 was counted for something else)', () => {
    for (const x of PLANTED.filter((p) => p.flaw)) expect(x.reason, x.id).toBeInstanceOf(RegExp)
    const byId = (id: string) => PLANTED.find((x) => x.id === id)!
    const issue = (quote: string, message: string, kind = 'fact') => ({ kind, severity: 'warning', quote, message })
    // What the live run of 2026-10-16 raised on each slip's sentence (report.md), scored again.
    const live: [string, string, string, boolean][] = [
      ['X1', 'Kit’s brown eyes creased at the corners', 'Kit Ansel’s eyes: this scene says “brown”, but the memory says “grey”.', true],
      ['X2', 'four hundred and twenty crowns, paid in full eleven years ago', 'The debt Tamsin paid off and had struck from the guild’s books was four hundred and twelve crowns, not four hundred and twenty.', true],
      ['X4', byId('X4').flaw!, 'Pim cannot read words, as established when Orla Finch promised to read any message to him, yet here he reads the guild’s letter aloud.', true],
      [
        'X7',
        'That afternoon Orla let one of the Callowmere birds go from the loft with a letter for Leckie, and it flew north for Hollin as straight as a thrown stone.',
        'Orla Finch sends a bird with a letter for Leckie, but the memory says she does not know that Tamsin is fetching Edwin Leckie home for the Reckoning, nor that he is in Hollin, and nothing in the scene shows her learning it.',
        false
      ],
      ['X7', 'That afternoon Orla let one of the Callowmere birds go from the loft with a letter for Leckie', 'The scene is set on Day 50, three days after Thaw Day, but the previous scene ended on Day 48; the scene’s ‘that afternoon’ places it on the same day as the loft visit.', false],
      ['X10', byId('X10').flaw!, 'Tamsin pawned her father’s silver watch in Dunmere and the pawnbroker told her it had been sold to a drover and was gone for good, so she cannot have it in her pocket now.', true],
      ['X11', byId('X11').flaw!, 'The scene is told in close third person from Tamsin’s point of view, but this paragraph slips into Corvin Slade’s head and reports his thoughts.', true],
      ['X12', 'Okay, so the guild totally owes us a new bell rope', 'Pim’s speech is fast, eager and full of questions, but this line uses modern filler that doesn’t match his voice notes.', true]
    ]
    for (const [id, quote, message, caught] of live) {
      const s = scorePlanted(byId(id), [issue(quote, message)])
      expect(s.caught, `${id}: ${message}`).toBe(caught)
      expect(s.issues[0].on).toBe(caught ? 'flaw' : 'wrong')
      expect(s.falseAlarms).toBe(caught ? 0 : 1)
    }
    // The right reason on X7, and on X6 (Isla told Tamsin, not Kit).
    expect(scorePlanted(byId('X7'), [issue(byId('X7').flaw!, 'Guild pigeons fly only home to their own loft, so a Callowmere bird can’t carry a letter to Hollin.')]).caught).toBe(true)
    expect(scorePlanted(byId('X6'), [issue('‘The old woman told you his heart won’t last the summer,’ Kit said.', 'The memory has Isla Thorne telling Tamsin of Leckie’s failing heart, not Kit.', 'continuity')]).caught).toBe(true)
    expect(scorePlanted(byId('X6'), [issue('‘The old woman told you his heart won’t last the summer,’ Kit said.', 'Kit was asleep when the scene before ended.', 'continuity')]).caught).toBe(false)
  })

  it('X2 has one slip only: the ledger stayed at the Guildhall and Kit sleeps on the bench by the stove', () => {
    const x2 = PLANTED.find((x) => x.id === 'X2')!.paragraphs.join('\n\n')
    expect(x2).not.toMatch(/ledger lay open|closed the ledger|on his pallet/)
    expect(x2).toContain('her father’s last ledger had stayed at the Guildhall')
    expect(x2).toContain('Kit turning over on the bench by the stove in the workshop')
  })

  it('sums up catches, false alarms and decoys by kind', () => {
    const r = (id: string, planted: boolean, kind: PlantedResult['kind'], caught: boolean | null, alarms: number, decoy = false): PlantedResult => ({
      id,
      name: id,
      kind,
      trap: 't',
      planted,
      sentence: null,
      why: '',
      samples: [
        {
          index: 0,
          status: 'checked',
          caught,
          falseAlarms: alarms,
          issues: Array.from({ length: alarms + (caught ? 1 : 0) }, (_, i) => ({ kind: 'fact', severity: 'warning', quote: '', message: '', on: caught && i === 0 ? 'flaw' : decoy ? 'decoy' : 'other' }))
        }
      ]
    })
    const s = summarisePlanted([r('X1', true, 'detail', true, 0), r('X2', true, 'detail', false, 1), r('N1', false, 'detail', null, 1, true), r('N2', false, 'world', null, 0)])
    expect(s).toMatchObject({ slipChecks: 2, caught: 1, controlChecks: 2, controlsFlagged: 1, falseAlarms: 2, decoys: 1, recall: 0.5 })
    expect(s.precision).toBeCloseTo(1 / 3)
    expect(s.byKind.detail).toEqual({ slipChecks: 2, caught: 1, falseAlarms: 2 })
  })

  it('groups probe scores by ConStory’s kinds and by kind of memory', () => {
    const probe: ProbeResult = {
      id: 'B7',
      scene: 's32',
      kind: 'addBelow',
      asks: '',
      samples: [
        {
          index: 0,
          status: 'complete',
          error: null,
          generationId: null,
          words: 1,
          text: '',
          judge: { status: 'ok', raw: '' },
          results: [
            { id: 'B7a', trap: 'swim', ask: '', verdict: 'broken', by: 'judge', answer: 'yes', quote: '' },
            { id: 'B7b', trap: 'river', ask: '', verdict: 'kept', by: 'pattern', answer: '', quote: '' },
            { id: 'B7s', trap: 'pov', ask: '', verdict: 'kept', by: 'pattern', answer: '', quote: '' }
          ]
        }
      ]
    }
    const b = summariseBook([probe])
    expect(b.byKind.character).toMatchObject({ broken: 1, kept: 0 })
    expect(b.byKind.world).toMatchObject({ kept: 1 })
    expect(b.byKind.style).toMatchObject({ kept: 1 })
    expect(b.byMemory.early).toMatchObject({ kept: 1, broken: 1 })
    expect(b.byMemory.style).toMatchObject({ kept: 1 })
  })
})
