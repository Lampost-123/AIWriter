// Fake replies for the ask part's AI calls (system prompts starting "[AIWRITE-ASK v1] <job>").
// Returns null for any other request.
//
// Jobs and their replies:
//   answer   An answer to the question (the last user message), citing what the briefing gave it, as the
//            real model is asked to:
//              - every entry under "## Named in the question" (its "### Name (kind)" headings), else those
//                under "## Also relevant", else the first two names under "## Everything else in the
//                memory", each as [[Name]];
//              - always "[[The Grey Ferry]]" as well, a name that is in no world (so the app must show it
//                as plain words, not a link);
//              - from the second question in a chat on, it starts "Answer N in this chat." (N counts the
//                earlier answers sent with it, so tests can see the conversation was sent);
//            Two short paragraphs; with model fake/slow, a list of twenty ideas after them, one a line, so
//            there is time to Stop.
const MARKER = '[AIWRITE-ASK v1]'

/** The briefing's parts, by their "## Title". */
function sections(system) {
  const out = new Map()
  for (const part of system.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n')
    out.set(part.slice(0, nl).trim(), part.slice(nl + 1))
  }
  return out
}

/** The names of the "### Name (kind)" headings in a part. */
const headed = (text) => [...(text ?? '').matchAll(/^### (.+?) \([^)\n]*\)\s*$/gm)].map((m) => m[1].trim())

/** The names listed as "- Name: ..." or "- Name (also: ...)" in a part. */
const listed = (text) => [...(text ?? '').matchAll(/^- ([^:(\n]+?)(?: \(also:[^)]*\))?(?::|$)/gm)].map((m) => m[1].trim())

export function askReply(system, messages, model) {
  if (!system.startsWith(MARKER)) return null
  const job = system.slice(MARKER.length).trim().split(/\s/)[0]
  if (job !== 'answer') return null
  const parts = sections(system)
  let names = headed(parts.get('Named in the question'))
  if (!names.length) names = headed(parts.get('Also relevant'))
  if (!names.length) names = listed(parts.get('Everything else in the memory')).slice(0, 2)
  names = [...new Set(names)].slice(0, 4)
  const question = String([...messages].reverse().find((m) => m.role === 'user')?.content ?? '').trim()
  const earlier = messages.filter((m) => m.role === 'assistant').length
  const cited = names.map((n) => `[[${n}]]`)
  const who =
    cited.length > 1 ? `${cited.slice(0, -1).join(', ')} and ${cited[cited.length - 1]}` : (cited[0] ?? 'nothing in the memory yet')
  const lead = earlier ? `Answer ${earlier + 1} in this chat. ` : ''
  const paragraphs = [
    `${lead}From the memory: ${who}. You asked: “${question.replace(/\s+/g, ' ').slice(0, 120)}”.`,
    `One idea that fits: they meet at [[The Grey Ferry]] at dusk, where nobody is watching.`
  ]
  if (model === 'fake/slow') {
    const more = []
    for (let i = 1; i <= 20; i++) more.push(`Idea ${i}: something quiet happens by the water, and it changes what they want.`)
    paragraphs.push(more.join('\n'))
  }
  return paragraphs.join('\n\n')
}
