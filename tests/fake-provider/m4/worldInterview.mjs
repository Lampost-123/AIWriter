// Fake replies for the World builder's "Interview me" (src/main/worldBuilder/interview.ts: system prompt
// starting "[AIWRITE-WORLD v1] interview"). It asks about the first of these topics not yet asked in the
// interview (the "Already asked in this interview" list), in this order, so tests know each question:
//   Premise          What is the story about, and what sets it going?
//   Main characters  Who are the main characters, and what does each of them want?
//   Setting          Where and when does the story take place?
//   How the world works  What rules does the world run on, and what do they cost?
//   Tone             How should the story feel to read?
//   The ending       How does the story end?
// After those, "More": "What else should the world remember?". The reply is {"topic", "question"}; the
// model fake/world-junk answers with words and no question (a reply that can't be used).
// Returns null for any other request.

const MARKER = '[AIWRITE-WORLD v1] interview'

export const INTERVIEW_TOPICS = [
  ['Premise', 'What is the story about, and what sets it going?'],
  ['Main characters', 'Who are the main characters, and what does each of them want?'],
  ['Setting', 'Where and when does the story take place?'],
  ['How the world works', 'What rules does the world run on, and what do they cost?'],
  ['Tone', 'How should the story feel to read?'],
  ['The ending', 'How does the story end?']
]

export function worldInterviewReply(system, messages, model) {
  if (!system.startsWith(MARKER)) return null
  if (model === 'fake/world-junk') return 'I read it, and it is a fine world.'
  const user = String((messages ?? []).filter((m) => m.role === 'user').pop()?.content ?? '')
  const asked = (user.split('Already asked in this interview:\n')[1] ?? '')
    .split('\n')
    .map((l) => l.match(/^- (.+?): /)?.[1])
    .filter(Boolean)
  const [topic, question] = INTERVIEW_TOPICS.find(([t]) => !asked.includes(t)) ?? ['More', 'What else should the world remember?']
  return JSON.stringify({ topic, question })
}
