// Build with AI's Cast and world (2026-10-20): the people, places and more the story needs, built with the AI. Two ways,
// side by side as a choice:
//   - From your idea (the Story builder's Cast and world step, CodexStep.tsx): the AI plans everything the idea needs,
//     Adam ticks, edits, redoes or talks it over, then builds it into the codex, with one Undo;
//   - From a summary (the World builder, SummaryBuilder): a summary of the world or story, from a paragraph to pages,
//     laid out and saved as it goes.
// Then Interview me, topic by topic (TopicInterviews: characters, places, lore and history, then how it all connects).
// Under them, who and what the world has now, by kind, with Add someone with AI (the character builder) and the codex.

import { useEffect, useMemo, useState } from 'react'
import type { Entry, EntryKind, ID } from '@shared/types'
import { KIND_LABELS } from '@shared/fields'
import { ArrowRight, LayoutGrid, UserPlus, Users, WandSparkles } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { KIND_ICONS, KIND_INK } from '@/features/world/kindIcons'
import { CodexStep } from '@/features/storyBuilder/CodexStep'
import { SummaryBuilder } from '@/features/worldBuilder/WorldBuilderView'
import { TopicInterviews } from '@/features/worldInterviews/TopicInterviews'
import type { BuildSection } from './buildLogic'
import { showSummary } from './hubStore'

/** The kinds "In your world" lists, in order (plot threads have their own section). */
const KINDS: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'event', 'glossary']
/** The most names shown for a kind before "and N more". */
const NAMES_MOST = 8

export function CastSection({ storyId, summary, premise, onGo }: { storyId: ID; summary: boolean; premise: string; onGo: (s: BuildSection) => void }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div role="group" aria-label="How to build the cast and world" className="hub-chips" data-cast-way>
        <span className="hub-chips-l">Build it</span>
        <button type="button" aria-pressed={!summary} className={cn('hub-chip', !summary && 'is-on')} onClick={() => showSummary(storyId, false)} data-cast-way-idea>
          from your idea
        </button>
        <button type="button" aria-pressed={summary} className={cn('hub-chip', summary && 'is-on')} onClick={() => showSummary(storyId, true)} data-cast-way-summary>
          from a summary
        </button>
      </div>
      {summary ? (
        <div className="build-summary">
          <p className="build-panel-s">
            Type, paste or dictate a summary of your world or story, from a paragraph to several pages. The AI lays out every character, place, rule and thread
            in it and saves them to your world as it goes. Your own words are kept exactly as you wrote them, and anything already in your world is left as it is.
          </p>
          <SummaryBuilder />
        </div>
      ) : (
        <CodexStep storyId={storyId} premise={premise} onGo={(s) => onGo(s)} onSummary={() => showSummary(storyId, true)} />
      )}
      <TopicInterviews storyId={storyId} back={{ view: { kind: 'planHub', storyId, section: 'cast' }, label: 'Back to Build with AI' }} />
      <InYourWorld />
    </div>
  )
}

/** Who and what the world has now: each kind with how many and its first names (a click opens one), and the ways to add more. */
function InYourWorld(): React.JSX.Element {
  const rev = useApp((s) => s.entriesRev)
  const worldId = useApp((s) => s.world?.id)
  const [entries, setEntries] = useState<Entry[] | null>(null)
  useEffect(() => {
    let live = true
    api
      .listEntries()
      .then((list) => live && setEntries(list))
      .catch(() => live && setEntries([]))
    return () => {
      live = false
    }
  }, [rev, worldId])
  const byKind = useMemo(
    () => KINDS.map((k) => ({ kind: k, list: (entries ?? []).filter((e) => e.kind === k).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.list.length),
    [entries]
  )
  const go = useApp((s) => s.navigate)
  return (
    <section aria-label="In your world" className="build-world" data-in-world>
      <div className="build-world-head">
        <Users size={14} className="text-muted" aria-hidden />
        <h3 className="build-world-t">In your world</h3>
        <span className="flex-1" />
        <Button size="sm" variant="ai" icon={<UserPlus size={13} />} onClick={() => go({ kind: 'builder', entryKind: 'character', entryId: null })} data-add-someone>
          Add someone with AI
        </Button>
        <Button size="sm" icon={<LayoutGrid size={13} />} onClick={() => go({ kind: 'codex' })}>
          Open the codex
        </Button>
      </div>
      {entries === null ? (
        <div className="build-world-wait" aria-hidden />
      ) : byKind.length ? (
        <ul className="build-world-list">
          {byKind.map(({ kind, list }) => {
            const Icon = KIND_ICONS[kind]
            return (
              <li key={kind} className="build-world-row">
                <span className={cn('build-world-kind', KIND_INK[kind].tile)} aria-hidden>
                  <Icon size={13} />
                </span>
                <span className="build-world-n">
                  {list.length} {list.length === 1 ? KIND_LABELS[kind].one.toLowerCase() : KIND_LABELS[kind].many.toLowerCase()}
                </span>
                <span className="build-world-names">
                  {list.slice(0, NAMES_MOST).map((e) => (
                    <button key={e.id} type="button" className="build-world-name" onClick={() => go({ kind: 'entries', entryKind: e.kind, entryId: e.id })} title={`Open ${e.name}`}>
                      {e.name || 'Unnamed'}
                    </button>
                  ))}
                  {list.length > NAMES_MOST ? (
                    <button type="button" className="hub-link" onClick={() => go({ kind: 'entries', entryKind: kind, entryId: null })}>
                      and {list.length - NAMES_MOST} more
                      <ArrowRight size={11} aria-hidden />
                    </button>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="build-panel-s">
          <WandSparkles size={13} className="mr-1 inline text-ai" aria-hidden />
          Nobody and nothing yet. Plan the cast and world from your idea above, or add someone with AI.
        </p>
      )}
    </section>
  )
}
