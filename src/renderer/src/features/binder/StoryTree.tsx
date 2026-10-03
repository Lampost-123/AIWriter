import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  BetweenHorizontalStart,
  FilePlus2,
  FolderInput,
  FolderPlus,
  ListTree,
  PenLine,
  Plus,
  Target as TargetIcon,
  Trash2
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ID, Outline } from '@shared/types'
import { Button } from '@/components/ui'
import { useApp } from '@/lib/store'
import { undoLastDelete } from '@/lib/undoDelete'
import { requestEditorFocus } from '@/features/editor/focusRequest'
import { openOutlineHelper } from '@/features/outline/open'
import * as actions from './actions'
import { useCollapsed } from './collapsed'
import {
  actOf,
  applyTreeOrder,
  arrayMove,
  canStartActAt,
  chapterRuns,
  findChapterOf,
  groupOutline,
  moveSceneTo,
  scenePlace,
  shownOrder,
  treeOrder,
  type TreeOrder
} from './outlineModel'
import { useOutlineStore } from './outlineStore'
import { RowMenu, RowMenuItem, RowMenuSeparator, RowMenuSub } from './RowMenu'
import {
  ActBlock,
  ChapterBlock,
  ChapterDragPreview,
  chapterDndId,
  EmptyChapterRow,
  parseDndId,
  SceneDragPreview,
  sceneDndId,
  SceneRow,
  type RowHandlers,
  type RowKind
} from './TreeRows'

interface Target {
  kind: RowKind
  id: ID
}
interface DragState {
  kind: 'scene' | 'chapter'
  id: ID
  order: TreeOrder
}

/** Only move up and down, and stay inside the binder's scrolling area. */
const keepInTree: Modifier = ({ transform, draggingNodeRect, scrollableAncestorRects }) => {
  const t = { ...transform, x: 0 }
  const bounds = scrollableAncestorRects[0]
  if (!draggingNodeRect || !bounds) return t
  if (draggingNodeRect.top + t.y < bounds.top) t.y = bounds.top - draggingNodeRect.top
  else if (draggingNodeRect.bottom + t.y > bounds.bottom) t.y = bounds.bottom - draggingNodeRect.bottom
  return t
}

const measuring = { droppable: { strategy: MeasuringStrategy.Always } }
/** The dragged row settles into place, unless the system asks for less motion. */
const dropAnimation =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? null
    : { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }

const MENU_LABELS: Record<RowKind, string> = { scene: 'Scene actions', chapter: 'Chapter actions', act: 'Act actions' }

/**
 * The chapters and scenes of the open story, with drag and drop, inline rename and a context menu. In a
 * story with acts (milestone 4), each act heads its chapters and folds like a chapter; chapters are
 * dragged within their act and moved to another one from their menu.
 */
export function StoryTree({ outline }: { outline: Outline }): React.JSX.Element {
  const sceneId = useApp((s) => s.sceneId)
  const writing = useApp((s) => s.view.kind === 'write')
  const { collapsed, toggle } = useCollapsed()
  const [renaming, setRenaming] = useState<Target | null>(null)
  // The row menu hands focus back a moment after it has closed, from a render before it closed: by
  // then a scene or chapter it added may already have its name box open, so it reads this instead.
  const renamingRef = useRef(renaming)
  renamingRef.current = renaming
  /** The act whose purpose box is open. */
  const [purposeFor, setPurposeFor] = useState<ID | null>(null)
  const purposeRef = useRef(purposeFor)
  purposeRef.current = purposeFor
  const [menu, setMenu] = useState<(Target & { x: number; y: number }) | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  /** Row to focus once it has rendered (after add/delete/rename). */
  const focusNext = useRef<ID | null>(null)

  const groups = useMemo(() => groupOutline(outline), [outline])
  // Chapters in the order shown: each act's together (the order the story itself keeps).
  const base = useMemo<TreeOrder>(() => {
    const t = treeOrder(outline)
    return { ...t, chapters: shownOrder(outline, t.chapters) }
  }, [outline])
  const order = drag?.order ?? base
  const runs = useMemo(() => chapterRuns(outline, order.chapters), [outline, order.chapters])
  const hasActs = (outline.acts?.length ?? 0) > 0
  const chapterById = useMemo(() => new Map(groups.map((g) => [g.chapter.id, g])), [groups])
  const sceneById = useMemo(() => new Map(outline.scenes.map((s) => [s.id, s])), [outline])
  /** Each chapter's act (in a story with acts). */
  const actOfChapter = useMemo(() => new Map(outline.chapters.map((c) => [c.id, actOf(outline, c.id)])), [outline])

  // Live values for the drag callbacks, which dnd-kit holds on to, and for the stable row handlers.
  const live = useRef({ order, drag, collapsed, actOfChapter, outline })
  live.current = { order, drag, collapsed, actOfChapter, outline }
  const lastOver = useRef<UniqueIdentifier | null>(null)
  const movedAcross = useRef(false)
  useEffect(() => {
    requestAnimationFrame(() => (movedAcross.current = false))
  }, [order])

  // ---------- Row handlers (stable) ----------

  const focusRow = useCallback((id: ID | null) => {
    if (!id) return
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-row][data-id="${CSS.escape(id)}"]`)
    if (el) el.focus({ preventScroll: false })
    else focusNext.current = id
  }, [])

  useLayoutEffect(() => {
    if (!focusNext.current) return
    const id = focusNext.current
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-row][data-id="${CSS.escape(id)}"]`)
    if (el && !renaming && !purposeFor) {
      focusNext.current = null
      el.focus()
    }
  })

  /** A chapter just added: once it has rendered, scroll so all of it shows, not only its title. */
  const revealNext = useRef<ID | null>(null)
  const addChapterRef = useRef<HTMLButtonElement>(null)

  const h = useMemo<RowHandlers>(() => {
    const select = (id: ID): void => {
      const { storyId, sceneId: open, view, navigate, selectScene } = useApp.getState()
      if (id !== open) selectScene(id, storyId ?? undefined)
      else if (view.kind !== 'write') navigate({ kind: 'write' })
    }
    return {
      open: (id) => {
        // Opening a scene puts the caret in its page, so typing goes straight into it.
        select(id)
        requestEditorFocus(id)
      },
      toggle: (id) => toggle(id),
      startRename: (kind, id) => setRenaming({ kind, id }),
      stopRename: () => {
        setRenaming((r) => {
          if (r) focusNext.current = r.id
          return null
        })
      },
      rename: (kind, id, title) =>
        kind === 'scene' ? actions.renameScene(id, title) : kind === 'chapter' ? actions.renameChapter(id, title) : actions.renameAct(id, title),
      openMenu: (kind, id, at) => setMenu({ kind, id, ...at }),
      addScene: (chapterId) => {
        toggle(chapterId, false)
        void actions.addScene(chapterId).then((id) => id && setRenaming({ kind: 'scene', id }))
      },
      addChapter: (actId) => {
        toggle(actId, false)
        void actions.addChapterToAct(live.current.outline.story.id, actId).then((id) => {
          if (!id) return
          revealNext.current = id
          setRenaming({ kind: 'chapter', id })
        })
      },
      finishPurpose: (actId, purpose) => {
        setPurposeFor(null)
        focusNext.current = actId
        const was = live.current.outline.acts?.find((a) => a.id === actId)?.purpose ?? ''
        if (purpose !== null && purpose.replace(/\s+/g, ' ').trim() !== was.trim()) void actions.setActPurpose(actId, purpose)
      }
    }
  }, [toggle])

  const addChapter = useCallback(
    (afterId?: ID | null) => {
      void actions.addChapter(outline.story.id, afterId).then((id) => {
        if (!id) return
        revealNext.current = id
        setRenaming({ kind: 'chapter', id })
      })
    },
    [outline.story.id]
  )

  const addAct = useCallback(
    (afterId: ID) => {
      void actions.addAct(outline.story.id, afterId).then((id) => id && setRenaming({ kind: 'act', id }))
    },
    [outline.story.id]
  )

  /** A new act from this chapter on, named straight away. */
  const startAct = useCallback((chapterId: ID) => {
    void actions.startActAt(chapterId).then((id) => id && setRenaming({ kind: 'act', id }))
  }, [])

  const moveToAct = useCallback(
    (chapterId: ID, actId: ID) => {
      // Shown in its new act, and keeps the keyboard where it was.
      toggle(actId, false)
      focusNext.current = chapterId
      void actions.moveChapterToAct(chapterId, actId)
    },
    [toggle]
  )

  useLayoutEffect(() => {
    const id = revealNext.current
    if (!id) return
    const row = treeRef.current?.querySelector<HTMLElement>(`[data-row="chapter"][data-id="${CSS.escape(id)}"]`)
    if (!row) return
    revealNext.current = null
    // The last chapter: show it down to the Add chapter button. Otherwise its block (title and Add a scene).
    const last = order.chapters[order.chapters.length - 1] === id
    const target = last ? addChapterRef.current : row.closest<HTMLElement>('[role="group"]')
    target?.scrollIntoView({ block: 'nearest' })
  })

  const remove = useCallback(
    (t: Target) => {
      // Keep keyboard focus in the tree: move it to a neighbouring row first.
      const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
      const i = rows.findIndex((r) => r.dataset.id === t.id)
      const hadFocus = rows[i] && rows[i].contains(document.activeElement)
      if (hadFocus) {
        const inAct = t.kind === 'act' ? base.chapters.filter((c) => actOfChapter.get(c) === t.id) : []
        const skip =
          t.kind === 'chapter'
            ? new Set([t.id, ...(base.scenes[t.id] ?? [])])
            : t.kind === 'act'
              ? new Set([t.id, ...inAct, ...inAct.flatMap((c) => base.scenes[c] ?? [])])
              : new Set([t.id])
        const neighbour = rows.slice(i + 1).find((r) => !skip.has(r.dataset.id!)) ?? rows.slice(0, i).reverse().find((r) => !skip.has(r.dataset.id!))
        neighbour?.focus()
      }
      void (t.kind === 'scene' ? actions.deleteScene(t.id) : t.kind === 'chapter' ? actions.deleteChapter(t.id) : actions.deleteAct(t.id))
    },
    [base, actOfChapter]
  )

  // ---------- Keyboard ----------

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (renaming || drag || purposeFor) return
    const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
    const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-row]')
    const i = current ? rows.indexOf(current) : -1
    const kind = current?.dataset.row as RowKind | undefined
    const id = current?.dataset.id
    const folds = kind === 'chapter' || kind === 'act'
    const move = (to: number): void => {
      e.preventDefault()
      rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus()
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(i + 1)
      case 'ArrowUp':
        return move(i < 0 ? 0 : i - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(rows.length - 1)
      case 'ArrowRight':
        if (folds && id && collapsed.has(id)) {
          e.preventDefault()
          toggle(id, false)
        } else if (folds) move(i + 1)
        return
      case 'ArrowLeft':
        if (folds && id && !collapsed.has(id)) {
          e.preventDefault()
          toggle(id, true)
        } else if (kind === 'chapter' && id && actOfChapter.get(id)) {
          // A folded chapter in an act: up to its act.
          e.preventDefault()
          focusRow(actOfChapter.get(id) ?? null)
        } else if (kind === 'scene' && id) {
          e.preventDefault()
          const ch = findChapterOf(base.scenes, id)
          if (ch) focusRow(ch)
        }
        return
      case 'Enter':
        if (!id) return
        e.preventDefault()
        if (kind === 'scene') h.open(id)
        else toggle(id)
        return
      case 'F2':
        if (!id || !kind) return
        e.preventDefault()
        setRenaming({ kind, id })
        return
      case 'Delete':
        if (!id || !kind) return
        e.preventDefault()
        remove({ kind, id })
        return
      case 'z':
      case 'Z':
        // Ctrl+Z in the binder undoes the last delete (while its toast still offers Undo).
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && undoLastDelete()) e.preventDefault()
        return
    }
  }

  // ---------- Drag and drop ----------

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const collision: CollisionDetection = useCallback((args) => {
    const { drag: d, order: o, collapsed: c, actOfChapter: acts } = live.current
    if (!d) return closestCenter(args)
    if (d.kind === 'chapter') {
      // A chapter moves among the chapters of its own act (another act is a menu choice).
      const act = acts.get(d.id) ?? null
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((x) => {
          const t = parseDndId(x.id)
          return t.kind === 'chapter' && (acts.get(t.id) ?? null) === act
        })
      })
    }
    // A scene: find the row under the pointer; over a chapter, the nearest of its visible scenes.
    const pointer = pointerWithin(args)
    const hits = pointer.length > 0 ? pointer : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')
    if (overId != null) {
      const over = parseDndId(overId)
      if (over.kind === 'chapter') {
        const visible = (o.scenes[over.id] ?? []).filter((sid) => !c.has(over.id) || sid === d.id).map(sceneDndId)
        if (visible.length > 0) {
          const inner = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((x) => visible.includes(String(x.id))) })
          overId = inner[0]?.id ?? overId
        }
      }
      lastOver.current = overId
      return [{ id: overId }]
    }
    if (movedAcross.current) lastOver.current = sceneDndId(d.id)
    return lastOver.current ? [{ id: lastOver.current }] : []
  }, [])

  const onDragStart = ({ active }: DragStartEvent): void => {
    setMenu(null)
    const t = parseDndId(active.id)
    lastOver.current = null
    setDrag({ kind: t.kind, id: t.id, order: base })
  }

  const onDragOver = ({ active, over }: DragOverEvent): void => {
    if (!over) return
    const target = parseDndId(over.id)
    const midY = (() => {
      const r = active.rect.current.translated
      return r ? r.top + r.height / 2 : null
    })()
    setDrag((d) => {
      if (!d || d.kind !== 'scene') return d
      const fromCh = findChapterOf(d.order.scenes, d.id)
      const toCh = target.kind === 'chapter' ? target.id : findChapterOf(d.order.scenes, target.id)
      if (!fromCh || !toCh || fromCh === toCh) return d
      let index: number
      if (target.kind === 'chapter') {
        index = live.current.collapsed.has(toCh) ? 0 : d.order.scenes[toCh].length
      } else {
        const overIndex = d.order.scenes[toCh].indexOf(target.id)
        const below = midY != null && midY > over.rect.top + over.rect.height / 2
        index = overIndex + (below ? 1 : 0)
      }
      movedAcross.current = true
      return { ...d, order: { ...d.order, scenes: moveSceneTo(d.order.scenes, d.id, toCh, index) } }
    })
  }

  const finishDrag = (next: TreeOrder | null): void => {
    const d = live.current.drag
    setDrag(null)
    if (!d || !next) return
    if (d.kind === 'chapter') {
      const from = base.chapters.indexOf(d.id)
      const to = next.chapters.indexOf(d.id)
      if (from === to) return
      useOutlineStore.getState().patch((o) => applyTreeOrder(o, next))
      void actions.moveChapter(d.id, to)
      return
    }
    const before = scenePlace(base.scenes, d.id)
    const after = scenePlace(next.scenes, d.id)
    if (!after || (before && before.chapterId === after.chapterId && before.index === after.index)) return
    useOutlineStore.getState().patch((o) => applyTreeOrder(o, next))
    if (live.current.collapsed.has(after.chapterId)) toggle(after.chapterId, false)
    void actions.moveScene(d.id, after.chapterId, after.index)
  }

  const onDragEnd = ({ over }: DragEndEvent): void => {
    const d = live.current.drag
    if (!d) return
    let next = d.order
    if (over) {
      const target = parseDndId(over.id)
      if (d.kind === 'chapter' && target.kind === 'chapter' && target.id !== d.id) {
        const from = next.chapters.indexOf(d.id)
        const to = next.chapters.indexOf(target.id)
        if (from >= 0 && to >= 0) next = { ...next, chapters: arrayMove(next.chapters, from, to) }
      } else if (d.kind === 'scene' && target.kind === 'scene' && target.id !== d.id) {
        const ch = findChapterOf(next.scenes, d.id)
        if (ch && findChapterOf(next.scenes, target.id) === ch) {
          const list = next.scenes[ch]
          next = { ...next, scenes: { ...next.scenes, [ch]: arrayMove(list, list.indexOf(d.id), list.indexOf(target.id)) } }
        }
      }
    }
    finishDrag(next)
  }

  // ---------- Render ----------

  const firstRow = runs[0]?.act?.id ?? runs[0]?.chapters[0] ?? null
  /** The one row Tab reaches: the open scene, or the nearest row of it that shows, else the first row. */
  const tabbableId = (() => {
    if (!sceneId || !sceneById.has(sceneId)) return firstRow
    const ch = findChapterOf(base.scenes, sceneId)
    const act = ch ? actOfChapter.get(ch) : null
    if (act && collapsed.has(act)) return act
    if (ch && collapsed.has(ch)) return ch
    return sceneId
  })()
  const activeScene = drag?.kind === 'scene' ? sceneById.get(drag.id) : undefined
  const activeChapter = drag?.kind === 'chapter' ? chapterById.get(drag.id) : undefined
  const storyWords = outline.scenes.reduce((n, s) => n + s.wordCount, 0)

  if (order.chapters.length === 0 && !hasActs) {
    return (
      <div className="flex flex-col items-center px-4 py-10 text-center animate-fade-in">
        <p className="text-[13px] font-medium text-fg">No chapters yet</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Chapters hold the scenes of this story.</p>
        <Button size="sm" className="mt-3" icon={<Plus size={14} />} onClick={() => addChapter()}>
          Add chapter
        </Button>
        <Button variant="ghost" size="sm" className="mt-1.5" icon={<ListTree size={14} />} onClick={() => openOutlineHelper(outline.story.id)}>
          Plan it with the outline helper
        </Button>
      </div>
    )
  }

  const chapterBlock = (chapterId: ID, level: number): React.JSX.Element | null => {
    const g = chapterById.get(chapterId)
    if (!g) return null
    const ids = order.scenes[chapterId] ?? []
    const isCollapsed = collapsed.has(chapterId)
    const shown = isCollapsed ? ids.filter((id) => drag?.kind === 'scene' && id === drag.id) : ids
    const words = ids.reduce((n, id) => n + (sceneById.get(id)?.wordCount ?? 0), 0)
    return (
      <ChapterBlock
        key={chapterId}
        chapter={g.chapter}
        level={level}
        words={words}
        sceneCount={ids.length}
        collapsed={isCollapsed}
        renaming={renaming?.kind === 'chapter' && renaming.id === chapterId}
        tabbable={tabbableId === chapterId}
        menuOpen={menu?.kind === 'chapter' && menu.id === chapterId}
        lifted={drag?.kind === 'chapter' && drag.id === chapterId}
        h={h}
      >
        <SortableContext items={shown.map(sceneDndId)} strategy={verticalListSortingStrategy}>
          {shown.map((id) => {
            const scene = sceneById.get(id)
            return scene ? (
              <SceneRow
                key={id}
                scene={scene}
                level={level + 1}
                selected={id === sceneId}
                quiet={!writing}
                renaming={renaming?.kind === 'scene' && renaming.id === id}
                tabbable={tabbableId === id}
                menuOpen={menu?.kind === 'scene' && menu.id === id}
                h={h}
              />
            ) : null
          })}
        </SortableContext>
        {!isCollapsed && ids.length === 0 ? <EmptyChapterRow chapterId={chapterId} level={level} h={h} /> : null}
      </ChapterBlock>
    )
  }

  const menuChapterAct = menu?.kind === 'chapter' ? (actOfChapter.get(menu.id) ?? null) : null
  const otherActs = menu?.kind === 'chapter' ? (outline.acts ?? []).filter((a) => a.id !== menuChapterAct) : []

  return (
    <div ref={treeRef} role="tree" aria-label="Chapters and scenes" onKeyDown={onKeyDown} className="px-1.5 pb-3 pt-1">
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={measuring}
        modifiers={[keepInTree]}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => finishDrag(null)}
      >
        {runs.map((run) => {
          const chapters = (
            <SortableContext key={run.act?.id ?? 'no-act'} items={run.chapters.map(chapterDndId)} strategy={verticalListSortingStrategy}>
              {run.chapters.map((chapterId) => chapterBlock(chapterId, run.act ? 2 : 1))}
            </SortableContext>
          )
          if (!run.act) return chapters
          const act = run.act
          const words = run.chapters.reduce((n, c) => n + (order.scenes[c] ?? []).reduce((m, s) => m + (sceneById.get(s)?.wordCount ?? 0), 0), 0)
          return (
            <ActBlock
              key={act.id}
              act={act}
              words={words}
              chapterCount={run.chapters.length}
              collapsed={collapsed.has(act.id) && !(drag?.kind === 'chapter' && actOfChapter.get(drag.id) === act.id)}
              renaming={renaming?.kind === 'act' && renaming.id === act.id}
              editingPurpose={purposeFor === act.id}
              tabbable={tabbableId === act.id}
              menuOpen={menu?.kind === 'act' && menu.id === act.id}
              h={h}
            >
              {chapters}
            </ActBlock>
          )
        })}
        <DragOverlay dropAnimation={dropAnimation} modifiers={[keepInTree]}>
          {activeScene ? (
            <SceneDragPreview scene={activeScene} level={actOfChapter.get(findChapterOf(order.scenes, activeScene.id) ?? '') ? 3 : 2} />
          ) : null}
          {activeChapter ? (
            <ChapterDragPreview
              chapter={activeChapter.chapter}
              words={activeChapter.words}
              sceneCount={(order.scenes[activeChapter.chapter.id] ?? []).length}
              level={actOfChapter.get(activeChapter.chapter.id) ? 2 : 1}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <button
        ref={addChapterRef}
        type="button"
        onClick={() => addChapter()}
        className="mt-1 flex h-8 w-full items-center gap-2 rounded-md pl-[9px] text-left text-[12.5px] text-faint hover:bg-surface-2 hover:text-muted"
      >
        <Plus size={14} />
        Add chapter
      </button>
      {storyWords === 0 ? (
        // Nothing written yet: the outline helper can plan the story from its premise.
        <button
          type="button"
          onClick={() => openOutlineHelper(outline.story.id)}
          className="flex h-8 w-full items-center gap-2 rounded-md pl-[9px] text-left text-[12.5px] text-faint animate-fade-in hover:bg-surface-2 hover:text-muted"
        >
          <ListTree size={14} />
          Plan it with the outline helper
        </button>
      ) : null}

      <RowMenu
        at={menu}
        label={menu ? MENU_LABELS[menu.kind] : 'Actions'}
        onClose={() => setMenu(null)}
        onCloseFocus={() => {
          if (menu && !renamingRef.current && !purposeRef.current) focusRow(menu.id)
        }}
      >
        {menu?.kind === 'scene' ? (
          <>
            <RowMenuItem icon={<PenLine size={14} />} hint="F2" onSelect={() => setRenaming({ kind: 'scene', id: menu.id })}>
              Rename
            </RowMenuItem>
            <RowMenuItem
              icon={<FilePlus2 size={14} />}
              onSelect={() => {
                const ch = findChapterOf(base.scenes, menu.id)
                if (ch) void actions.addScene(ch, menu.id).then((id) => id && setRenaming({ kind: 'scene', id }))
              }}
            >
              Add scene after
            </RowMenuItem>
            <RowMenuSeparator />
            <RowMenuItem icon={<Trash2 size={14} />} hint="Del" danger onSelect={() => remove({ kind: 'scene', id: menu.id })}>
              Delete scene
            </RowMenuItem>
          </>
        ) : menu?.kind === 'chapter' ? (
          <>
            <RowMenuItem icon={<PenLine size={14} />} hint="F2" onSelect={() => setRenaming({ kind: 'chapter', id: menu.id })}>
              Rename
            </RowMenuItem>
            <RowMenuItem icon={<FilePlus2 size={14} />} onSelect={() => h.addScene(menu.id)}>
              Add scene
            </RowMenuItem>
            <RowMenuItem icon={<FolderPlus size={14} />} onSelect={() => addChapter(menu.id)}>
              Add chapter after
            </RowMenuItem>
            {canStartActAt(outline, menu.id) ? (
              <RowMenuItem icon={<BetweenHorizontalStart size={14} />} onSelect={() => startAct(menu.id)}>
                Start a new act here
              </RowMenuItem>
            ) : null}
            {otherActs.length > 0 ? (
              <RowMenuSub icon={<FolderInput size={14} />} label="Move to act">
                {otherActs.map((a) => (
                  <RowMenuItem key={a.id} onSelect={() => moveToAct(menu.id, a.id)}>
                    {a.title.trim() || 'Untitled act'}
                  </RowMenuItem>
                ))}
              </RowMenuSub>
            ) : null}
            <RowMenuSeparator />
            <RowMenuItem icon={<Trash2 size={14} />} hint="Del" danger onSelect={() => remove({ kind: 'chapter', id: menu.id })}>
              Delete chapter
            </RowMenuItem>
          </>
        ) : menu?.kind === 'act' ? (
          <>
            <RowMenuItem icon={<PenLine size={14} />} hint="F2" onSelect={() => setRenaming({ kind: 'act', id: menu.id })}>
              Rename
            </RowMenuItem>
            <RowMenuItem
              icon={<TargetIcon size={14} />}
              onSelect={() => {
                toggle(menu.id, false)
                setPurposeFor(menu.id)
              }}
            >
              Edit purpose
            </RowMenuItem>
            <RowMenuItem icon={<FilePlus2 size={14} />} onSelect={() => h.addChapter(menu.id)}>
              Add chapter
            </RowMenuItem>
            <RowMenuItem icon={<FolderPlus size={14} />} onSelect={() => addAct(menu.id)}>
              Add act after
            </RowMenuItem>
            <RowMenuSeparator />
            <RowMenuItem icon={<Trash2 size={14} />} hint="Del" danger onSelect={() => remove({ kind: 'act', id: menu.id })}>
              Delete act
            </RowMenuItem>
          </>
        ) : null}
      </RowMenu>
    </div>
  )
}
