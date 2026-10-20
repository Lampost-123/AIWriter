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
