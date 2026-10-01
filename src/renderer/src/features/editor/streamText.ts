// Turns streamed draft text (arriving in arbitrary chunks) into paragraph
// operations for the editor. Pure functions, so they're easy to test.
//
// Rules: any run of newlines starts a new paragraph (blank lines and single
// line breaks alike); spaces at the start of a paragraph are dropped; newlines
// before the first word are ignored; and a paragraph break is only emitted when
// text follows it, so a draft never ends with an empty paragraph.

export type StreamOp = { kind: 'text'; text: string } | { kind: 'paragraph' }

export interface SplitState {
  /** Some text has been emitted already. */
  started: boolean
  /** A newline arrived; the next text starts a new paragraph. */
  pendingBreak: boolean
  /** The next character is at the start of a line (leading spaces are dropped). */
  lineStart: boolean
}

export const newSplitState = (): SplitState => ({ started: false, pendingBreak: false, lineStart: true })

function pushText(ops: StreamOp[], text: string): void {
  const last = ops[ops.length - 1]
  if (last && last.kind === 'text') last.text += text
  else ops.push({ kind: 'text', text })
}

/** Splits one streamed chunk into paragraph operations, carrying state between chunks. */
export function splitChunk(state: SplitState, chunk: string): { ops: StreamOp[]; state: SplitState } {
  let { started, pendingBreak, lineStart } = state
  const ops: StreamOp[] = []
  const parts = chunk.replace(/\r\n?/g, '\n').split(/(\n+)/)
  for (const part of parts) {
    if (!part) continue
    if (part[0] === '\n') {
      if (started) pendingBreak = true
      lineStart = true
      continue
    }
    let text = part
    if (lineStart) {
      text = text.replace(/^[ \t ]+/, '')
      if (!text) continue
    }
    if (pendingBreak) {
      ops.push({ kind: 'paragraph' })
      pendingBreak = false
    }
    pushText(ops, text)
    started = true
    lineStart = false
  }
  return { ops, state: { started, pendingBreak, lineStart } }
}

/** Splits a whole text into paragraphs, the same way a stream would be split. */
export function splitParagraphs(text: string): string[] {
  const { ops } = splitChunk(newSplitState(), text)
  const out: string[] = []
  for (const op of ops) {
    if (op.kind === 'paragraph') out.push('')
    else if (out.length === 0) out.push(op.text)
    else out[out.length - 1] += op.text
  }
  return out.map((p) => p.replace(/[ \t]+$/, ''))
}

/** A line that marks a scene break: "***", "* * *", "---", "#" or "⁂". */
export function isSceneBreakLine(text: string): boolean {
  const t = text.trim()
  return /^(\*\s*){3,}$/.test(t) || /^(-\s*){3,}$/.test(t) || /^(_\s*){3,}$/.test(t) || t === '#' || t === '⁂' || /^(~\s*){3,}$/.test(t)
}
