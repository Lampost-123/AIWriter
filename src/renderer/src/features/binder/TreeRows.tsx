import { useSortable } from '@dnd-kit/sortable'
import { ChevronRight, CircleAlert, MoreHorizontal, Plus } from 'lucide-react'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Act, Chapter, ID, SceneMeta } from '@shared/types'
import { Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { registerFlusher } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { ChapterIssueBadge, SceneIssueBadge } from '@/features/consistency/IssueBadge'
import { ChapterPlayingMark, SceneStatusMark } from '@/features/readAloud/PlayingMark'
import { InlineTitle } from './InlineTitle'
import { formatWords } from './outlineModel'
import { STATUS_LABELS } from './StatusDot'

export const sceneDndId = (id: ID): string => `s:${id}`
export const chapterDndId = (id: ID): string => `c:${id}`
export function parseDndId(id: string | number): { kind: 'scene' | 'chapter'; id: ID } {
  const s = String(id)
  return { kind: s.startsWith('c:') ? 'chapter' : 'scene', id: s.slice(2) }
}

type Transform = { x: number; y: number; scaleX: number; scaleY: number }
const toCss = (t: Transform | null): string | undefined => (t ? `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)` : undefined)

/** The kinds of row in the story tree. Acts appear only in a story that has them (milestone 4). */
export type RowKind = 'scene' | 'chapter' | 'act'

/** Callbacks shared by every row; kept stable so rows only re-render when their own data changes. */
export interface RowHandlers {
  /** Opens the scene and puts the caret in its page. */
  open(sceneId: ID): void
  /** Folds or unfolds a chapter or an act. */
  toggle(id: ID): void
  startRename(kind: RowKind, id: ID): void
  stopRename(): void
  /** Saves a new title; resolves once it is stored. */
  rename(kind: RowKind, id: ID, title: string): Promise<void>
  openMenu(kind: RowKind, id: ID, at: { x: number; y: number }): void
  addScene(chapterId: ID): void
  /** Adds a chapter at the end of an act. */
  addChapter(actId: ID): void
  /** Saves an act's purpose (or, with null, leaves it as it was) and closes its box. */
  finishPurpose(actId: ID, purpose: string | null): void
}

const rowBase =
  'group/row relative flex h-8 select-none items-center rounded-md text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60'

/** A chapter's or scene's left padding by its depth: inside an act, one step further in, so it reads as the act's. */
const chapterPad = (level: number): string => (level >= 2 ? 'pl-4' : 'pl-1')
const scenePad = (level: number): string => (level >= 3 ? 'pl-[42px]' : 'pl-[30px]')

/** Word count, swapped for hover buttons in the same spot so nothing shifts. */
function RowEnd({ words, children, forceButtons }: { words: string; children: ReactNode; forceButtons?: boolean }): React.JSX.Element {
  return (
    <span className="relative ml-2 flex h-6 min-w-[44px] shrink-0 items-center justify-end">
      <span
        className={cn(
          'text-[11.5px] tabular-nums text-faint transition-opacity duration-150 group-hover/row:opacity-0 group-focus-visible/row:opacity-0',
          forceButtons && 'opacity-0'
        )}
      >
        {words}
      </span>
      <span
        className={cn(
          'absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-focus-visible/row:opacity-100',
          forceButtons && 'opacity-100'
        )}
      >
        {children}
      </span>
    </span>
  )
}

function HoverButton({ label, onClick, children }: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-3 hover:text-fg"
    >
      {children}
    </button>
  )
}

const menuPoint = (e: React.MouseEvent<HTMLElement>): { x: number; y: number } => {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.left, y: r.bottom + 2 }
}

// ---------- Scene row ----------

export interface SceneRowProps {
  scene: SceneMeta
  /** Its depth in the tree: 2, or 3 in a chapter that is in an act. */
  level?: number
  selected: boolean
  /** The selected scene isn't on screen (a world page is): show it more quietly. */
  quiet: boolean
  renaming: boolean
  tabbable: boolean
  menuOpen: boolean
  h: RowHandlers
}

/** A draft is being written into this scene, perhaps while Adam is in another one. */
function DraftingDot({ sceneId }: { sceneId: ID }): React.JSX.Element | null {
  const drafting = useApp((s) => s.activeGeneration?.sceneId === sceneId)
  if (!drafting) return null
  return (
    <span className="ml-1.5 flex h-4 w-2 shrink-0 items-center justify-center" title="A draft is being written into this scene">
      <span className="h-1.5 w-1.5 rounded-full bg-ai animate-pulse" aria-hidden />
      <span className="sr-only">A draft is being written into this scene</span>
    </span>
  )
}

export function SceneRowContent({
  scene,
  selected,
  renaming,
  h,
  forceButtons
}: Pick<SceneRowProps, 'scene' | 'selected' | 'renaming'> & { h?: RowHandlers; forceButtons?: boolean }): React.JSX.Element {
  return (
    <>
      {/* The status dot, or a speaker while the scene is read aloud. */}
      <SceneStatusMark sceneId={scene.id} status={scene.status} statusLabel={STATUS_LABELS[scene.status]} />
      {renaming && h ? (
        <InlineTitle
          label="Scene title"
          value={scene.title}
          className="h-6 text-[13px]"
          onCommit={(t) => h.rename('scene', scene.id, t)}
          onDone={h.stopRename}
        />
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', selected ? 'font-medium text-fg' : 'text-fg/90')}>{scene.title || 'Untitled scene'}</span>
      )}
      {/* Milestone 5: open issues, after the title so nothing moves when they load. */}
      {renaming ? null : <DraftingDot sceneId={scene.id} />}
      {renaming ? null : <SceneIssueBadge sceneId={scene.id} />}
      {scene.memoryState === 'failed' && !renaming ? (
        // The scene header says why and offers Try again.
        <span className="ml-1 flex shrink-0 text-ai" title="Memory not updated for this scene">
          <CircleAlert size={12} aria-hidden />
          <span className="sr-only">Memory not updated</span>
        </span>
      ) : null}
      <RowEnd words={formatWords(scene.wordCount)} forceButtons={forceButtons}>
        {h ? (
          <HoverButton label="More actions" onClick={(e) => h.openMenu('scene', scene.id, menuPoint(e))}>
            <MoreHorizontal size={15} />
          </HoverButton>
        ) : null}
      </RowEnd>
    </>
  )
}

const sameRow = (a: SceneRowProps, b: SceneRowProps): boolean =>
  a.selected === b.selected &&
  a.quiet === b.quiet &&
  a.renaming === b.renaming &&
  a.tabbable === b.tabbable &&
  a.menuOpen === b.menuOpen &&
  a.level === b.level &&
  a.h === b.h &&
  a.scene.id === b.scene.id &&
  a.scene.title === b.scene.title &&
  a.scene.status === b.scene.status &&
  a.scene.wordCount === b.scene.wordCount &&
  a.scene.memoryState === b.scene.memoryState

export const SceneRow = memo(function SceneRow({ scene, level = 2, selected, quiet, renaming, tabbable, menuOpen, h }: SceneRowProps): React.JSX.Element {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: sceneDndId(scene.id),
    data: { kind: 'scene' },
    disabled: renaming
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      role="treeitem"
      aria-selected={selected}
      aria-level={level}
      tabIndex={tabbable ? 0 : -1}
      data-row="scene"
      data-id={scene.id}
      style={{ transform: toCss(transform), transition }}
      onClick={() => h.open(scene.id)}
      onDoubleClick={() => h.startRename('scene', scene.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        h.openMenu('scene', scene.id, { x: e.clientX, y: e.clientY })
      }}
      className={cn(
        rowBase,
        scenePad(level),
        'pr-1.5',
        isDragging
          ? 'z-10 bg-accent-soft ring-1 ring-inset ring-accent/40 [&>*]:opacity-0'
          : selected
            ? quiet
              ? 'bg-surface-3/70'
              : 'bg-accent-soft'
            : menuOpen
              ? 'bg-surface-2'
              : 'hover:bg-surface-2'
      )}
    >
      <SceneRowContent scene={scene} selected={selected} renaming={renaming} h={h} forceButtons={menuOpen} />
    </div>
  )
}, sameRow)

/** The scene as it follows the pointer while dragged. */
export function SceneDragPreview({ scene, level = 2 }: { scene: SceneMeta; level?: number }): React.JSX.Element {
  return (
    <div className={cn(rowBase, scenePad(level), 'cursor-grabbing bg-surface pr-1.5 shadow-pop ring-1 ring-line')}>
      <SceneRowContent scene={scene} selected={false} renaming={false} />
    </div>
  )
}

// ---------- Chapter ----------

export interface ChapterBlockProps {
  chapter: Chapter
  /** Its depth in the tree: 1, or 2 in an act. */
  level?: number
  words: number
  sceneCount: number
  collapsed: boolean
  renaming: boolean
  tabbable: boolean
  menuOpen: boolean
  /** This chapter is being dragged: show only its heading. */
  lifted: boolean
  h: RowHandlers
  children?: ReactNode
}

function ChapterRowContent({
  chapter,
  words,
  collapsed,
  renaming,
  h,
  forceButtons
}: Pick<ChapterBlockProps, 'chapter' | 'words' | 'collapsed' | 'renaming'> & { h?: RowHandlers; forceButtons?: boolean }): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label={collapsed ? 'Show scenes' : 'Hide scenes'}
        className="mr-1 flex h-6 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-fg"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          h?.toggle(chapter.id)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <ChevronRight size={14} className={cn('transition-transform duration-150', !collapsed && 'rotate-90')} />
      </button>
      {renaming && h ? (
        <InlineTitle
          label="Chapter title"
          value={chapter.title}
          className="h-6 text-[13px] font-semibold"
          onCommit={(t) => h.rename('chapter', chapter.id, t)}
          onDone={h.stopRename}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate font-semibold text-fg">{chapter.title || 'Untitled chapter'}</span>
      )}
      {renaming ? null : <ChapterPlayingMark chapterId={chapter.id} />}
      {collapsed && !renaming ? <ChapterIssueBadge chapterId={chapter.id} /> : null}
      <RowEnd words={formatWords(words)} forceButtons={forceButtons}>
        {h ? (
          <>
            <HoverButton label="Add a scene to this chapter" onClick={() => h.addScene(chapter.id)}>
              <Plus size={15} />
            </HoverButton>
            <HoverButton label="More actions" onClick={(e) => h.openMenu('chapter', chapter.id, menuPoint(e))}>
              <MoreHorizontal size={15} />
            </HoverButton>
          </>
        ) : null}
      </RowEnd>
    </>
  )
}

export const ChapterBlock = memo(function ChapterBlock({
  chapter,
  level = 1,
  words,
  collapsed,
  renaming,
  tabbable,
  menuOpen,
  lifted,
  h,
  children
}: ChapterBlockProps): React.JSX.Element {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: chapterDndId(chapter.id),
    data: { kind: 'chapter' },
    disabled: renaming
  })
  return (
    <div ref={setNodeRef} role="group" style={{ transform: toCss(transform), transition }} className={cn('relative pb-1', isDragging && 'z-10')}>
      <div
        ref={setActivatorNodeRef}
        {...listeners}
        role="treeitem"
        aria-expanded={!collapsed}
        aria-level={level}
        tabIndex={tabbable ? 0 : -1}
        data-row="chapter"
        data-id={chapter.id}
        onDoubleClick={() => h.startRename('chapter', chapter.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          h.openMenu('chapter', chapter.id, { x: e.clientX, y: e.clientY })
        }}
        className={cn(
          rowBase,
          chapterPad(level),
          'pr-1.5',
          isDragging ? 'bg-accent-soft ring-1 ring-inset ring-accent/40 [&>*]:opacity-0' : menuOpen ? 'bg-surface-2' : 'hover:bg-surface-2'
        )}
      >
        <ChapterRowContent chapter={chapter} words={words} collapsed={collapsed || lifted} renaming={renaming} h={h} forceButtons={menuOpen} />
      </div>
      {lifted ? null : children}
    </div>
  )
})

export function ChapterDragPreview({
  chapter,
  words,
  sceneCount,
  level = 1
}: {
  chapter: Chapter
  words: number
  sceneCount: number
  level?: number
}): React.JSX.Element {
  return (
    <div className="cursor-grabbing rounded-md bg-surface shadow-pop ring-1 ring-line">
      <div className={cn(rowBase, chapterPad(level), 'pr-1.5')}>
        <ChapterRowContent chapter={chapter} words={words} collapsed renaming={false} />
      </div>
      {sceneCount > 0 ? (
        <div className={cn('-mt-1.5 pb-1.5 text-[11.5px] text-faint', scenePad(level + 1))}>
          {sceneCount === 1 ? '1 scene' : `${sceneCount} scenes`}
        </div>
      ) : null}
    </div>
  )
}

/** Shown inside a chapter with no scenes; also where a dragged scene can land. `level`: the chapter's depth. */
export function EmptyChapterRow({ chapterId, level = 1, h }: { chapterId: ID; level?: number; h: RowHandlers }): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => h.addScene(chapterId)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md text-left text-[12.5px] text-faint hover:bg-surface-2 hover:text-muted',
        scenePad(level + 1)
      )}
    >
      <Plus size={13} />
      Add a scene
    </button>
  )
}

// ---------- Act (milestone 4) ----------

export interface ActBlockProps {
  act: Act
  words: number
  chapterCount: number
  collapsed: boolean
  renaming: boolean
  /** Its purpose box is open (the menu's "Edit purpose"). */
  editingPurpose: boolean
  tabbable: boolean
  menuOpen: boolean
  h: RowHandlers
  children?: ReactNode
}

/**
 * An act: a quiet heading over its chapters, folded and unfolded like a chapter. Its purpose shows
 * when the pointer rests on it, and can be edited from its menu.
 */
export const ActBlock = memo(function ActBlock({
  act,
  words,
  chapterCount,
  collapsed,
  renaming,
  editingPurpose,
  tabbable,
  menuOpen,
  h,
  children
}: ActBlockProps): React.JSX.Element {
  const purpose = act.purpose.trim()
  return (
    <div role="group" className="pb-1 pt-0.5">
      <div
        role="treeitem"
        aria-expanded={!collapsed}
        aria-level={1}
        tabIndex={tabbable ? 0 : -1}
        data-row="act"
        data-id={act.id}
        title={renaming ? undefined : purpose ? `${act.title || 'Untitled act'}: ${purpose}` : act.title || 'Untitled act'}
        onDoubleClick={() => h.startRename('act', act.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          h.openMenu('act', act.id, { x: e.clientX, y: e.clientY })
        }}
        className={cn(rowBase, 'pl-1 pr-1.5', menuOpen ? 'bg-surface-2' : 'hover:bg-surface-2')}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label={collapsed ? 'Show chapters' : 'Hide chapters'}
          className="mr-1 flex h-6 w-5 shrink-0 items-center justify-center rounded text-faint hover:text-fg"
          onClick={(e) => {
            e.stopPropagation()
            h.toggle(act.id)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={14} className={cn('transition-transform duration-150', !collapsed && 'rotate-90')} />
        </button>
        {renaming ? (
          <InlineTitle
            label="Act title"
            value={act.title}
            className="h-6 text-[13px] font-semibold"
            onCommit={(t) => h.rename('act', act.id, t)}
            onDone={h.stopRename}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-fg">{act.title || 'Untitled act'}</span>
        )}
        {purpose ? <span className="sr-only">. {purpose}</span> : null}
        <RowEnd words={formatWords(words)} forceButtons={menuOpen}>
          <HoverButton label="Add a chapter to this act" onClick={() => h.addChapter(act.id)}>
            <Plus size={15} />
          </HoverButton>
          <HoverButton label="More actions" onClick={(e) => h.openMenu('act', act.id, menuPoint(e))}>
            <MoreHorizontal size={15} />
          </HoverButton>
        </RowEnd>
      </div>
      {editingPurpose ? <PurposeBox act={act} h={h} /> : null}
      {collapsed ? null : children}
      {!collapsed && chapterCount === 0 ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => h.addChapter(act.id)}
          className="flex h-8 w-full items-center gap-2 rounded-md pl-[21px] text-left text-[12.5px] text-faint hover:bg-surface-2 hover:text-muted"
        >
          <Plus size={14} />
          Add a chapter
        </button>
      ) : null}
    </div>
  )
})

/** The act's purpose, edited in place under its heading: Enter or leaving the box saves, Esc cancels. */
function PurposeBox({ act, h }: { act: Act; h: RowHandlers }): React.JSX.Element {
  const [value, setValue] = useState(act.purpose)
  const ref = useRef<HTMLTextAreaElement>(null)
  const finished = useRef(false)
  const latest = useRef({ value, h, id: act.id })
  latest.current = { value, h, id: act.id }
  const finish = (save: boolean): void => {
    if (finished.current) return
    finished.current = true
    latest.current.h.finishPurpose(latest.current.id, save ? latest.current.value : null)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    const el = ref.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    // A purpose still being typed is saved when the window closes or the world changes.
    return registerFlusher(() => finishRef.current(true))
  }, [])
  return (
    <div className="pb-1.5 pl-[26px] pr-1.5 pt-0.5">
      <Textarea
        ref={ref}
        aria-label="Act purpose"
        value={value}
        minRows={1}
        maxRows={5}
        placeholder="What this act does for the story"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            finish(true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
          }
        }}
        onBlur={() => finish(true)}
        className="px-2 py-1 text-[12.5px]"
      />
    </div>
  )
}
