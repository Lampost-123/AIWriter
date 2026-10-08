import { describe, expect, it } from 'vitest'
import type { ChangeInput, ChangeView, Entry, Outline, SourceLink } from '@shared/types'
import {
  allAdams,
  changeSourceNote,
  changeWhere,
  createKindsFor,
  describeChange,
  madeByNote,
  mergeRelationEdit,
  notesSource,
  orientRelationship,
  relationEditOf,
  relationPhrase,
  relationshipInput,
  saveRelationOverNewer,
  sceneLabels,
  sourceNote,
  splitChanges,
  type RelationshipChange
} from './memoryLogic'

const base = {
  storyId: null,
  sceneId: null,
  position: 0,
  origin: 'adam' as const,
  runId: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  where: '',
  links: [] as SourceLink[]
}

const rel = (
  id: string,
  entryId: string,
  otherId: string,
  extra: Partial<{ type: string; feels: string; otherFeels: string; ended: boolean }> = {},
  anchor: ChangeView['anchor'] = 'baseline'
): ChangeView => ({
  ...base,
  id,
  entryId,
  anchor,
  kind: 'relationship',
  payload: { otherId, type: '', feels: '', otherFeels: '', ...extra }
})

const knows = (id: string, entryId: string, fact: string, anchor: ChangeView['anchor'] = 'baseline', forgets = false): ChangeView => ({
  ...base,
  id,
  entryId,
  anchor,
  kind: 'knowledge',
  payload: { factId: `f-${fact}`, fact, forgets }
})

const NAMES: Record<string, string> = { mara: 'Mara', tobin: 'Tobin', sword: 'the Sword', guild: 'The Guild' }
const nameOf = (id: string): string | null => NAMES[id] ?? null
const label = (k: string): string => ({ hair: 'Hair', clothing: 'Typical clothing' })[k] ?? k

describe('sceneLabels', () => {
  it('counts chapters and scenes from 1, in order', () => {
    const outline = {
      story: { title: 'Book 1' },
      chapters: [
        { id: 'c2', position: 1 },
        { id: 'c1', position: 0 }
      ],
      scenes: [
        { id: 's3', chapterId: 'c2', position: 0 },
        { id: 's2', chapterId: 'c1', position: 1 },
        { id: 's1', chapterId: 'c1', position: 0 }
      ]
    } as unknown as Outline
    const labels = sceneLabels(outline)
    expect(labels.get('s1')).toBe('Book 1, Ch 1, Sc 1')
    expect(labels.get('s2')).toBe('Book 1, Ch 1, Sc 2')
    expect(labels.get('s3')).toBe('Book 1, Ch 2, Sc 1')
  })
})

describe('allAdams', () => {
  it('is true only for an entry Adam made with nothing on it drafted by AI', () => {
    expect(allAdams({ origin: 'adam', fieldOrigins: {} })).toBe(true)
    // What the memory keeper read from the story since doesn't stop it being his writing.
    expect(allAdams({ origin: 'adam', fieldOrigins: { hair: 'text', eyes: 'adam' } })).toBe(true)
    // A builder's entry: his name and notes, the rest drafted by AI.
    expect(allAdams({ origin: 'adam', fieldOrigins: { summary: 'adam', description: 'ai' } })).toBe(false)
    expect(allAdams({ origin: 'text', fieldOrigins: {} })).toBe(false)
  })
})

describe('madeByNote', () => {
  it('speaks only for entries AI Write made and Adam has not touched', () => {
    expect(madeByNote({ origin: 'text', byHand: false }, 'Book 1, Ch 2, Sc 1')).toBe(
      "Added by AI Write from Book 1, Ch 2, Sc 1. Edit anything and it's yours."
    )
    expect(madeByNote({ origin: 'text', byHand: false }, null)).toBe("Added by AI Write from your story. Edit anything and it's yours.")
    expect(madeByNote({ origin: 'ai', byHand: false }, null)).toBe("Drafted by AI. Edit anything and it's yours.")
    expect(madeByNote({ origin: 'text', byHand: true }, 'Book 1, Ch 2, Sc 1')).toBeNull()
    expect(madeByNote({ origin: 'adam', byHand: false }, null)).toBeNull()
  })
})

describe('sourceNote', () => {
  const link = (state: SourceLink['state'], quote = 'she lost her hand'): SourceLink => ({
    id: `l-${state}-${quote}`,
    factKind: 'field',
    factId: 'mara',
    field: 'marks',
    sceneId: 's1',
    sceneVersion: 3,
    paragraphId: 'p1',
    start: 0,
    end: quote.length,
    quote,
    state
  })

  it('shows the words a text fact came from, preferring ones that are unchanged', () => {
    expect(sourceNote('text', [link('changed', 'edited words'), link('ok')])).toEqual({
      kind: 'words',
      quote: 'she lost her hand',
      sceneId: 's1',
      paragraphId: 'p1',
      changed: false,
      more: 1
    })
  })

  it('keeps the paragraph of words edited since, so the page can show where they were', () => {
    expect(sourceNote('text', [{ ...link('changed', 'old words'), paragraphId: 'p9' }])).toEqual({
      kind: 'words',
      quote: 'old words',
      sceneId: 's1',
      paragraphId: 'p9',
      changed: true,
      more: 0
    })
  })

  it('says when every passage it came from was deleted', () => {
    expect(sourceNote('text', [link('gone')])).toEqual({ kind: 'gone', sceneId: 's1' })
    expect(sourceNote('text', [])).toBeNull()
  })

  it('marks AI drafts and Adam’s own facts', () => {
    expect(sourceNote('ai', [link('ok')])).toEqual({ kind: 'ai' })
    expect(sourceNote('adam', [link('ok')])).toEqual({ kind: 'adam' })
  })

  it('says "Kept by you" for a change brought back by Undo, which rests on no words any more', () => {
    expect(changeSourceNote({ origin: 'text', links: [] })).toEqual({ kind: 'kept' })
    // Otherwise as sourceNote: its words, words removed, the AI's or Adam's.
    expect(changeSourceNote({ origin: 'text', links: [link('ok')] })?.kind).toBe('words')
    expect(changeSourceNote({ origin: 'text', links: [link('gone')] })).toEqual({ kind: 'gone', sceneId: 's1' })
    expect(changeSourceNote({ origin: 'ai', links: [] })).toEqual({ kind: 'ai' })
    expect(changeSourceNote({ origin: 'adam', links: [] })).toEqual({ kind: 'adam' })
  })
})

describe('relationships from either side', () => {
  it('reads a relationship written on this entry as it is', () => {
    const c = rel('r1', 'mara', 'tobin', { type: 'sister', feels: 'protective', otherFeels: 'resentful' })
    const v = orientRelationship(c as Extract<ChangeView, { kind: 'relationship' }>, 'mara')!
    expect(v).toMatchObject({
      mine: true,
      otherId: 'tobin',
      fromId: 'mara',
      type: 'sister',
      selfFeels: 'protective',
      otherFeels: 'resentful'
    })
  })

  it('reads one written on the other entry from this entry’s point of view', () => {
    const c = rel('r1', 'mara', 'tobin', { type: 'sister', feels: 'protective', otherFeels: 'resentful' })
    const v = orientRelationship(c as Extract<ChangeView, { kind: 'relationship' }>, 'tobin')!
    expect(v).toMatchObject({
      mine: false,
      otherId: 'mara',
      fromId: 'mara',
      type: 'sister',
      selfFeels: 'resentful',
      otherFeels: 'protective'
    })
  })

  it('saves edits back on the side it was written from', () => {
    const c = rel('r1', 'mara', 'tobin', { type: 'sister', feels: 'protective', otherFeels: 'resentful' }) as Extract<
      ChangeView,
      { kind: 'relationship' }
    >
    const fromTobin = orientRelationship(c, 'tobin')!
    expect(relationshipInput(fromTobin, { type: 'sister', selfFeels: 'grateful', otherFeels: 'protective' })).toEqual({
      entryId: 'mara',
      anchor: 'baseline',
      storyId: null,
      sceneId: null,
      kind: 'relationship',
      payload: { otherId: 'tobin', type: 'sister', feels: 'protective', otherFeels: 'grateful' }
    })
    const fromMara = orientRelationship(c, 'mara')!
    expect(relationshipInput(fromMara, { type: 'rival', selfFeels: 'wary', otherFeels: 'resentful' }).payload).toEqual({
      otherId: 'tobin',
      type: 'rival',
      feels: 'wary',
      otherFeels: 'resentful'
    })
  })

  it('ignores a relationship that does not involve the entry', () => {
    const c = rel('r1', 'mara', 'tobin') as Extract<ChangeView, { kind: 'relationship' }>
    expect(orientRelationship(c, 'guild')).toBeNull()
  })
})

describe('saving a relationship over a newer copy', () => {
  type R = RelationshipChange
  // One relationship in a fake world. `others` are writes from elsewhere (the memory keeper) that land
  // after the page loaded it; `puts` records what the page sent.
  const world = (start: R) => {
    let row = start
    const puts: ChangeInput[] = []
    return {
      others: (payload: Partial<R['payload']>) => {
        row = { ...row, payload: { ...row.payload, ...payload }, updatedAt: '2026-10-02T10:05:00.000Z' }
      },
      puts,
      row: () => row,
      io: {
        get: async (c: R) => (c.id === row.id ? row : null),
        put: async (id: string, input: ChangeInput) => {
          puts.push(input)
          row = { ...row, id, payload: input.payload as R['payload'], updatedAt: '2026-10-02T10:06:00.000Z' }
          return row
        }
      }
    }
  }
  const start = rel('r1', 'mara', 'tobin', { type: 'sister', feels: 'protective', otherFeels: '' }) as R

  it('keeps how the other one feels when the memory filled it in while Adam typed the type', async () => {
    const w = world(start)
    const fromMara = orientRelationship(start, 'mara')!
    const base = relationEditOf(fromMara, start)
    w.others({ otherFeels: 'resentful' })
    const { now } = await saveRelationOverNewer(fromMara, { ...base, type: 'older sister' }, base, w.io)
    expect(w.row().payload).toEqual({ otherId: 'tobin', type: 'older sister', feels: 'protective', otherFeels: 'resentful' })
    expect(now).toEqual({ type: 'older sister', selfFeels: 'protective', otherFeels: 'resentful' })
  })

  it('works the same from the other entry’s page, where the sides are swapped', async () => {
    const w = world(start)
    const fromTobin = orientRelationship(start, 'tobin')!
    const base = relationEditOf(fromTobin, start)
    expect(base).toEqual({ type: 'sister', selfFeels: '', otherFeels: 'protective' })
    // The memory changes how Mara feels; Adam, on Tobin's page, types how Tobin feels.
    w.others({ feels: 'guilty', ended: true })
    const { now } = await saveRelationOverNewer(fromTobin, { ...base, selfFeels: 'grateful' }, base, w.io)
    expect(w.row().payload).toEqual({ otherId: 'tobin', type: 'sister', feels: 'guilty', otherFeels: 'grateful', ended: true })
    expect(now).toEqual({ type: 'sister', selfFeels: 'grateful', otherFeels: 'guilty' })
  })

  it('lets what Adam typed win in a box both changed, and sends his edit as it is when nothing changed', async () => {
    const w = world(start)
    const fromMara = orientRelationship(start, 'mara')!
    const base = relationEditOf(fromMara, start)
    w.others({ feels: 'wary' })
    await saveRelationOverNewer(fromMara, { ...base, selfFeels: 'fiercely protective' }, base, w.io)
    expect(w.row().payload.feels).toBe('fiercely protective')

    const quiet = world(start)
    const mine = { type: 'twin', selfFeels: 'fond', otherFeels: 'jealous' }
    await saveRelationOverNewer(fromMara, mine, base, quiet.io)
    expect(quiet.puts[0]).toEqual(relationshipInput(fromMara, mine))
  })

  it('merges box by box', () => {
    const base = { type: 'sister', selfFeels: 'a', otherFeels: 'b' }
    expect(mergeRelationEdit(base, { ...base, type: 'twin' }, { type: 'sister', selfFeels: 'A', otherFeels: 'B' })).toEqual({
      type: 'twin',
      selfFeels: 'A',
      otherFeels: 'B'
    })
  })
})

describe('relationPhrase', () => {
  it('joins the type to the other entry in plain words', () => {
    expect(relationPhrase('enemies', 'Tobin')).toBe('enemies with Tobin')
    expect(relationPhrase('holds', 'the Sword')).toBe('holds the Sword')
    expect(relationPhrase('member', 'The Guild')).toBe('member of The Guild')
    expect(relationPhrase('member (lieutenant)', 'The Guild')).toBe('member of The Guild (lieutenant)')
    expect(relationPhrase('involved in', 'the Fall')).toBe('involved in the Fall')
    expect(relationPhrase('sister', 'Tobin')).toBe('sister of Tobin')
    expect(relationPhrase('Sister', 'Tobin')).toBe('sister of Tobin')
    expect(relationPhrase('married', 'Tobin')).toBe('married to Tobin')
    expect(relationPhrase('mentor', 'Tobin')).toBe('mentor to Tobin')
    expect(relationPhrase('estranged', 'Tobin')).toBe('estranged from Tobin')
    expect(relationPhrase('in love', 'Tobin')).toBe('in love with Tobin')
    expect(relationPhrase('at war', 'The Guild')).toBe('at war with The Guild')
    expect(relationPhrase('owes money', 'Tobin')).toBe('owes money to Tobin')
    expect(relationPhrase('boss', 'Tobin')).toBe('boss of Tobin')
    expect(relationPhrase('Dark Lord', 'the North')).toBe('Dark Lord of the North')
    expect(relationPhrase('', 'Tobin')).toBe('linked to Tobin')
  })

  it('puts "a" or "an" before a role when asked, but not before a name or "the ..."', () => {
    const a = (type: string, other = 'Tobin'): string => relationPhrase(type, other, { article: true })
    expect(a('enemy')).toBe('an enemy of Tobin')
    expect(a('old friend')).toBe('an old friend of Tobin')
    expect(a('member (lieutenant)', 'The Guild')).toBe('a member of The Guild (lieutenant)')
    expect(a('one-time ally')).toBe('a one-time ally of Tobin')
    expect(a('honoured guest')).toBe('an honoured guest of Tobin')
    expect(a('the leader', 'The Guild')).toBe('the leader of The Guild')
    expect(a('Dark Lord', 'the North')).toBe('Dark Lord of the North')
    expect(a('enemies')).toBe('enemies with Tobin')
    expect(a('mentor')).toBe('mentor to Tobin')
    expect(a('part of', 'The Guild')).toBe('part of The Guild')
  })

  it('reads plural and singular types with extra detail as a sentence, the detail after the name', () => {
    const a = (type: string, other = 'Ash Penrose'): string => relationPhrase(type, other, { article: true })
    // The trial's own: plural, with where they are.
    expect(a('travelling companions on the drove road')).toBe('travelling companions with Ash Penrose (on the drove road)')
    expect(a('travelling companion on the drove road')).toBe('a travelling companion of Ash Penrose (on the drove road)')
    expect(a('travelling companions')).toBe('travelling companions with Ash Penrose')
    expect(a('travelling companion')).toBe('a travelling companion of Ash Penrose')
    expect(a('rivals at court')).toBe('rivals with Ash Penrose (at court)')
    expect(a('friends since childhood')).toBe('friends with Ash Penrose (since childhood)')
    expect(a('enemy since the fire')).toBe('an enemy of Ash Penrose (since the fire)')
    expect(a('estranged since the war')).toBe('estranged from Ash Penrose (since the war)')
    expect(a('companions on the road (uneasy)')).toBe('companions with Ash Penrose (on the road; uneasy)')
    // The trial's others: detail after a semicolon, and the two halves of a family tie.
    expect(a('acquaintance; he has stayed at her inn before')).toBe('an acquaintance of Ash Penrose (he has stayed at her inn before)')
    expect(a('father and daughter', 'Pell Venn')).toBe('father and daughter with Pell Venn')
    expect(a('mentor and friend')).toBe('a mentor and friend of Ash Penrose')
    expect(a('old friend, from the war')).toBe('an old friend of Ash Penrose (from the war)')
    // Words that belong together keep their own link.
    expect(a('involved in')).toBe('involved in Ash Penrose')
    expect(a('in love')).toBe('in love with Ash Penrose')
    expect(a('holds the key to', 'the Assay Office')).toBe('holds the key to the Assay Office')
    expect(a('stationed at', 'Harrowgate')).toBe('stationed at Harrowgate')
    expect(relationPhrase('companions on the drove road', 'Ash')).toBe('companions with Ash (on the drove road)')
  })

  it('offers sensible kinds to create from a typed name', () => {
    expect(createKindsFor('character')[0]).toBe('character')
    expect(createKindsFor('event')).toContain('place')
  })
})

describe('splitChanges', () => {
  it('puts baseline relationships and knowledge on their own, and the rest in story order', () => {
    const scene = { ...rel('r2', 'mara', 'tobin', { type: 'enemies' }, 'scene'), where: 'Book 1, Ch 12, Sc 3' }
    const changes: ChangeView[] = [
      rel('r1', 'mara', 'tobin', { type: 'sister' }),
      rel('r3', 'guild', 'mara', { type: 'led by' }),
      knows('k1', 'mara', 'The heir lives'),
      knows('k2', 'mara', 'Forgotten', 'baseline', true),
      scene,
      knows('k3', 'mara', 'Mara is the heir', 'scene')
    ]
    const split = splitChanges(changes, 'mara')
    expect(split.relationships.map((r) => [r.change.id, r.otherId, r.mine])).toEqual([
      ['r1', 'tobin', true],
      ['r3', 'guild', false]
    ])
    expect(split.knows.map((k) => k.id)).toEqual(['k1'])
    expect(split.history.map((c) => c.id)).toEqual(['r2', 'k3'])
  })

  it('keeps one relationship per pair: the later one', () => {
    const split = splitChanges([rel('r1', 'mara', 'tobin', { type: 'sister' }), rel('r2', 'tobin', 'mara', { type: 'brother' })], 'mara')
    expect(split.relationships.map((r) => r.change.id)).toEqual(['r2'])
  })
})

describe('describeChange', () => {
  const say = (c: ChangeView, self = 'mara'): string | null => describeChange(c, self, nameOf, label)?.text ?? null

  it('phrases updates from their note, or from what changed', () => {
    const upd = (payload: object): ChangeView =>
      ({ ...base, id: 'u', entryId: 'mara', anchor: 'scene', kind: 'update', payload: { note: '', ...payload } }) as ChangeView
    expect(say(upd({ note: 'lost her left hand' }))).toBe('Lost her left hand')
    expect(say(upd({ fields: { hair: 'cropped short', clothing: '' } }))).toBe('Hair: cropped short')
    expect(say(upd({ description: 'Older now.' }))).toBe('A new description')
  })

  it('phrases relationships naturally, from either side', () => {
    expect(say(rel('r', 'mara', 'tobin', { type: 'enemies' }, 'scene'))).toBe('Now enemies with Tobin')
    expect(say(rel('r', 'mara', 'tobin', { type: 'enemies', ended: true }, 'scene'))).toBe('No longer enemies with Tobin')
    expect(say(rel('r', 'mara', 'sword', { type: 'holds' }, 'scene'))).toBe('Now holds the Sword')
    expect(say(rel('r', 'mara', 'sword', { type: 'holds' }, 'scene'), 'sword')).toBe('Mara: now holds the Sword')
    expect(say(rel('r', 'tobin', 'mara', { type: 'enemies' }, 'scene'))).toBe('Tobin: now enemies with Mara')
    expect(say(rel('r', 'tobin', 'mara', { type: 'enemy' }, 'scene'))).toBe('Tobin: now an enemy of Mara')
    expect(say(rel('r', 'mara', 'tobin', { type: 'rival', ended: true }, 'scene'))).toBe('No longer a rival of Tobin')
  })

  it('phrases a plural relationship with extra detail as a sentence (the trial’s "Now a travelling companions ...")', () => {
    expect(say(rel('r', 'mara', 'tobin', { type: 'travelling companions on the drove road' }, 'scene'))).toBe(
      'Now travelling companions with Tobin (on the drove road)'
    )
    expect(say(rel('r', 'mara', 'tobin', { type: 'travelling companions', ended: true }, 'scene'))).toBe(
      'No longer travelling companions with Tobin'
    )
    expect(say(rel('r', 'tobin', 'mara', { type: 'guide on the fell road' }, 'scene'))).toBe('Tobin: now a guide of Mara (on the fell road)')
  })

  it('adds how each feels, this entry first', () => {
    const c = rel('r', 'tobin', 'mara', { type: 'enemies', feels: 'betrayed', otherFeels: 'guilty' }, 'scene')
    expect(describeChange(c, 'mara', nameOf, label)?.detail).toBe('Mara feels: guilty · Tobin feels: betrayed')
  })

  it('leaves out a relationship with an entry that no longer exists', () => {
    expect(say(rel('r', 'mara', 'gone', { type: 'enemies' }, 'scene'))).toBeNull()
  })

  it('shows something said once: not again under it when its source words are the same words', () => {
    const said = (links: SourceLink[], there?: string[]): ChangeView => ({
      ...base,
      id: 's',
      entryId: 'tobin',
      anchor: 'scene',
      kind: 'knowledge',
      links,
      payload: { factId: 'f', fact: 'the vault is empty', said: { kind: 'secret', by: 'mara', words: 'The vault is empty.' }, ...(there ? { there } : {}) }
    })
    const link = (quote: string, state: SourceLink['state'] = 'ok'): SourceLink =>
      ({ id: 'l', factKind: 'change', factId: 's', field: null, sceneId: 'sc', sceneVersion: 1, paragraphId: 'p1', start: 0, end: 20, quote, state }) as SourceLink
    const detail = (c: ChangeView): string | null | undefined => describeChange(c, 'tobin', nameOf, label)?.detail
    expect(say(said([link('“The vault is empty.”')]), 'tobin')).toBe('A secret told: the vault is empty')
    // An older world (no one named as there): the line is shown by its source words only.
    expect(detail(said([link('“The vault is empty.”')]))).toBeNull()
    expect(detail(said([link('The  vault is empty.')]))).toBeNull()
    // No source words to show it, or words that are gone or say something else: the line is shown under it.
    expect(detail(said([]))).toBe('“The vault is empty.”')
    expect(detail(said([link('The vault is empty.', 'gone')]))).toBe('“The vault is empty.”')
    expect(detail(said([link('She said nothing more.')]))).toBe('“The vault is empty.”')
    // Who was there takes its place when known.
    expect(detail(said([link('The vault is empty.')], ['tobin', 'mara']))).toBe('Was there with Mara')
  })

  it('phrases knowledge and plot threads', () => {
    expect(say(knows('k', 'tobin', 'Mara is the heir', 'scene'), 'tobin')).toBe('Learns: Mara is the heir')
    expect(say(knows('k', 'tobin', 'Mara is the heir', 'scene', true), 'tobin')).toBe('Forgets: Mara is the heir')
    const thread = (status: 'open' | 'resolved', note: string): ChangeView => ({
      ...base,
      id: 't',
      entryId: 'heir',
      anchor: 'scene',
      kind: 'thread',
      payload: { status, note }
    })
    expect(say(thread('resolved', 'the heir is found'), 'heir')).toBe('Thread resolved: the heir is found')
    expect(say(thread('open', ''), 'heir')).toBe('Thread opened')
  })

  it('phrases a fresh description, and another entry’s that sets its relationship with this one', () => {
    const full = (entryId: string): ChangeView => ({
      ...base,
      id: 'f',
      entryId,
      anchor: 'story-start',
      kind: 'full',
      payload: {
        description: 'Young and reckless.',
        summary: '',
        knows: [],
        relationships: [{ otherId: 'mara', type: 'rival', feels: 'jealous', otherFeels: '' }]
      }
    })
    expect(say(full('mara'))).toBe('Described afresh: Young and reckless.')
    expect(say(full('tobin'))).toBe('Tobin: rival of Mara')
  })
})

describe('changeWhere', () => {
  it('starts with a capital, and says when a change has no place', () => {
    expect(changeWhere({ where: 'the start of Book 2', anchor: 'story-start' })).toBe('The start of Book 2')
    expect(changeWhere({ where: '', anchor: 'baseline' })).toBe('From the start')
  })
})

describe('notesSource', () => {
  const entry = (patch: Partial<Entry>): Entry =>
    ({
      id: 'mara',
      kind: 'character',
      name: 'Mara',
      aliases: [],
      summary: '',
      description: '',
      tags: [],
      notes: '',
      fields: {},
      origin: 'text',
      fieldOrigins: {},
      ...patch
    }) as Entry
  const keys = ['aliases', 'summary', 'description', 'tags', 'eyes', 'hair']

  it('keeps the line of a field AI Write filled in that Adam has since made his', () => {
    const prev = entry({ summary: 'Someone called Mara.', fields: { eyes: 'green' } })
    const saved = entry({
      summary: 'A ferrywoman',
      fields: { eyes: '', hair: 'grey' },
      fieldOrigins: { summary: 'adam', eyes: 'adam', hair: 'text' }
    })
    const out = notesSource(prev, saved, keys)
    expect(out.summary).toBe('Someone called Mara.')
    expect(out.fields).toEqual({ eyes: 'green', hair: 'grey' })
    expect(out.fieldOrigins).toEqual({ summary: 'text', eyes: 'text', hair: 'text' })
  })

  it('takes the newer copy for everything else', () => {
    const prev = entry({ origin: 'adam', fields: { hair: 'long' } })
    const saved = entry({ origin: 'adam', fields: { hair: 'long', eyes: 'grey' }, fieldOrigins: { eyes: 'text' } })
    expect(notesSource(prev, saved, keys)).toEqual(saved)
  })
})
