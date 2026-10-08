// Reading the bridge's pending requests, for whoever stands in for the model:
//   node tests/chat-eval/bridge-view.mjs <bridge-dir>                 lists what is waiting
//   node tests/chat-eval/bridge-view.mjs <bridge-dir> <seq> [--system] [--max N]
//        shows one request: the tools offered and tool_choice, then each message (the system message only as its
//        first lines and a fingerprint unless --system; tool results cut at N characters, default 3000)
//   node tests/chat-eval/bridge-view.mjs <bridge-dir> <seq> --reply <file.json>
//        checks a reply file and puts it in done\ (as <seq>.json)
import { createHash } from 'node:crypto'
import { copyFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readReply } from './bridge.mjs'

const [dir, seq, ...rest] = process.argv.slice(2)
if (!dir) {
  console.error('Give the bridge folder.')
  process.exit(2)
}
const pending = readdirSync(join(dir, 'pending')).filter((f) => f.endsWith('.json')).sort()
if (!seq) {
  console.log(pending.length ? pending.join('\n') : '(nothing waiting)')
  process.exit(0)
}
const file = pending.find((f) => f.startsWith(seq)) ?? `${seq}.json`
const replyAt = rest.indexOf('--reply')
if (replyAt >= 0) {
  const src = rest[replyAt + 1]
  readReply(readFileSync(src, 'utf8'))
  copyFileSync(src, join(dir, 'done', file))
  console.log(`reply for ${file} is in done\\`)
  process.exit(0)
}
const req = JSON.parse(readFileSync(join(dir, 'pending', file), 'utf8'))
const max = Number(rest[rest.indexOf('--max') + 1]) || 3000
const full = rest.includes('--system')
console.log(`# ${req.seq}  tools: ${req.tools.map((t) => t.function?.name ?? t.name).join(', ') || 'none'}  tool_choice: ${JSON.stringify(req.tool_choice)}  max_tokens: ${req.max_tokens}`)
for (const m of req.messages) {
  const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  if (m.role === 'system') {
    const fp = createHash('sha1').update(text).digest('hex').slice(0, 10)
    console.log(`\n## system (${text.length} chars, ${fp})\n${full ? text : text.split('\n').slice(0, 3).join('\n') + '\n…'}`)
  } else if (m.role === 'tool') {
    console.log(`\n## tool ${m.tool_call_id}\n${text.length > max ? `${text.slice(0, max)}\n[… ${text.length - max} more]` : text}`)
  } else {
    const calls = (m.tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments})`).join('\n  ')
    console.log(`\n## ${m.role}\n${text}${calls ? `\n  calls: ${calls}` : ''}`)
  }
}
