// What the open scene is checked against: the world's names and the phrases to avoid for its story
// (getCheckWords), and the flags Adam ignored there (listLiveIgnores). Loaded when a scene opens and
// again when entries, a style guide or the story change, Adam's preference for common AI phrases
// changes, or the writing page shows again (his writing preferences may have changed in Settings). The last few scenes are kept, so switching back to
// one underlines it at once.
//
// Ignoring is instant: the flag goes from the page straight away, then the ignore is stored. Until a
// load made after it lands, the ignores in flight are laid over what was loaded, so a load already on its
// way never brings an ignored flag back for a moment.
import { useEffect, useState } from 'react'
import type { ID, Story } from '@shared/types'
import type { LiveIgnore } from '@shared/contracts/checks'
import { EMPTY_WORDS, prepareLiveWords, type LiveWords } from '@shared/liveChecks'
import { api, onEvent } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { usePrefs } from '@/features/style/prefsStore'
import { liveInputs, setLiveInputs } from './liveDecorations'

interface Loaded {
  rev: string
  words: LiveWords
  ignored: Set<string>
}

/** How many scenes' words are kept. */
const KEEP = 8
const loaded = new Map<ID, Loaded>()
/** Ignores and Undos not yet seen in a load: key → ignored or not, and the op's number once it is stored. */
const pending = new Map<string, { sceneId: ID; ignored: boolean; done: number | null }>()
let opsDone = 0
/** Bumped when the open scene's issues change elsewhere (an ignore taken back on the Issues tab). */
let issuesRev = 0
const issueListeners = new Set<() => void>()

registerDiscarder(() => {
  loaded.clear()
  pending.clear()
})

onEvent('issues:changed', ({ sceneIds }) => {
  const open = useApp.getState().sceneId
  if (!open || !sceneIds.includes(open)) return
  issuesRev++
  issueListeners.forEach((l) => l())
})

const avoidOf = (style: { avoidPhrases?: string[] } | null | undefined): string => (style?.avoidPhrases ?? []).join('\u0001')
const storiesAvoid = new WeakMap<Story[], string>()
function storyPhrases(stories: Story[]): string {
  let s = storiesAvoid.get(stories)
  if (s === undefined) {
    s = stories.map((x) => `${x.id}=${avoidOf(x.style)}`).join('\n')
    storiesAvoid.set(stories, s)
  }
  return s
}

/** What the words depend on (besides Adam's writing preferences, read again whenever the page shows). */
const revision = (s: ReturnType<typeof useApp.getState>): string =>
  `${s.world?.id ?? ''}:${s.entriesRev}:${avoidOf(s.world?.style)}:${storyPhrases(s.stories)}`

/** The ignored keys for a scene: as loaded, with the ignores in flight laid over them. */
function effective(sceneId: ID, base: Set<string>): Set<string> {
  let out = base
  for (const [key, p] of pending) {
    if (p.sceneId !== sceneId && !key.startsWith('spelling:')) continue
    if (p.ignored === out.has(key)) continue
    if (out === base) out = new Set(base)
    if (p.ignored) out.add(key)
    else out.delete(key)
  }
  return out
}

function use(sceneId: ID, l: Loaded): void {
  const cur = liveInputs()
  // The same words keep the same object, so nothing is matched afresh for nothing.
  const words = cur.words.key === l.words.key ? cur.words : l.words
  setLiveInputs({ sceneId, words, ignored: effective(sceneId, l.ignored) })
}

function put(sceneId: ID, l: Loaded): void {
  loaded.delete(sceneId)
  loaded.set(sceneId, l)
  for (const id of [...loaded.keys()].slice(0, Math.max(0, loaded.size - KEEP))) loaded.delete(id)
}

async function load(sceneId: ID, rev: string): Promise<Loaded | null> {
  const seen = opsDone
  try {
    const [w, ignores] = await Promise.all([api.getCheckWords(sceneId), api.listLiveIgnores(sceneId)])
    // Ignores stored before this load began are in it now.
    for (const [key, p] of pending) if (p.done !== null && p.done <= seen) pending.delete(key)
    const prev = loaded.get(sceneId)?.words
    const words = prepareLiveWords(w)
    return { rev, words: prev && prev.key === words.key ? prev : words, ignored: new Set(ignores.map((i: LiveIgnore) => i.key)) }
  } catch {
    // The last words stay; asked again on the next change.
    return null
  }
}

/**
 * Keeps the live checks' words for the scene on screen. `active` false (another page covers the writing
 * page) holds loading off; coming back loads again.
 */
export function useLiveWords(sceneId: ID | null, active: boolean): void {
  const rev = useApp(revision)
  // "Avoid common AI phrases" switched on or off while this page shows: the scene is checked again.
  const aiPhrases = usePrefs((s) => s.prefs?.avoidAiPhrases !== false)
  const [visit, setVisit] = useState(0)
  const [issues, setIssues] = useState(issuesRev)
  useEffect(() => {
    if (active) setVisit((v) => v + 1)
  }, [active])
  useEffect(() => {
    const l = (): void => setIssues(issuesRev)
    issueListeners.add(l)
    return () => void issueListeners.delete(l)
  }, [])

  useEffect(() => {
    if (!sceneId) {
      setLiveInputs({ sceneId: null, words: EMPTY_WORDS, ignored: new Set() })
      return
    }
    if (!active) return
    const key = `${rev}:${visit}:${issues}:${aiPhrases}`
    const cached = loaded.get(sceneId)
    if (cached) use(sceneId, cached)
    if (cached?.rev === key) return
    let cancelled = false
    // The first time straight away; after a change, a moment later, so a burst of changes asks once.
    const t = setTimeout(
      () =>
        void load(sceneId, key).then((l) => {
          if (!l || cancelled) return
          put(sceneId, l)
          if (useApp.getState().sceneId === sceneId) use(sceneId, l)
        }),
      cached ? 120 : 0
    )
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [sceneId, active, rev, visit, issues, aiPhrases])
}

/** Applies an ignore or its Undo in the page now, and stores it. Throws (plain words) if it couldn't be stored. */
async function setIgnored(sceneId: ID, key: string, ignored: boolean, store: () => Promise<void>): Promise<void> {
  const op = { sceneId, ignored, done: null as number | null }
  pending.set(key, op)
  const l = loaded.get(sceneId)
  if (l && liveInputs().sceneId === sceneId) use(sceneId, l)
  try {
    await store()
    op.done = ++opsDone
  } catch (e) {
    if (pending.get(key) === op) pending.delete(key)
    const cur = loaded.get(sceneId)
    if (cur && liveInputs().sceneId === sceneId) use(sceneId, cur)
    throw e
  }
  // The loaded lists follow (every scene's, for a spelling, which counts across the world), so a scene
  // shown again from what was loaded agrees.
  for (const [id, l] of loaded) {
    if (id !== sceneId && !key.startsWith('spelling:')) continue
    if (ignored) l.ignored.add(key)
    else l.ignored.delete(key)
  }
}

export function ignoreLiveFlag(sceneId: ID, flag: LiveIgnore & { quote: string; message: string }): Promise<void> {
  return setIgnored(sceneId, flag.key, true, () => api.ignoreLive(sceneId, flag))
}

export function unignoreLiveFlag(sceneId: ID, key: string): Promise<void> {
  return setIgnored(sceneId, key, false, () => api.unignoreLive(sceneId, key))
}
