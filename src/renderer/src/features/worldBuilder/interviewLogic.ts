// "Interview me" on the World builder page: how an answer goes into the summary (in Adam's own words, at
// its end, under the question's topic: "Setting: ..."), how Undo takes it out again, and the interview's
// small note. Pure, so it is unit-tested; interviewStore.ts and WorldInterview.tsx use it.

/** An answer as it goes into the summary: his words, trimmed, with no more than one blank line inside. */
export function tidyAnswer(answer: string): string {
  return answer
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** "Setting: <his answer>", unless his answer already starts with that label. */
export function answerLine(topic: string, answer: string): string {
  const words = tidyAnswer(answer)
  const label = topic.replace(/\s+/g, ' ').trim() || 'More'
  if (words.toLowerCase().startsWith(`${label.toLowerCase()}:`)) return words
  return `${label}: ${words}`
}

/**
 * The summary with the answer added at its end, after a blank line, and `added`: exactly what was added
 * (so Undo can take out just that, even after other edits). Unchanged when the answer is empty.
 */
export function withAnswer(summary: string, topic: string, answer: string): { summary: string; added: string } {
  if (!tidyAnswer(answer)) return { summary, added: '' }
  const kept = summary.trimEnd()
  const added = `${kept ? '\n\n' : ''}${answerLine(topic, answer)}`
  return { summary: kept + added, added }
}

/**
 * The summary with an added answer taken out again (the toast's Undo): what it was before when nothing has
 * changed since, else the summary as it is now without the added words (the last place they are). Null
 * when the added words are no longer there as they were.
 */
export function withoutAnswer(current: string, change: { before: string; after: string; added: string }): string | null {
  if (current === change.after) return change.before
  if (!change.added) return null
  const at = current.lastIndexOf(change.added)
  if (at >= 0) return current.slice(0, at) + current.slice(at + change.added.length)
  // The blank line before it was changed: the answer itself, on its own line.
  const line = change.added.trim()
  const alone = current.lastIndexOf(line)
  if (alone < 0) return null
  return (current.slice(0, alone).trimEnd() + current.slice(alone + line.length)).trimEnd()
}

/** The note under the answer box: how answers are used, then how many are in. */
export function interviewNote(added: number): string {
  if (added <= 0) return 'Each answer is added to the end of your summary, in your own words.'
  return `${added === 1 ? '1 answer' : `${added} answers`} added to your summary.`
}
