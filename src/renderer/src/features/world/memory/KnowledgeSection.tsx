import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ChangeView, Entry, ID } from '@shared/types'
import { Field, IconButton, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { announceDelete } from '@/lib/undoDelete'
import { normalizeName } from '../entryLogic'
import { shortQuote, sourceNote } from '../memoryLogic'
import { Combobox, type ComboOption } from '../parts/Combobox'
import type { ScenePlace } from '../useSceneLabels'
import { QuietError } from './QuietError'
import { SourceLine } from './SourceLine'
import { useEntryData, type EntryData } from './useEntryData'

type Knows = Extract<ChangeView, { kind: 'knowledge' }>

const MAX_SHOWN = 50

/**
 * What a character knows from the beginning (baseline knowledge). Facts are shared by id, so
 * picking a fact another character knows means the AI can tell who knows it and who doesn't.
 */
export function KnowledgeSection({
  self,
  rows,
  data,
  places
}: {
  self: Pick<Entry, 'id' | 'name'>
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
    const list: ComboOption[] = matching.slice(0, MAX_SHOWN).map((f) => ({ key: f.factId, label: f.fact }))
    const text = query.trim()
    const same = (facts.data ?? []).some((f) => normalizeName(f.fact) === normalizeName(text))
    if (text && !same) list.push({ key: 'new', label: `Add "${text}"`, create: true })
    return { list, more: Math.max(0, matching.length - MAX_SHOWN) }
  }, [facts.data, rows, query])

  const pick = async (o: ComboOption): Promise<void> => {
    setAddError(null)
    const fact = o.create ? { factId: crypto.randomUUID(), fact: query.trim() } : (facts.data ?? []).find((f) => f.factId === o.key)
    if (!fact) return
    try {
      const c = await api.createChange({
        entryId: self.id,
        anchor: 'baseline',
        kind: 'knowledge',
        payload: { factId: fact.factId, fact: fact.fact }
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
      message: `Removed ${shortQuote(c.payload.fact)} from what ${name} knows.`,
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
        Secrets and facts {name} knows from the beginning. The AI is told who knows what, and who doesn't.
      </p>
      {rows.length ? (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((c) => {
            const note = c.origin === 'adam' ? null : sourceNote(c.origin, c.links)
            return (
              <li key={c.id} className="flex items-start gap-2 py-1.5 pl-3 pr-1.5">
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="text-[13.5px] leading-snug text-fg">{c.payload.fact}</p>
                  {note ? <SourceLine note={note} places={places} /> : null}
                </div>
                <IconButton label={`Remove ${shortQuote(c.payload.fact)} from what ${name} knows`} size="sm" onClick={() => void remove(c)}>
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
