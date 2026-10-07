// The fake planner (src/main/plan/, "[AIWRITE-PLAN v1]"): plans from what it was given, the way a careless real model
// might, so the app's checks have something to do. For the first character under "Where things stand" it relies on
// what they wear, in the wrong words ("a red coat": the app puts the stage's words back where they still hold), and on
// something they hold that the stage doesn't know ("a silver knife": left out); it plans them taking off what the stage
// says they wear (kept), putting on what they already wear (already so: left out), and a stranger bursting in that the
// scene card never asks for (left out). With no one on the stage it plans a knock at the door. It asks for the first
// entry under "Also in the world". A scene card with "PLAN-BROKEN" in it gets an answer that isn't JSON. Null for any
// other request.

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
  // "- Mara: where: in the scene; wearing: grey cloak"
  const first = /^- ([^:\n]+): (.+)$/m.exec(part(user, 'Where things stand'))
  const name = first?.[1]?.trim() ?? ''
  const wearing = first ? (/(?:^|; )wearing: ([^;]+)/.exec(first[2])?.[1]?.trim() ?? '') : ''
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
  return JSON.stringify({ relies, changes, needs: other ? [other] : [] })
}
