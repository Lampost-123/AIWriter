// The Sounds tab beside a scene (shown while sound effects are on): the scene's sounds in reading order, each with
// what it sounds like, where it plays in plain words, Listen, and (on hover or focus) a menu to play it on other
// words, change its description or remove it. "Add a sound" places one on the words selected in the page; "Find
// sounds in this scene" has the AI mark the whole scene now. Changes are Adam's from then on (the AI leaves those
// paragraphs alone) and each can be undone from its toast. Hovering a row marks its words in the page; clicking one
// shows them. While the tab shows, every sound's words are marked faintly in the page (soundMarks.ts).
import type { Editor } from '@tiptap/core'
import * as M from '@radix-ui/react-dropdown-menu'
import { TextSelection } from '@tiptap/pm/state'
import { AudioLines, Flag, MapPin, MoreHorizontal, Pencil, Play, Plus, Sparkles, Square, Trash2, Waves, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CueInput, SceneCue, SoundKind } from '@shared/contracts/sounds'
import type { ID } from '@shared/types'
import { Button, EmptyState, IconButton, Notice, Spinner, Textarea } from '@/components/ui'
import { api, onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { REVEALED } from '@/features/editor/reveal'
import { Segmented, useDelayed } from '@/features/generate/parts'
import { pageParagraphs } from '@/features/readAloud/pageText'
import { usePreview } from './mixer'
import { setHoveredSound, setSoundMarks } from './soundMarks'
import { anchorRange, comesAfter, countWords, pickWords, quote, soundWords, stateWords, whereWords, type Picked } from './soundsLogic'
import { asInput, changeSound, findSounds, listenTo, loadSounds, makeAgain, stopListening, useSounds } from './soundsStore'
import './sounds.css'

/** After typing stops, the sounds are read again this much later (their places follow the words). */
const AFTER_TYPING_MS = 1200
const AFTER_MARKED_MS = 150
const AFTER_READY_MS = 300

const KIND_WORDS: Record<SoundKind, string> = { effect: 'Sound effect', ambience: 'Ambience' }

export function SoundsPanel({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const editor = useSceneEditor(sceneId)
  const sounds = useSounds((s) => (s.sceneId === sceneId ? s.sounds : null))
  const error = useSounds((s) => (s.sceneId === sceneId ? s.error : null))
  const finding = useSounds((s) => s.finding)
  const ready = useSoundsReady()
  const picked = usePicked(editor)
  const [adding, setAdding] = useState(false)
  useSoundsLoader(editor, sceneId)
  usePageMarks(editor, sounds?.cues ?? null)

  const cues = sounds?.cues ?? []
  const marking = finding || !!sounds?.marking.length

  return (
    <div className="flex min-h-full flex-col">
      <FindBar sceneId={sceneId} count={sounds ? cues.length : null} marking={marking} finding={finding} />
      {ready === false ? (
        <div className="px-4 pb-2">
          <Notice
            action={
              <Button size="sm" onClick={() => useApp.getState().navigate({ kind: 'settings', tab: 'speech' })}>
                Open Settings
              </Button>
            }
          >
            Sounds are made once the sound effects download is done and the speech engine is running.
          </Notice>
        </div>
      ) : null}
      {adding ? (
        <AddSound sceneId={sceneId} picked={picked} onDone={() => setAdding(false)} />
      ) : null}
      {sounds === null ? (
        error ? (
          <div className="px-4 pt-2">
            <Notice
              tone="danger"
              action={
                <Button size="sm" onClick={() => void loadSounds(sceneId)}>
                  Try again
                </Button>
              }
            >
              Couldn’t read this scene’s sounds. {error}
            </Notice>
          </div>
        ) : // Loading: nothing rather than a flash; the list takes its place when it comes.
        null
      ) : cues.length ? (
        <>
          <ul aria-label="Sounds in this scene" className="flex flex-col gap-0.5 px-4 pb-2 pt-0.5 animate-fade-in">
            {cues.map((c) => (
              <li key={c.id}>
                <SoundRow sceneId={sceneId} cue={c} editor={editor} picked={picked} />
              </li>
            ))}
          </ul>
          {!adding ? (
            <div className="px-4 pb-6">
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} className="-ml-2" onClick={() => setAdding(true)}>
                Add a sound
              </Button>
            </div>
          ) : null}
        </>
      ) : !adding && !marking ? (
        <EmptyState
          icon={<AudioLines size={20} />}
          title="No sounds in this scene yet"
          className="py-8"
          actions={
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
              Add a sound
            </Button>
          }
        >
          When the scene is read aloud, the AI adds quiet sounds just ahead of the voice. Find sounds in this scene marks them all
          now, or select words in the page and add one there.
        </EmptyState>
      ) : null}
    </div>
  )
}

// ---------- The bar along the top ----------

/** How many sounds, or that the AI is finding them; and Find sounds in this scene. A fixed height, so nothing moves. */
function FindBar({
  sceneId,
  count,
  marking,
  finding
}: {
  sceneId: ID
  count: number | null
  marking: boolean
  finding: boolean
}): React.JSX.Element {
  const slow = useDelayed(marking, 120)
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-4">
      {marking ? (
        <span
          role="status"
          className={cn('flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-muted transition-opacity duration-150', slow ? 'opacity-100' : 'opacity-0')}
        >
          <Spinner size={13} className="shrink-0" />
          <span className="truncate">Finding sounds…</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">{count ? countWords(count) : ''}</span>
      )}
      <Button
        size="sm"
        icon={<Sparkles size={14} />}
        disabled={finding}
        onClick={() => void findSounds(sceneId)}
        title="The AI marks the sounds of the whole scene now. Sounds you placed or changed stay as they are."
      >
        Find sounds in this scene
      </Button>
    </div>
  )
}

// ---------- One sound ----------

function SoundRow({ sceneId, cue, editor, picked }: { sceneId: ID; cue: SceneCue; editor: Editor | null; picked: Picked }): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const state = stateWords(cue)
  const hover = (on: boolean): void => {
    if (editor && !editor.isDestroyed) setHoveredSound(editor.view, on ? cue.id : null)
  }
  const Icon = cue.kind === 'effect' ? Zap : Waves

  return (
    <div
      role="group"
      aria-label={`${KIND_WORDS[cue.kind]}: ${cue.description}`}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onFocus={() => hover(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hover(false)
      }}
      className={cn(
        'group relative -mx-2 flex gap-2.5 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-surface-2',
        'has-[:focus-visible]:bg-surface-2',
        (menuOpen || editing) && 'bg-surface-2'
      )}
    >
      <span
        title={KIND_WORDS[cue.kind]}
        className={cn(
          'mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-page',
          cue.kind === 'effect' ? 'text-accent' : 'text-muted'
        )}
      >
        <Icon size={14} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <DescriptionEditor
            cue={cue}
            onDone={async (description) => {
              if (description && description !== cue.description)
                await changeSound(sceneId, cue.id, { ...asInput(cue), description }, 'Description changed.')
              setEditing(false)
            }}
          />
        ) : (
          // Stretched over the whole row, so a click anywhere on it shows its words in the page.
          <button
            type="button"
            onClick={() => editor && showWords(editor, cue)}
            title="Show these words in the page"
            className={cn(
              '-mx-[7px] block w-[calc(100%+14px)] rounded-md border border-transparent px-1.5 py-0.5 text-left text-[13.5px] leading-[1.55] text-fg outline-none',
              'after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-accent/40'
            )}
          >
            <span className="line-clamp-2">{cue.description}</span>
          </button>
        )}
        <p className="mt-px text-[12px] leading-[17px] text-muted">
          <span>{whereWords(cue)}</span>
          {state ? (
            <span className={cn(cue.sound === 'failed' ? 'text-danger' : 'text-faint')}>
              {' · '}
              {state}
            </span>
          ) : null}
          {cue.sound === 'failed' ? (
            <>
              {' · '}
              <button type="button" onClick={() => void makeAgain(cue)} className="relative z-10 text-accent hover:underline">
                Try again
              </button>
            </>
          ) : null}
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 items-start gap-0.5">
        <RowMenu
          sceneId={sceneId}
          cue={cue}
          picked={picked}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onEdit={() => setEditing(true)}
        />
        <ListenButton cue={cue} />
      </div>
    </div>
  )
}

/** The description, changed in place: Enter (or leaving the box) saves, Esc puts it back. */
function DescriptionEditor({ cue, onDone }: { cue: SceneCue; onDone: (description: string | null) => Promise<void> }): React.JSX.Element {
  const [text, setText] = useState(cue.description)
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    void onDone(save ? text.replace(/\s+/g, ' ').trim() : null)
  }
  return (
    <Textarea
      ref={ref}
      aria-label="What it sounds like"
      value={text}
      minRows={1}
      maxRows={4}
      maxLength={300}
      onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      // The same box as the words it replaces, so nothing moves.
      className="relative z-10 -mx-[7px] w-[calc(100%+14px)]! px-1.5! py-0.5! text-[13.5px]! leading-[1.55]!"
    />
  )
}

/** Listen: the sound on its own at the volume set (made now when it isn't yet); pressed again, it stops. */
function ListenButton({ cue }: { cue: SceneCue }): React.JSX.Element {
  const playing = usePreview((s) => !!cue.soundId && s.playing === cue.soundId)
  const loading = usePreview((s) => !!cue.soundId && s.loading === cue.soundId)
  const waiting = useSounds((s) => !!cue.soundId && s.waiting === cue.soundId)
  const busy = loading || waiting
  return (
    <IconButton
      label={playing || busy ? `Stop: ${cue.description}` : `Listen: ${cue.description}`}
      title={playing || busy ? 'Stop' : cue.sound === 'ready' ? 'Listen' : 'Make it now and listen'}
      size="md"
      disabled={!cue.soundId}
      active={playing}
      onClick={() => (playing || busy ? stopListening() : void listenTo(cue))}
      className={cn('h-7 w-7', playing && 'text-accent')}
    >
      {busy ? <Spinner size={12} /> : playing ? <Square size={11} /> : <Play size={13} />}
    </IconButton>
  )
}

/** On hover or focus: play it on the selected words, change what it sounds like, or remove it. */
function RowMenu({
  sceneId,
  cue,
  picked,
  open,
  onOpenChange,
  onEdit
}: {
  sceneId: ID
  cue: SceneCue
  picked: Picked
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
}): React.JSX.Element {
  const anchor = 'anchor' in picked ? picked.anchor : null
  const hint = 'problem' in picked && picked.problem === 'paragraphs' ? 'Select words in one paragraph' : 'Select words in the page first'
  const move = (patch: Partial<CueInput>, done: string): void => void changeSound(sceneId, cue.id, { ...asInput(cue), ...patch }, done)
  const endAfterStart = (): boolean => {
    const editor = editorBridge()?.editor
    return !!anchor && !!editor && comesAfter(pageParagraphs(editor.state.doc), cue.at, anchor)
  }

  return (
    <M.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <M.Trigger asChild>
        <IconButton
          label={`More for: ${cue.description}`}
          title="Change or remove"
          className={cn(
            'h-7 w-7 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100'
          )}
        >
          <MoreHorizontal size={15} />
        </IconButton>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[230px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {cue.kind === 'effect' ? (
            <MenuItem icon={<MapPin size={14} />} hint={anchor ? undefined : hint} disabled={!anchor} onSelect={() => anchor && move({ at: anchor }, `It plays on ${quote(anchor.words)} now.`)}>
              Play it on the selected words
            </MenuItem>
          ) : (
            <>
              <MenuItem
                icon={<MapPin size={14} />}
                hint={anchor ? undefined : hint}
                disabled={!anchor}
                onSelect={() => anchor && move({ at: anchor, until: null }, `It starts on ${quote(anchor.words)} now.`)}
              >
                Start it on the selected words
              </MenuItem>
              <MenuItem
                icon={<Flag size={14} />}
                hint={!anchor ? hint : endAfterStart() ? undefined : 'Select words after where it starts'}
                disabled={!anchor || !endAfterStart()}
                onSelect={() => anchor && move({ until: anchor }, `It ends on ${quote(anchor.words)} now.`)}
              >
                End it on the selected words
              </MenuItem>
              {cue.until ? (
                <MenuItem icon={<Flag size={14} />} onSelect={() => move({ until: null }, 'It plays to the end of the scene now.')}>
                  Play it to the end of the scene
                </MenuItem>
              ) : null}
            </>
          )}
          <MenuItem icon={<Pencil size={14} />} onSelect={onEdit}>
            Change what it sounds like
          </MenuItem>
          <M.Separator className="my-1 h-px bg-line" />
          <MenuItem icon={<Trash2 size={14} />} danger onSelect={() => void changeSound(sceneId, cue.id, null, 'Sound removed.')}>
            Remove
          </MenuItem>
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

function MenuItem({
  icon,
  children,
  hint,
  danger,
  disabled,
  onSelect
}: {
  icon: ReactNode
  children: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex min-h-8 items-start gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:cursor-default',
        danger ? 'text-danger' : 'text-fg'
      )}
    >
      <span className={cn('mt-[3px] flex w-4 shrink-0 justify-center', danger ? 'text-danger' : 'text-muted', disabled && 'opacity-50')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block', disabled && 'text-muted')}>{children}</span>
        {hint ? <span className="block text-[11.5px] text-faint">{hint}</span> : null}
      </span>
    </M.Item>
  )
}

// ---------- Adding a sound ----------

const KIND_OPTIONS: { value: SoundKind; label: string }[] = [
  { value: 'effect', label: 'Sound effect' },
  { value: 'ambience', label: 'Ambience' }
]

/** Add a sound: on the words selected in the page, an effect or an ambience, and what it sounds like. */
function AddSound({ sceneId, picked, onDone }: { sceneId: ID; picked: Picked; onDone: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<SoundKind>('effect')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const anchor = 'anchor' in picked ? picked.anchor : null
  const words = description.replace(/\s+/g, ' ').trim()
  const canAdd = !!anchor && !!words && !saving

  useEffect(() => box.current?.focus(), [])

  const add = async (): Promise<void> => {
    if (!anchor || !words) return
    setSaving(true)
    const ok = await changeSound(sceneId, null, { kind, description: words, at: anchor, until: null }, 'Sound added.')
    setSaving(false)
    if (ok) onDone()
  }

  return (
    <section aria-label="Add a sound" className="mx-4 mb-3 rounded-lg border border-line bg-surface px-3 py-3 animate-fade-in">
      <Segmented label="Kind of sound" value={kind} onChange={setKind} options={KIND_OPTIONS} className="w-full" />
      {/* One line, always: where it plays, or how to choose where. */}
      <p className="mt-2.5 truncate text-[12.5px] leading-[18px]" title={anchor?.words}>
        {anchor ? (
          <span className="text-fg">
            {kind === 'effect' ? `On ${quote(anchor.words, 40)}` : `From ${quote(anchor.words, 24)} to the end of the scene`}
          </span>
        ) : (
          <span className="text-muted">
            {'problem' in picked && picked.problem === 'paragraphs' ? 'Select words in one paragraph.' : 'Select the words in the page where it plays.'}
          </span>
        )}
      </p>
      <Textarea
        ref={box}
        aria-label="What it sounds like"
        placeholder={kind === 'effect' ? 'A heavy wooden door slamming shut' : 'Steady rain on a tin roof'}
        value={description}
        minRows={1}
        maxRows={4}
        maxLength={300}
        onChange={(e) => setDescription(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (canAdd) void add()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onDone()
          }
        }}
        className="mt-2"
      />
      <div className="mt-2.5 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!canAdd} loading={saving} onClick={() => void add()}>
          Add
        </Button>
      </div>
    </section>
  )
}

// ---------- The page ----------

/** The scene editor, once it shows this scene. */
function useSceneEditor(sceneId: ID): Editor | null {
  const [editor, setEditor] = useState<Editor | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = (): void => {
      const bridge = editorBridge()
      const e = bridge?.editor
      if (e && !e.isDestroyed && bridge?.sceneId === sceneId) setEditor(e)
      else {
        setEditor(null)
        timer = setTimeout(look, 200)
      }
    }
    look()
    return () => clearTimeout(timer)
  }, [sceneId])
  return editor
}

/** Reads the scene's sounds now, again when the AI marks some or a sound is made, and a moment after typing stops. */
function useSoundsLoader(editor: Editor | null, sceneId: ID): void {
  useEffect(() => {
    if (!editor) return
    void loadSounds(sceneId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(() => void loadSounds(sceneId), ms)
    }
    const offMarked = onEvent('sounds:marked', (e) => {
      if (e.sceneId === sceneId) soon(AFTER_MARKED_MS)
    })
    const offReady = onEvent('sounds:ready', () => soon(AFTER_READY_MS))
    const onUpdate = (): void => soon(AFTER_TYPING_MS)
    editor.on('update', onUpdate)
    return () => {
      clearTimeout(timer)
      offMarked()
      offReady()
      editor.off('update', onUpdate)
      stopListening()
    }
  }, [editor, sceneId])
}

/** Marks every sound's words faintly in the page while the tab shows (not while an entry or Ask covers it). */
function usePageMarks(editor: Editor | null, cues: SceneCue[] | null): void {
  const covered = useApp((s) => !!s.peekEntryId || s.askOpen)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    setSoundMarks(editor.view, cues && !covered ? soundWords(cues) : null)
  }, [editor, cues, covered])
  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed) setSoundMarks(editor.view, null)
    },
    [editor]
  )
}

/** The words selected in the page now, as a place for a sound (the selection stays while the panel has focus). */
function usePicked(editor: Editor | null): Picked {
  const [picked, setPicked] = useState<Picked>({ problem: 'none' })
  useEffect(() => {
    if (!editor) return
    const look = (): void => {
      if (editor.isDestroyed) return
      const { from, to } = editor.state.selection
      const next = pickWords(pageParagraphs(editor.state.doc), from, to)
      setPicked((prev) => (samePick(prev, next) ? prev : next))
    }
    look()
    editor.on('selectionUpdate', look)
    editor.on('update', look)
    return () => {
      editor.off('selectionUpdate', look)
      editor.off('update', look)
    }
  }, [editor])
  return picked
}

function samePick(a: Picked, b: Picked): boolean {
  if ('anchor' in a && 'anchor' in b)
    return a.anchor.pid === b.anchor.pid && a.anchor.from === b.anchor.from && a.anchor.to === b.anchor.to && a.anchor.words === b.anchor.words
  return 'problem' in a && 'problem' in b && a.problem === b.problem
}

/** Whether sounds can be made now (the download is done and the speech engine answers); null until known. */
function useSoundsReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api
      .getSoundsStatus()
      .then((s) => live && setReady(s.ready))
      .catch(() => undefined)
    const off = onEvent('sounds:status', (s) => setReady(s.ready))
    return () => {
      live = false
      off()
    }
  }, [])
  return ready
}

/** The element that scrolls the page. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if (y === 'auto' || y === 'scroll') return p
  }
  return null
}

/**
 * Selects the words a sound plays on and brings them into view a third of the way down the page. Marked as shown
 * (REVEALED), so the "Selected words" bar doesn't offer itself for them.
 */
function showWords(editor: Editor, cue: SceneCue): void {
  if (editor.isDestroyed) return
  const view = editor.view
  const range = anchorRange(pageParagraphs(view.state.doc), cue.at)
  if (!range) return
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).setMeta(REVEALED, true))
  view.focus()
  const el = scrollParent(view.dom as HTMLElement)
  if (el) {
    const top = view.coordsAtPos(range.from).top - el.getBoundingClientRect().top
    el.scrollTo({ top: Math.max(0, el.scrollTop + top - el.clientHeight / 3), behavior: 'auto' })
  }
}
