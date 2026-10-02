// The live checks' underlines in the page (milestone 5): phrases to avoid, repetition nearby and name
// spelling, worked out by src/shared/liveChecks.ts. A TipTap extension, in the editor's list
// (features/editor/extensions.ts).
//
// How it works:
//  - The underlines are decorations in this plugin's state: they never change the document, so drawing
//    them never autosaves or wakes the memory keeper.
//  - Typing never waits for a check. A change maps the underlines along with the words, and drops only
//    those whose own words it touched (a letter added to "Marra" takes its underline away at once).
//    About 300 ms after typing pauses, the scene is checked again: only paragraphs whose text changed
//    are read again (LiveCache), and an underline that stays the same is left as it is, so nothing
//    flickers.
//  - A misspelt name the caret is still at the end of isn't underlined until the caret leaves it, so a
//    name being typed ("Mar…") is never flagged half-way.
//  - Nothing is underlined while a draft streams into the page or text is held for replacing, nor
//    inside a change an AI tool is suggesting.
//  - The words to check against (names, phrases to avoid, ignored flags) are read from this module
//    (setLiveInputs), never captured when the extension is made: the scene controller swaps scenes by
//    building a new state from the same plugins.

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { ID } from '@shared/types'
import { checkScene, countFlags, EMPTY_WORDS, LiveCache, type LiveFlag, type LiveKind, type LiveParagraph, type LiveWords } from '@shared/liveChecks'
import { editorBridge } from '@/lib/editorBridge'
import { activeStream } from '@/features/editor/streamDoc'
import { activeSuggestion } from '@/features/edits/suggestions'
import { NO_FLAGS, setLiveCounts } from './liveStore'

export const LIVE_EXTENSION = 'aiwriteLiveChecks'
/** The class on every live underline; each kind adds `aw-live-<kind>`. */
export const LIVE_CLASS = 'aw-live'
/** How long after typing pauses the scene is checked again. */
export const CHECK_DELAY = 300

/** A flag as it stands in the page: positions in the document, mapped through every change. */
export interface PlacedFlag {
  kind: LiveKind
  from: number
  to: number
  word: string
  key: string
  message: string
  suggestion: string | null
  /** The paragraph's id. */
  pid: string | null
}

/** What a decoration keeps: no positions, so an underline that only moved still compares equal and isn't redrawn. */
type FlagSpec = Omit<PlacedFlag, 'from' | 'to'>

interface LiveInputs {
  /** The scene these words and ignores are for; nothing is underlined in any other. */
  sceneId: ID | null
  words: LiveWords
  ignored: ReadonlySet<string>
}

let inputs: LiveInputs = { sceneId: null, words: EMPTY_WORDS, ignored: new Set() }
const cache = new LiveCache()
const runners = new Set<LiveRunner>()

export const liveInputs = (): LiveInputs => inputs

/** Uses new words or ignores: the page is checked again straight away. */
export function setLiveInputs(next: LiveInputs): void {
  inputs = next
  for (const r of runners) r.runSoon(0)
}

// ---------- The plugin's state ----------

interface LiveState {
  set: DecorationSet
  /** Checked at least once since this state was made (a scene opened builds a new one). */
  ran: boolean
}

export const liveChecksKey = new PluginKey<LiveState>(LIVE_EXTENSION)

const LETTER = /[\p{L}\p{N}]/u

/** True while the words under a flag are still the words it was made for, as whole words. */
function stillFits(doc: PMNode, d: Decoration): boolean {
  const spec = d.spec as FlagSpec
  if (d.from >= d.to || d.to > doc.content.size) return false
  if (doc.textBetween(d.from, d.to, '\n', '\n') !== spec.word) return false
  const before = d.from > 0 ? doc.textBetween(d.from - 1, d.from, '\n', '\n') : ''
  const after = d.to < doc.content.size ? doc.textBetween(d.to, d.to + 1, '\n', '\n') : ''
  return !LETTER.test(before) && !LETTER.test(after)
}

/** Maps the underlines through a change, dropping those whose words it touched. */
function mapThrough(set: DecorationSet, tr: Transaction): DecorationSet {
  let next = set.map(tr.mapping, tr.doc)
  if (next === DecorationSet.empty) return next
  const gone: Decoration[] = []
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1)
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = rest.map(newStart, -1)
      const to = rest.map(newEnd, 1)
      for (const d of next.find(Math.max(0, from - 1), Math.min(tr.doc.content.size, to + 1))) if (!stillFits(tr.doc, d)) gone.push(d)
    })
  })
  if (gone.length) next = next.remove(gone)
  return next
}

/** Every paragraph's text (a line break is one character) and where its text starts. */
function paragraphsOf(doc: PMNode): { paras: LiveParagraph[]; starts: number[] } {
  const paras: LiveParagraph[] = []
  const starts: number[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    paras.push({ pid: (node.attrs.pid as string | null) ?? null, text: node.textBetween(0, node.content.size, undefined, '\n') })
    starts.push(pos + 1)
    return false
  })
  return { paras, starts }
}

function decoration(f: LiveFlag, start: number, pid: string | null): Decoration {
  const from = start + f.from
  const to = start + f.to
  // Only plain values in the spec, and no positions, so an underline that stays the same (or only moved)
  // compares equal and isn't redrawn.
  const spec: FlagSpec = { kind: f.kind, word: f.word, key: f.key, message: f.message, suggestion: f.suggestion, pid }
  return Decoration.inline(from, to, { class: `${LIVE_CLASS} ${LIVE_CLASS}-${f.kind}`, 'data-live': f.kind }, spec)
}

/** True when the page shows no live underlines at all now (a draft streaming or text held for one). */
export const liveHidden = (state: EditorState): boolean => !!activeStream(state)

/** The words an AI tool's waiting change covers (its flags are hidden), or null. */
function suggested(state: EditorState): { from: number; to: number } | null {
  const s = activeSuggestion(state)
  return s && s.from < s.to ? { from: s.from, to: s.to } : null
}

const overlaps = (d: { from: number; to: number }, r: { from: number; to: number } | null): boolean => !!r && d.from < r.to && r.from < d.to

const placed = (d: Decoration): PlacedFlag => ({ ...(d.spec as FlagSpec), from: d.from, to: d.to })

/** The flags shown in the page now, in reading order: none while it shows none, none inside an AI tool's change. */
export function liveFlagsOf(state: EditorState): PlacedFlag[] {
  const set = liveChecksKey.getState(state)?.set
  if (!set || liveHidden(state)) return []
  const s = suggested(state)
  return set
    .find()
    .filter((d) => !overlaps(d, s))
    .map(placed)
    .sort((a, b) => a.from - b.from)
}

/** The flag shown at a position in the page, if any. */
export function liveFlagAt(state: EditorState, pos: number): PlacedFlag | null {
  const set = liveChecksKey.getState(state)?.set
  if (!set || liveHidden(state)) return null
  const s = suggested(state)
  const d = set.find(pos, pos + 1).find((x) => x.from <= pos && pos < x.to && !overlaps(x, s))
  return d ? placed(d) : null
}

/** What decides which flags show besides the flags themselves, to notice when the counts change. */
const showing = (state: EditorState): string => {
  const s = suggested(state)
  return liveHidden(state) ? 'hidden' : s ? `${s.from}-${s.to}` : ''
}

// The underlines shown: without those inside a change an AI tool is suggesting. Worked out once per set
// and suggestion, so the page compares the same set from one draw to the next.
let shown: { set: DecorationSet; from: number; to: number; out: DecorationSet } | null = null
function visible(state: EditorState): DecorationSet | null {
  if (liveHidden(state)) return null
  const set = liveChecksKey.getState(state)?.set ?? null
  const s = suggested(state)
  if (!set || !s) return set
  if (shown?.set === set && shown.from === s.from && shown.to === s.to) return shown.out
  const out = set.remove(set.find(s.from, s.to).filter((d) => overlaps(d, s)))
  shown = { set, from: s.from, to: s.to, out }
  return out
}

// ---------- Checking after a pause ----------

class LiveRunner {
  private timer: ReturnType<typeof setTimeout> | null = null
  /** A misspelt name left alone because the caret is at it; checked again once the caret leaves. */
  private held: { from: number; to: number } | null = null
  /** The last check was asked for by an edit (so the word being typed is left alone). */
  private edited = false

  constructor(private readonly view: EditorView) {
    runners.add(this)
    this.runSoon(0)
  }

  update(view: EditorView, prev: EditorState): void {
    const state = view.state
    const st = liveChecksKey.getState(state)
    if (!st?.ran) {
      // Another scene's state: check it as soon as its words are known.
      if (prev.doc !== state.doc) {
        this.edited = false
        this.held = null
      }
      if (prev.doc !== state.doc || !this.timer) this.runSoon(0)
      return
    }
    if (prev.doc !== state.doc) {
      this.edited = true
      this.held = null
      this.runSoon(CHECK_DELAY)
      return
    }
    if (activeStream(prev) && !activeStream(state)) return this.runSoon(0)
    // An AI tool's change came or went: the flags under it are hidden, or back, and the counts follow.
    if (showing(prev) !== showing(state)) this.publish()
    const held = this.held
    if (held && (!state.selection.empty || state.selection.head < held.from || state.selection.head > held.to)) {
      this.held = null
      this.edited = false
      this.runSoon(0)
    }
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    runners.delete(this)
  }

  runSoon(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.run()
    }, ms)
  }

  private run(): void {
    const view = this.view
    if (view.isDestroyed) return
    // Never under a word an input method is composing; again a moment later.
    if (view.composing) return this.runSoon(CHECK_DELAY)
    const state = view.state
    // A draft is being written in (or text is held for one): checked once it ends.
    if (activeStream(state)) return
    const sceneId = editorBridge()?.sceneId ?? null
    if (!sceneId || inputs.sceneId !== sceneId) {
      // The words for this scene aren't known yet: nothing rather than another scene's.
      if (liveChecksKey.getState(state)?.set.find().length) this.dispatch(DecorationSet.empty, sceneId)
      return
    }
    const { paras, starts } = paragraphsOf(state.doc)
    const flags = checkScene(paras, inputs.words, inputs.ignored, cache)
    const sel = state.selection
    let held: { from: number; to: number } | null = null
    const decos: Decoration[] = []
    for (const f of flags) {
      const start = starts[f.para]
      if (this.edited && f.kind === 'spelling' && sel.empty && sel.head >= start + f.from && sel.head <= start + f.to) {
        held = { from: start + f.from, to: start + f.to }
        continue
      }
      decos.push(decoration(f, start, paras[f.para].pid))
    }
    this.held = held
    this.edited = false
    this.dispatch(DecorationSet.create(state.doc, decos), sceneId)
  }

  private dispatch(set: DecorationSet, sceneId: ID | null): void {
    const view = this.view
    view.dispatch(view.state.tr.setMeta(liveChecksKey, set).setMeta('addToHistory', false))
    this.publish(sceneId)
  }

  /** The counts for the Issues tab, of the flags shown. */
  private publish(sceneId: ID | null = inputs.sceneId === editorBridge()?.sceneId ? inputs.sceneId : null): void {
    setLiveCounts(sceneId, sceneId ? countFlags(liveFlagsOf(this.view.state)) : NO_FLAGS)
  }
}

const livePlugin = new Plugin<LiveState>({
  key: liveChecksKey,
  state: {
    init: () => ({ set: DecorationSet.empty, ran: false }),
    apply(tr, value) {
      const set = tr.getMeta(liveChecksKey) as DecorationSet | undefined
      if (set) return { set, ran: true }
      if (!tr.docChanged) return value
      return { set: mapThrough(value.set, tr), ran: value.ran }
    }
  },
  view: (view) => new LiveRunner(view),
  props: {
    decorations: visible
  }
})

export const LiveChecks = Extension.create({
  name: LIVE_EXTENSION,
  addProseMirrorPlugins: () => [livePlugin]
})
