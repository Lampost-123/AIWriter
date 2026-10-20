// chat-truth Phase 3 (tasks 11-16): the truth check's wider catch, narrower exemptions, claims matched to what each
// proposal changes, backed claims said as waiting, and claims about earlier answers checked against what Adam did.
// Invented words only.
import { describe, expect, it } from 'vitest'
import { changeClaims, claimsUnmade, settleAnswer, unbackedClaims } from './askTruth'

const claims = (s: string): boolean => changeClaims(s).length > 0

describe('changeClaims: the wider catch (the audit’s misses)', () => {
  it('catches every wording the audit found slipping through', () => {
    for (const s of [
      'The plan now reads: Mara crosses at dusk.',
      'Updated: the goal now says she must find the key.',
      '## Changes made',
      '**Changes made**',
      '**Updated scene card**',
      'Here’s what I did:',
      'Summary of edits:',
      '- Changed mood from calm to dread',
      'Plan updated.',
      'Scene card updated.',
      'Beats updated!',
      'The beats are updated.',
      'Your chapter plan is updated.',
      'The goal has been updated.',
      'Okay — updated the chapter plan.',
      'Made the changes to the chapter plan.',
      'I’ve revamped the opening.',
      'I’ve reworked the second beat.',
      'I overhauled the chapter plan.',
      'I’ve streamlined the dialogue.',
      'I’ve condensed the ending.',
      'I’ve refined the goal.',
      'I’ve incorporated your notes into the card.',
      'I’ve written a new opening.',
      'I wrote a tighter ending.',
      'I’ve drafted the next scene.',
      'I’ve rearranged the beats.',
      'I’ve shifted the reveal to the end.',
      'I’ve planned chapter 3 around the flood.',
      'I’ve set the goal: find the key.',
      'Ive updated the card.',
      'The chapter card now has a clearer goal.',
      'Beat 3 now reads: she finds the letter.',
      'Your scene now opens with the gulls.',
      'The edit is in.',
      'The changes are in place.',
      'Revised the beats as you asked.',
      'The opening was revised as you asked.'
    ])
      expect(claims(s), s).toBe(true)
  })

  it('catches the hand-overs that name plans, cards and beats', () => {
    for (const s of ['Revised chapter plan:', 'New scene card:', 'Here is the updated chapter plan:', 'Here’s your new beat list:']) expect(claims(s), s).toBe(true)
  })

  it('still leaves suggestions, ready changes, story people and quotes alone', () => {
    for (const s of [
      'I suggest changing the goal to finding the key.',
      'You could update the mood to dread.',
      'Mara changed her plan.',
      'Tobin reworked the ledger before dawn.',
      '“I’ve changed,” she said.',
      'She wrote to her sister.',
      'The scene is set at the ferry.',
      'Earlier in the story the reveal comes too soon.',
      'The typo is in the second line.'
    ])
      expect(claims(s), s).toBe(false)
    // These are claims only of something ready, never of something made.
    for (const s of ['Here’s a change you can apply:', 'Change 1 is ready to apply.']) expect(changeClaims(s).every((c) => !c.made), s).toBe(true)
  })

  it('names the new targets: plans, goals, chapter cards, beats and threads', () => {
    const t = (s: string) => changeClaims(s)[0]?.target ?? null
    expect(t('I’ve updated the chapter plan.')).toBe('chapterCard')
    expect(t('I’ve updated the chapter card.')).toBe('chapterCard')
    expect(t('I’ve rewritten the beats.')).toBe('beats')
    expect(t('I’ve updated the scene card.')).toBe('card')
    expect(t('I’ve changed the goal.')).toBe('card')
    expect(t('I’ve linked the thread to this scene.')).toBe('thread')
    expect(t('I’ve updated the outline.')).toBe('plan')
  })
})

describe('changeClaims: narrower exemptions', () => {
  it('“earlier” marks only a sentence about an earlier answer', () => {
    expect(claims('I’ve moved the reveal earlier.')).toBe(true)
    expect(changeClaims('I’ve moved the reveal earlier.')[0].earlier).toBe(false)
    for (const s of ['As I changed earlier, the opening is tighter.', 'In my last answer I updated the scene card.', 'Earlier in our talk I rewrote the opening.'])
      expect(changeClaims(s)[0]?.earlier, s).toBe(true)
  })
  it('“you” no longer cancels a passive claim; the writer’s own changes still aren’t claims', () => {
    expect(claims('The card has been revised as you asked.')).toBe(true)
    expect(claims('You’ve updated her entry since, so it now says green.')).toBe(false)
  })
})

describe('target matching: a claim must match what was proposed, not just its kind', () => {
  const card = (scene: number) => ({ kind: 'card', id: '1', sceneLabel: `Ch 1, Sc ${scene}` }) as never
  it('a claim naming scenes 4 and 5 with only scene 4 proposed is unbacked', () => {
    expect(unbackedClaims('I’ve updated the cards for scenes 4 and 5.', [card(4)])).toHaveLength(1)
    expect(unbackedClaims('I’ve updated the card for scene 4.', [card(4)])).toHaveLength(0)
    expect(unbackedClaims('I’ve updated the card for scene 5.', [card(4)])).toHaveLength(1)
    expect(unbackedClaims('I’ve updated the card for Ch 1, Sc 4.', [card(4)])).toHaveLength(0)
  })
  it('a chapter or an entry named must be the one proposed', () => {
    const ch = { kind: 'chapterCard', id: '1', chapterLabel: 'Ch 2 “Low Water”' } as never
    expect(unbackedClaims('I’ve updated the chapter card for chapter 2.', [ch])).toHaveLength(0)
    expect(unbackedClaims('I’ve updated the chapter card for chapter 3.', [ch])).toHaveLength(1)
    const mara = { kind: 'entry', id: '1', name: 'Mara Venn' } as never
    expect(unbackedClaims('I’ve updated Mara’s entry.', [mara])).toHaveLength(0)
    expect(unbackedClaims('I’ve updated Tobin’s entry.', [mara])).toHaveLength(1)
  })
  it('a scene card claim is not backed by a chapter card, nor a chapter card by a scene card', () => {
    expect(claimsUnmade('I’ve updated the scene card.', [{ kind: 'chapterCard' }])).toBe(true)
    expect(claimsUnmade('I’ve updated the chapter card.', [{ kind: 'card' }])).toBe(true)
    expect(claimsUnmade('I’ve rewritten the beats.', [{ kind: 'beats' }])).toBe(false)
    expect(claimsUnmade('I’ve rewritten the beats.', [{ kind: 'card' }])).toBe(false)
  })
  it('a chapter’s goal or length is a chapter card change, backed only by one for that chapter (R5)', () => {
    const t = (s: string) => changeClaims(s)[0]?.target ?? null
    for (const s of ['I’ve updated chapter 3’s goal.', 'I’ve set the length of chapter 3 to 4,000 words.', 'I’ve changed the goal for Ch 3.', 'I’ve updated the chapter goal.'])
      expect(t(s), s).toBe('chapterCard')
    const ch = (n: number) => ({ kind: 'chapterCard', id: '1', chapterLabel: `Ch ${n} “Low Water”` }) as never
    const scene = { kind: 'card', id: '1', sceneLabel: 'Ch 3, Sc 1' } as never
    expect(unbackedClaims('I’ve updated chapter 3’s goal.', [ch(3)])).toHaveLength(0)
    expect(unbackedClaims('I’ve updated chapter 3’s goal.', [ch(2)])).toHaveLength(1)
    expect(unbackedClaims('I’ve updated chapter 3’s goal.', [scene])).toHaveLength(1)
  })
})

describe('settleAnswer: nothing is ever said as made, backed or not', () => {
  const text = [{ kind: 'text', id: '1' }] as never[]
  it('rewords a backed first-person claim as waiting', () => {
    const out = settleAnswer('I’ve tightened the opening.', text)
    expect(out).toBe('Change 1 is ready to apply: tighten the opening.')
    expect(settleAnswer(out, text)).toBe(out)
    expect(settleAnswer('I’ve also cut the last line.', [{ kind: 'text', id: '1' }, { kind: 'cut', id: '2' }] as never[])).toBe(
      'Changes 1 and 2 are ready to apply: cut the last line.'
    )
  })
  it('a backed claim mid-sentence becomes an offer, with a line saying what waits', () => {
    expect(settleAnswer('To fix the pacing, I’ve cut the third paragraph.', [{ kind: 'cut', id: '1' }] as never[])).toBe(
      'Change 1 is ready to apply. Nothing changes until you press Apply.\n\nTo fix the pacing, I’d cut the third paragraph.'
    )
  })
  it('leaves true words alone: proposed, ready, waiting', () => {
    for (const s of ['I’ve proposed a tighter opening as change 1.', 'Change 1 is ready to apply.', 'Here’s a change you can apply: a tighter opening.'])
      expect(settleAnswer(s, text), s).toBe(s)
  })
  it('a backed "Done." goes, "now reads" becomes "would read", and a line says what waits', () => {
    expect(settleAnswer('Done! The plan now reads: Mara crosses at dusk.', [{ kind: 'chapterCard', id: '1' }] as never[])).toBe(
      'Change 1 is ready to apply. Nothing changes until you press Apply.\n\nThe plan would read: Mara crosses at dusk.'
    )
  })
  it('edge case 1: scene 4 proposed, scenes 4 and 5 claimed → put right', () => {
    expect(settleAnswer('I’ve updated the cards for scenes 4 and 5.', [{ kind: 'card', id: '1', sceneLabel: 'Ch 1, Sc 4' }] as never[])).toBe(
      'Only change 1 is ready to apply; nothing else was changed.\n\nI’d update the cards for scenes 4 and 5.'
    )
  })
  it('edge case 5: a claim about an earlier change is true only when that change was applied', () => {
    const answer = 'As I changed earlier, the opening is tighter.'
    expect(settleAnswer(answer, [], { earlier: [{ kind: 'text', id: '1', status: 'applied' }] as never[] })).toBe(answer)
    expect(settleAnswer(answer, [], { earlier: [{ kind: 'text', id: '1', status: 'pending' }] as never[] })).toBe(
      'That earlier change isn’t in the story: it hasn’t been applied.\n\nAs I suggested earlier, the opening is tighter.'
    )
    expect(settleAnswer(answer, [], { earlier: [{ kind: 'text', id: '1', status: 'declined' }] as never[] })).toBe(
      'That earlier change isn’t in the story: it was turned down.\n\nAs I suggested earlier, the opening is tighter.'
    )
    // Without the earlier answers known, such a sentence is left be (as before).
    expect(settleAnswer(answer, [])).toBe(answer)
  })
  it('edge case 10: quoted lines never count', () => {
    expect(settleAnswer('Her line “I’ve changed” still works.', [])).toBe('Her line “I’ve changed” still works.')
  })
})

describe('“made” with a thing and what it became (chat-truth task A)', () => {
  it('catches “I made the first chapter a betrayal” and “I’ve made the opening punchier”', () => {
    for (const s of [
      'I made the first chapter a betrayal.',
      'I’ve made the opening punchier.',
      'I’ve made scene 3 darker.',
      'I’ve made your ending quieter and colder.',
      'I made the card’s goal sharper.',
      'I’ve made this scene tenser.',
      'I’ve made that line shorter.'
    ])
      expect(claims(s), s).toBe(true)
    expect(changeClaims('I’ve made the opening punchier.')[0].target).toBe('words')
    expect(changeClaims('I’ve made the opening punchier.')[0].made).toBe(true)
  })
  it('leaves “made a note”, “made sure”, “made up”, story people, quotes and offers be', () => {
    for (const s of [
      'I made a note of that.',
      'I made sure the dates line up.',
      'I made up a name for the inn, but only as an idea.',
      'Mara made tea for the crew.',
      'Mara made the first chapter of her diary a lie.',
      'She said “I made the opening punchier” to the editor.',
      'I’d make the opening punchier.',
      'I could make the first chapter a betrayal.',
      'If I made the opening punchier, the pause would go.',
      'I made the mistake of reading it twice.',
      'I made the opening line.',
      'I made it clear that the plan waits for you.'
    ])
      expect(claims(s), s).toBe(false)
  })
})

describe('honestReply: the button’s own name', () => {
  it('says “press Make this change” when the button says so', () => {
    expect(settleAnswer('Done! The plan now reads: Mara crosses at dusk.', [{ kind: 'chapterCard', id: '1' }] as never[], { applyLabel: 'Make this change' })).toBe(
      'Change 1 is ready to apply. Nothing changes until you press Make this change.\n\nThe plan would read: Mara crosses at dusk.'
    )
  })
})

describe('“Done —” before a claim goes with it', () => {
  it('a backed “Done — I’ve updated the chapter card.” is said as waiting, with no “Done” left', () => {
    const out = settleAnswer('Done — I’ve updated the chapter card.', [{ kind: 'chapterCard', id: '1', chapterLabel: 'Ch 3 “Low Water”' }] as never[])
    expect(out).toBe('Change 1 is ready to apply: update the chapter card.')
    expect(changeClaims(out).every((c) => !c.made)).toBe(true)
  })
  it('an unbacked one becomes an offer', () => {
    const out = settleAnswer('All done, I’ve updated the chapter card.', [])
    expect(out).toBe('No change was made, so there’s nothing to apply. Here’s what I’d suggest:\n\nI’d update the chapter card.')
  })
})

describe('what is left after a heading goes', () => {
  it('starts with a capital letter', () => {
    const out = settleAnswer('Here’s what I did: the opening line would read tighter.', [])
    expect(out).toContain('The opening line would read tighter.')
    expect(out).not.toMatch(/\bthe opening line would read/)
  })
})

// Review fixes (2026-10-20): what the reviewer found with real outputs.
describe('review fixes: put right without stray marks or lost meaning', () => {
  const NONE = 'No change was made, so there’s nothing to apply. Here’s what I’d suggest:\n\n'
  const text = (extra: object = {}): never[] => [{ kind: 'text', id: '1', ...extra }] as never[]

  it('a bold heading with its colon inside the marks leaves no marks behind', () => {
    expect(settleAnswer('**Updated plan:**\n1. Mara arrives.', [])).toBe(`${NONE}1. Mara arrives.`)
    expect(settleAnswer('**Changes made:**\n- tighter opening', [])).toBe(`${NONE}- tighter opening`)
    expect(settleAnswer('__New scene card:__ goal: escape', [])).toBe(`${NONE}Goal: escape`)
  })

  it('prose the chat hands over is never read as claims, with or without a proposal', () => {
    const offered = 'Here’s a tighter version you could use:\n\nI moved to the door. I cut the rope and ran. We fixed the cart by dawn.'
    expect(settleAnswer(offered, [])).toBe(offered)
    expect(settleAnswer(offered, text())).toBe(offered)
    const two = 'One way the opening could go:\n\nI moved to the door.\n\nWe fixed the cart by dawn.'
    expect(settleAnswer(two, [])).toBe(two)
  })

  it('a summary heading naming a part is no hand-over: the list under it is read', () => {
    expect(settleAnswer('Changes to the opening:\n- Tightened the first line.\n- Cut the adverbs.', [])).toContain('- Tighten the first line.')
    expect(settleAnswer('For the ending:\n\n- Tightened the last line.', [])).toContain('- Tighten the last line.')
    expect(settleAnswer('Here’s a tighter opening:\n\nI moved to the door.', [])).toBe('Here’s a tighter opening:\n\nI moved to the door.')
  })

  it('the chat speaking again after the prose is read again', () => {
    expect(settleAnswer('Here’s a tighter version you could use:\n\nI moved to the door.\n\nI’ve cut the adverbs.', [])).toBe(
      `${NONE}Here’s a tighter version you could use:\n\nI moved to the door.\n\nI’d cut the adverbs.`
    )
  })

  it('story prose in a quote block, a fenced block or an indented block is never read', () => {
    for (const s of ['> I moved to the door. I cut the rope.', '```\nI moved to the door. I cut the rope.\n```', 'Try this:\n\n    I moved to the door. I cut the rope.'])
      expect(settleAnswer(s, [])).toBe(s)
  })

  it('a backed claim that names nothing it changes is not said as a ready change', () => {
    expect(settleAnswer('I moved to the door.', text())).toBe('Change 1 is ready to apply. Nothing changes until you press Apply.\n\nI’d move to the door.')
  })

  it('an unbacked summary line keeps its suggestion, said plainly', () => {
    expect(settleAnswer('Changes made: tightened the opening and cut the ending.', [])).toBe(`${NONE}Tighten the opening and cut the ending.`)
    expect(settleAnswer('Tightened the opening and trimmed the ending.', [])).toBe(`${NONE}Tighten the opening and trim the ending.`)
    expect(settleAnswer('Made the opening shorter.', [])).toBe(`${NONE}Make the opening shorter.`)
    expect(settleAnswer('Done.\nUpdated the plan.', [])).toBe(`${NONE}Update the plan.`)
  })

  it('straight quotes after *, _ or a comma are quotes', () => {
    for (const s of ['*"I\'ve updated the will,"* she says.', 'She turns to say,"I\'ve updated the will."', '_"I changed the locks,"_ he admits.']) expect(claims(s)).toBe(false)
  })

  it('reported speech and narration are not the chat’s claims', () => {
    for (const s of [
      'In the scene, Mara says I changed the locks last night, which works.',
      'Mara tells him that I moved the boat.',
      'We changed course at dawn, Mara writes in her journal.',
      'I put a lot of thought into the ending, and here is my view.'
    ])
      expect(claims(s)).toBe(false)
    expect(claims('I’ve put the reveal into chapter 3.')).toBe(true)
    expect(claims('I’ve changed the locks scene, as you asked.')).toBe(true)
  })

  it('an earlier claim keeps its meaning when said as a suggestion', () => {
    expect(settleAnswer('In my last answer I updated the plan.', [], { earlier: [{ kind: 'chapterCard', id: '0', status: 'pending' }] as never[] })).toBe(
      'That earlier change isn’t in the story: it hasn’t been applied.\n\nIn my last answer I suggested updating the plan.'
    )
    expect(settleAnswer('In my last answer I cut the last line.', [], { earlier: [{ kind: 'text', id: '0', status: 'pending' }] as never[] })).toBe(
      'That earlier change isn’t in the story: it hasn’t been applied.\n\nIn my last answer I suggested cutting the last line.'
    )
  })

  it('a half-backed claim says what is ready once', () => {
    expect(settleAnswer('I’ve tightened the opening of scene 2 and I’ve updated Mara’s entry.', text({ sceneLabel: 'Ch 1, Sc 2' }))).toBe(
      'Only change 1 is ready to apply; nothing else was changed.\n\nI’d tighten the opening of scene 2 and I’d update Mara’s entry.'
    )
  })

  it('a list of backed changes says they are ready once, then each in plain words', () => {
    expect(settleAnswer('- I cut the last line.\n- I tightened the opening.\n- I reworded the second paragraph.', text())).toBe(
      'Change 1 is ready to apply. Nothing changes until you press Apply.\n\n- Cut the last line.\n- Tighten the opening.\n- Reword the second paragraph.'
    )
    // Each its own change: each says which one is ready.
    expect(
      settleAnswer('- I cut the last line.\n- I tightened the opening of scene 2.', [
        { kind: 'cut', id: '1', sceneLabel: 'Ch 1, Sc 1' },
        { kind: 'text', id: '2', sceneLabel: 'Ch 1, Sc 2' }
      ] as never[])
    ).toContain('- Change 2 is ready to apply: tighten the opening of scene 2.')
  })
})

// Second review (2026-10-20): a hand-over covers the story words it hands over, never the chat's claims after them.
describe('review fixes 2: a hand-over never swallows a claim', () => {
  const NONE = 'No change was made, so there’s nothing to apply. Here’s what I’d suggest:\n\n'
  const text = [{ kind: 'text', id: '1' }] as never[]
  const OPEN = 'Here’s the opening:\n\nThe rain fell.'

  it('a claim after the handed-over words is caught, with no proposal and with only a text one', () => {
    const answers = [
      ...[
        'I updated the scene card too.',
        'Also updated the scene card.',
        'Scene card updated.',
        'And I’ve changed Mara’s entry.',
        'Plus, I tightened the chapter plan.',
        'The scene card has been updated.',
        'Done.'
      ].map((s) => `${OPEN}\n\n${s}`),
      `${OPEN}\nI’ve updated the scene card too.`,
      'My thoughts on the ending line:\n\nThe pacing drags.\n\nI tightened the beats and updated the plan.\n\nAlso cut the last line.'
    ]
    for (const a of answers) {
      expect(changeClaims(a).length, a).toBeGreaterThan(0)
      expect(claimsUnmade(a, []), a).toBe(true)
      expect(settleAnswer(a, text), a).not.toBe(a)
    }
  })

  it('the handed-over words themselves stay as written', () => {
    expect(settleAnswer(`${OPEN}\n\nI updated the scene card too.`, [])).toBe(`${NONE}${OPEN}\n\nI’d update the scene card too.`)
    expect(settleAnswer(`${OPEN}\n\nAlso updated the scene card.`, [])).toBe(`${NONE}${OPEN}\n\nUpdate the scene card.`)
  })

  it('commentary is no hand-over', () => {
    for (const s of ['Notes on the ending line:\n\nI cut the last line.', 'About the ending line:\n\nI cut the last line.'])
      expect(claims(s), s).toBe(true)
  })

  it('“Done.” after a summary line goes', () => {
    expect(settleAnswer('Tightened the opening. Done.', [])).toBe(`${NONE}Tighten the opening.`)
    expect(settleAnswer('Tightened the opening. Done!', text)).not.toContain('Done')
  })

  it('a first-person claim with a second verb is said as one offer', () => {
    expect(settleAnswer('I’ve updated the scene card and rewrote the beats.', [])).toBe(`${NONE}I’d update the scene card and rewrite the beats.`)
  })
})

// Third review (2026-10-20): a pronoun claim after handed-over words, and summary lines that start "Cut", "Merged"…
describe('review fixes 3: pronoun claims and the missing summary verbs', () => {
  const NONE = 'No change was made, so there’s nothing to apply. Here’s what I’d suggest:\n\n'
  const OPEN = 'Here’s the opening:\n\nThe rain fell.'

  it('a first-person edit of “it” or “that” after the handed-over words ends the hand-over and is a claim', () => {
    for (const s of ['I updated it too.', 'I’ve changed that as well.', 'I also tweaked it.', 'I edited this as well.', 'I revised them too.', 'I rewrote it.', 'I adjusted those too.', 'I fixed it too.', 'I updated it to match.', 'I revised it slightly for pace.']) {
      const a = `${OPEN}\n\n${s}`
      expect(changeClaims(a).length, a).toBeGreaterThan(0)
      expect(claimsUnmade(a, []), a).toBe(true)
    }
    expect(settleAnswer(`${OPEN}\n\nI updated it too.`, [])).toBe(`${NONE}${OPEN}\n\nI’d update it too.`)
  })

  it('story narration with story objects stays as written', () => {
    for (const s of [
      'Here’s a tighter version you could use:\n\nI moved to the door. I cut the rope and ran. We fixed the cart by dawn.',
      'One way the opening could go:\n\nI moved to the door.\n\nWe fixed the cart by dawn.',
      `${OPEN}\n\nWe fixed the cart too.`,
      `${OPEN}\n\nThe engine died. I fixed it.`,
      `${OPEN}\n\nI changed it back before she woke.`
    ])
      expect(settleAnswer(s, []), s).toBe(s)
  })

  it('a summary line that starts with “Cut” or another edit verb is a claim', () => {
    for (const s of [
      'Also cut the last line.',
      'The pacing drags. Also cut the last line.',
      'Tightened the opening. Cut the last line.',
      'Merged scenes 2 and 3.',
      'Reordered the beats.',
      'Tweaked the opening.',
      'Adjusted the second paragraph.'
    ])
      expect(claims(s), s).toBe(true)
    expect(settleAnswer('Also cut the last line.', [])).toBe(`${NONE}Cut the last line.`)
    expect(settleAnswer('Merged scenes 2 and 3.', [])).toBe(`${NONE}Merge scenes 2 and 3.`)
  })

  it('suggestions, story words and dialogue that start with “Cut” stay as written', () => {
    for (const s of [
      '1. Tighten the opening.\n2. Cut the last line.',
      '1. Cut the last line.',
      'Cut the last line.',
      'Tighten the opening. Also cut the last line.',
      'Cut to the chase.',
      'Cut the rope, she said.',
      '"Cut the rope," she said.',
      'Also cut the rope, she said.',
      'Split the chapter if it drags.'
    ])
      expect(settleAnswer(s, []), s).toBe(s)
  })
})

// Review of fix 3 (2026-10-20): the new summary verbs never reach into story words.
describe('review fixes 4: the new summary verbs leave story words alone', () => {
  it('a speech tag keeps any summary verb from being a claim', () => {
    for (const s of ['Sharpened the knife, she said.', 'Softened the blow, Mara says.', 'Tweaked the dial, he admits.', 'Merged the two camps, they said.'])
      expect(claims(s), s).toBe(false)
  })

  it('a new summary verb with story nouns does not end handed-over prose', () => {
    const a = 'Here’s the revised paragraph:\n\nMerged the two rivers into one, and the boat drifted.\n\nThe end.'
    expect(changeClaims(a).map((c) => c.sentence)).toEqual(['Here’s the revised paragraph:'])
    for (const s of ['Sharpened the knife and waited.', 'Softened the blow with a smile.', 'Reordered the crates by size.'])
      expect(changeClaims(`Here’s the revised paragraph:\n\n${s}`).map((c) => c.sentence), s).toEqual(['Here’s the revised paragraph:'])
  })

  it('a hand-over line is no claim beside which “Cut” counts', () => {
    expect(changeClaims('Here is the revised scene:\n\nHe ran. Cut the rope.\n\nIt was over.').map((c) => c.sentence)).toEqual(['Here is the revised scene:'])
    expect(claims('Tightened the opening. Cut the last line.')).toBe(true)
    expect(changeClaims('Tightened the opening. Cut the last line.')).toHaveLength(2)
  })
})

// Re-review of fix 4 (2026-10-20): only the verb's own object can name the app's thing.
describe('review fixes 5: a story-told summary verb is the chat again only by its object', () => {
  const OPEN = 'Here’s the revised paragraph:'
  it('an app word later in the story line keeps the prose handed over', () => {
    for (const s of ['Merged the two rivers, and the scene went quiet.', 'Sharpened the knife and the plan forming in his head.'])
      expect(changeClaims(`${OPEN}\n\n${s}\n\nThe end.`).map((c) => c.sentence), s).toEqual([OPEN])
  })
  it('a summary naming an app thing as its object still ends the hand-over', () => {
    for (const s of ['Merged scenes 2 and 3.', 'Also updated the scene card.', 'I updated it too.'])
      expect(changeClaims(`${OPEN}\n\nThe rain fell.\n\n${s}`).length, s).toBeGreaterThan(1)
  })
})
