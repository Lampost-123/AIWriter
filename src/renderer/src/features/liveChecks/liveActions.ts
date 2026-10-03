// What Adam can do about a live flag: put the name right (Change to Mara), have the AI rewrite the
// sentence with a phrase to avoid in it (the AI tools' Rewrite, as a tracked change), or mark it as
// intended (Ignore, with Undo in a toast that gathers ignores made while it shows).
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { editorBridge } from '@/lib/editorBridge'
import { startTool } from '@/features/edits/session'
import type { PlacedFlag } from './liveDecorations'
import { ignoreLiveFlag, unignoreLiveFlag } from './liveWords'

/** True while the flag's words are still in the page where it says. */
const stillThere = (doc: PMNode, f: PlacedFlag): boolean => f.to <= doc.content.size && doc.textBetween(f.from, f.to, '\n', '\n') === f.word

/** Puts the name right: just those letters, as one step Ctrl+Z takes back. */
export function changeSpelling(editor: Editor, flag: PlacedFlag): void {
  const view = editor.view
  if (!flag.suggestion || editor.isDestroyed) return
  if (editorBridge()?.busy()) {
    toast('A draft is being written into this scene. Wait for it to finish (or stop it), then try again.')
    return
  }
  if (!stillThere(view.state.doc, flag)) {
    toast('Those words have changed. Have another look.')
    return
  }
  view.dispatch(closeHistory(view.state.tr.insertText(flag.suggestion, flag.from, flag.to)))
  // Typing straight after is a step of its own.
  view.dispatch(closeHistory(view.state.tr))
  view.focus()
}

/** The sentence a flag is in (within its paragraph), without the spaces at its edges. */
export function sentenceAround(doc: PMNode, from: number, to: number): { from: number; to: number } {
  const $from = doc.resolve(from)
  const block = $from.parent
  const start = $from.start()
  const text = block.textBetween(0, block.content.size, undefined, '\n')
  const a = from - start
  const b = to - start
  // A sentence ends at . ! ? or … (and any closing quotes or brackets after), or at a line break.
  const END = /[.!?…]+["'”’)\]]*(?=\s|$)|\n/g
  let s = 0
  let e = text.length
  for (const m of text.matchAll(END)) {
    const endAt = m.index + m[0].length
    if (endAt <= a) s = endAt
    else if (m.index >= b) {
      e = m[0] === '\n' ? m.index : endAt
      break
    }
  }
  while (s < e && /\s/.test(text[s])) s++
  while (e > s && /\s/.test(text[e - 1])) e--
  return { from: start + s, to: start + e }
}

/** Asks the AI tools' Rewrite for the sentence with a phrase to avoid in it, as a change to accept or reject. */
export function rewritePhrase(editor: Editor, flag: PlacedFlag): void {
  if (editor.isDestroyed) return
  if (!stillThere(editor.state.doc, flag)) {
    toast('Those words have changed. Have another look.')
    return
  }
  // The phrase as the list has it (the key is phrase:<paragraph>:<phrase>).
  const phrase = flag.key.split(':').slice(2).join(':') || flag.word
  void startTool('rewrite', {
    direction: `Rewrite this without “${phrase}”, keeping its meaning and the scene’s voice.`,
    range: sentenceAround(editor.state.doc, flag.from, flag.to)
  })
}

// ---------- Ignore ----------

interface Ignored {
  sceneId: ID
  flag: PlacedFlag
}

let batch: { toastId: number; items: Ignored[] } | null = null

/** The batch whose toast still shows. */
function liveBatch(): typeof batch {
  if (batch && !useToasts.getState().items.some((t) => t.id === batch!.toastId)) batch = null
  return batch
}

const WHERE: Record<PlacedFlag['kind'], string> = {
  spelling: 'It won’t be flagged again anywhere in this world.',
  phrase: 'It won’t be flagged again in this paragraph.',
  repetition: 'It won’t be flagged again in this scene.'
}

const messageFor = (items: Ignored[]): string =>
  items.length === 1 ? `Marked “${items[0].flag.word}” as intended. ${WHERE[items[0].flag.kind]}` : `Marked ${items.length} as intended.`

async function undoAll(items: Ignored[]): Promise<void> {
  for (const { sceneId, flag } of [...items].reverse()) {
    try {
      await unignoreLiveFlag(sceneId, flag.key)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }
}

/** Marks a flag as intended: it goes from the page at once, and the toast offers Undo. */
export function ignoreFlag(sceneId: ID, flag: PlacedFlag): void {
  const item: Ignored = { sceneId, flag }
  void ignoreLiveFlag(sceneId, { kind: flag.kind, key: flag.key, quote: flag.word, message: flag.message }).catch((e: Error) => {
    toast(e.message, { tone: 'danger' })
  })
  const b = liveBatch()
  if (b) {
    b.items.push(item)
    useToasts.getState().update(b.toastId, { message: messageFor(b.items) })
    return
  }
  const next = { toastId: 0, items: [item] }
  next.toastId = toast(messageFor(next.items), {
    action: {
      label: 'Undo',
      run: () => {
        if (batch === next) batch = null
        void undoAll(next.items)
      }
    }
  })
  batch = next
}
