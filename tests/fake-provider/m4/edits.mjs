// Fake replies for the edits part's AI calls (system prompts starting "[AIWRITE-EDIT v1] <job>", the job
// being the tool). Each reply is worked out from the selected words in the briefing (the block after "The
// selected words (your reply takes their place):"), so tests can tell exactly what to expect. Returns
// null for any other request.
//
//   condense      starts with a lead-in line ("Here's the condensed version:", which the app leaves out),
//                 then the first sentence of each paragraph; a paragraph of one sentence keeps its first
//                 half (and a full stop).
//   expand        the words, then " She let the silence stretch until the fire popped."
//   vivid         the words, then " The lamplight shivered on the wet stones."
//   tone          the words, then " The room seemed to hold its breath."
//   rewrite       the sentences of each paragraph in reverse order; a single sentence becomes
//                 "In the end, <the sentence, lower-cased first letter>". Asked to fix an issue (Fix the text: the
//                 direction says the words "must change"), the first answer is the words unchanged, as real models
//                 often sent them (Adam, 2026-10-08); asked again ("Your last answer was identical"), the rewrite
//                 above. With the model fake/stubborn, the words unchanged every time.
//   voice         each line of dialogue whose speaker the briefing names and gives sample lines for is
//                 replaced by “<that speaker's first sample line>”; other lines stay as they are.
//   alternatives  "=== Version 1 ===" "Quietly, <words>", "=== Version 2 ===" "<words without the last full
//                 stop>, and nobody noticed.", "=== Version 3 ===" "Even then, <words>" (lower-cased first letter).
//   continue      carrying on a paragraph ("It stops part-way through a paragraph."):
//                 "and then, without a word, she sat down across from him."; otherwise two paragraphs:
//                 "Tobin set his cup down at last. “Then we go tonight,” he said, “before the bells finish.”"
//                 and "Mara looked at the door, then back at him, and for the first time that evening she sat."
//
// With the model fake/slow, every tool's reply is long (about 700 words, the words above repeated), so a
// test can stop it part-way.

const MARKER = '[AIWRITE-EDIT v1]'

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const sentences = (p) =>
  p
    .match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [p]
const paragraphs = (text) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

/** The selected words, as the briefing sends them. */
function selectedWords(user) {
  const m = user.match(/The selected words \(your reply takes their place\):\n"""\n([\s\S]*?)\n"""/)
  return m ? m[1] : ''
}

/** Each speaker's first sample line, from the briefing's character profiles. */
function sampleLines(user) {
  const out = new Map()
  for (const section of user.split(/\n(?=### )/)) {
    const name = section.match(/^### (.+)$/m)?.[1]?.trim()
    const sample = section.match(/Sample lines of dialogue:\n[ \t]+(.+)/)?.[1]?.trim()
    if (name && sample) out.set(name, sample)
  }
  return out
}

function fixVoice(user, words) {
  const samples = sampleLines(user)
  let out = words
  const list = user.match(/Who says each line[^\n]*\n((?:\d+\. .*\n?)+)/)?.[1] ?? ''
  for (const line of list.split('\n')) {
    const m = line.match(/^\d+\. ([^:,]+?)(, who has no voice profile yet \(leave it as it is\))?: (.+)$/)
    if (!m || m[2] || m[1] === 'Not known (leave it as it is)') continue
    const sample = samples.get(m[1].trim())
    if (sample) out = out.replace(m[3].trim(), `“${sample.replace(/^["“]|["”]$/g, '')}”`)
  }
  return out
}

/** Fix the text's asking (issues/issuesLogic.ts fixDirection), and its second asking (fixAgainNote). */
const FIX_ASK = 'These words are wrong as they stand and must change'
const FIX_AGAIN = 'Your last answer was identical to the selected words'

function reply(tool, user, system = '', model = '') {
  const words = selectedWords(user)
  if (tool === 'rewrite' && system.includes(FIX_ASK) && (model === 'fake/stubborn' || !system.includes(FIX_AGAIN))) return words
  switch (tool) {
    case 'condense':
      return `Here's the condensed version:\n\n${paragraphs(words)
        .map((p) => {
          const s = sentences(p)
          if (s.length > 1) return s[0]
          const w = p.replace(/[.!?…]+$/, '').split(/\s+/)
          return `${w.slice(0, Math.max(2, Math.ceil(w.length / 2))).join(' ')}.`
        })
        .join('\n\n')}`
    case 'expand':
      return `${words} She let the silence stretch until the fire popped.`
    case 'vivid':
      return `${words} The lamplight shivered on the wet stones.`
    case 'tone':
      return `${words} The room seemed to hold its breath.`
    case 'rewrite':
      return paragraphs(words)
        .map((p) => {
          const s = sentences(p)
          return s.length > 1 ? s.reverse().join(' ') : `In the end, ${lowerFirst(p)}`
        })
        .join('\n\n')
    case 'voice':
      return fixVoice(user, words)
    case 'alternatives':
      return [
        '=== Version 1 ===',
        `Quietly, ${lowerFirst(words)}`,
        '',
        '=== Version 2 ===',
        `${words.replace(/[.!?…]+$/, '')}, and nobody noticed.`,
        '',
        '=== Version 3 ===',
        `Even then, ${lowerFirst(words)}`
      ].join('\n')
    case 'continue':
      return user.includes('It stops part-way through a paragraph.')
        ? 'and then, without a word, she sat down across from him.'
        : 'Tobin set his cup down at last. “Then we go tonight,” he said, “before the bells finish.”\n\nMara looked at the door, then back at him, and for the first time that evening she sat.'
    default:
      return null
  }
}

export function editsReply(system, messages, model) {
  if (!system.startsWith(MARKER)) return null
  const tool = system.slice(MARKER.length).split('\n')[0].trim()
  const user = String(messages.find((m) => m.role === 'user')?.content ?? '')
  const out = reply(tool, user, system, model)
  if (out == null) return null
  if (model !== 'fake/slow') return out
  // Long enough to stop part-way.
  let long = out
  while (long.split(/\s+/).length < 700) long += ` ${out.replace(/^Here's the condensed version:\n\n/, '')}`
  return long
}
