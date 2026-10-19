// The editor chat's truth check: what an answer claims it changed, against what it proposed (Adam, 2026-10-19).
// Invented words only.
import { describe, expect, it } from 'vitest'
import { changeClaims, claimsUnmade, honestReply, NO_CHANGE_LEAD, unbackedClaims, writerReason } from './askTruth'

const claims = (s: string): boolean => changeClaims(s).length > 0

describe('changeClaims: what counts as a claim', () => {
  it('catches first-person claims of a change, made or proposed', () => {
    for (const s of [
      'I’ve updated Mara’s entry so her eyes are green.',
      "I've edited the opening line.",
      'I have rewritten the second paragraph to be tenser.',
      'I changed the ending so Tobin leaves first.',
      'I’ve added a beat where she finds the letter.',
      'I removed the adverbs from the dialogue.',
      'I’ve proposed a tighter version of the opening.',
      'I’ve applied the fix to the first sentence.',
      'I renamed the chapter to “Low Water”.',
      'I’ve moved the reveal to the end of the scene.',
      'I’ve also tightened the last line.',
      'I’ve gone ahead and cut the third paragraph.',
      'I’ve made the change you asked for.',
      'I’ve set her age to forty.',
      "We've trimmed the scene's opening.",
      'I’ve kept your voice and tightened the opening.'
    ])
      expect(claims(s), s).toBe(true)
  })

  it('catches passive claims, "done", ready changes and hand-overs', () => {
    for (const s of [
      'Mara’s entry has been updated.',
      'The opening paragraph is now tightened.',
      'Done! Her eyes are green now.',
      'All done.',
      'The change is ready for you to apply.',
      'Two changes are waiting for you.',
      'Apply the changes below when you’re ready.',
      'Here’s the revised paragraph: The tide came in.',
      'Tightened the opening and cut a line.',
      '- Reworded the second sentence'
    ])
      expect(claims(s), s).toBe(true)
  })

  it('leaves offers, suggestions and questions alone', () => {
    for (const s of [
      'I’d suggest cutting the second paragraph.',
      'You could make the ending darker.',
      'I can change the opening if you like.',
      'I’d change “grey” to “green” in her entry.',
      'Want me to update Mara’s entry?',
      'Shall I tighten the opening?',
      'Have I changed the right line?',
      'I’ll propose a rewrite once you pick one.',
      'If I cut that paragraph, the scene loses its pause.',
      'Once I’ve read the scene I can tighten it.',
      'I haven’t changed anything yet.',
      'I’ve changed nothing: the scene already does this.',
      'I’ve read the scene and it already works.',
      'I’ve checked the memory: her eyes are grey.',
      'One idea: they meet at the ferry at dusk.',
      'She could apply pressure to the wound.'
    ])
      expect(claims(s), s).toBe(false)
  })

  it('never counts quoted words: the writer’s own, or the scene’s', () => {
    expect(claims('You said “I’ve changed the ending”, but the ending is the same as before.')).toBe(false)
    expect(claims('The line reads: "I changed my name when I left Saltreach."')).toBe(false)
    expect(claims('> I’ve updated the ledger, Tobin said.\n\nThat line works.')).toBe(false)
  })

  it('never counts what the story’s people did, or what happened earlier in the chat', () => {
    for (const s of [
      'In chapter 3, Mara changed her name and moved to the docks.',
      'Tobin has rewritten the ledger twice by then.',
      'She’s added a lock to the door since the raid.',
      'Her name has been changed since the war.',
      'Changed by the war, Mara keeps to herself.',
      'Moved, she wept at the grave.',
      'Earlier I changed the opening, and you applied it.',
      'You’ve updated her entry since, so it now says green.'
    ])
      expect(claims(s), s).toBe(false)
  })

  it('reads every sentence, with Ch. and Sc. kept whole', () => {
    const c = changeClaims('Her eyes are grey in Ch. 2, Sc. 1 of the story. I’ve updated her entry to say green.')
    expect(c).toHaveLength(1)
    expect(c[0].sentence).toBe('I’ve updated her entry to say green.')
    expect(c[0].target).toBe('entry')
  })

  it('names what a claim says was changed', () => {
    const t = (s: string) => changeClaims(s)[0]?.target ?? null
    expect(t('I’ve tightened the opening.')).toBe('words')
    expect(t('I’ve updated Mara’s entry.')).toBe('entry')
    expect(t('I’ve added a beat to the card.')).toBe('card')
    expect(t('I renamed the scene.')).toBe('title')
    expect(t('I’ve added a new character, Brannoc.')).toBe('new')
    expect(t('Done.')).toBeNull()
  })
})

describe('unbackedClaims: claims against what was proposed', () => {
  it('counts every claim when nothing was proposed', () => {
    expect(unbackedClaims('I’ve fixed the first sentence.', [])).toHaveLength(1)
    expect(claimsUnmade('I’d fix the first sentence.', [])).toBe(false)
  })
  it('counts a claim backed by a proposal of its kind as made', () => {
    expect(claimsUnmade('I’ve tightened the opening. The change is ready to apply.', [{ kind: 'text' }])).toBe(false)
    expect(claimsUnmade('I’ve updated Mara’s entry.', [{ kind: 'entry' }])).toBe(false)
    expect(claimsUnmade('I’ve proposed a change.', [{ kind: 'card' }])).toBe(false)
  })
  it('counts a claim of another kind of change as unmade', () => {
    const c = unbackedClaims('I’ve tightened the opening and I’ve updated Mara’s entry too.', [{ kind: 'text' }])
    expect(c.map((x) => x.target)).toEqual(['entry'])
    expect(claimsUnmade('I’ve renamed the chapter.', [{ kind: 'text' }])).toBe(true)
    expect(claimsUnmade('I’ve set the issue right in her entry.', [{ kind: 'issueFix', how: 'memory' } as never])).toBe(false)
  })
})

describe('honestReply: a claim never shown as made', () => {
  it('turns first-person claims into offers and leads with "No change was made"', () => {
    const answer = 'I’ve updated Mara’s entry: her eyes are green now, as in chapter 4.'
    const out = honestReply(answer, unbackedClaims(answer, []), { proposed: [] })
    expect(out).toBe(`${NO_CHANGE_LEAD}, so there’s nothing to apply. Here’s what I’d suggest:\n\nI’d update Mara’s entry: her eyes are green now, as in chapter 4.`)
    expect(claimsUnmade(out, [])).toBe(false)
  })
  it('says why when a tool turned the change down', () => {
    const answer = 'Done! I’ve fixed the first sentence. Apply the changes below.'
    const out = honestReply(answer, unbackedClaims(answer, []), { proposed: [], failure: 'the words it meant to change aren’t in the scene as written' })
    expect(out).toBe(
      `${NO_CHANGE_LEAD}: I couldn’t make it because the words it meant to change aren’t in the scene as written. Here’s what I’d suggest:\n\nI’d fix the first sentence.`
    )
    expect(claimsUnmade(out, [])).toBe(false)
  })
  it('keeps nothing of an answer that was only a claim but the plain line', () => {
    const answer = 'Done.\n\n- Tightened the opening\n- Reworded the second sentence'
    const out = honestReply(answer, unbackedClaims(answer, []), { proposed: [] })
    expect(out).toBe(`${NO_CHANGE_LEAD}, so there’s nothing to apply.`)
  })
  it('with some changes proposed, says which are ready and that nothing else was changed', () => {
    const answer = 'I’ve tightened the opening. I’ve also updated Mara’s entry.'
    const out = honestReply(answer, unbackedClaims(answer, [{ kind: 'text' }]), { proposed: ['1'] })
    expect(out).toBe('Only change 1 is ready to apply; nothing else was changed.\n\nI’ve tightened the opening. I’d also update Mara’s entry.')
    expect(claimsUnmade(out, [{ kind: 'text' }])).toBe(false)
  })
  it('leaves an answer with no unbacked claim as it is', () => {
    expect(honestReply('Her eyes are grey.', [], { proposed: [] })).toBe('Her eyes are grey.')
  })
})

describe('writerReason: why a change wasn’t made, in plain words', () => {
  it('says the checks’ messages in Adam’s words', () => {
    expect(writerReason('Not proposed: nothing is waiting for the writer. Those words are not in the scene as written. Read the scene and copy the words exactly.')).toBe(
      'the words it meant to change aren’t in the scene as written'
    )
    expect(writerReason('“Favourite colour” isn’t one of Mara’s fields. Her fields (key: label): eyes (Eyes).')).toBe('Mara has no “Favourite colour” field')
    expect(writerReason('There is no entry called “Mara Venn” in this story’s memory. Search for it, or propose a new entry.')).toBe(
      'there’s no entry called “Mara Venn” in this story’s memory'
    )
    expect(writerReason('Give the changes as `changes`: a list, each with its `kind` and that kind’s fields.')).toBe('what it sent couldn’t be used')
    expect(writerReason('The new words are the same as the old.')).toBe('the new words were the same as the old')
  })
})
