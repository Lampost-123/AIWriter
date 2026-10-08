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
//            proposed. Otherwise two short paragraphs (then three numbered options when it asks for ideas, options,
//            any thoughts or titles); with model fake/slow, a list of twenty ideas after them, one a line, so
//            there is time to Stop.
//            When the instructions ask for the block format (they mention ::options: AIWRITE_EXP_CHAT_FORMAT on), the
//            ideas come as an ::options block with a ::next block after it (also for "brainstorm" / "what could"), and
//            a question of fact ("did I already", "how old", "who is") is "Not in memory yet." with a ::facts unknown
//            block citing the names. Plumbing only: with the switch off, the old plain answers.
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
  // The answer format (Phase 2): the instructions ask for blocks.
  const format = system.includes('::options')
  // Asked for ideas, options, thoughts or titles, it ends with three numbered options, as a real model does, so a
  // follow-up pick ("option 2", "the second one", "yes, do that") has something to pick.
  if (/\b(ideas|options|any thoughts|titles)\b/i.test(question) || (format && /\b(brainstorm|what could)\b/i.test(question)))
    paragraphs.push(
      format
        ? [
            '::options',
            '- **Cut it back**: to the one strong image.',
            '- **End on the dialogue**: the line of dialogue instead.',
            '- **Move it earlier**: keep it, but sooner.',
            '::',
            '::next',
            '- Draft the second one',
            '- Give me three more',
            '::'
          ].join('\n')
        : ['1. Cut it back to the one strong image.', '2. End on the line of dialogue instead.', '3. Keep it, but move it earlier.'].join('\n')
    )
  else if (format && /\b(did i already|how old|who is)\b/i.test(question))
    paragraphs.splice(
      0,
      paragraphs.length,
      [`${lead}Not in memory yet.`, '::facts unknown', ...(cited.length ? cited : ['Nothing']).map((c) => `- ${c}: named in the memory, no more said (its entry).`), '::'].join('\n')
    )
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
 *
 * The chat overhaul's tools (Phase 1), only when the app offers them (plumbing only, never a score):
 *   propose_draft    "next bit" / "continue from here" / "draft the scene": a draft hand-off straight away
 *   ask_user         "make it better" / "shorten it" / "change his name" / "thing we talked about" / "which one":
 *                    one question with three options
 *   propose_changes  "drags" / "punch" / "sort" / "angrier" / "harder" / "flat" / "both" / "second one" / "go ahead" /
 *                    "do that" / "option 2" / a reply starting "yes" /
 *                    "do it": reads the scene, then one edit item on its first sentence (on the first two for "both"); also used for
 *                    "fix" / "tighten" when propose_edit isn't offered
 * Only the words he typed count for these (not a selection quoted above them). A forced tool_choice is obeyed.
 */
export function askToolCalls(system, messages, tools, toolChoice) {
  if (!system.startsWith(MARKER) || !Array.isArray(tools) || !tools.length) return null
  const calls = scriptedCalls(system, messages, tools)
  // A request that forces a tool (tool_choice, the chat overhaul's TOOLCHOICE switch) gets that tool, as a real API
  // would insist; "required" with nothing scripted asks the writer (ask_user) when it is offered.
  const forced = typeof toolChoice === 'object' ? toolChoice?.function?.name : toolChoice === 'required' ? 'required' : null
  if (!forced) return calls
  if (forced === 'required') return calls ?? (offered(tools, 'ask_user') ? [askUserCall(tools)] : null)
  if (calls?.some((c) => c.name === forced) || !offered(tools, forced)) return calls
  if (forced === 'ask_user') return [askUserCall(tools)]
  // Made to propose when it would have asked: the question goes as propose_changes' one item of kind ask, where the
  // tool takes one (TOOLCHOICE with ASKUSER).
  const asking = calls?.find((c) => c.name === 'ask_user')
  if (forced === 'propose_changes' && asking && askKindOffered(tools)) return [changesCall(tools, [{ kind: 'ask', ...asking.arguments }])]
  if (forced === 'propose_draft') return [draftCall(tools, 'Carry on from the end of the scene.')]
  return [{ name: forced, arguments: fill(paramsOf(tools, forced), { why: 'As asked.' }) }]
}

// ---------- The chat overhaul's tools (Phase 1): propose_changes, ask_user, propose_draft ----------
// Their argument shapes are read from the tools as offered (each tool's JSON schema), so the fake keeps working while
// the shapes settle: known words are filled in where the schema has a property of that name, anything else required
// gets a plain value of its type.

const nameOf = (t) => t?.function?.name ?? t?.name
const offered = (tools, name) => tools.some((t) => nameOf(t) === name)
const paramsOf = (tools, name) => {
  const t = tools.find((x) => nameOf(x) === name)
  return t?.function?.parameters ?? t?.parameters ?? { type: 'object', properties: {} }
}

/** A value for a JSON schema: `hints` by property name first, else a plain value of the right type for what is required. */
function fill(schema, hints = {}, depth = 0) {
  if (!schema || depth > 5) return ''
  if (Array.isArray(schema.enum)) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  if (type === 'object' || schema.properties) {
    const out = {}
    const required = new Set(schema.required ?? [])
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      if (k in hints) out[k] = Array.isArray(v?.enum) && !v.enum.includes(hints[k]) ? v.enum[0] : hints[k]
      else if (required.has(k)) out[k] = fill(v, hints, depth + 1)
    }
    return out
  }
  if (type === 'array') return [fill(schema.items, hints, depth + 1)]
  if (type === 'number' || type === 'integer') return 1
  if (type === 'boolean') return true
  return 'As asked.'
}

/** The array property of a schema (propose_changes' list of items): its name and its items' schema. */
function listOf(schema) {
  const props = schema?.properties ?? {}
  const name = 'items' in props ? 'items' : 'changes' in props ? 'changes' : Object.keys(props).find((k) => props[k]?.type === 'array')
  return name ? { name, items: props[name].items ?? { type: 'object', properties: {} } } : null
}

/** propose_changes with one item per change: { kind, find, replace, why } filled into the item schema. */
function changesCall(tools, changes) {
  const schema = paramsOf(tools, 'propose_changes')
  const list = listOf(schema)
  const items = changes.map((c) => fill(list?.items, c))
  const top = fill(schema, { why: 'As asked.' })
  if (list) top[list.name] = items
  return { name: 'propose_changes', arguments: top }
}

/** propose_changes takes an item of kind ask (a question for the writer). */
const askKindOffered = (tools) => !!listOf(paramsOf(tools, 'propose_changes'))?.items?.properties?.kind?.enum?.includes('ask')

/** ask_user: one question with options (options as strings, or as objects when the schema wants them). */
function askUserCall(tools) {
  const schema = paramsOf(tools, 'ask_user')
  const options = ['The opening paragraph', 'The ending', 'Hesper’s lines']
  // One option with a detail, where the schema has room for one.
  const details = { 'The ending': 'the last two lines, where the gulls go quiet' }
  const optSchema = schema?.properties?.options?.items
  const opts =
    optSchema && (optSchema.type === 'object' || optSchema.properties)
      ? options.map((o) => fill(optSchema, { label: o, text: o, title: o, value: o, ...(details[o] ? { detail: details[o] } : {}) }))
      : options
  // The first option recommended (1 = the first), where the schema has `recommended`.
  return { name: 'ask_user', arguments: fill(schema, { question: 'Which part do you mean?', options: opts, recommended: 1, why: 'The ask could mean several things.' }) }
}

/** propose_draft: a hand-off to the writer's own drafting, with a short direction. */
function draftCall(tools, direction) {
  const mode = /draft the scene/.test(direction) ? 'generate' : 'continue'
  const hints = { direction, mode, why: 'You asked for new prose.' }
  return { name: 'propose_draft', arguments: fill(paramsOf(tools, 'propose_draft'), hints) }
}

/** The scene's words as read_scene gave them: after "Text:" (or, with numbered paragraphs, "Text ([n] …):"), numbers taken out. */
const sceneText = (content) => {
  const parts = String(content ?? '').split(/\nText(?: \([^)\n]*\))?:\n/)
  return (parts[1] ?? '').replace(/^\[\d+\] /gm, '')
}

/** The sentences of the scene as read_scene gave it. */
const sentences = (content) => sceneText(content).trim().match(/[^.!?]+[.!?]/g)?.map((x) => x.trim()) ?? []

/** The first sentence of the scene as read_scene gave it, or ''. */
const firstSentence = (content) => (/^[^.!?]+[.!?]/.exec(sceneText(content).trim()) ?? [''])[0]

function scriptedCalls(system, messages, tools) {
  const users = messages.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''))
  const nudged = users.some((u) => u.startsWith('[AI Write, not the writer] Your answer gives'))
  // The question is Adam's, not the app's note asking for the tools.
  const question = (users.filter((u) => !u.startsWith('[AI Write, not the writer]')).at(-1) ?? '').toLowerCase()
  // What he typed (after a quoted selection, "About this passage: “…”", if any).
  const typed = question.startsWith('about this passage:') ? question.slice(question.lastIndexOf('\n\n') + 2) : question
  const last = messages[messages.length - 1]
  const toolResults = messages.filter((m) => m.role === 'tool')
  const called = (name) => messages.some((m) => (m.tool_calls ?? []).some((c) => c.function?.name === name))
  // The overhaul's tools, when offered: a draft hand-off for new prose, one question for a truly vague ask, and
  // propose_changes for a novelist's vague edit ("this drags", "punch this up"), after reading the scene.
  if (offered(tools, 'propose_draft') && /\b(next bit|continue from here|draft the scene)\b/.test(typed)) {
    return called('propose_draft') ? null : [draftCall(tools, typed.replace(/\s+/g, ' ').slice(0, 200))]
  }
  if (offered(tools, 'ask_user') && /\b(make it better|shorten it|change his name|thing we talked about|which one)\b/.test(typed)) {
    return called('ask_user') ? null : [askUserCall(tools)]
  }
  // ("Push … harder" is the rewrite across paragraphs below, through propose_changes when that is the tool offered.)
  if (offered(tools, 'propose_changes') && !/\bpush\b/.test(typed) && /\b(drags|punch|sort|angrier|harder|flat|both|second one|go ahead|do it|do that|option \d)\b|^yes\b/.test(typed.trim())) {
    if (called('propose_changes')) return null
    if (!toolResults.length) return [{ name: 'read_scene', arguments: {} }]
    const first = last?.role === 'tool' ? firstSentence(last.content) : ''
    if (!first) return null
    const changes = [{ kind: 'edit', find: first, replace: first.replace(/\s+/g, ' ').toUpperCase(), why: 'Louder, as asked.' }]
    const second = last?.role === 'tool' ? sentences(last.content)[1] : undefined
    if (/\bboth\b/.test(typed) && second) changes.push({ kind: 'edit', find: second, replace: second.toUpperCase(), why: 'And the other one.' })
    return [changesCall(tools, changes)]
  }
  return legacyCalls(question, nudged, last, toolResults, tools)
}

function legacyCalls(question, nudged, last, toolResults, tools) {
  // Asked to propose what it claimed ("pretend"), it does, as a fix would; a stubborn one still doesn't.
  if (/\bpretend\b/.test(question)) {
    if (!nudged || /\bstubborn/.test(question)) return null
    if (!toolResults.length) return [{ name: 'read_scene', arguments: {} }]
    if (last?.role === 'tool' && toolResults.length === 1) {
      const first = firstSentence(last.content)
      if (!first) return null
      const change = { find: first, replace: first.toUpperCase(), why: 'Tidied, as claimed.' }
      return [offered(tools, 'propose_edit') || !offered(tools, 'propose_changes') ? { name: 'propose_edit', arguments: change } : changesCall(tools, [{ kind: 'edit', ...change }])]
    }
    return null
  }
  if (/\bnew place\b/.test(question)) {
    if (toolResults.length) return null
    const place = { name: 'The Salt Stair', summary: 'Worn steps cut into the harbour wall.', why: 'You asked for a new place.' }
    if (!offered(tools, 'propose_new_entry') && offered(tools, 'propose_changes')) return [changesCall(tools, [{ kind: 'new_entry', entry_kind: 'place', ...place }])]
    return [{ name: 'propose_new_entry', arguments: { kind: 'place', ...place } }]
  }
  // Asked to push a passage harder: it reads the scene, then rewrites the whole of it (every paragraph) as two new ones.
  if (/\bpush\b/.test(question)) {
    if (!toolResults.length) return [{ name: 'read_scene', arguments: {} }]
    if (last?.role === 'tool' && toolResults.length === 1) {
      const words = sceneText(last.content).trim().split(/\s+/)
      if (words.length < 6) return null
      const replace = 'The tide *roared* in over the flats.\n\nThe gulls screamed once, then nothing.'
      const rewrite = { start: words.slice(0, 3).join(' '), end: words.slice(-3).join(' '), replace, why: 'Pushed harder, as asked.' }
      if (!offered(tools, 'propose_rewrite') && offered(tools, 'propose_changes')) return [changesCall(tools, [{ kind: 'rewrite', ...rewrite }])]
      return [{ name: 'propose_rewrite', arguments: rewrite }]
    }
    return null
  }
  if (!/\b(fix|tighten)\b/.test(question)) return null
  if (!toolResults.length) return [{ name: 'read_scene', arguments: {} }]
  if (last?.role === 'tool' && toolResults.length === 1) {
    const first = firstSentence(last.content)
    if (!first) return null
    const change = { find: first, replace: first.replace(/\s+/g, ' ').toUpperCase(), why: 'Shouted, as asked.' }
    // With propose_edit gone (the overhaul's single propose_changes), the same edit goes through propose_changes.
    if (!offered(tools, 'propose_edit') && offered(tools, 'propose_changes')) return [changesCall(tools, [{ kind: 'edit', ...change }])]
    return [{ name: 'propose_edit', arguments: change }]
  }
  return null
}
