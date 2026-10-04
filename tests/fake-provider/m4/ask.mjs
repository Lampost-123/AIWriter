// Fake replies for the ask part's AI calls (system prompts starting "[AIWRITE-ASK v1] <job>").
// Returns null for any other request.
//
// Jobs and their replies:
//   answer   An answer to the question (the last user message), citing what the briefing gave it, as the
//            real model is asked to:
//              - every entry under "## Named in the question" (or "## Named earlier in this chat", or "## Named
//                in the question or earlier in this chat": its "### Name (kind)" headings), else those
//                under "## Also relevant", else the first two names under "## Everything else in the
//                memory", each as [[Name]];
//              - always "[[The Grey Ferry]]" as well, a name that is in no world (so the app must show it
//                as plain words, not a link);
//              - one word in italics, "*nobody*", as real models often write (so the app must show it in
//                italics, without the marks);
//              - from the second question in a chat on, it starts "Answer N in this chat." (N counts the
//                earlier answers sent with it, so tests can see the conversation was sent);
//            A question with "pretend" in it gets an answer that tells the writer to apply changes it never
//            proposed. Otherwise two short paragraphs; with model fake/slow, a list of twenty ideas after them, one a line, so
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
  let names = headed([...parts].find(([title]) => title.startsWith('Named '))?.[1])
  if (!names.length) names = headed(parts.get('Also relevant'))
  if (!names.length) names = listed(parts.get('Everything else in the memory')).slice(0, 2)
  names = [...new Set(names)].slice(0, 4)
  // Adam's question, not the app's note asking for the tools.
  const question = String(
    [...messages].reverse().find((m) => m.role === 'user' && !String(m.content ?? '').startsWith('[AI Write, not the writer]'))?.content ?? ''
  ).trim()
  const proposed = messages.some((m) => m.role === 'tool' && String(m.content ?? '').startsWith('Proposed to the writer'))
  const earlier = messages.filter((m) => m.role === 'assistant').length
  const cited = names.map((n) => `[[${n}]]`)
  const who =
    cited.length > 1 ? `${cited.slice(0, -1).join(', ')} and ${cited[cited.length - 1]}` : (cited[0] ?? 'nothing in the memory yet')
  // A model that claims changes it never proposed (the app must say nothing came with the answer).
  if (/\bpretend\b/i.test(question))
    return proposed ? 'I proposed a tidier opening line.' : 'I’ve tidied up the opening. Apply the changes below when you’re ready.'
  const lead = earlier ? `Answer ${earlier + 1} in this chat. ` : ''
  const paragraphs = [
    `${lead}From the memory: ${who}. You asked: “${question.replace(/\s+/g, ' ').slice(0, 120)}”.`,
    `One idea that fits: they meet at [[The Grey Ferry]] at dusk, where *nobody* is watching.`
  ]
  if (model === 'fake/slow') {
    const more = []
    for (let i = 1; i <= 20; i++) more.push(`Idea ${i}: something quiet happens by the water, and it changes what they want.`)
    paragraphs.push(more.join('\n'))
  }
  return paragraphs.join('\n\n')
}

/**
 * The editor chat (Ask the world with tools): with tools offered and a question asking to fix or tighten something,
 * the fake model works like a real one: it reads the open scene first (read_scene), then proposes an edit to the
 * scene's first sentence (propose_edit: the sentence in capitals), then answers in words. A question asking for a new
 * place proposes one (propose_new_entry). Returns the tool calls to send now, or null to answer in words (askReply).
 */
export function askToolCalls(system, messages, tools) {
  if (!system.startsWith(MARKER) || !Array.isArray(tools) || !tools.length) return null
  const users = messages.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''))
  const nudged = users.some((u) => u.startsWith('[AI Write, not the writer] Your answer says'))
  // The question is Adam's, not the app's note asking for the tools.
  const question = (users.filter((u) => !u.startsWith('[AI Write, not the writer]')).at(-1) ?? '').toLowerCase()
  const last = messages[messages.length - 1]
  const toolResults = messages.filter((m) => m.role === 'tool')
  // Asked to propose what it claimed ("pretend"), it does, as a fix would; a stubborn one still doesn't.
  if (/\bpretend\b/.test(question)) {
    if (!nudged || /\bstubborn/.test(question)) return null
    if (!toolResults.length) return [{ name: 'read_scene', arguments: {} }]
    if (last?.role === 'tool' && toolResults.length === 1) {
      const text = String(last.content).split('\nText:\n')[1] ?? ''
      const first = (/^[^.!?]+[.!?]/.exec(text.trim()) ?? [''])[0]
      return first ? [{ name: 'propose_edit', arguments: { find: first, replace: first.toUpperCase(), why: 'Tidied, as claimed.' } }] : null
    }
    return null
  }
  if (/\bnew place\b/.test(question)) {
    if (toolResults.length) return null
    return [{ name: 'propose_new_entry', arguments: { kind: 'place', name: 'The Salt Stair', summary: 'Worn steps cut into the harbour wall.', why: 'You asked for a new place.' } }]
  }
  if (!/\b(fix|tighten)\b/.test(question)) return null
  if (!toolResults.length) return [{ name: 'read_scene', arguments: {} }]
  if (last?.role === 'tool' && toolResults.length === 1) {
    const text = String(last.content).split('\nText:\n')[1] ?? ''
    const first = (/^[^.!?]+[.!?]/.exec(text.trim()) ?? [''])[0]
    if (!first) return null
    return [{ name: 'propose_edit', arguments: { find: first, replace: first.replace(/\s+/g, ' ').toUpperCase(), why: 'Shouted, as asked.' } }]
  }
  return null
}
