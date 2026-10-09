// The editor chat's question with options (ask_user, lab switch ASKUSER), as the panel shows it: the options as
// buttons under the answer, the pick sent as the next question in the chat. Pure, so it is unit-tested.
//  - The answer's text also ends with the question and its numbered options (agent.ended(), for a window that shows
//    only the text): with the buttons on show they would read twice, so they are taken off the text shown.
//  - Which options were picked is read back from the question that followed (the pick is sent as each picked
//    option's own line), so reopening a chat shows the pick with nothing more kept.
import type { AskChoice } from '@shared/contracts/ask'

type Option = AskChoice['options'][number]

/** The words the answer ends with for a choice, exactly as the main process adds them (ask/agent.ts ended()). */
export function choiceClosing(c: AskChoice): string {
  const lines = c.options.map((o, i) => `${i + 1}. ${o.label}${o.detail ? ` — ${o.detail}` : ''}${c.recommended === i ? ' (recommended)' : ''}`)
  return [c.question, lines.join('\n'), c.multi ? 'You can pick more than one.' : ''].filter(Boolean).join('\n\n')
}

/**
 * The answer as it shows above the choice's buttons: without the question and numbered options it ends with. When
 * those aren't word for word as expected (an answer stopped part-way, say), a run of numbered lines at the end that
 * name the options goes, and the question just above them too.
 */
export function withoutChoice(answer: string, c: AskChoice | undefined): string {
  if (!c) return answer
  const text = answer.replace(/\s+$/, '')
  const closing = choiceClosing(c)
  if (text.endsWith(closing)) return text.slice(0, text.length - closing.length).replace(/\s+$/, '')
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0 && (!lines[end - 1].trim() || /^you can pick more than one\.?$/i.test(lines[end - 1].trim()))) end--
  let start = end
  while (start > 0 && /^\s*\d+[.)]\s+\S/.test(lines[start - 1])) start--
  const listed = lines.slice(start, end)
  const named = listed.length >= 2 && listed.every((l) => c.options.some((o) => l.includes(o.label)))
  if (!named) return answer
  let cut = start
  while (cut > 0 && !lines[cut - 1].trim()) cut--
  if (cut > 0 && lines[cut - 1].trim() === c.question.trim()) cut--
  return lines.slice(0, cut).join('\n').replace(/\s+$/, '')
}

/** One picked option as it goes in the question: its label, and its detail when it has one. */
export const pickLine = (o: Option): string => (o.detail ? `${o.label} — ${o.detail}` : o.label)

/** The question a pick sends: each picked option on a line of its own, in the options' order. */
export function pickQuestion(c: AskChoice, picked: number[]): string {
  return c.options
    .filter((_o, i) => picked.includes(i))
    .map(pickLine)
    .join('\n')
}

/** The options a question that followed the choice picked (by their lines), in order; [] for words of his own. */
export function pickedOf(c: AskChoice, question: string | undefined): number[] {
  if (!question) return []
  const lines = new Set(
    question
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  )
  return c.options.flatMap((o, i) => (lines.has(pickLine(o)) || lines.has(o.label) ? [i] : []))
}
