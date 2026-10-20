import { X } from '@/components/ui/icons'
import { useMemo, useState } from 'react'
import type { ChangeView, Entry, ID } from '@shared/types'
import { Field, IconButton, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { normalizeName } from '../entryLogic'
import { changeSourceNote, changeUntil, shortQuote } from '../memoryLogic'
import { Combobox, type ComboOption } from '../parts/Combobox'
import type { ScenePlace } from '../useSceneLabels'
import { QuietError } from './QuietError'
import { SourceLine } from './SourceLine'
import { useEntryData, type EntryData } from './useEntryData'

type Knows = Extract<ChangeView, { kind: 'knowledge' }>

const MAX_SHOWN = 50
/** The option that adds what was typed as something they believe wrongly. */
const WRONG = 'new-wrong'
/** The option that adds what was typed as an order or suggestion they are to follow from the start (2026-10-20). */
const FOLLOW = 'new-follow'

/**
 * What a character knows from the beginning (baseline knowledge). Facts are shared by id, so
 * picking a fact another character knows means the AI can tell who knows it and who doesn't.
 * Something they believe that isn't true can be added as believed wrongly (the who-knows-what ledger, long story
 * memory fix 9): the AI writes them believing it until the story shows them learning otherwise.
 */
export function KnowledgeSection({
  self,
  adamsEntry,
  rows,
  data,
  places
}: {
  self: Pick<Entry, 'id' | 'name'>
  /** The entry is Adam's own: the note at the top of its page says he wrote it, so what he added needs no line of its own. */
  adamsEntry: boolean
  rows: Knows[]
  data: EntryData<ChangeView[]>
  places: Map<ID, ScenePlace> | null
}): React.JSX.Element {
  const facts = useEntryData(() => api.listFacts(), 'facts')
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const name = self.name.trim() || 'this character'

  const options = useMemo(() => {
    const known = new Set(rows.map((r) => r.payload.factId))
    const words = normalizeName(query).split(' ').filter(Boolean)
    const matching = (facts.data ?? []).filter((f) => !known.has(f.factId) && words.every((w) => normalizeName(f.fact).includes(w)))
    const list: ComboOption[] = matching
      .slice(0, MAX_SHOWN)
      .map((f) => ({ key: f.factId, label: f.wrong ? `${f.fact} (believed wrongly)` : f.fact }))
    const text = query.trim()
    const same = (facts.data ?? []).some((f) => normalizeName(f.fact) === normalizeName(text))
    if (text && !same) {
      list.push({ key: 'new', label: `Add "${text}"`, create: true })
      list.push({ key: WRONG, label: `Add "${text}" as something ${name} believes wrongly`, create: true })
      list.push({ key: FOLLOW, label: `Add "${text}" as something ${name} is to follow`, create: true })
    }
    return { list, more: Math.max(0, matching.length - MAX_SHOWN) }
  }, [facts.data, rows, query, name])

  const pick = async (o: ComboOption): Promise<void> => {
    setAddError(null)
    const fact = o.create
      ? { factId: crypto.randomUUID(), fact: query.trim(), ...(o.key === WRONG ? { wrong: true as const } : {}) }
      : (facts.data ?? []).find((f) => f.factId === o.key)
    if (!fact) return
    try {
      const c = await api.createChange({
        entryId: self.id,
        anchor: 'baseline',
        kind: 'knowledge',
        payload: {
          factId: fact.factId,
          fact: fact.fact,
          ...(fact.wrong ? { wrong: true as const } : {}),
          // To follow until the story lifts it (memory/state.ts FactState.rule): an order of the author's own, from no one.
          ...(o.key === FOLLOW ? { said: { kind: 'rule' as const, by: '', words: fact.fact } } : {})
        }
      })
      data.update((list) => [...list, c])
      if (o.create) facts.update((list) => [...list, fact])
    } catch (err) {
      setAddError(`Couldn't add that. ${(err as Error).message}`)
      throw err
    }
  }

  const remove = async (c: Knows): Promise<void> => {
    try {
      await api.deleteChange(c.id)
    } catch (err) {
      toast(`Couldn't remove ${shortQuote(c.payload.fact)}. ${(err as Error).message}`, { tone: 'danger' })
      return
    }
    data.update((list) => list.filter((x) => x.id !== c.id))
    announceDelete({
      message: `Removed ${shortQuote(c.payload.fact)} from what ${name} ${c.payload.wrong ? 'believes' : 'knows'}.`,
      noun: ['fact', 'facts'],
      undo: () =>
        api
          .restoreChange(c.id)
          .then(() => useApp.getState().bumpEntries())
          .catch((err: Error) => void toast(`Couldn't bring back ${shortQuote(c.payload.fact)}. ${err.message}`, { tone: 'danger' }))
    })
  }

  if (data.error && !data.data) return <QuietError what="what they know" message={data.error} onRetry={data.reload} />

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-relaxed text-muted">
        Secrets and facts {name} knows from the beginning, and anything {name} is to follow. The AI is told who knows what, and
        who doesn't.
      </p>
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((c) => {
            const note = c.origin === 'adam' && adamsEntry ? null : changeSourceNote(c)
            return (
              <li key={c.id} className="flex items-start gap-2 py-1.5 pl-3 pr-1.5">
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="text-[13.5px] leading-snug text-fg">{c.payload.fact}</p>
                  {c.payload.wrong ? <p className="text-[12px] leading-snug text-muted">Believes wrongly: it isn’t true</p> : null}
                  {c.payload.said?.kind === 'rule' ? (
                    <p className="text-[12px] leading-snug text-muted">To follow until the story lifts it</p>
                  ) : null}
                  {changeUntil(c) ? <p className="text-[12px] leading-snug text-faint">True {changeUntil(c)}</p> : null}
                  {note ? <SourceLine note={note} places={places} showAdam /> : null}
                </div>
                <IconButton
                  label={`Remove ${shortQuote(c.payload.fact)} from what ${name} ${c.payload.wrong ? 'believes' : 'knows'}`}
                  size="sm"
                  onClick={() => void remove(c)}
                >
                  <X size={13} />
                </IconButton>
              </li>
            )
          })}
        </ul>
      ) : null}
      {data.data ? (
        <div>
          <Field label={`Add something ${name} knows`}>
            {(id) => (
              <Combobox
                id={id}
                listLabel="Facts"
                query={query}
                onQuery={(q) => {
                  setQuery(q)
                  setAddError(null)
                }}
                options={options.list}
                more={options.more}
                onPick={pick}
                placeholder="Type a fact, or pick one another character knows…"
              />
            )}
          </Field>
          {addError ? (
            <p role="alert" className="mt-1.5 text-[12px] text-danger">
              {addError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
