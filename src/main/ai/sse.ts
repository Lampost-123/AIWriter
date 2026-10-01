// A small, forgiving parser for server-sent events, as used by every
// OpenAI-compatible streaming API. It copes with events split across network
// chunks, CRLF / CR / LF line endings, ": comment" keep-alive lines and
// multi-line data fields. Pure: no network, no Electron.

export class SseParser {
  private buf = ''
  private data: string[] = []

  /** Feeds raw text and returns the data payload of every event completed by it. */
  push(chunk: string): string[] {
    this.buf += chunk
    const events: string[] = []
    let start = 0
    let i = 0
    while (i < this.buf.length) {
      const c = this.buf.charCodeAt(i)
      if (c !== 10 && c !== 13) {
        i++
        continue
      }
      // A CR at the very end may be the first half of a CRLF: wait for more.
      if (c === 13 && i + 1 >= this.buf.length) break
      const line = this.buf.slice(start, i)
      i += c === 13 && this.buf.charCodeAt(i + 1) === 10 ? 2 : 1
      start = i
      this.line(line, events)
    }
    this.buf = this.buf.slice(start)
    return events
  }

  /** Call when the stream ends: completes any event still in progress. */
  end(): string[] {
    const events: string[] = []
    if (this.buf) {
      const rest = this.buf.replace(/\r$/, '')
      this.buf = ''
      this.line(rest, events)
    }
    this.dispatch(events)
    return events
  }

  private line(line: string, events: string[]): void {
    if (line === '') {
      this.dispatch(events)
      return
    }
    if (line.startsWith(':')) return // comment / keep-alive
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
    // 'event', 'id' and 'retry' fields are not needed here.
  }

  private dispatch(events: string[]): void {
    if (!this.data.length) return
    events.push(this.data.join('\n'))
    this.data = []
  }
}

/**
 * Turns one event's data into JSON objects. Some servers forget the blank line
 * between events, which glues several JSON objects into one payload; those are
 * split line by line. Returns 'done' for the [DONE] marker.
 */
export function parsePayload(data: string): { done: boolean; objects: unknown[]; bad: string[] } {
  const trimmed = data.trim()
  if (!trimmed) return { done: false, objects: [], bad: [] }
  if (trimmed === '[DONE]') return { done: true, objects: [], bad: [] }
  try {
    return { done: false, objects: [JSON.parse(trimmed)], bad: [] }
  } catch {
    const objects: unknown[] = []
    const bad: string[] = []
    let done = false
    for (const part of trimmed.split(/\n+/)) {
      const p = part.trim().replace(/^data:\s?/, '')
      if (!p) continue
      if (p === '[DONE]') {
        done = true
        continue
      }
      try {
        objects.push(JSON.parse(p))
      } catch {
        bad.push(p)
      }
    }
    return { done, objects, bad }
  }
}
