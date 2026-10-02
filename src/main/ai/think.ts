// Removes "thinking" from streamed scene text. Reasoning models sometimes put
// their thinking inside <think>...</think> (or <thinking>) in the normal text;
// it must never reach the scene or count as scene words. Works across chunk
// boundaries: a tag split between two chunks is held back until it's complete.

const TAGS = ['<think>', '<thinking>', '</think>', '</thinking>']
const OPEN_OR_CLOSE = /<(\/?)think(?:ing)?>/i
const CLOSE = /<\/think(?:ing)?>/i

/** Length of the longest tail of `s` that could be the start of a tag. */
function partialTagTail(s: string): number {
  const lower = s.slice(-12).toLowerCase()
  let best = 0
  for (const tag of TAGS) {
    for (let k = Math.min(tag.length - 1, lower.length); k > best; k--) {
      if (lower.endsWith(tag.slice(0, k))) {
        best = k
        break
      }
    }
  }
  return best
}

export class ThinkFilter {
  /** True once any thinking has been seen (and removed). */
  sawThinking = false
  private inThink = false
  private pending = ''
  private started = false

  /** Takes raw streamed text; returns the part that belongs in the scene. */
  push(text: string): string {
    let s = this.pending + text
    this.pending = ''
    let out = ''
    while (s) {
      if (this.inThink) {
        const m = CLOSE.exec(s)
        if (m) {
          s = s.slice(m.index + m[0].length)
          this.inThink = false
          continue
        }
        const tail = partialTagTail(s)
        this.pending = tail ? s.slice(-tail) : ''
        s = ''
      } else {
        const m = OPEN_OR_CLOSE.exec(s)
        if (m) {
          out += s.slice(0, m.index)
          s = s.slice(m.index + m[0].length)
          // A stray closing tag (thinking that began before the text did) is just dropped.
          if (!m[1]) this.inThink = true
          this.sawThinking = true
          continue
        }
        const tail = partialTagTail(s)
        out += s.slice(0, s.length - tail)
        this.pending = tail ? s.slice(-tail) : ''
        s = ''
      }
    }
    return this.emit(out)
  }

  /** Call at the end of the stream: releases anything held back that wasn't a tag. */
  end(): string {
    const rest = this.inThink ? '' : this.pending
    this.pending = ''
    return this.emit(rest)
  }

  private emit(out: string): string {
    if (!this.started) {
      // The scene starts at its first real character.
      out = out.replace(/^\s+/, '')
      if (out) this.started = true
    }
    return out
  }
}
