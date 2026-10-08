// What Ask the world sends: the entries a question names, from the open story's point of view (a
// what-if's own events never reach another story's chat), what the search finds, and the conversation
// trimmed to fit. Checked against the spec's fixed test world (tests/unit/testWorld.ts).
import { beforeAll, describe, expect, it } from 'vitest'
import type { ContextBlock, ID } from '@shared/types'
import { defaultWritingPrefs } from '@shared/defaults'
import { dbWorld } from '../../../tests/unit/testWorld'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { countRaw } from '../ai/tokens'
import { assembleAsk, EARLIER, MAX_TURNS, NOT_YET, searchTerms, standsAlone, type AskBriefing } from './context'
import { loadShape } from '../memory/scene'
import { ASK_MARKER } from './prompts'
import type { PastTurn } from './prompts'

let w: ReturnType<typeof dbWorld>

beforeAll(() => {
  w = dbWorld()
})

function brief(
  question: string,
  story: string | null,
  scene: string | null = null,
  turns: PastTurn[] = [],
  contextLength: number | null = null
): AskBriefing {
  return briefIn(w, question, story, scene, turns, contextLength)
}

/** The same, in a world of the test's own (for a test that changes it). */
function briefIn(
  world: ReturnType<typeof dbWorld>,
  question: string,
  story: string | null,
  scene: string | null = null,
  turns: PastTurn[] = [],
  contextLength: number | null = null
): AskBriefing {
  return assembleAsk(
    world.db,
    {
      question,
      storyId: story ? world.id(story) : null,
      sceneId: scene ? world.id(scene) : null,
      turns,
      prefs: defaultWritingPrefs(),
      contextLength
    },
    countRaw
  )
}

const systemOf = (b: AskBriefing): string => b.messages[0].content
const sent = (b: AskBriefing, id: string): ContextBlock | undefined => b.blocks.find((x) => x.id === id && !x.dropped)
const textOf = (b: AskBriefing, id: string): string => sent(b, id)?.text ?? ''
const sentIds = (b: AskBriefing): ID[] => b.entries.map((e) => e.entryId)

describe('the briefing for a question', () => {
  it('starts with the marker and ends with the question', () => {
    const b = brief('Did I already say how old the Duke is?', 'b1', 'b1.c3.s1')
    expect(systemOf(b).startsWith(`${ASK_MARKER} answer\n`)).toBe(true)
    expect(b.messages.at(-1)).toEqual({ role: 'user', content: 'Did I already say how old the Duke is?' })
    expect(b.label).toBe('Book 1, Ch 3, Sc 1')
    // How to answer and where the author is are never left out.
    expect(sent(b, 'instructions')).toBeTruthy()
    expect(textOf(b, 'where')).toContain('working on Book 1, at Book 1, Ch 3, Sc 1')
  })

  it('sends the entries the question names, in full as of the open scene, in the order it names them', () => {
    const b = brief('What would Tobin do if Mara lied to him?', 'b1', 'b1.c3.s1')
    const named = textOf(b, 'named')
    expect(named).toContain('### Tobin (character)')
    expect(named).toContain('### Mara (character)')
    expect(named.indexOf('### Tobin')).toBeLessThan(named.indexOf('### Mara'))
    // What has happened by this scene, and what Tobin knows here.
    expect(named).toContain('lost her left hand')
    expect(named).toContain('Mara is the heir to the Reach.')
    expect(sentIds(b)).toEqual(expect.arrayContaining([w.id('mara'), w.id('tobin')]))
    expect(sent(b, 'named')?.entryIds).toEqual([w.id('tobin'), w.id('mara')])
  })

  it('labels a named entry that comes later in this story, and never brings in one from a story this one doesn’t know', () => {
    const b = brief('Who are Wren, Hal and Ilse?', 'b2', 'b2.c1.s1')
    expect(textOf(b, 'named')).toContain(`### Wren (character; ${NOT_YET})`)
    expect(systemOf(b)).not.toMatch(/\bHal\b/)
    expect(systemOf(b)).not.toContain('Ilse')
    expect(sentIds(b)).not.toContain(w.id('hal'))
    expect(sentIds(b)).not.toContain(w.id('ilse'))
  })

  it('adds what the search finds for the question’s words', () => {
    const b = brief('Who looks after the ferry these days?', 'b1', 'b1.c3.s1')
    expect(textOf(b, 'named')).toBe('')
    expect(textOf(b, 'related')).toContain('### Tobin (character)')
    expect(sentIds(b)).toContain(w.id('tobin'))
  })

  it('lists everything else in the memory a line each, so any of it can be named', () => {
    const b = brief('What should happen next?', 'b1', 'b1.c3.s1')
    const catalogue = textOf(b, 'catalogue')
    expect(catalogue).toContain('- Harrow Mill')
    expect(catalogue).toContain('- Tobin: A ferryman.')
  })
})

describe('stories that are not one series', () => {
  it('never lets a what-if’s own events reach another story’s chat', () => {
    for (const story of ['b1', 'b2', 'other']) {
      const s = systemOf(brief('How is Mara doing?', story))
      expect(s, story).not.toContain('learned to fight with both hands')
    }
    expect(systemOf(brief('How is Mara doing?', 'b1'))).toContain('lost her left hand')
  })

  it('answers a what-if from its own point of view: its own events, not the main book’s later ones', () => {
    const b = brief('How is Mara doing?', 'keep')
    const s = systemOf(b)
    expect(s).toContain('learned to fight with both hands')
    expect(s).not.toContain('lost her left hand')
    expect(s).toContain('Mara Keeps Her Hand is an own version of events')
    expect(b.label).toBe('End of Mara Keeps Her Hand')
  })

  it('only names an entry from a main book’s later chapters, seen from a what-if or a prequel', () => {
    const v = dbWorld()
    const sable = repo.createEntry(
      v.db,
      'character',
      { name: 'Sable Thorn', description: 'Betrays the Duke at the weir.' },
      { origin: 'adam', originStoryId: v.id('b1') }
    )
    // First in Book 1, Ch 3: past where the what-if leaves Book 1, and after the prequel is over.
    mem.setDefaultExistsPoints(v.db, sable.id, [{ kind: 'scene', storyId: v.id('b1'), sceneId: v.id('b1.c3.s1') }])
    const places: [string, string | null][] = [
      ['keep', null],
      ['keep', 'keep.c1.s1'],
      ['ym', null]
    ]
    for (const [story, scene] of places) {
      const b = briefIn(v, 'Who is Sable Thorn?', story, scene)
      expect(textOf(b, 'named'), story).toBe('### Sable Thorn (character; from Book 1, not in this story so far)')
      expect(systemOf(b), story).not.toContain('Betrays the Duke')
    }
    // Earlier in Book 1 itself, it comes later in this very story: sent in full, labelled so.
    const early = textOf(briefIn(v, 'Who is Sable Thorn?', 'b1', 'b1.c1.s1'), 'named')
    expect(early).toContain(`### Sable Thorn (character; ${NOT_YET})`)
    expect(early).toContain('Betrays the Duke at the weir.')
  })

  it('knows what an own version is, and what follows on from one', () => {
    const shape = loadShape(w.db)
    expect(standsAlone(shape, w.id('keep'))).toBe(true)
    expect(standsAlone(shape, w.id('other'))).toBe(true)
    expect(standsAlone(shape, w.id('b2'))).toBe(false)
    expect(standsAlone(shape, null)).toBe(false)
  })

  it('with no story open, answers from the world as it was set up', () => {
    const b = brief('Who is Mara?', null)
    expect(textOf(b, 'where')).toContain('No story is open')
    expect(textOf(b, 'named')).toContain("A smith's daughter with a quick temper.")
    expect(systemOf(b)).not.toContain('lost her left hand')
    expect(b.label).toBe('The world as it was set up')
  })
})

describe('the conversation so far', () => {
  const turn = (i: number, words = 3): PastTurn => ({
    question: `Question ${i}?`,
    answer: `${'An answer that goes on. '.repeat(words)}End of answer ${i}.`
  })

  it('sends the earlier turns as messages, oldest first, before the question', () => {
    const b = brief('And then?', 'b1', 'b1.c3.s1', [turn(1), turn(2)])
    expect(b.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user'])
    expect(b.messages[1].content).toBe('Question 1?')
    expect(b.messages[4].content).toContain('End of answer 2.')
    expect(b.turnsSent).toBe(2)
  })

  it(`keeps at most the last ${MAX_TURNS} turns, and fewer when the model can't read them all`, () => {
    const many = Array.from({ length: 20 }, (_, i) => turn(i + 1))
    const all = brief('And then?', 'b1', 'b1.c3.s1', many)
    expect(all.turnsSent).toBe(MAX_TURNS)
    expect(all.messages[1].content).toBe(`Question ${20 - MAX_TURNS + 1}?`)

    const long = Array.from({ length: 10 }, (_, i) => turn(i + 1, 300))
    const small = brief('And then?', 'b1', 'b1.c3.s1', long, 9000)
    expect(small.turnsSent).toBeGreaterThan(0)
    expect(small.turnsSent).toBeLessThan(10)
    // The latest turns are the ones kept, and the question still closes the messages.
    const users = small.messages.filter((m) => m.role === 'user').map((m) => m.content)
    expect(users.at(-2)).toBe('Question 10?')
    expect(users.at(-1)).toBe('And then?')
    expect(sent(small, 'instructions')).toBeTruthy()
    expect(sent(small, 'where')).toBeTruthy()
  })

  it('leaves out a turn that has no answer', () => {
    const b = brief('And then?', 'b1', 'b1.c3.s1', [{ question: 'Lost?', answer: '' }, turn(2)])
    expect(b.messages.map((m) => m.content)).not.toContain('Lost?')
  })

  it('remembers who an earlier turn was about, and says so', () => {
    const earlier: PastTurn[] = [{ question: 'Tell me about Mara.', answer: 'Mara is quick to anger.' }]
    const b = brief('What would she do next?', 'b1', 'b1.c3.s1', earlier)
    expect(sent(b, 'named')?.entryIds).toContain(w.id('mara'))
    expect(sent(b, 'named')?.title).toBe('Named earlier in this chat')
    expect(textOf(b, 'named')).toContain(`### Mara (character; ${EARLIER})`)

    // With one the question names too, each says where it was named.
    const both = brief('Would Tobin help her?', 'b1', 'b1.c3.s1', earlier)
    expect(sent(both, 'named')?.title).toBe('Named in the question or earlier in this chat')
    expect(textOf(both, 'named')).toContain('### Tobin (character)\n')
    expect(textOf(both, 'named')).toContain(`### Mara (character; ${EARLIER})`)
    expect(sent(both, 'named')?.entryIds).toEqual([w.id('tobin'), w.id('mara')])
    expect(sent(brief('Would Tobin help?', 'b1', 'b1.c3.s1'), 'named')?.title).toBe('Named in the question')
  })
})

describe('the words searched for', () => {
  it('keeps the words that say what the question is about', () => {
    expect(searchTerms('Did I already say how old the Duke is?')).toEqual(['duke'])
    expect(searchTerms('Give me ten tavern names that fit the north')).toEqual(['tavern', 'north'])
    expect(searchTerms("What would Mara's brother do?")).toEqual(['mara', 'brother'])
  })
})

describe('what Adam keeps out', () => {
  it('leaves an entry kept out of a story out of its chats, unless the question names it', () => {
    const v = dbWorld()
    mem.setPin(v.db, v.id('tobin'), 'story', v.id('b1'), 'hide')
    const oath = repo.createEntry(v.db, 'lore', {
      name: 'The Iron Oath',
      description: 'No oath sworn on iron is ever broken.',
      hardRule: true
    })
    mem.setPin(v.db, oath.id, 'story', v.id('b1'), 'hide')

    for (const question of ['How is Mara doing?', 'What should happen next?', 'Who looks after the ferry these days?']) {
      const b = briefIn(v, question, 'b1', 'b1.c3.s1')
      // Not in the list of everything else, nor in Mara's ties, nor as a world rule.
      expect(systemOf(b), question).not.toMatch(/\bTobin\b/)
      expect(systemOf(b), question).not.toContain('Iron Oath')
      expect(sentIds(b), question).not.toContain(v.id('tobin'))
      expect(sentIds(b), question).not.toContain(oath.id)
    }

    // Asked about by name, he comes in after all.
    const asked = briefIn(v, 'What would Tobin do now?', 'b1', 'b1.c3.s1')
    expect(textOf(asked, 'named')).toContain('### Tobin (character)')
    // Book 1's pin doesn't reach another story.
    const b2 = briefIn(v, 'What should happen next?', 'b2')
    expect(textOf(b2, 'catalogue')).toMatch(/\bTobin\b/)
    expect(textOf(b2, 'world-rules')).toContain('No oath sworn on iron is ever broken.')
  })
})

describe('the briefing for an answer that may use tools', () => {
  it("is fitted into less, keeping room for the tools' results", () => {
    const db = memoryWorld()
    const [story] = repo.listStories(db)
    const input = { question: 'Who keeps the inn?', storyId: story.id, sceneId: null, turns: [], prefs: defaultWritingPrefs(), contextLength: 32000 }
    const plain = assembleAsk(db, input, countRaw)
    const tools = assembleAsk(db, { ...input, withTools: true }, countRaw)
    expect(tools.budget.reserved).toBe(plain.budget.reserved + 6400)
    expect(tools.budget.available).toBe(plain.budget.available - 6400)
  })
})

describe('a hard rule of the world', () => {
  it('is always sent', () => {
    const db = memoryWorld()
    repo.createEntry(db, 'lore', { name: 'No magic', description: 'Nobody can work magic.', hardRule: true })
    const [story] = repo.listStories(db)
    const b = assembleAsk(
      db,
      { question: 'Could she fly?', storyId: story.id, sceneId: null, turns: [], prefs: defaultWritingPrefs(), contextLength: null },
      countRaw
    )
    expect(b.blocks.find((x) => x.id === 'world-rules' && !x.dropped)?.text).toContain('Nobody can work magic.')
  })
})
