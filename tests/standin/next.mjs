// For the Claude helper that plays the stand-in model: waits for the next request nobody has answered yet and prints
// it, so the helper can read it and write the reply. Prints "none" and exits 3 when nothing arrives in time.
//
//   node tests/standin/next.mjs <folder> [--wait-ms 600000]
//
// The request is printed as: a header line (id, job, size, reply limit, tools), each tool's name and description, then
// each message under a "=== <role>" line. The reply goes to <folder>/outbox/<id>.json (see RESPONDER.md).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node tests/standin/next.mjs <folder> [--wait-ms 600000]')
  process.exit(2)
}
const i = process.argv.indexOf('--wait-ms')
const waitMs = i > 0 ? Number(process.argv[i + 1]) : 600_000
const inbox = join(dir, 'inbox')
const outbox = join(dir, 'outbox')

function unanswered() {
  if (!existsSync(inbox)) return []
  return readdirSync(inbox)
    .filter((f) => f.endsWith('.json') && !existsSync(join(outbox, f)))
    .sort()
}

const started = Date.now()
let found = unanswered()
while (!found.length && Date.now() - started < waitMs) {
  await new Promise((r) => setTimeout(r, 300))
  found = unanswered()
}
if (!found.length) {
  console.log('none')
  process.exit(3)
}

const r = JSON.parse(readFileSync(join(inbox, found[0]), 'utf8'))
const lines = [
  `REQUEST ${r.id} | job: ${r.job} | about ${r.estimated_tokens_in} tokens in | reply limit ${r.max_tokens ?? 'none'} tokens | ${r.tools.length} tools${found.length > 1 ? ` | ${found.length - 1} more waiting` : ''}`
]
if (r.response_format) lines.push(`RESPONSE FORMAT: ${JSON.stringify(r.response_format)}`)
if (r.tool_choice) lines.push(`TOOL CHOICE: ${JSON.stringify(r.tool_choice)}`)
for (const t of r.tools) lines.push(`TOOL ${t.name}: ${t.description ?? ''} ${t.parameters ? JSON.stringify(t.parameters) : ''}`)
for (const m of r.messages) {
  lines.push(`=== ${m.role}${m.name ? ` (${m.name})` : ''}${m.tool_call_id ? ` [result of ${m.tool_call_id}]` : ''}`)
  if (m.content) lines.push(m.content)
  if (m.tool_calls) lines.push(`(asked for tools: ${JSON.stringify(m.tool_calls)})`)
}
lines.push(`=== END. Write the reply to ${join(outbox, `${r.id}.json`)}`)
console.log(lines.join('\n'))
