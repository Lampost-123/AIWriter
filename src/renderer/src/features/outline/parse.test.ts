import { describe, expect, it } from 'vitest'
import { outlineCounts, outlineScenes, parseIdeas, parseOutline, threadNames, type ParsedOutline } from './parse'
import { outlineReply } from '../../../../../tests/fake-provider/m4/outline.mjs'

const TIDY = `# Act: The Arrival
Purpose: Mara reaches the city and learns what the guild wants of her.

## Chapter: Rain on the Narrows
Goal: Mara finds her footing in the city.

### Scene: Arrival at the docks
Summary: Mara arrives at the docks and finds it watched.
- Mara comes in out of the rain
- She spots the guild's watcher
- She slips away before he follows

### Scene: A bargain at the docks
Summary: Tobin offers Mara a deal.
- Tobin names his price
- Mara haggles and loses

# Act: The Turning
Purpose: Her loyalties split.

## Chapter: Lanterns at Low Tide
Goal: Mara follows the trail to the market.

### Scene: Pursuit through the market
Summary: The guild chases Mara.
- A shout behind her
`

/** A compact picture of a parsed outline: one line per act, chapter and scene, "?" for not complete. */
function show(o: ParsedOutline): string[] {
  const lines: string[] = []
  const chapter = (c: ParsedOutline['chapters'][number], pad: string): void => {
    lines.push(`${pad}${c.key} ${c.title} | ${c.goal}${c.complete ? '' : ' ?'}`)
    for (const s of c.scenes) lines.push(`${pad}  ${s.key} ${s.title} | ${s.summary} | ${s.beats.join('; ')}${s.complete ? '' : ' ?'}`)
  }
  for (const c of o.chapters) chapter(c, '')
  for (const a of o.acts) {
    lines.push(`${a.key} ${a.title} | ${a.purpose}${a.complete ? '' : ' ?'}`)
    for (const c of a.chapters) chapter(c, '  ')
  }
  return lines
}

describe('reading an outline', () => {
  it('reads the form the AI is asked for', () => {
    expect(show(parseOutline(TIDY, true))).toEqual([
      'a0 The Arrival | Mara reaches the city and learns what the guild wants of her.',
      '  a0c0 Rain on the Narrows | Mara finds her footing in the city.',
      "    a0c0s0 Arrival at the docks | Mara arrives at the docks and finds it watched. | Mara comes in out of the rain; She spots the guild's watcher; She slips away before he follows",
      '    a0c0s1 A bargain at the docks | Tobin offers Mara a deal. | Tobin names his price; Mara haggles and loses',
      'a1 The Turning | Her loyalties split.',
      '  a1c0 Lanterns at Low Tide | Mara follows the trail to the market.',
      '    a1c0s0 Pursuit through the market | The guild chases Mara. | A shout behind her'
    ])
    expect(outlineCounts(parseOutline(TIDY, true))).toEqual({ acts: 2, chapters: 2, scenes: 3 })
  })

  it('reads the plot threads a scene sets up and pays off, never as its summary or a beat (2026-10-08)', () => {
    const reply = `## Chapter: Rain
Goal: Mara finds her footing.

### Scene: The bell
When: Day 1, dusk
Summary: The bell rings over the marsh.
Sets up: Who rang the drowned bell; The ferryman's debt
- Mara hears the bell
- She finds the tower barred

### Scene: The ferry
Pays off: who rang the drowned bell
- **Sets up:** none
- The ferryman confesses`
    const [first, second] = parseOutline(reply, true).chapters[0].scenes
    expect(first).toMatchObject({ summary: 'The bell rings over the marsh.', setsUp: ['Who rang the drowned bell', "The ferryman's debt"] })
    expect(first.beats).toEqual(['Mara hears the bell', 'She finds the tower barred'])
    expect(first.paysOff).toBeUndefined()
    expect(second).toMatchObject({ paysOff: ['who rang the drowned bell'], setsUp: [], beats: ['The ferryman confesses'] })
    expect(threadNames('A, B')).toEqual(['A', 'B'])
    expect(threadNames('None.')).toEqual([])
  })

  it('marks only what has fully arrived as complete while the reply is still coming', () => {
    const cut = TIDY.slice(0, TIDY.indexOf('- Mara haggles'))
    expect(show(parseOutline(cut, false))).toEqual([
      'a0 The Arrival | Mara reaches the city and learns what the guild wants of her. ?',
      '  a0c0 Rain on the Narrows | Mara finds her footing in the city. ?',
      "    a0c0s0 Arrival at the docks | Mara arrives at the docks and finds it watched. | Mara comes in out of the rain; She spots the guild's watcher; She slips away before he follows",
      '    a0c0s1 A bargain at the docks | Tobin offers Mara a deal. | Tobin names his price ?'
    ])
    // Stopped there: what arrived is kept, and all of it can be kept.
    expect(show(parseOutline(cut, true)).some((l) => l.endsWith('?'))).toBe(false)
  })

  it('keeps the same keys as the reply grows', () => {
    const early = outlineScenes(parseOutline(TIDY.slice(0, 400), false)).map((s) => s.key)
    const whole = outlineScenes(parseOutline(TIDY, true)).map((s) => s.key)
    expect(whole.slice(0, early.length)).toEqual(early)
  })

  it('reads chapters with no acts', () => {
    const o = parseOutline(
      '## Chapter: One\nGoal: First.\n\n### Scene: A\nSummary: Happens.\n- Beat\n\n## Chapter: Two\n### Scene: B\n- Beat',
      true
    )
    expect(o.acts).toEqual([])
    expect(show(o)).toEqual(['c0 One | First.', '  c0s0 A | Happens. | Beat', 'c1 Two | ', '  c1s0 B |  | Beat'])
  })

  it('reads a chatty reply with numbered, bold and quoted headings, "*" bullets and labels in bold', () => {
    const messy = [
      'Sure! Here is a possible outline for the story:',
      '',
      '**Act 1: The Arrival**',
      '*Purpose:* Mara reaches the city.',
      '',
      '## Chapter 1 – Rain on the Narrows',
      '**Goal:** Mara finds her footing.',
      '',
      '### Scene 1: "Arrival at the docks"',
      'Mara arrives at the docks and finds it watched.',
      '* Mara comes in out of the rain',
      '* She spots the watcher',
      '',
      'Act Two — The Turning',
      'Her loyalties split.',
      'Chapter 2: Lanterns',
      'Scene 1 - The market',
      'Beats:',
      '1. A shout behind her',
      '2. She doubles back',
      '',
      'Let me know if you would like more scenes or a different ending.'
    ].join('\n')
    expect(show(parseOutline(messy, true))).toEqual([
      'a0 The Arrival | Mara reaches the city.',
      '  a0c0 Rain on the Narrows | Mara finds her footing.',
      '    a0c0s0 Arrival at the docks | Mara arrives at the docks and finds it watched. | Mara comes in out of the rain; She spots the watcher',
      'a1 The Turning | Her loyalties split.',
      '  a1c0 Lanterns | ',
      '    a1c0s0 The market |  | A shout behind her; She doubles back'
    ])
  })

  it('reads the fake provider’s messy reply as it reads its tidy one', () => {
    const ask = (premise: string) => [
      {
        role: 'user',
        content: `${premise}\n## What to suggest\nSuggest 2 new acts with 3 chapters in all, spread across them, and 2 scenes in each chapter.`
      }
    ]
    const tidy = parseOutline(outlineReply('[AIWRITE-OUTLINE v1] outline', ask(''), '') as string, true)
    const messy = parseOutline(outlineReply('[AIWRITE-OUTLINE v1] outline', ask('[[fake: messy]]'), '') as string, true)
    expect(show(messy)).toEqual(show(tidy))
    expect(outlineCounts(tidy)).toEqual({ acts: 2, chapters: 3, scenes: 6 })
    const whens = (o: ParsedOutline): string[] => outlineScenes(o).map((sc) => sc.when)
    expect(whens(tidy)).toEqual(['Day 1, morning', 'Day 1, midday', 'Day 2, morning', 'Day 2, midday', 'Day 3, morning', 'Day 3, midday'])
    expect(whens(messy)).toEqual(whens(tidy))
  })

  it('reads each scene’s When, in whatever form it comes, and never takes it for the summary, a goal or a beat', () => {
    const o = parseOutline(
      [
        '## Chapter: Rain',
        'When: Day 9',
        '### Scene: Docks',
        'When: Day 1, morning',
        'Summary: Mara lands.',
        '- She comes in',
        '### Scene: Ferry',
        '**When:** Day 1, dusk',
        'Tobin offers a deal.',
        '- He names his price',
        '### Scene: Tower',
        '- When: Day 2, night',
        '- She climbs',
        '### Scene: Gate',
        'Mara leaves.',
        '- When the bell rings, she runs'
      ].join('\n'),
      true
    )
    expect(show(o)).toEqual([
      'c0 Rain | ',
      '  c0s0 Docks | Mara lands. | She comes in',
      '  c0s1 Ferry | Tobin offers a deal. | He names his price',
      '  c0s2 Tower |  | She climbs',
      '  c0s3 Gate | Mara leaves. | When the bell rings, she runs'
    ])
    expect(outlineScenes(o).map((sc) => sc.when)).toEqual(['Day 1, morning', 'Day 1, dusk', 'Day 2, night', ''])
  })

  it('leaves out code fences and rules, ignores prose that only starts with "Act" or "Scene", and names untitled headings', () => {
    const o = parseOutline(
      [
        '```',
        '# Act 2',
        'Acting on a tip, Mara goes north.',
        '---',
        '## Chapter 4',
        'Scene shifts are fine in prose.',
        '### Scene',
        '- One',
        '```'
      ].join('\n'),
      true
    )
    expect(show(o)).toEqual([
      'a0 Act 2 | Acting on a tip, Mara goes north.',
      '  a0c0 Chapter 4 | Scene shifts are fine in prose.',
      '    a0c0s0  |  | One'
    ])
  })

  it('reads scenes written as list items under a chapter, with what happens after the title', () => {
    const o = parseOutline(
      [
        '## Chapter 1: Rain on the Narrows',
        'Goal: Mara finds her footing.',
        '- **Scene 1: Docks** — Mara lands.',
        '- **Scene 2: The bargain** — Tobin offers a deal.',
        '  - Tobin names his price',
        '  - Mara haggles and loses',
        '- Scene 3: Pursuit through the market - The guild chases her.',
        '## Chapter 2: Lanterns',
        '1. Scene: The market — Mara runs.',
        '2. Act fast: she grabs the ledger',
        '- Scene shifts to the bridge'
      ].join('\n'),
      true
    )
    expect(show(o)).toEqual([
      'c0 Rain on the Narrows | Mara finds her footing.',
      '  c0s0 Docks | Mara lands. | ',
      '  c0s1 The bargain | Tobin offers a deal. | Tobin names his price; Mara haggles and loses',
      '  c0s2 Pursuit through the market | The guild chases her. | ',
      'c1 Lanterns | ',
      '  c1s0 The market | Mara runs. | Act fast: she grabs the ledger; Scene shifts to the bridge'
    ])
  })

  it('reads acts and chapters written as list items too', () => {
    const o = parseOutline(
      [
        '- **Act 1: The Arrival** — Mara reaches the city.',
        '  - **Chapter 1: Rain** — She finds her footing.',
        '    - **Scene 1: Docks**'
      ].join('\n'),
      true
    )
    expect(show(o)).toEqual(['a0 The Arrival | Mara reaches the city.', '  a0c0 Rain | She finds her footing.', '    a0c0s0 Docks |  | '])
  })

  it('reads dotted and long numbers, a prologue and an epilogue, and titles on a line of their own', () => {
    const o = parseOutline(
      [
        '## Prologue',
        'Title: The Drowned Bell',
        'Goal: The bell is lost.',
        '### Scene 0.1: The river takes it',
        '- The bell falls',
        '# Act One',
        '**Title:** The Arrival',
        '**Purpose:** Mara reaches the city.',
        '## Chapter Twenty-One',
        '**Rain on the Narrows**',
        '**Goal**',
        'Mara finds her footing.',
        '### Scene 1.1 – Arrival at the docks',
        '**Summary:** Mara lands.',
        '**Beats:**',
        '- She lands',
        '### Scene 1.2',
        'Title: A bargain',
        'Tobin offers a deal.',
        '## Epilogue: After the Thaw',
        '### Scene: Spring'
      ].join('\n'),
      true
    )
    expect(show(o)).toEqual([
      'c0 Prologue: The Drowned Bell | The bell is lost.',
      '  c0s0 The river takes it |  | The bell falls',
      'a0 The Arrival | Mara reaches the city.',
      '  a0c0 Rain on the Narrows | Mara finds her footing.',
      '    a0c0s0 Arrival at the docks | Mara lands. | She lands',
      '    a0c0s1 A bargain | Tobin offers a deal. | ',
      '  a0c1 Epilogue: After the Thaw | ',
      '    a0c1s0 Spring |  | '
    ])
  })

  it('names an untitled heading by its number, and takes a "Prologue" in a list only in bold, so a beat may start with one', () => {
    expect(show(parseOutline('## Chapter Twenty-One\n### Scene 2.3\n- Beat', true))).toEqual([
      'c0 Chapter Twenty-one | ',
      '  c0s0 Scene 2.3 |  | Beat'
    ])
    const o = parseOutline(
      ['- **Prologue** — The bell is lost.', '  - **Scene 1: The river**', '    - Interlude: a quiet moment on the water'].join('\n'),
      true
    )
    expect(show(o)).toEqual(['c0 Prologue | The bell is lost.', '  c0s0 The river |  | Interlude: a quiet moment on the water'])
  })

  it('reads a line starting "Act fast:" as what happens, not as an act', () => {
    const o = parseOutline('### Scene: The ledger\nAct fast: she grabs the ledger and runs.\n- She runs', true)
    expect(show(o)).toEqual(['c0 Chapter 1 | ', '  c0s0 The ledger | Act fast: she grabs the ledger and runs. | She runs'])
  })

  it('gives a scene with no chapter heading a chapter of its own', () => {
    const o = parseOutline('### Scene: Alone\n- Beat', true)
    expect(show(o)).toEqual(['c0 Chapter 1 | ', '  c0s0 Alone |  | Beat'])
  })

  it('reads nothing from a reply with no headings', () => {
    expect(parseOutline('I am sorry, I cannot help with that.', true)).toEqual({ acts: [], chapters: [] })
    expect(parseOutline('', false)).toEqual({ acts: [], chapters: [] })
  })
})

describe('reading next scene ideas', () => {
  const IDEAS = `## 1. The door left open
Mara finds the guild house unguarded.
- Mara finds the side door unlatched
- She overhears Tobin

## 2. A debt called in
Tobin calls in the favour.
- Tobin waits at the ferry

## 3. The wrong messenger
A child brings a message.
- A soaked child presses a note into her hand
`

  it('reads three directions with a line on what happens and their beats', () => {
    expect(parseIdeas(IDEAS, true)).toEqual([
      {
        title: 'The door left open',
        summary: 'Mara finds the guild house unguarded.',
        beats: ['Mara finds the side door unlatched', 'She overhears Tobin'],
        complete: true
      },
      { title: 'A debt called in', summary: 'Tobin calls in the favour.', beats: ['Tobin waits at the ferry'], complete: true },
      {
        title: 'The wrong messenger',
        summary: 'A child brings a message.',
        beats: ['A soaked child presses a note into her hand'],
        complete: true
      }
    ])
  })

  it('marks the one still arriving', () => {
    const ideas = parseIdeas(IDEAS.slice(0, IDEAS.indexOf('Tobin calls')), false)
    expect(ideas.map((i) => [i.title, i.complete])).toEqual([
      ['The door left open', true],
      ['A debt called in', false]
    ])
  })

  it('reads other ways of numbering them, and never more than three', () => {
    const text = [
      'Here are three directions:',
      '**1. The door**',
      'Summary: She goes in.',
      '- Door',
      'Option 2: The debt',
      'What happens: Tobin asks.',
      '* Ferry',
      '### Idea 3 — The messenger',
      'A child comes.',
      '1. Note',
      '2. Raid',
      '## 4. Too many',
      'Extra.'
    ].join('\n')
    expect(parseIdeas(text, true)).toEqual([
      { title: 'The door', summary: 'She goes in.', beats: ['Door'], complete: true },
      { title: 'The debt', summary: 'Tobin asks.', beats: ['Ferry'], complete: true },
      { title: 'The messenger', summary: 'A child comes.', beats: ['Note', 'Raid'], complete: true }
    ])
  })

  it('reads ideas numbered with no “##”, telling them from numbered beats', () => {
    const text = [
      'Here are three directions for the scene:',
      '',
      '1. The door left open',
      'Mara finds the guild house unguarded.',
      '- Mara finds the side door unlatched',
      '- She overhears Tobin',
      '',
      '2. A debt called in — Tobin calls in the favour.',
      '1. Tobin waits at the ferry',
      '2. He names the job',
      '3. Mara says yes',
      '',
      '3. **The wrong messenger**',
      'A child brings a message.',
      '- A soaked child presses a note into her hand'
    ].join('\n')
    expect(parseIdeas(text, true)).toEqual([
      {
        title: 'The door left open',
        summary: 'Mara finds the guild house unguarded.',
        beats: ['Mara finds the side door unlatched', 'She overhears Tobin'],
        complete: true
      },
      {
        title: 'A debt called in',
        summary: 'Tobin calls in the favour.',
        beats: ['Tobin waits at the ferry', 'He names the job', 'Mara says yes'],
        complete: true
      },
      {
        title: 'The wrong messenger',
        summary: 'A child brings a message.',
        beats: ['A soaked child presses a note into her hand'],
        complete: true
      }
    ])
    // While it arrives, the one being written is not complete yet.
    const cut = text.slice(0, text.indexOf('2. He names'))
    expect(parseIdeas(cut, false).map((i) => [i.title, i.beats.length, i.complete])).toEqual([
      ['The door left open', 2, true],
      ['A debt called in', 1, false]
    ])
  })

  it('reads ideas whose titles are on a line of their own, and labels in bold as labels', () => {
    const text = [
      '### Idea 1',
      '**Title:** The door left open',
      '**Summary:** Mara finds the guild house unguarded.',
      '**Beats:**',
      '- The side door is unlatched',
      '### Option 2',
      '**A debt called in**',
      '**What happens**',
      'Tobin calls in the favour.',
      '- Tobin waits at the ferry',
      'Title: The wrong messenger',
      'Summary: A child brings a message.',
      'Beats: A note; A raid'
    ].join('\n')
    expect(parseIdeas(text, true)).toEqual([
      {
        title: 'The door left open',
        summary: 'Mara finds the guild house unguarded.',
        beats: ['The side door is unlatched'],
        complete: true
      },
      { title: 'A debt called in', summary: 'Tobin calls in the favour.', beats: ['Tobin waits at the ferry'], complete: true },
      { title: 'The wrong messenger', summary: 'A child brings a message.', beats: ['A note', 'A raid'], complete: true }
    ])
  })

  it('reads the fake provider’s ideas', () => {
    const ideas = parseIdeas(outlineReply('[AIWRITE-OUTLINE v1] ideas', [], '') as string, true)
    expect(ideas.map((i) => [i.title, i.beats.length])).toEqual([
      ['The door left open', 4],
      ['A debt called in', 4],
      ['The wrong messenger', 4]
    ])
  })
})
