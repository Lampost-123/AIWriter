// Where an entry first appears, beside its kind at the top of its page ("First appears: the start
// of Book 1"), and the small panel that changes it: add the beginning of the world, a story's start
// or a scene, or remove one. Every change applies straight away and can be undone from its toast.

import * as P from '@radix-ui/react-popover'
import { ChevronDown, Plus, X } from '@/components/ui/icons'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FirstExists } from '@shared/contracts/entryViews'
import type { EntryKind, ID } from '@shared/types'
import { Button, IconButton, toast, useToasts } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { PopoverPanel } from '@/features/generate/parts'
import { ownTitle } from './appearsLogic'
import { asTheyWere, changedText, firstAppearsText, placeChoices, withPoint, withoutPoint, type SceneChoice } from './firstExistsLogic'
import { sceneLabels, upperFirst } from './memoryLogic'
import type { EntryData } from './memory/useEntryData'
import { Combobox, type ComboOption } from './parts/Combobox'

/** Every scene of every story in reading order of the shelf, with its place and own title. Loaded while `enabled`. */
function useSceneChoices(enabled: boolean): SceneChoice[] | null {
  const stories = useApp((s) => s.stories)
  const rev = useApp((s) => s.outlineRev)
  const [scenes, setScenes] = useState<SceneChoice[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const ordered = [...stories].sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
    void Promise.all(ordered.map((s) => api.getOutline(s.id).catch(() => null))).then((outlines) => {
      if (!live) return
      const out: SceneChoice[] = []
      for (const o of outlines) {
        if (!o) continue
        const titles = new Map(o.scenes.map((s) => [s.id, s.title]))
        for (const [id, label] of sceneLabels(o)) out.push({ id, storyId: o.story.id, label, title: ownTitle(titles.get(id) ?? '') })
      }
      setScenes(out)
    })
    return () => {
      live = false
    }
  }, [enabled, stories, rev])
  return scenes
}

export function FirstAppears({
  name,
  kind,
  points,
  className
}: {
  name: string
  kind: EntryKind
  /** The entry's first-exists points (the page loads them once for this and the note about edits that reach other stories). */
  points: EntryData<FirstExists[]>
  className?: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const text = points.data ? firstAppearsText(points.data) : null
  // Nothing until it is known, so the line appears whole; its place beside the kind is kept free meanwhile.
  if (!text || !points.data) return null
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild>
        <button
          type="button"
          title="Change where it first appears"
          className={cn(
            'flex min-w-0 animate-fade-in items-center gap-1.5 rounded-sm text-left text-[12px] text-faint outline-none transition-colors duration-150 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=open]:text-fg',
            className
          )}
        >
          {/* Beside the kind on a wide page; on a narrow one it has its own line, without the dot. */}
          <span aria-hidden className="@max-[34rem]:hidden">
            ·
          </span>
          <span className="min-w-0 truncate">{text}</span>
          <ChevronDown size={12} className="shrink-0" aria-hidden />
        </button>
      </P.Trigger>
      <PopoverPanel align="start" className="w-[360px] p-3.5">
        <FirstExistsEditor name={name} kind={kind} points={points} />
      </PopoverPanel>
    </P.Root>
  )
}

function FirstExistsEditor({ name, kind, points }: { name: string; kind: EntryKind; points: EntryData<FirstExists[]> }): React.JSX.Element {
  const entryName = name.trim() || 'It'
  const list = points.data ?? []
  const entryId = list[0]?.entryId ?? null
  const stories = useApp((s) => s.stories)
  // The place picker opens when Adam asks for it, so the panel opens calm, not with a list over the page.
  const [adding, setAdding] = useState(false)
  const scenes = useSceneChoices(adding)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const them = kind === 'character' ? 'them' : 'it'
  // Undo goes back to how it was when the panel opened, from one toast however many changes are made.
  const opened = useRef<FirstExists[] | null>(null)
  if (!opened.current && list.length) opened.current = list
  const toastId = useRef<number | null>(null)

  useEffect(() => {
    if (adding) document.getElementById(inputId)?.focus()
  }, [adding, inputId])

  const choices = useMemo(() => {
    const ordered = [...stories].sort((a, b) => a.position - b.position || a.createdOrder - b.createdOrder)
    return placeChoices(ordered, scenes ?? [], list, query, 30)
  }, [stories, scenes, list, query])
  const options: ComboOption[] = choices.list.map((c) => ({ key: c.key, label: c.label, sub: c.sub }))

  const apply = async (next: ReturnType<typeof withPoint>): Promise<void> => {
    if (!next || !entryId || busy) return
    const before = opened.current ?? list
    setBusy(true)
    try {
      const after = await api.setFirstExists(entryId, next)
      points.update(() => after)
      useApp.getState().bumpEntries()
      const message = changedText(entryName, after)
      const action = {
        label: 'Undo',
        run: () =>
          void api
            .setFirstExists(entryId, asTheyWere(before))
            .then(() => useApp.getState().bumpEntries())
            .catch((e: Error) => toast(`Couldn’t undo that. ${e.message}`, { tone: 'danger' }))
      }
      const toasts = useToasts.getState()
      const shown = toastId.current !== null && toasts.items.some((t) => t.id === toastId.current)
      if (shown) toasts.update(toastId.current!, { message, action })
      else toastId.current = toast(message, { action })
      setAdding(false)
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
      throw e
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="text-[13.5px] font-semibold text-fg">Where {entryName} first appears</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        Before this, {entryName} isn't in the story: the AI isn't told about {them}, and the page shows “Not in the story yet” there.
      </p>
      <ul aria-label="Where it first appears" className="mt-3 flex flex-col gap-1">
        {list.map((p) => (
          <li key={p.id} className="flex min-h-8 items-center gap-2 rounded-md bg-surface-2 py-0.5 pl-2.5 pr-1 text-[13px] text-fg">
            <span className="min-w-0 flex-1 truncate">{upperFirst(p.label)}</span>
            {p.byHand ? null : <span className="shrink-0 text-[11.5px] text-faint">Worked out for you</span>}
            <IconButton
              size="sm"
              label={`Remove ${p.label}`}
              title={list.length < 2 ? 'Add another point first: it always first appears somewhere.' : undefined}
              disabled={list.length < 2 || busy}
              onClick={() => void apply(withoutPoint(list, p.id)).catch(() => undefined)}
            >
              <X size={13} />
            </IconButton>
          </li>
        ))}
      </ul>
      {adding ? (
        <>
          <label htmlFor={inputId} className="mb-1 mt-3 block text-[12px] font-medium text-muted">
            Add another point in the story
          </label>
          <Combobox
            id={inputId}
            query={query}
            onQuery={setQuery}
            options={options}
            more={choices.more}
            listLabel="Points in the story"
            placeholder="The start of a story, or a scene"
            onPick={(o) => {
              const c = choices.list.find((x) => x.key === o.key)
              return c ? apply(withPoint(list, c.point)) : undefined
            }}
          />
        </>
      ) : (
        <Button variant="ghost" size="sm" icon={<Plus size={14} />} className="-ml-2.5 mt-2" onClick={() => setAdding(true)}>
          Add another point in the story
        </Button>
      )}
    </div>
  )
}

/** Where an entry's first-exists points are, for the note about edits that reach other stories. */
export const homesOf = (points: FirstExists[] | null): (ID | null)[] | null => (points ? points.map((p) => p.homeStoryId) : null)
