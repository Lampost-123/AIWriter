// The fake planner (src/main/plan/, "[AIWRITE-PLAN v1]"): plans from what it was given, the way a careless real model
// might, so the app's checks have something to do. For the first character under "Where things stand" it relies on
// what they wear, in the wrong words ("a red coat": the app puts the stage's words back where they still hold), and on
// something they hold that the stage doesn't know ("a silver knife": left out); it plans them taking off what the stage
// says they wear (kept), putting on what they already wear (already so: left out), and a stranger bursting in that the
// scene card never asks for (left out). With no one on the stage it plans a knock at the door. It asks for the first
// entry under "Also in the world". A scene card with "PLAN-BROKEN" in it gets an answer that isn't JSON. Asked what must
// change (a scene contract), it says the card's beats and a dragon the card never asks for. Asked for a continuity
// brief, it writes one from what it was given (briefOf). Null for any other request.

export const PLAN_MARKER = '[AIWRITE-PLAN v1]'

/** The lines of one "## Title" part of the request (its title may go on: "## Where things stand as …"). */
function part(user, title) {
  const at = user.indexOf(`## ${title}`)
  if (at < 0) return ''
  const rest = user.slice(user.indexOf('\n', at) + 1)
  const end = rest.indexOf('\n## ')
  return end < 0 ? rest : rest.slice(0, end)
}

export function planReply(system, user) {
  if (!system.includes(PLAN_MARKER)) return null
  if (part(user, 'The scene card').includes('PLAN-BROKEN')) return 'I think the scene should be tense.'
  // "- Mara: where: in the scene", then each piece she wears on a line of its own: "  - wearing: grey cloak on"
  const stand = part(user, 'Where things stand')
  const first = /^- ([^:\n]+): (.+)$/m.exec(stand)
  const name = first?.[1]?.trim() ?? ''
  const wearing = first ? (/^ +- wearing: (.+?)(?: (?:on|off)\b.*)?$/m.exec(stand.slice(first.index))?.[1]?.trim() ?? '') : ''
  const other = /^([^(;\n]+?) \(/.exec(part(user, 'Also in the world (not in the briefing)').trim())?.[1]?.trim()
  const relies = name
    ? [
        { who: name, what: 'wearing', value: 'a red coat' },
        { who: name, what: 'holding', value: 'a silver knife' }
      ]
    : []
  const changes =
    name && wearing
      ? [
          { who: name, what: 'wearing', from: wearing, to: `${wearing} off, over the chair`, how: `${name} takes off the ${wearing} and hangs it over the chair.` },
          { who: name, what: 'wearing', from: '', to: wearing, how: `${name} puts on the ${wearing}.` },
          { who: '', what: 'fact', from: '', to: '', how: 'A stranger bursts in with a crossbow.' }
        ]
      : [{ who: '', what: 'fact', from: '', to: '', how: 'Someone knocks at the door.' }]
  const reply = { relies, changes, needs: other ? [other] : [] }
  // Asked what must change (the scene's contract, long story memory fix 13): the card's beats in their own words, and a
  // dragon the card never asks for (left out).
  if (system.includes('"must": [""]')) {
    const beats = [...part(user, 'The scene card').matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1].trim().replace(/[.]$/, ''))
    reply.must = [...beats, 'A dragon lands in the yard']
  }
  if (system.includes('"brief": {')) reply.brief = briefOf(user)
  return JSON.stringify(reply)
}

/** The "- " lines of one part of the request. */
const linesOf = (user, title) =>
  part(user, title)
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())

/**
 * Asked for a continuity brief (long story memory fix 14): each list from the part of what it was given that says it
 * (what must stay true, who knows what, the open plot threads, the story calendar), a line saying so when the book so far
 * was read whole, and a line citing a scene it was never given ("Ch 9, Sc 9": left out by the app).
 */
function briefOf(user) {
  const pov = /^Point of view: (.+)$/m.exec(part(user, 'The scene card'))?.[1]?.trim()
  return {
    matters: [
      pov ? `${pov} carries this scene, as the card says.` : 'The scene card says what matters here.',
      ...(user.includes('## The book so far, word for word') ? ['The book so far was read whole for this brief.'] : [])
    ],
    keep: [...linesOf(user, 'Must stay true').slice(0, 3), 'Mara lost her ring in Ch 9, Sc 9.'],
    knows: linesOf(user, 'Who knows what, among everyone here').slice(0, 2),
    promises: linesOf(user, 'Open plot threads').slice(0, 2),
    time: linesOf(user, 'The story calendar').slice(0, 2)
  }
}
