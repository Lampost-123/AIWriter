// Fake replies for the consistency checks (src/main/checks/prompts.ts: system prompts starting
// "[AIWRITE-CHECK v1] <checks>"). They read the memory in the request (each entry under a heading
// "### E1 Mara (character; ...)", its fields as "- Eyes: blue" lines and "What has happened so far:" items)
// and the scene's text (everything after the "## The scene" heading), with these rules, so tests know
// exactly what a scene raises:
//   facts   "<Name>'s eyes are|were|flashed|shone <colour>" or "<Name>'s <colour> eyes" (either apostrophe), when the memory gives
//           <Name> other eyes: a warning about the eyes field, with a fix that puts the memory's colour back
//           (and "memory" / "text", so a field of Adam's can be updated from it).
//           A line of dialogue said by <Name> ("...," said Name / Name said / Name asked, replied, whispered,
//           shouted) when the memory says <Name> died, is dead or was killed: must fix, with no fix.
//   other checks find nothing.
//   story   (comparing two stories) finds nothing.
//   Every reply also says what each check looked at ("checked"): "Looked at <check>.", ok unless it raised something.
// The model fake/check-bad-json answers its first check with words, not JSON (asked once more, it answers
// properly). Returns null for any other request.

const MARKER = '[AIWRITE-CHECK v1]'
let badJsonSeen = 0

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sentencesOf = (text) =>
  text
    .split(/\n+/)
    .flatMap((l) => l.match(/[^.!?]+[.!?]+["'’”]?|[^.!?]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean)

/** The entries in the request: id, name, fields by label (lower case), and what has happened to them. */
function entriesIn(user) {
  const out = []
  let cur = null
  let inHappened = false
  for (const line of user.split('\n')) {
    const head = line.match(/^### (E\d+) (.+?) \(([^;)]+)/)
    if (head) {
      cur = { id: head[1], name: head[2].trim(), kind: head[3].trim(), fields: {}, happened: [], text: '' }
      out.push(cur)
      inHappened = false
      continue
    }
    if (/^## /.test(line)) {
      cur = null
      continue
    }
    if (!cur) continue
    cur.text += `${line}\n`
    if (/^What has happened so far:/.test(line)) {
      inHappened = true
      continue
    }
    const item = line.match(/^- (.+)$/)
    if (item && inHappened) {
      cur.happened.push(item[1])
      continue
    }
    const field = line.match(/^- ([^:]+): (.+)$/)
    if (field) cur.fields[field[1].trim().toLowerCase()] = field[2].trim()
  }
  return out
}

/** The scene's text: everything after its heading. */
const sceneIn = (user) => user.match(/(?:^|\n)## The scene[^\n]*\n([\s\S]*)$/)?.[1] ?? ''

const dead = (e) => [...e.happened, e.text].some((t) => /\b(died|dead|killed)\b/i.test(t))

function checkIssues(system, user) {
  const checks = system.split('\n')[0].slice(MARKER.length).split(',').map((s) => s.trim())
  if (!checks.includes('facts')) return []
  const scene = sceneIn(user)
  const sentences = sentencesOf(scene)
  const issues = []
  for (const e of entriesIn(user)) {
    const name = escape(e.name.split(' ')[0])
    const eyes = (e.fields.eyes ?? '').toLowerCase().match(/[a-z]+/)?.[0]
    if (eyes) {
      for (const s of sentences) {
        const m =
          s.match(new RegExp(`\\b${name}['’]s eyes (?:are|were|flashed|shone|gleamed) ([a-z]+)`)) ?? s.match(new RegExp(`\\b${name}['’]s ([a-z]+) eyes`))
        if (!m || m[1].toLowerCase() === eyes) continue
        issues.push({
          check: 'facts',
          severity: 'warning',
          quote: s,
          message: `${e.name}'s eyes are ${eyes} in the memory, but ${m[1]} here.`,
          conflicts: { entry: e.id, field: 'eyes' },
          memory: eyes,
          text: m[1],
          fix: s.replace(m[1], eyes)
        })
      }
    }
    if (dead(e)) {
      const says = new RegExp(`(?:said|says|asked|replied|whispered|shouted) ${name}\\b|\\b${name} (?:said|says|asked|replied|whispered|shouted)\\b`)
      const s = sentences.find((x) => says.test(x))
      if (s) {
        issues.push({
          check: 'facts',
          severity: 'must-fix',
          quote: s,
          message: `${e.name} is dead by this point in the story, but speaks here.`,
          advice: 'Give the line to someone alive, or cut it.',
          conflicts: { entry: e.id }
        })
      }
    }
  }
  return issues
}

/** The reply for a consistency check request, or null when it isn't one. */
export function checkReply(system, messages, model = '') {
  if (!system.startsWith(MARKER)) return null
  const users = (messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content ?? ''))
  if (model === 'fake/check-bad-json' && users.length === 1 && badJsonSeen++ === 0) return 'I found a couple of things worth a look in this scene.'
  if (/^\[AIWRITE-CHECK v1\] story/.test(system)) return JSON.stringify({ issues: [] })
  const issues = checkIssues(system, users[0] ?? '')
  // What each check looked at (the critic's report): "Looked at <check>." with ok unless it raised something.
  const checks = system.split('\n')[0].slice(MARKER.length).split(',').map((c) => c.trim()).filter(Boolean)
  const checked = checks.map((check) => ({ check, ok: !issues.some((i) => i.check === check), note: `Looked at ${check}.` }))
  return JSON.stringify({ issues, checked }, null, 1)
}
