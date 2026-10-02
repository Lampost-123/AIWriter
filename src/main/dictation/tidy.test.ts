import { describe, expect, it } from 'vitest'
import { tidyDictation } from './tidy'

describe('tidying dictated words', () => {
  it('leaves clean words as the speech model wrote them, capitals and punctuation included', () => {
    expect(tidyDictation('The lantern flickered twice.')).toBe('The lantern flickered twice.')
    expect(tidyDictation('  she said,   "Wait."  ')).toBe('she said, "Wait."')
    expect(tidyDictation('')).toBe('')
    expect(tidyDictation('   ')).toBe('')
  })

  it('takes out um, uh and erm, with the commas the model put round them', () => {
    expect(tidyDictation('The lantern, um, flickered twice.')).toBe('The lantern flickered twice.')
    expect(tidyDictation('I was, uh, going home.')).toBe('I was going home.')
    expect(tidyDictation('I was uh going home.')).toBe('I was going home.')
    expect(tidyDictation('I was, umm going home.')).toBe('I was going home.')
    expect(tidyDictation('I was erm, going home.')).toBe('I was going home.')
    expect(tidyDictation('And then, uh.')).toBe('And then.')
    expect(tidyDictation('What is it, um?')).toBe('What is it?')
    expect(tidyDictation('and then um')).toBe('and then')
  })

  it('starts a sentence that began with um at the word after it', () => {
    expect(tidyDictation('Um, the lantern flickered twice.')).toBe('The lantern flickered twice.')
    expect(tidyDictation('Uh the door was open.')).toBe('The door was open.')
    expect(tidyDictation('It was late. Um, she left.')).toBe('It was late. She left.')
    expect(tidyDictation('It was late. Um. She left.')).toBe('It was late. She left.')
    expect(tidyDictation('Um... the door was open.')).toBe('The door was open.')
    expect(tidyDictation('He said, “Um, wait.”')).toBe('He said, “Wait.”')
    expect(tidyDictation('Uh, um, the door.')).toBe('The door.')
  })

  it('joins the word after the filler to an opening quote or bracket, straight quotes too', () => {
    // The speech models mostly write straight quotes.
    expect(tidyDictation('"Um, hello," she said.')).toBe('"Hello," she said.')
    expect(tidyDictation("'Uh, wait,' he said.")).toBe("'Wait,' he said.")
    expect(tidyDictation('She said, "uh, wait."')).toBe('She said, "wait."')
    expect(tidyDictation('(Uh, maybe) not.')).toBe('(Maybe) not.')
    // A closing quote or an apostrophe stays where it is.
    expect(tidyDictation('"Hello," um, she said.')).toBe('"Hello," she said.')
    expect(tidyDictation("The dogs' um, bowls.")).toBe("The dogs' bowls.")
  })

  it('keeps a dash pair whole when the filler sat between them', () => {
    expect(tidyDictation('I — uh — wasn’t ready.')).toBe('I — wasn’t ready.')
    expect(tidyDictation('I—uh—wasn’t ready.')).toBe('I—wasn’t ready.')
  })

  it('says nothing was said when there were only fillers', () => {
    expect(tidyDictation('Um.')).toBe('')
    expect(tidyDictation('Uh, um...')).toBe('')
  })

  it('never takes out words that only look like fillers', () => {
    expect(tidyDictation('Uh-huh, she said.')).toBe('Uh-huh, she said.')
    expect(tidyDictation('Uh-oh.')).toBe('Uh-oh.')
    expect(tidyDictation('To err is human.')).toBe('To err is human.')
    expect(tidyDictation('He was rushed to the ER.')).toBe('He was rushed to the ER.')
    expect(tidyDictation('Hmm, she said.')).toBe('Hmm, she said.')
    expect(tidyDictation('The umbrella and the user.')).toBe('The umbrella and the user.')
  })

  it('takes out stutters such as "the the"', () => {
    expect(tidyDictation('She opened the the door.')).toBe('She opened the door.')
    expect(tidyDictation('The the door opened.')).toBe('The door opened.')
    expect(tidyDictation('I I think so.')).toBe('I think so.')
    expect(tidyDictation('and and then the the the door')).toBe('and then the door')
    expect(tidyDictation("It's it's late.")).toBe("It's late.")
    expect(tidyDictation('She went to, uh, to the door.')).toBe('She went to the door.')
  })

  it('keeps real doubles such as "had had"', () => {
    expect(tidyDictation('She had had enough.')).toBe('She had had enough.')
    expect(tidyDictation('He said that that was fine.')).toBe('He said that that was fine.')
    expect(tidyDictation('What it is is a trap.')).toBe('What it is is a trap.')
    expect(tidyDictation('What it was was a ghost.')).toBe('What it was was a ghost.')
    expect(tidyDictation('They do do it.')).toBe('They do do it.')
    expect(tidyDictation('He gave her her coat.')).toBe('He gave her her coat.')
    expect(tidyDictation('There there, my dear.')).toBe('There there, my dear.')
    expect(tidyDictation('A very very long road.')).toBe('A very very long road.')
    expect(tidyDictation('No, no, no.')).toBe('No, no, no.')
  })

  it('keeps the words on one line', () => {
    expect(tidyDictation('The lantern\nflickered\ttwice.')).toBe('The lantern flickered twice.')
  })
})
