// An entry's dossier (UI overhaul phase 4, D4.2): its page drawn as a dossier rather than a form. A band in its kind's
// colour with its name and portrait, its one-liner, a row of facts (and where it first appears), then sections: what it
// is, each of its kind's groups of fields, how a character speaks, where things stand as of the scene Adam is in, the
// chapters it appears in, its relationships and the rest of what the memory keeps. Everything is edited where it is
// shown: the name and the one-liner as they are, a section's fields from its Edit (Done, or Esc, puts it back). It saves
// the way the panels' entry page does (world/useEntryEditor.ts) and shares its parts (EntryForm's field inputs, the
// memory's sections, the as-of view). The desk's World room opens it over the gallery (features/desk/world); it is built
// to be the panels' entry page too, later in the overhaul.
import * as M from '@radix-ui/react-dropdown-menu'
import {
  ArrowLeft,
  BookOpen,
  Check,
  History,
  Lock,
  MoreHorizontal,
  PenLine,
  ShieldCheck,
  Trash2,
  WandSparkles
} from '@/components/ui/icons'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CHARACTER_ROLES, FIELD_GROUPS, KIND_LABELS } from '@shared/fields'
import type { Appearance } from '@shared/contracts/entryViews'
import type { Entry, EntryKind, ID } from '@shared/types'
import { Field, Input, Select } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { setDraft as setAskDraft } from '@/features/ask/askStore'
import { openAsk } from '@/features/ask/open'
import { useOutline } from '@/features/binder/outlineStore'
import { requestReveal } from '@/features/editor/reveal'
import { EntryVoice } from '@/features/readAloud/EntryVoice'
import { Portrait } from '@/features/views/Portrait'
import { PortraitDrop } from '@/features/views/PortraitDrop'
import { useEntryAsOf } from '@/features/views/useAsOf'
import { Motif } from '@/components/art/Motif'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { MotifPicker } from '@/features/world/art/MotifPicker'
import { artHue, shortPlace } from '@/features/desk/world/galleryLogic'
import { setAsOfMode, useAsOfMode } from '../asOfMode'
import { EntryAsOfView } from '../AsOfView'
import { DuplicateHint, FieldInput, ReachNote } from '../EntryForm'
import { takeFresh } from '../entryDrafts'
import { entryInitial, findNearDuplicates, parentPlaceOptions } from '../entryLogic'
import { FirstAppears } from '../FirstAppears'
import { KIND_ICONS } from '../kindIcons'
import { EntryMemorySections, type MemorySectionWrap } from '../memory/EntryMemory'
import { MadeByNote, YouWroteNote } from '../memory/EntryNotes'
import { useEntryData } from '../memory/useEntryData'
import { allAdams, splitChanges } from '../memoryLogic'
import { dismissProfile } from '../reachLogic'
import { AutoTextarea } from '../parts/AutoTextarea'
import { SaveNote } from '../parts/SaveNote'
import { Switch } from '../parts/Switch'
import { CommaListInput } from '../parts/TextInputs'
import { useEntryEditor } from '../useEntryEditor'
import { appearsBands, dossierGroups, factDefs, factsOf, kickerOf, relationLine, voiceOf, type DossierGroup } from './dossierLogic'

/** Kinds with a portrait and a builder. */
const PICTURED: EntryKind[] = ['character', 'place', 'group', 'item']
const ROLE_OPTIONS = CHARACTER_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))

/** Whether anything is written in the entry besides its name. */
const hasWords = (e: Entry): boolean =>
  !!(e.summary.trim() || e.description.trim() || e.aliases.length || e.tags.length || Object.values(e.fields).some((v) => v.trim()))

export interface DossierProps {
  /** The entry as loaded (newer copies are taken in, keeping what Adam has typed). */
  entry: Entry
  /** Every other entry in the world (relationships, near-duplicate names). */
  others: Entry[]
  /** Every place (where a place is inside). */
  places: Entry[]
  /** The way back, and its words ("Back to the world"). */
  back: { label: string; run: () => void }
  onLiveChange: (e: Entry) => void
  onDeleted: (e: Entry) => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
  /** The heading's id, for the dialog around it. */
  titleId: string
  /** Where it first appears in the story (the codex card's earliest scene), or null when in no scene yet; undefined when not known. */
  firstSeen?: { sceneId: ID; storyId: ID; label: string } | null
}

/**
 * One section of the dossier: small capitals over it, a quiet note after them, and Edit (shown on hover and to the
 * keyboard) that turns its words into their fields; Done, or Esc in a field, turns them back and gives Edit the keyboard.
 */
function Sec({
  id,
  title,
  note,
  editing,
  onEdit,
  read,
  edit,
  wide
}: {
  id: string
  title: string
  note?: ReactNode
  editing?: boolean
  onEdit?: (id: string, on: boolean) => void
  read: ReactNode
  edit?: ReactNode
  wide?: boolean
}): React.JSX.Element {
  const box = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const was = useRef(editing)
  useLayoutEffect(() => {
    if (editing && !was.current)
      box.current?.querySelector<HTMLElement>('input, textarea, [role="combobox"], button[role="switch"]')?.focus()
    if (!editing && was.current && box.current?.contains(document.activeElement) === false && document.activeElement === document.body)
      button.current?.focus()
    was.current = editing
  }, [editing])
  const headId = useId()
  return (
    <section
      ref={box}
      aria-labelledby={headId}
      data-dz-section={id}
      data-editing={editing || undefined}
      className={cn('dz-sec', wide && 'is-wide')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !editing || e.defaultPrevented) return
        const t = e.target as HTMLElement
        if (!t.matches('input, textarea')) return
        e.preventDefault()
        e.stopPropagation()
        onEdit?.(id, false)
        requestAnimationFrame(() => button.current?.focus())
      }}
    >
      <div className="dz-sec-h">
        <h3 id={headId} className="dz-caps">
          {title}
        </h3>
        {note ? <span className="dz-sec-note">{note}</span> : null}
        {onEdit && edit ? (
          <button
            ref={button}
            type="button"
            className={cn('dz-edit', editing && 'is-on')}
            aria-label={editing ? `Done editing ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}
            aria-expanded={editing}
            onClick={() => onEdit(id, !editing)}
          >
            {editing ? <Check size={13} aria-hidden /> : <PenLine size={13} aria-hidden />}
            <span>{editing ? 'Done' : 'Edit'}</span>
          </button>
        ) : null}
      </div>
      <div className="dz-sec-b">{editing && edit ? edit : read}</div>
    </section>
  )
}

/** Words read as paragraphs (blank lines between them). */
function Paras({ text, className }: { text: string; className?: string }): React.JSX.Element {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={cn('dz-p', className)}>
            {p}
          </p>
        ))}
    </>
  )
}

/** An empty section's line, inviting Adam to fill it in. */
function Nothing({ children, onAdd }: { children: ReactNode; onAdd?: () => void }): React.JSX.Element {
  return (
    <p className="dz-nothing">
      {children}
      {onAdd ? (
        <>
          {' '}
          <button type="button" className="dz-add" onClick={onAdd}>
            Add
          </button>
        </>
      ) : null}
    </p>
  )
}

/** Opens a scene, at the words that name the entry when there are some. */
function openScene(a: Pick<Appearance, 'sceneId' | 'storyId' | 'quote'>): void {
  if (a.quote) requestReveal(a.sceneId, a.quote)
  useApp.getState().selectScene(a.sceneId, a.storyId)
}

export function Dossier({
  entry,
  others,
  places,
  back,
  onLiveChange,
  onDeleted,
  onOpen,
  titleId,
  firstSeen
}: DossierProps): React.JSX.Element {
  const kind = entry.kind
  const groupsAll = FIELD_GROUPS[kind] ?? []
  const noteKeys = useMemo(
    () => ['aliases', 'summary', 'description', 'tags', ...groupsAll.flatMap((g) => g.fields.map((f) => f.key))],
    [groupsAll]
  )
  const editor = useEntryEditor(entry, { onLiveChange, onDeleted, noteKeys })
  const { draft, rev, owner, savedNames, setReachFrom, autosave, takeNewer, update, setField, setParent, setName, remove } = editor
  const { firsts, reach, reaching, keeping, keepFromHere } = editor
  const [madeByAI] = useState(() => entry.origin !== 'adam' && !entry.byHand)
  const [madeByAdam] = useState(() => entry.origin === 'adam' && hasWords(entry))
  const [aiDrafted] = useState(() => !allAdams(entry))
  const name = draft.name.trim() || 'Unnamed'
  const ids = { hard: useId(), notes: useId() }

  // Which sections are being edited.
  const [editing, setEditing] = useState<Set<string>>(() => new Set())
  const onEdit = useCallback(
    (id: string, on: boolean) => {
      setEditing((prev) => {
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      })
      if (!on) void autosave.flush()
    },
    [autosave]
  )

  // A freshly made entry opens with its name chosen, ready to type over.
  const nameRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!takeFresh(entry.id)) return
    if (useAsOfMode.getState().on) setAsOfMode({ on: false })
    requestAnimationFrame(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    })
  }, [entry.id])
  // The name stays one line of text that wraps (Enter does nothing), growing with it.
  useLayoutEffect(() => {
    const el = nameRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [draft.name])

  // As of a scene: the dossier's body shows the entry as it is there.
  const asOf = useAsOfMode((s) => s.on)
  const asOfButton = useRef<HTMLButtonElement>(null)
  const [focusSlider, setFocusSlider] = useState(false)
  const showAsOf = (): void => {
    setFocusSlider(true)
    setAsOfMode({ on: true })
  }
  const backToEditing = (): void => {
    setAsOfMode({ on: false })
    setFocusSlider(false)
    requestAnimationFrame(() => asOfButton.current?.focus())
  }

  // Where it appears (the bands, the count over the name, "Show in the story").
  const memoryRev = useApp((s) => s.memoryRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const appears = useEntryData(
    () => api.listAppearances(entry.id),
    `dz-appears:${entry.id}`,
    true,
    `${memoryRev}|${outlineRev}|${savedNames}`
  )
  const { outline } = useOutline()
  const sceneId = useApp((s) => s.sceneId)
  const storyId = useApp((s) => s.storyId)
  const bands = useMemo(() => {
    const list = appears.data ?? []
    const short = (outline?.chapters.length ?? 0) <= 6
    return appearsBands(outline, list, sceneId, short)
  }, [appears.data, outline, sceneId])
  const scenes = appears.data ? appears.data.length : null
  // Where things stand as of the scene Adam is in (or the end of his story).
  const at = useMemo(
    () => (storyId ? (sceneId ? { kind: 'scene' as const, storyId, sceneId } : { kind: 'end' as const, storyId }) : null),
    [storyId, sceneId]
  )
  const now = useEntryAsOf(asOf ? null : entry.id, at)
  const happened = now.data?.state?.happened ?? []

  const facts = factsOf(draft)
  const factKeys = factDefs(kind)
  const groups = dossierGroups(draft)
  const voice = kind === 'character' ? voiceOf(draft.fields) : null
  const dups = useMemo(
    () => findNearDuplicates({ id: draft.id, kind, name: draft.name, aliases: draft.aliases }, others),
    [draft.id, kind, draft.name, draft.aliases, others]
  )
  const parentOptions = useMemo(() => (kind === 'place' ? parentPlaceOptions(places, draft.id) : []), [kind, places, draft.id])
  const parent = draft.parentId ? places.find((p) => p.id === draft.parentId) : null
  const hue = artHue(kind, entry.id)
  const Icon = KIND_ICONS[kind]
  // Its drawing (the card's, as the gallery shows it): on the portrait while it has none of Adam's.
  const motif = useEntryMotifs().get(entry.id) ?? null

  const openBuilder = async (): Promise<void> => {
    if (!PICTURED.includes(kind)) return
    await autosave.flush()
    useApp.getState().navigate({ kind: 'builder', entryKind: kind as 'character', entryId: entry.id })
  }
  const askAbout = (): void => {
    setAskDraft(`About ${name}: `)
    openAsk()
  }
  const first = appears.data?.[0] ?? null

  // Its relationships, read from its side (the memory's section edits them).
  const changes = useEntryData(() => api.listChanges(entry.id), `dz-changes:${entry.id}`)
  const rels = useMemo(() => (changes.data ? splitChanges(changes.data, entry.id).relationships : null), [changes.data, entry.id])
  const byId = useMemo(() => new Map(others.map((e) => [e.id, e])), [others])

  // The memory's sections: relationships and "Appears in" open; the rest folded.
  const [folds, setFolds] = useState<Set<string>>(() => new Set())
  const wrap: MemorySectionWrap = ({ id, title, meta, children }) => {
    if (id === 'relationships') {
      const shown = (rels ?? []).filter((r) => byId.has(r.otherId))
      return (
        <Sec
          id={id}
          title={title}
          note={shown.length ? String(shown.length) : undefined}
          editing={editing.has(id)}
          onEdit={onEdit}
          read={
            rels === null ? (
              <div className="h-5" aria-hidden />
            ) : shown.length ? (
              <ul className="dz-rels">
                {shown.map((r) => {
                  const other = byId.get(r.otherId)!
                  const otherName = other.name.trim() || 'Unnamed'
                  return (
                    <li key={r.otherId}>
                      <button type="button" className="dz-rel" onClick={() => onOpen(other)} title={`Open ${otherName}`}>
                        <Portrait entry={other} size={32} />
                        <span className="dz-rel-t">
                          <span className="dz-rel-n">{otherName}</span>
                          <span className="dz-rel-s">{relationLine(r, { id: entry.id, name }, otherName)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <Nothing onAdd={() => onEdit(id, true)}>No relationships yet.</Nothing>
            )
          }
          edit={children}
        />
      )
    }
    if (id === 'appears') {
      return (
        <Sec
          id={id}
          title={title}
          note={meta || undefined}
          read={
            <>
              {id === 'appears' && bands.length ? (
                <div className="dz-bands" aria-label="Chapters of the story it appears in">
                  {bands.map((b) => (
                    <div key={b.id} className="dz-band-row">
                      <span className="dz-band-l">
                        <span className="dz-rn">{b.numeral}</span>
                        <span className="truncate">{b.title}</span>
                      </span>
                      <span className="dz-track">
                        {b.dots.map((d) => {
                          const a = appears.data?.find((x) => x.sceneId === d.sceneId)
                          return a ? (
                            <button
                              key={d.sceneId}
                              type="button"
                              className={cn('dz-dot is-on', d.current && 'is-now')}
                              title={`${d.title}: open this scene`}
                              aria-label={`Open ${d.title}`}
                              onClick={() => openScene(a)}
                            />
                          ) : (
                            <span
                              key={d.sceneId}
                              className={cn('dz-dot', d.planned && 'is-planned', d.current && 'is-now')}
                              title={d.title}
                            />
                          )
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {children}
            </>
          }
        />
      )
    }
    const open = folds.has(id)
    return (
      <section className="dz-fold" data-dz-section={id}>
        <button
          type="button"
          className="dz-fold-h"
          aria-expanded={open}
          onClick={() =>
            setFolds((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
        >
          <span className="dz-caps">{title}</span>
          {meta ? <span className="dz-sec-note">{meta}</span> : null}
          <span aria-hidden className={cn('dz-fold-chev', open && 'is-open')}>
            ›
          </span>
        </button>
        {open ? <div className="dz-fold-b">{children}</div> : null}
      </section>
    )
  }

  const groupSection = (g: DossierGroup): React.JSX.Element => {
    const isVoice = g.group.id === 'voice' && voice
    const read = !g.filled.length ? (
      <Nothing onAdd={() => onEdit(g.group.id, true)}>Nothing written here yet.</Nothing>
    ) : isVoice ? (
      <>
        {voice!.speech ? <p className="dz-voice">{voice!.speech}</p> : null}
        {voice!.lines.length ? (
          <div className="dz-quotes">
            {voice!.lines.slice(0, 5).map((l, i) => (
              <p key={i} className="dz-q">
                “{l}”
              </p>
            ))}
          </div>
        ) : null}
        {voice!.rest.length ? (
          <dl className="dz-dl">
            {voice!.rest.map((r) => (
              <div key={r.key}>
                <dt>{g.fields.find((f) => f.key === r.key)?.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </>
    ) : (
      <dl className="dz-dl">
        {g.filled.map(({ def, value }) => (
          <div key={def.key} className={cn(def.type === 'line' && 'is-line')}>
            <dt>{def.label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    )
    return (
      <Sec
        key={g.group.id}
        id={g.group.id}
        title={g.group.label}
        note={g.filled.length ? `${g.filled.length} of ${g.fields.length}` : undefined}
        editing={editing.has(g.group.id)}
        onEdit={onEdit}
        read={read}
        edit={
          <div className="dz-fields">
            {g.fields.map((f) => (
              <FieldInput key={f.key} def={f} value={draft.fields[f.key] ?? ''} onField={setField} note={null} places={null} />
            ))}
          </div>
        }
      />
    )
  }

  const about = (
    <Sec
      id="about"
      title={kind === 'character' ? 'Who they are' : kind === 'thread' ? 'The thread' : kind === 'glossary' ? 'The word' : 'What it is'}
      editing={editing.has('about')}
      onEdit={onEdit}
      wide
      read={
        <>
          {draft.description.trim() ? (
            <Paras text={draft.description} />
          ) : (
            <Nothing onAdd={() => onEdit('about', true)}>No description yet.</Nothing>
          )}
          {draft.aliases.length || draft.tags.length || parent ? (
            <div className="dz-chips">
              {parent ? (
                <button type="button" className="dz-chip is-link" onClick={() => onOpen(parent)}>
                  Inside {parent.name.trim() || 'a place'}
                </button>
              ) : null}
              {draft.aliases.map((a) => (
                <span key={`a:${a}`} className="dz-chip" title="Also called">
                  “{a}”
                </span>
              ))}
              {draft.tags.map((t) => (
                <span key={`t:${t}`} className="dz-chip is-tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </>
      }
      edit={
        <div className="dz-fields is-one">
          <Field label="Description">
            {(id) => (
              <AutoTextarea
                id={id}
                value={draft.description}
                minRows={4}
                maxRows={30}
                onChange={(e) => update({ description: e.target.value })}
              />
            )}
          </Field>
          <Field label="Aliases" hint="Separate with commas. Used to spot it in your text.">
            {(id) => <CommaListInput key={rev.aliases} id={id} value={draft.aliases} onChange={(aliases) => update({ aliases })} />}
          </Field>
          {kind === 'place' ? (
            <Field label="Inside">
              {(id) => (
                <Select
                  id={id}
                  value={draft.parentId && parentOptions.some((o) => o.value === draft.parentId) ? draft.parentId : null}
                  onChange={setParent}
                  options={parentOptions}
                  allowNone
                  noneLabel="Not inside another place"
                />
              )}
            </Field>
          ) : null}
          {kind === 'lore' ? (
            <div className="flex items-start gap-3">
              <Switch id={ids.hard} checked={draft.hardRule} onChange={(hardRule) => update({ hardRule })} className="mt-px" />
              <label htmlFor={ids.hard} className="flex-1 cursor-default">
                <span className="block text-[13.5px] font-medium text-fg">Hard rule</span>
                <span className="block text-[12.5px] text-muted">Never break this rule. Always given to the AI.</span>
              </label>
            </div>
          ) : null}
          <Field label="Tags" hint="Separate with commas.">
            {(id) => (
              <CommaListInput
                key={rev.tags}
                id={id}
                value={draft.tags}
                onChange={(tags) => update({ tags })}
                placeholder="family, the north, book one"
              />
            )}
          </Field>
        </div>
      }
    />
  )

  return (
    <div className="dz" data-kind={kind} onBlur={() => void autosave.flush()} style={{ '--dz-hue': hue } as React.CSSProperties}>
      <div className="dz-band" aria-hidden={false}>
        <span aria-hidden className="dz-band-art">
          <Icon size={180} className="dz-band-icon" />
        </span>
        <button type="button" className="dz-back" onClick={back.run}>
          <ArrowLeft size={16} aria-hidden />
          <span>{back.label}</span>
        </button>
        <div className="dz-tools">
          <button
            ref={asOfButton}
            type="button"
            className={cn('dz-ib dz-ib-label', asOf && 'is-on')}
            aria-pressed={asOf}
            onClick={asOf ? backToEditing : showAsOf}
          >
            <History size={15} aria-hidden />
            <span>View as of a scene</span>
          </button>
          {PICTURED.includes(kind) ? (
            <button
              type="button"
              className="dz-ib"
              aria-label="Open in the builder"
              title="Open in the builder"
              onClick={() => void openBuilder()}
            >
              <WandSparkles size={15} aria-hidden />
            </button>
          ) : null}
          <M.Root modal={false}>
            <M.Trigger className="dz-ib" aria-label={`More for ${name}`}>
              <MoreHorizontal size={16} aria-hidden />
            </M.Trigger>
            <M.Portal>
              <M.Content
                align="end"
                sideOffset={6}
                collisionPadding={8}
                className="desk-menu z-[80] min-w-[200px] rounded-[14px] p-1.5 font-sans data-[state=open]:animate-pop-in"
              >
                <M.Item
                  className="desk-menu-item flex h-[34px] select-none items-center gap-2.5 rounded-[9px] px-2.5 text-[13px] text-danger outline-none data-[highlighted]:bg-surface-2"
                  onSelect={() => void remove()}
                >
                  <Trash2 size={15} aria-hidden />
                  Delete {KIND_LABELS[kind].one.toLowerCase()}
                </M.Item>
              </M.Content>
            </M.Portal>
          </M.Root>
        </div>
        <div className="dz-titles">
          <div className="dz-kicker">{kickerOf(draft, scenes)}</div>
          {asOf ? (
            <h2 id={titleId} tabIndex={-1} className="dz-name">
              {name}
            </h2>
          ) : (
            <h2 id={titleId} tabIndex={-1} className="dz-name-h">
              <textarea
                ref={nameRef}
                rows={1}
                value={draft.name}
                aria-label="Name"
                placeholder="Name"
                spellCheck={false}
                className="dz-name dz-name-input"
                onChange={(e) => setName(e.target.value.replace(/[ \t]*[\r\n]+[ \t]*/g, ' '))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault()
                }}
              />
            </h2>
          )}
        </div>
      </div>

      {/* Its drawing from the drawing library, right under the name and beside the portrait, and the way to change it. */}
      {asOf ? null : (
        <div className="dz-art">
          <MotifPicker entry={draft} compact />
        </div>
      )}

      <div className="dz-portrait">
        {PICTURED.includes(kind) ? (
          <PortraitDrop entry={draft} size={88} motif={motif} live onChange={(saved) => takeNewer(saved, editor.base.current)} />
        ) : (
          <span aria-hidden className="dz-mono">
            {kind === 'lore' && draft.hardRule ? <ShieldCheck size={36} /> : motif ? <Motif id={motif} size={54} live reveal /> : entryInitial(name)}
          </span>
        )}
      </div>

      <div className="dz-sumrow">
        {asOf ? (
          <p className="dz-sum">{draft.summary.trim() || 'No summary yet'}</p>
        ) : (
          <AutoTextarea
            value={draft.summary}
            minRows={1}
            maxRows={3}
            aria-label="Short summary"
            placeholder="A one-line summary"
            className="dz-sum dz-sum-input"
            onChange={(e) => update({ summary: e.target.value.replace(/[\r\n]+/g, ' ') })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault()
            }}
          />
        )}
        <SaveNote status={autosave.status} error={autosave.error} className="dz-save" />
      </div>

      <div className="dz-facts" data-editing={editing.has('facts') || undefined}>
        {editing.has('facts') ? (
          <div className="dz-facts-edit">
            {factKeys.map((f) =>
              f.key === 'role' ? (
                <Field key={f.key} label="Role">
                  {(id) => (
                    <Select
                      id={id}
                      value={draft.fields.role || null}
                      onChange={(v) => setField('role', v ?? '')}
                      options={
                        draft.fields.role && !ROLE_OPTIONS.some((o) => o.value === draft.fields.role)
                          ? [...ROLE_OPTIONS, { value: draft.fields.role, label: draft.fields.role }]
                          : ROLE_OPTIONS
                      }
                      allowNone
                      noneLabel="Not set"
                      placeholder="Not set"
                    />
                  )}
                </Field>
              ) : (
                <Field key={f.key} label={f.label}>
                  {(id) => (
                    <Input
                      id={id}
                      value={draft.fields[f.key] ?? ''}
                      placeholder={f.placeholder}
                      onChange={(e) => setField(f.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          e.stopPropagation()
                          onEdit('facts', false)
                        }
                      }}
                    />
                  )}
                </Field>
              )
            )}
          </div>
        ) : (
          facts.map((f) => (
            <div key={f.key} className="dz-fact">
              <span className="dz-caps">{f.label}</span>
              <span className={cn('dz-fact-v', !f.value && 'is-empty')}>{f.value || 'Not set'}</span>
            </div>
          ))
        )}
        {firstSeen !== undefined ? (
          // The first scene it is in, by story order (it opens there); where it first exists in the world is beside it.
          <div className="dz-fact">
            <span className="dz-caps">First seen</span>
            {firstSeen ? (
              <button
                type="button"
                className="dz-fact-v dz-fact-link"
                title={`Open ${firstSeen.label}`}
                onClick={() => openScene({ sceneId: firstSeen.sceneId, storyId: firstSeen.storyId, quote: '' })}
              >
                {shortPlace(firstSeen.label)}
              </button>
            ) : (
              <span className="dz-fact-v is-empty">Not in a scene yet</span>
            )}
          </div>
        ) : null}
        <div className="dz-fact is-first">
          <FirstAppears name={draft.name} kind={kind} points={firsts} className="dz-first" />
        </div>
        {factKeys.length && !asOf ? (
          <button
            type="button"
            className={cn('dz-edit dz-facts-btn', editing.has('facts') && 'is-on')}
            aria-label={editing.has('facts') ? 'Done editing the facts' : 'Edit the facts'}
            onClick={() => onEdit('facts', !editing.has('facts'))}
          >
            {editing.has('facts') ? <Check size={13} aria-hidden /> : <PenLine size={13} aria-hidden />}
            <span>{editing.has('facts') ? 'Done' : 'Edit'}</span>
          </button>
        ) : null}
      </div>

      <div className="dz-body" data-dz-body>
        {asOf ? (
          <div className="dz-asof">
            <EntryAsOfView
              entry={draft}
              others={others}
              firsts={firsts.data}
              onBack={backToEditing}
              onOpen={onOpen}
              autoFocus={focusSlider}
            />
          </div>
        ) : (
          <>
            <div className="dz-notes">
              {madeByAdam ? <YouWroteNote drafted={aiDrafted} /> : <MadeByNote entry={owner} shown={madeByAI} />}
              <DuplicateHint dups={dups} kind={kind} onOpen={onOpen} />
            </div>
            <div className="dz-cols">
              <div className="dz-col">
                {about}
                {groups.map(groupSection)}
                <Sec
                  id="notes"
                  title="Private notes"
                  note={
                    <span className="inline-flex items-center gap-1">
                      <Lock size={11} aria-hidden /> never sent to the AI
                    </span>
                  }
                  editing={editing.has('notes')}
                  onEdit={onEdit}
                  read={
                    draft.notes.trim() ? <Paras text={draft.notes} /> : <Nothing onAdd={() => onEdit('notes', true)}>No notes.</Nothing>
                  }
                  edit={
                    <Field label="Private notes">
                      {(id) => (
                        <AutoTextarea
                          id={id}
                          value={draft.notes}
                          minRows={3}
                          maxRows={24}
                          placeholder="Reminders for yourself. The AI never sees these."
                          onChange={(e) => update({ notes: e.target.value })}
                        />
                      )}
                    </Field>
                  }
                />
                <EntryVoice entry={draft} />
              </div>
              <div className="dz-col">
                {at ? (
                  <Sec
                    id="now"
                    title="Where things stand"
                    note={now.data ? `as of ${now.data.label.replace(/^.*?(?=Ch \d)/, '')}` : undefined}
                    read={
                      now.data?.absent ? (
                        <Nothing>{now.data.absent}.</Nothing>
                      ) : happened.length ? (
                        <ul className="dz-state">
                          {happened
                            .slice(-4)
                            .reverse()
                            .map((h) => (
                              <li key={h.changeId}>
                                <span className="dz-state-n">{h.note[0]?.toLocaleUpperCase() + h.note.slice(1)}</span>
                                {h.where ? <span className="dz-state-w">{h.where.replace(/^.*?(?=Ch \d)/, '')}</span> : null}
                              </li>
                            ))}
                        </ul>
                      ) : now.data ? (
                        <Nothing>
                          Nothing has changed for {kind === 'character' ? 'them' : 'it'} yet. The memory notes it here as you write.
                        </Nothing>
                      ) : (
                        <div className="h-5" aria-hidden />
                      )
                    }
                  />
                ) : null}
                <EntryMemorySections
                  now={draft}
                  names={savedNames}
                  ready={firsts.data !== null || firsts.error !== null}
                  others={others}
                  open={folds}
                  onToggle={() => undefined}
                  onOpen={onOpen}
                  beforeRestore={autosave.flush}
                  order={['appears', 'relationships', 'knows', 'changes', 'history']}
                  wrap={wrap}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {reach && reaching.length && !asOf ? (
        <div className="dz-reach">
          <ReachNote
            name={draft.name}
            story={reach.title}
            busy={keeping}
            onKeep={() => void keepFromHere()}
            onDismiss={() => setReachFrom((prev) => dismissProfile(prev, editor.draftRef.current, owner.fieldOrigins))}
          />
        </div>
      ) : null}

      <div className="dz-foot">
        <span className="dz-foot-t">
          <Check size={14} aria-hidden />
          <span>Kept up to date as you write</span>
        </span>
        <button
          type="button"
          className="dz-btn"
          disabled={!first}
          onClick={() => first && openScene(first)}
          title={first ? `Open ${first.label}` : 'Not in a scene yet'}
        >
          <BookOpen size={15} aria-hidden />
          Show in the story
        </button>
        <button type="button" className="dz-btn is-ai" onClick={askAbout}>
          <span aria-hidden className="dz-lamp" />
          Ask about {draft.name.trim() || (kind === 'character' ? 'them' : 'it')}
        </button>
      </div>
    </div>
  )
}
