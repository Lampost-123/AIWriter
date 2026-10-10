// Fake tool calls for Write the whole chapter's agent (src/main/chapterWriter/prompts.ts: system prompts starting
// "[AIWRITE-CHAPTER v1] <job>"), so tests know exactly what a run does:
//   study      write_brief once: the overview "A fake brief.", and for each "### Sc N" heading in the request, notes
//              "Keep Sc N true to the memory."; questions ["Sc 1's card has Mara at the inn; the memory has her at the
//              ferry."] when the request names Mara. Then words.
//   review     with findings (lines "F1 [...") and numbered words ("[1] ..."): one revise of paragraph [1], from its first
//              three words to its last three, to the same words with " The rain went on." after them, fixing every
//              finding listed; then done. A finding that quotes words of paragraph [2] and says "eyes" is set aside
//              instead, with not_a_problem quoting paragraph [2]'s first sentence (so the app can find the words).
//   chapter    done (asked again while findings are open, it calls done again: the third time is accepted).
//   proofread  done.
// The model fake/agent-words answers every request in words, never calling a tool (the app sends it back twice,
// then the session ends). Returns null for any other request.

const MARKER = '[AIWRITE-CHAPTER v1]'

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
  return [{ name: 'done', arguments: { summary: 'Fixed what was found.' } }]
}
