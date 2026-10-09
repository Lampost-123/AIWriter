// What the desk's World room loads (UI overhaul phase 4): the codex's cards, the entries in full (a group's or lore's
// category, the place one is inside, the dossier's fields) and where the story's plot threads stand. Reloaded whenever
// entries, the memory or the outline change; the last answer stays on screen while the next loads.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BoardThread } from '@shared/contracts/worldViews'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { Entry, ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { withDrafts } from '@/features/world/entryDrafts'

export interface WorldData {
  cards: CodexCard[] | null
  entries: Entry[] | null
  byId: Map<ID, Entry>
  threads: Map<ID, BoardThread>
  error: string | null
  retry: () => void
  /** Shows an edit on its card at once (the dossier's name or one-liner), before the next load. */
  live: (e: Entry) => void
}

export function useWorldData(): WorldData {
  const entriesRev = useApp((s) => s.entriesRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const storyId = useApp((s) => s.storyId)
  const [state, setState] = useState<{ cards: CodexCard[] | null; entries: Entry[] | null; threads: BoardThread[]; error: string | null }>({
    cards: null,
    entries: null,
    threads: [],
    error: null
  })
  const seq = useRef(0)
  const load = useCallback(() => {
    const ticket = ++seq.current
    Promise.all([api.listCodex(), api.listEntries(), storyId ? api.getThreadsBoard(storyId).catch(() => null) : Promise.resolve(null)])
      .then(([cards, entries, board]) => {
        if (ticket !== seq.current) return
        setState({ cards, entries: withDrafts(entries), threads: board?.threads ?? [], error: null })
      })
      .catch((e: Error) => ticket === seq.current && setState((s) => ({ ...s, error: e.message || 'Something went wrong.' })))
  }, [storyId])
  useEffect(() => load(), [load, entriesRev, memoryRev, outlineRev])

  const live = useCallback((e: Entry) => {
    setState((s) => ({
      ...s,
      entries: s.entries?.map((x) => (x.id === e.id ? e : x)) ?? s.entries,
      cards:
        s.cards?.map((c) =>
          c.id === e.id ? { ...c, name: e.name, summary: e.summary, aliases: e.aliases, hardRule: e.hardRule, image: e.image ?? null } : c
        ) ?? s.cards
    }))
  }, [])

  const byId = useMemo(() => new Map((state.entries ?? []).map((e) => [e.id, e])), [state.entries])
  const threads = useMemo(() => new Map(state.threads.map((t) => [t.id, t])), [state.threads])
  return { cards: state.cards, entries: state.entries, byId, threads, error: state.error, retry: load, live }
}
