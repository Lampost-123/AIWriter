import { useSortable } from '@dnd-kit/sortable'
import { ChevronRight, CircleAlert, MoreHorizontal, Plus } from 'lucide-react'
import { memo, type ReactNode } from 'react'
import type { Chapter, ID, SceneMeta } from '@shared/types'
import { cn } from '@/lib/cn'
import { InlineTitle } from './InlineTitle'
import { formatWords } from './outlineModel'
import { STATUS_LABELS, StatusDot } from './StatusDot'

export const sceneDndId = (id: ID): string => `s:${id}`
export const chapterDndId = (id: ID): string => `c:${id}`
export function parseDndId(id: string | number): { kind: 'scene' | 'chapter'; id: ID } {
  const s = String(id)
  return { kind: s.startsWith('c:') ? 'chapter' : 'scene', id: s.slice(2) }
}

type Transform = { x: number; y: number; scaleX: number; scaleY: number }
const toCss = (t: Transform | null): string | undefined => (t ? `translate3d(${Math.round(t.x)}px, ${Math.round(t.y)}px, 0)` : undefined)

/** Callbacks shared by every row; kept stable so rows only re-render when their own data changes. */
export interface RowHandlers {
  /** Opens the scene and puts the caret in its page. */
  open(sceneId: ID): void
  toggle(chapterId: ID): void
  startRename(kind: 'scene' | 'chapter', id: ID): void
  stopRename(): void
  /** Saves a new title; resolves once it is stored. */
  rename(kind: 'scene' | 'chapter', id: ID, title: string): Promise<void>
  openMenu(kind: 'scene' | 'chapter', id: ID, at: { x: number; y: number }): void
  addScene(chapterId: ID): void
}

const rowBase =
  'group/row relative flex h-8 select-none items-center rounded-md text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60'

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
  selected: boolean
  /** The selected scene isn't on screen (a world page is): show it more quietly. */
  quiet: boolean
  renaming: boolean
  tabbable: boolean
  menuOpen: boolean
  h: RowHandlers
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
      <StatusDot status={scene.status} className="mr-2" />
      <span className="sr-only">{STATUS_LABELS[scene.status]}: </span>
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
  a.h === b.h &&
  a.scene.id === b.scene.id &&
  a.scene.title === b.scene.title &&
  a.scene.status === b.scene.status &&
  a.scene.wordCount === b.scene.wordCount &&
  a.scene.memoryState === b.scene.memoryState

export const SceneRow = memo(function SceneRow({ scene, selected, quiet, renaming, tabbable, menuOpen, h }: SceneRowProps): React.JSX.Element {
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
      aria-level={2}
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
        'pl-[30px] pr-1.5',
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
export function SceneDragPreview({ scene }: { scene: SceneMeta }): React.JSX.Element {
  return (
    <div className={cn(rowBase, 'cursor-grabbing bg-surface pl-[30px] pr-1.5 shadow-pop ring-1 ring-line')}>
      <SceneRowContent scene={scene} selected={false} renaming={false} />
    </div>
  )
}

// ---------- Chapter ----------

export interface ChapterBlockProps {
  chapter: Chapter
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
        aria-level={1}
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
          'pl-1 pr-1.5',
          isDragging ? 'bg-accent-soft ring-1 ring-inset ring-accent/40 [&>*]:opacity-0' : menuOpen ? 'bg-surface-2' : 'hover:bg-surface-2'
        )}
      >
        <ChapterRowContent chapter={chapter} words={words} collapsed={collapsed || lifted} renaming={renaming} h={h} forceButtons={menuOpen} />
      </div>
      {lifted ? null : children}
    </div>
  )
})

export function ChapterDragPreview({ chapter, words, sceneCount }: { chapter: Chapter; words: number; sceneCount: number }): React.JSX.Element {
  return (
    <div className="cursor-grabbing rounded-md bg-surface shadow-pop ring-1 ring-line">
      <div className={cn(rowBase, 'pl-1 pr-1.5')}>
        <ChapterRowContent chapter={chapter} words={words} collapsed renaming={false} />
      </div>
      {sceneCount > 0 ? (
        <div className="-mt-1.5 pb-1.5 pl-[30px] text-[11.5px] text-faint">
          {sceneCount === 1 ? '1 scene' : `${sceneCount} scenes`}
        </div>
      ) : null}
    </div>
  )
}

/** Shown inside a chapter with no scenes; also where a dragged scene can land. */
export function EmptyChapterRow({ chapterId, h }: { chapterId: ID; h: RowHandlers }): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => h.addScene(chapterId)}
      className="flex h-8 w-full items-center gap-2 rounded-md pl-[30px] text-left text-[12.5px] text-faint hover:bg-surface-2 hover:text-muted"
    >
      <Plus size={13} />
      Add a scene
    </button>
  )
}
