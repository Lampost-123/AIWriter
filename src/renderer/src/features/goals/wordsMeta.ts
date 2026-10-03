// Writing by hand: how a change to the page tells the daily word count where its words came from. A transaction
// carrying this meta isn't Adam's typing: 'ai' for AI words he chose to keep (a picked variant: the words put in
// count), 'ai-net' for a change to AI words whose net change counts (a beat taken out to be written again), 'none'
// for words that aren't new writing at all (a restored version, switching drafts, find and replace).
// Typing, pasting and dictation carry nothing and count as typed. See wordTally.ts.
export const WORDS_META = 'aiwriteWords'

export type WordsSource = 'ai' | 'ai-net' | 'none'
