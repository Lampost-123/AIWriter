// Fake tool calls for Write the whole chapter's agent (src/main/chapterWriter/prompts.ts: system prompts starting
// "[AIWRITE-CHAPTER v1] <job>"), so tests know exactly what a run does:
//   study      write_brief once: the overview "A fake brief.", and for each "### Sc N" heading in the request, notes
//              "Keep Sc N true to the memory."; questions ["Sc 1's card has Mara at the inn; the memory has her at the
//              ferry."] when the request names Mara. Then words.
//   review     with findings (lines "F1 [...") and numbered words ("[1] ..."): one revise of paragraph [1], from its first
//              three words to its last three, to the same words with " The rain went on." after them, fixing every
//              finding listed; then done. A finding that quotes words of paragraph [2] and says "eyes" is set aside
//              instead, with not_a_problem quoting paragraph [2]'s first sentence (so the app can find the words).
//   chapter    with findings: reads Sc 1, then sets each aside with not_a_problem quoting its paragraph [1]'s first
//              sentence; then done (asked again while findings are open, it calls done again: the third time is accepted).
//   proofread  done.
// The model fake/agent-words answers every request in words, never calling a tool (the app sends it back twice,
// then the session ends). The model fake/agent-greedy first looks things up, three at a time (Ch 1's scenes, Mara,
// Tobin, a search, the story so far, the outline), in study, review and chapter sessions, as a live model did
// (2026-10-16), until the app says there are no more look-ups; then it goes on as above. The model
// fake/agent-checks-again calls check_again after its revise in a review, before done. Returns null for any other
// request.

const MARKER = '[AIWRITE-CHAPTER v1]'

/** What fake/agent-greedy looks up, in turn. */
const GREEDY = [
  ['read_scene', { scene: 'Ch 1, Sc 1' }],
  ['get_entry', { name: 'Mara' }],
  ['read_scene', { scene: 'Ch 1, Sc 2' }],
  ['search', { query: 'ferry' }],
  ['read_scene', { scene: 'Ch 1, Sc 3' }],
  ['get_entry', { name: 'Tobin' }],
  ['story_so_far', {}],
  ['outline', {}]
]

const contentOf = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p.text ?? '').join('') : '')

export function chapterToolCalls(system, messages, tools, model = '') {
  if (!String(system).startsWith(MARKER) || !Array.isArray(tools) || !tools.length) return null
  if (model === 'fake/agent-words') return null
  const job = String(system).slice(MARKER.length).trim().split(/\s/)[0]
  const user = contentOf(messages.find((m) => m.role === 'user'))
  const calls = messages.flatMap((m) => (m.tool_calls ?? []).map((c) => c.function?.name))
  const called = (name) => calls.includes(name)
  const last = messages[messages.length - 1]
  const lastResult = last?.role === 'tool' ? contentOf(last) : ''
  if (model === 'fake/agent-greedy' && job !== 'proofread' && !messages.some((m) => m.role === 'tool' && contentOf(m).startsWith('No more look-ups'))) {
    const offered = new Set(tools.map((t) => t.function?.name ?? t.name))
    const looks = GREEDY.filter(([name]) => offered.has(name))
    if (looks.length) return [0, 1, 2].map((i) => ({ name: looks[(calls.length + i) % looks.length][0], arguments: looks[(calls.length + i) % looks.length][1] }))
  }

  if (job === 'study') {
    if (called('write_brief')) return null
    const scenes = [...user.matchAll(/^### (Sc \d+)/gm)].map((m) => m[1])
    return [
      {
        name: 'write_brief',
        arguments: {
          overview: 'A fake brief.',
          scenes: scenes.map((s) => ({ scene: s, notes: `Keep ${s} true to the memory.` })),
          questions: /\bMara\b/.test(user) ? ["Sc 1's card has Mara at the inn; the memory has her at the ferry."] : []
        }
      }
    ]
  }
  if (job === 'chapter' && !lastResult.startsWith('Done.')) {
    const findings = [...user.matchAll(/^(F\d+) \[/gm)].map((m) => m[1])
    if (findings.length && !called('read_scene')) return [{ name: 'read_scene', arguments: { scene: 'Sc 1' } }]
    const p1 = /^\[1\] (.+)$/m.exec(lastResult)?.[1] ?? ''
    const first = (p1.match(/[^.!?]+[.!?]/) ?? [p1])[0].trim()
    if (findings.length && first && !called('not_a_problem')) {
      return findings.map((id) => ({ name: 'not_a_problem', arguments: { finding: id, why: `The chapter says "${first}" and reads as one piece.` } }))
    }
  }
  if (job === 'proofread' || job === 'chapter') {
    if (lastResult.startsWith('Done.')) return null
    return [{ name: 'done', arguments: { summary: job === 'proofread' ? 'Nothing to fix.' : 'The chapter reads as one piece.' } }]
  }
  if (job !== 'review') return null
  if (lastResult.startsWith('Done.')) return null
  if (!called('revise') && !called('not_a_problem')) {
    const findings = [...user.matchAll(/^(F\d+) \[[^\]]*\] (.*)$/gm)].map((m) => ({ id: m[1], line: m[2] }))
    const p1 = /^\[1\] (.+)$/m.exec(user)?.[1] ?? ''
    const p2 = /^\[2\] (.+)$/m.exec(user)?.[1] ?? ''
    const out = []
    const aside = findings.filter((f) => /eyes/i.test(f.line) && p2 && f.line.includes(p2.slice(0, 20)))
    for (const f of aside) {
      const first = (p2.match(/[^.!?]+[.!?]/) ?? [p2])[0].trim()
      out.push({ name: 'not_a_problem', arguments: { finding: f.id, why: `The scene says "${first}" so it fits.` } })
    }
    const fix = findings.filter((f) => !aside.includes(f))
    if (fix.length && p1) {
      const words = p1.split(/\s+/)
      out.push({
        name: 'revise',
        arguments: {
          scene: '',
          start: words.slice(0, 3).join(' '),
          end: words.slice(-3).join(' '),
          new_words: `${p1} The rain went on.`,
          fixes: fix.map((f) => f.id),
          why: 'Tightened the middle.'
        }
      })
    }
    if (out.length) return out
  }
  if (model === 'fake/agent-checks-again' && called('revise') && !called('check_again')) return [{ name: 'check_again', arguments: {} }]
  return [{ name: 'done', arguments: { summary: 'Fixed what was found.' } }]
}
