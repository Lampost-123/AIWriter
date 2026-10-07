// Check and repair's fake replies (src/main/repair/, "[AIWRITE-REPAIR v1]"): the claims new words make, checked against
// where things stand. Two slips, read from the stage lines in the request ("- [W2] Mara · wearing: hood off · words:
// "..."") and the fake writer's prose:
//   - someone whose hood is off (wearing "... hood off") and the new words say "<Name> kept her hood low": a slip,
//     mended in place ("kept her hood low" becomes "kept her hood down");
//   - someone who has gone (where "gone to the docks") and the new words say "<Name> was where he had promised to be"
//     (a draft) or "<Name> set his cup down at last" (Continue): a slip that needs the author's choice, asked as a
//     question.
// The time, when the new words ring the hour, fits. Null for any other request.

const MARKER = '[AIWRITE-REPAIR v1]'

export function repairReply(system, user) {
  if (!String(system).includes(MARKER)) return null
  const text = String(user)
  const stage = [...text.matchAll(/^- \[(W\d+)\] (?:([^·\n]+?) · )?([a-z ]+): (.+?) · (?:words: "(.*)"|no words kept)$/gm)].map((m) => ({
    code: m[1],
    who: (m[2] ?? '').trim(),
    field: m[3],
    value: m[4],
    quote: m[5] ?? null
  }))
  const words = /## The new words \(check these\)\n"""\n([\s\S]*?)\n"""/.exec(text)?.[1] ?? ''
  const claims = []
  for (const l of stage) {
    if (l.field === 'wearing' && /\bhood off\b/.test(l.value)) {
      const quote = `${l.who} kept her hood low`
      if (words.includes(quote)) {
        claims.push({
          quote,
          who: l.who,
          about: 'wearing',
          line: l.code,
          verdict: 'slip',
          why: `${l.who} took her hood off earlier, so it isn't low over her face now.`,
          fix: { replace: 'kept her hood low', with: 'kept her hood down' }
        })
      }
    }
    if (l.field === 'where' && /^gone to the /.test(l.value)) {
      // The fake writer's draft, or the fake Continue's.
      const quote = [`${l.who} was where he had promised to be`, `${l.who} set his cup down at last`].find((q) => words.includes(q))
      if (quote) {
        claims.push({
          quote,
          who: l.who,
          about: 'where',
          line: l.code,
          verdict: 'slip',
          why: `${l.who} left earlier in the scene, but here he is, waiting.`,
          question: `${l.who} left for the ${l.value.replace(/^gone to the /, '')} earlier in the scene. Should he come back first, or is someone else waiting here?`
        })
      }
    }
    if (l.field === 'time' && words.includes('the bells of the Narrows began the hour')) {
      claims.push({ quote: 'the bells of the Narrows began the hour', who: '', about: 'time', line: l.code, verdict: 'fits', why: '' })
    }
  }
  return JSON.stringify({ claims })
}
