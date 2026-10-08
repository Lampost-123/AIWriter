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
//   director  The director (src/main/readAloud/director.ts): an entry for each numbered line. The k-th quote (in order)
//             is "speech" by the first two characters the system prompt lists under "Characters (write their names
//             exactly as here):" taking turns (odd k the first, even k the second; "new:a stranger" after "someone"),
//             with the note "quiet and wary" (odd k) or "bright and quick" (even k). A line that starts with an
//             asterisk (*italics*) is the first character's "thought" ("small and inward"). The first sentence of
//             narration in each paragraph gets {"kind": "narration", "emotion": "tense", "note": "hushed and steady"}.
//             e.g. {"lines": {"1": {"kind": "speech", "who": "Mara", "emotion": "tense", "intensity": 2, "note": "quiet and wary"}}}
//
//   voice     Suggest (a character's voice): always
//             "A woman in her thirties with a low, steady voice, a slight northern lilt and a dry, unhurried delivery."
//             When the system prompt also asks how the name is said ("SAY IT AS:", the AI filling in a voice by
//             itself), a character called Siobhan also gets a last line "SAY IT AS: shiv-AWN" (SUGGESTED_SAY);
//             every other name gets none.
//
//   sounds    Sound effects (src/main/sounds/prompt.ts): for each numbered paragraph ("[P3] ..." under "The passage:" in
//             the user message; "[--]" paragraphs are left alone), a door effect where it says "slammed"
//             (SOUND_DOOR, word "slammed", 2 seconds), a thunder effect where it says "thunder" (SOUND_THUNDER), and a
//             rain ambience where it says "rain" (SOUND_RAIN, word "rain", playing on), unless the message says rain is
//             playing already. "at" is the word with the words either side of it, as written. A paragraph that says
//             "indoors" stops the ambience playing ({"type": "stop"}).
//             e.g. {"sounds":[{"type":"ambience","sound":"steady rain on a roof","p":1,"at":"The rain fell","word":"rain","until":null}]}

const MARKER = '[AIWRITE-READ-ALOUD v1]'

export const SUGGESTED_VOICE = 'A woman in her thirties with a low, steady voice, a slight northern lilt and a dry, unhurried delivery.'
export const SUGGESTED_SAY = 'shiv-AWN'
export const SOUND_DOOR = 'a heavy wooden door slamming shut'
export const SOUND_THUNDER = 'a distant rumble of thunder'
export const SOUND_RAIN = 'steady rain on a roof'

/** The numbered paragraphs of a sounds request: [{n, text}]. */
function soundParagraphs(text) {
  const passage = text.split('The passage:\n')[1] ?? ''
  return [...passage.matchAll(/\[P(\d+)\] ([\s\S]*?)(?=\n\n\[(?:P\d+|--)\] |$)/g)].map((m) => ({ n: Number(m[1]), text: m[2] }))
}

/** A word in a paragraph with the words either side of it, as written; null when it isn't there. */
function around(text, word) {
  const m = new RegExp(`(?:\\S+\\s+)?\\b${word}\\b(?:\\s+\\S+)?`, 'i').exec(text)
  return m ? { at: m[0].trim(), word: new RegExp(`\\b${word}\\b`, 'i').exec(m[0])[0] } : null
}

function soundsReply(user) {
  const sounds = []
  let raining = /Playing as this passage starts: the ambience "[^"]*rain/i.test(user)
  for (const p of soundParagraphs(user)) {
    const rain = around(p.text, 'rain')
    if (rain && !raining) {
      sounds.push({ type: 'ambience', sound: SOUND_RAIN, p: p.n, ...rain, until: null })
      raining = true
    }
    const door = around(p.text, 'slammed')
    if (door) sounds.push({ type: 'effect', sound: SOUND_DOOR, p: p.n, ...door, seconds: 2 })
    const thunder = around(p.text, 'thunder')
    if (thunder) sounds.push({ type: 'effect', sound: SOUND_THUNDER, p: p.n, ...thunder, seconds: 4 })
    const inside = around(p.text, 'indoors')
    if (inside && raining) {
      sounds.push({ type: 'stop', p: p.n, ...inside })
      raining = false
    }
  }
  return JSON.stringify({ sounds })
}

/** The names under "Characters in this story:" in the system prompt. */
function castNames(system) {
  const block = system.split('Characters in this story:')[1] ?? system.split('Characters (write their names exactly as here):')[1] ?? ''
  const names = []
  for (const line of block.split('\n').slice(1)) {
    const m = /^- (.+?)(?: \(also [^)]*\))?(?: \[in this scene\])?(?::|$)/.exec(line.trim())
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
    // The director numbers the narration after a quote too (“Fine,” [6]someone muttered): the numbers aren't words.
    someone: /^["“][^"”]*["”],?\s+someone\b/.test(text.slice(m.index + m[0].length - 1).replace(/\[\d+\]/g, ''))
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

  if (job === 'director') {
    const text = userText(messages).split('\n---\n').at(-1) ?? ''
    const out = {}
    let k = 0
    for (const para of text.split(/\n\n+/)) {
      let told = false
      for (const l of numberedLines(para)) {
        const at = para.indexOf(`[${l.n}]`) + `[${l.n}]`.length
        if (l.quote) {
          k++
          out[l.n] = l.someone
            ? { kind: 'speech', who: 'new:a stranger', emotion: 'neutral', intensity: 1, note: 'flat' }
            : { kind: 'speech', who: names.length ? names[(k - 1) % Math.min(2, names.length)] : 'new:someone', emotion: 'tense', intensity: 2, note: k % 2 ? 'quiet and wary' : 'bright and quick' }
        } else if (para[at] === '*' && names.length) {
          out[l.n] = { kind: 'thought', who: names[0], emotion: 'anxious', intensity: 1, note: 'small and inward' }
        } else if (!told) {
          out[l.n] = { kind: 'narration', emotion: 'tense', note: 'hushed and steady' }
          told = true
        }
      }
    }
    return JSON.stringify({ lines: out, state: { present: names.slice(0, 2), lastSpeakers: [], newPeople: [] } })
  }

  if (job === 'sounds') return soundsReply(userText(messages))

  if (job === 'voice') {
    const name = /^CHARACTER: ([^(\n]+?)(?: \(|$)/m.exec(userText(messages))?.[1] ?? ''
    return system.includes('SAY IT AS:') && name === 'Siobhan' ? `${SUGGESTED_VOICE}\nSAY IT AS: ${SUGGESTED_SAY}` : SUGGESTED_VOICE
  }
  return null
}
