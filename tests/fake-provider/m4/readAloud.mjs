// Fake replies for the readAloud part's AI calls (system prompts starting "[AIWRITE-READ-ALOUD v1] <job>",
// src/main/readAloud/speakers.ts and suggest.ts). Returns null for any other request. Every reply is
// deterministic:
//
//   speakers  Who says each numbered quote ("[3]“Get out.”" in the user message). Reply: a JSON object from each
//             number to a name, taking turns between the first two characters the system prompt lists under
//             "Characters in this story:" (odd numbers the first, even the second); "?" when it lists nobody; and
//             "a stranger" for a quote followed by "someone" (“Fine,” someone muttered).
//             e.g. {"1": "Mara", "2": "Tobin", "3": "a stranger"}
//
//   marks     Mark who says what: a note for each numbered line. A number before a quote gets
//             "<speaker> | quiet and wary" (the speaker taking turns as above, the tone "bright and quick" on even
//             numbers); a number before narration gets "hushed and steady | slow".
//             e.g. {"1": "Mara | quiet and wary", "2": "hushed and steady | slow"}
//
//   voice     Suggest (a character's voice): always
//             "A woman in her thirties with a low, steady voice, a slight northern lilt and a dry, unhurried delivery."

const MARKER = '[AIWRITE-READ-ALOUD v1]'

export const SUGGESTED_VOICE = 'A woman in her thirties with a low, steady voice, a slight northern lilt and a dry, unhurried delivery.'

/** The names under "Characters in this story:" in the system prompt. */
function castNames(system) {
  const block = system.split('Characters in this story:')[1] ?? ''
  const names = []
  for (const line of block.split('\n').slice(1)) {
    const m = /^- (.+?)(?: \(also [^)]*\))?(?::|$)/.exec(line.trim())
    if (!m) {
      if (line.trim() && !line.startsWith('-')) break
      continue
    }
    if (m[1] !== '(none listed)') names.push(m[1].trim())
  }
  return names
}

const userText = (messages) =>
  String(
    messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))[0] ?? ''
  )

/** Each numbered line in the user message: its number, whether it is a quote, and whether "someone" says it. */
function numberedLines(text) {
  return [...text.matchAll(/\[(\d+)\](.)/gs)].map((m) => ({
    n: Number(m[1]),
    quote: m[2] === '"' || m[2] === '“',
    someone: /^["“][^"”]*["”],?\s+someone\b/.test(text.slice(m.index + m[0].length - 1))
  }))
}

export function readAloudReply(system, messages, _model) {
  if (!system.startsWith(MARKER)) return null
  const job = system.slice(MARKER.length).trim().split(/\s/)[0]
  const names = castNames(system)
  const who = (n) => (names.length ? names[(n - 1) % Math.min(2, names.length)] : '?')
  const lines = numberedLines(userText(messages))

  if (job === 'speakers') {
    return JSON.stringify(Object.fromEntries(lines.filter((l) => l.quote).map((l) => [String(l.n), l.someone ? 'a stranger' : who(l.n)])))
  }

  if (job === 'marks') {
    return JSON.stringify(
      Object.fromEntries(
        lines.map((l) => [
          String(l.n),
          l.quote ? `${who(l.n)} | ${l.n % 2 ? 'quiet and wary' : 'bright and quick'}` : 'hushed and steady | slow'
        ])
      )
    )
  }

  if (job === 'voice') return SUGGESTED_VOICE
  return null
}
