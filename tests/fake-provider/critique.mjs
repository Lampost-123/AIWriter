// Fake replies for the scene and chapter critic (src/main/critique/prompts.ts: system prompts starting
// "[AIWRITE-CRITIQUE v1] scene" or "... chapter"). They read the words in the request (everything after the
// "## The scene: <title>" or "## The chapter: <title>" heading, a chapter's scenes under "### Scene N: ..." headings)
// and answer, so tests know exactly what a critique holds:
//   summary    "The scene moves well, but its middle slows." (a chapter: "The chapter builds steadily to its last scene.")
//   strengths  ["The opening line sets the mood at once."]
//   notes      1. pacing, high, "The middle slows", quoting the scene's (a chapter's first scene's) second sentence;
//              2. for a chapter, pull, medium, "The ending could pull harder", quoting its last scene's first sentence;
//              3. prose, low, "A quote from nowhere", quoting words that are in no scene (the app keeps the note,
//                 without the quote).
// The model fake/critique-bad-json answers its first critique with words, not JSON (asked once more, it answers
// properly). Returns null for any other request.

const MARKER = '[AIWRITE-CRITIQUE v1]'
let badJsonSeen = 0

const sentencesOf = (text) =>
  text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\(|^Summary:|^\[/.test(l))
    .flatMap((l) => l.match(/[^.!?]+[.!?]+["'’”]?|[^.!?]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)

/** The words sent: the text after the scene's or chapter's heading, up to the next part's. */
function wordsIn(user, scope) {
  const at = user.search(new RegExp(`^## The ${scope}: `, 'm'))
  if (at < 0) return ''
  const rest = user.slice(at).split('\n').slice(1).join('\n')
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

export function critiqueReply(system, user, model = '') {
  const s = String(system)
  if (!s.includes(MARKER)) return null
  const scope = s.includes(`${MARKER} chapter`) ? 'chapter' : 'scene'
  if (model === 'fake/critique-bad-json' && badJsonSeen++ === 0) return 'This scene is lovely, I would change very little.'
  const words = wordsIn(String(user), scope)
  const scenes = scope === 'chapter' ? words.split(/^### Scene \d+: .*$/m).slice(1) : [words]
  const first = sentencesOf(scenes[0] ?? '')
  const last = sentencesOf(scenes[scenes.length - 1] ?? '')
  const notes = []
  if (first.length) {
    notes.push({
      category: 'pacing',
      weight: 'high',
      title: 'The middle slows',
      quote: first[1] ?? first[0],
      suggestion: 'Cut this back to one line so the scene keeps moving.'
    })
  }
  if (scope === 'chapter' && last.length) {
    notes.push({
      category: 'pull',
      weight: 'medium',
      title: 'The ending could pull harder',
      quote: last[0],
      suggestion: 'End on a question the next chapter has to answer.'
    })
  }
  notes.push({
    category: 'prose',
    weight: 'low',
    title: 'A quote from nowhere',
    quote: 'Words that are nowhere in the text at all.',
    suggestion: 'Vary the sentence openings a little.'
  })
  return JSON.stringify({
    summary: scope === 'chapter' ? 'The chapter builds steadily to its last scene.' : 'The scene moves well, but its middle slows.',
    strengths: ['The opening line sets the mood at once.'],
    notes
  })
}
