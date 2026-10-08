// The head of the desk's page: where the scene sits in small capitals ("Chapter One · The Night Ferry"), the scene's
// title in Literata's display cut (click it to rename the scene, as in the panels), and a quiet line saying which scene
// of the chapter it is, whose eyes it is told through and when it happens ("Scene 1 of 2 · Told through Wren · Day 1,
// dusk"), from the scene's card, which opens the card when clicked, and Scene details at its end (the drawer, with the
// scene's open issues counted beside it). Every line keeps its height while the card loads, so the words below never
// move.
import { useEffect, useState } from 'react'
import type { ID } from '@shared/types'
import { chapterLabel } from '@shared/numberWords'
import { PanelRight } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { InlineTitle } from '@/features/binder/InlineTitle'
import { useOutline } from '@/features/binder/outlineStore'
import { openCount } from '@/features/issues/issuesLogic'
import { useSceneIssues } from '@/features/issues/issuesStore'
import { openSceneTab } from '@/layout/areaLinks'

/** The scene card's point of view (by name) and when it happens, reloaded as the card changes. */
function useCardLine(sceneId: ID): { pov: string; when: string } {
  const rev = useApp((s) => s.briefingRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const [line, setLine] = useState<{ id: ID; pov: string; when: string } | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const scene = await api.getScene(sceneId)
        const povId = scene.card?.povId ?? null
        const pov = povId ? ((await api.getEntry(povId).catch(() => null))?.name ?? '') : ''
        if (live) setLine({ id: sceneId, pov, when: (scene.card?.when ?? '').trim() })
      } catch {
        if (live) setLine({ id: sceneId, pov: '', when: '' })
      }
    })()
    return () => {
      live = false
    }
  }, [sceneId, rev, entriesRev])
  return line && line.id === sceneId ? line : { pov: '', when: '' }
}

/**
 * Scene details: the scene's card, context, cast, issues and drafts, in the drawer over the page's edge (open on the
 * card; pressed again, it closes). Its open issues, when it has any, are counted beside it, and open the Issues tab.
 */
function SceneDetails({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const { issues } = useSceneIssues(sceneId)
  const { count, mustFix } = openCount(issues)
  const open = useApp((s) => !!s.settings?.layout.inspectorOpen && !s.askOpen && s.view.kind === 'write')
  const tab = useApp((s) => s.inspectorTab)
  const close = (): void => void useApp.getState().updateSettings({ layout: { inspectorOpen: false } })
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        data-scene-details
        aria-expanded={open}
        title="The scene’s card, context, cast, issues and drafts (also from Ctrl+K: “Scene card”)"
        onClick={() => (open && tab === 'card' ? close() : openSceneTab('card'))}
        className={cn('desk-details inline-flex h-6 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[12.5px] font-medium', open && 'is-open')}
      >
        <PanelRight size={13} />
        Scene details
      </button>
      {count ? (
        <button
          type="button"
          title="This scene’s open issues"
          onClick={() => (open && tab === 'issues' ? close() : openSceneTab('issues'))}
          className={cn('desk-details-count inline-flex h-6 items-center rounded-full px-2 text-[12px] font-medium tabular-nums', mustFix && 'is-must')}
        >
          {count > 99 ? '99+' : count} {count === 1 ? 'issue' : 'issues'}
        </button>
      ) : null}
    </span>
  )
}

export function DeskPageHead({ sceneId, fallbackTitle }: { sceneId: ID; fallbackTitle: string }): React.JSX.Element {
  const { outline } = useOutline()
  const [editing, setEditing] = useState(false)
  const card = useCardLine(sceneId)
  const meta = outline?.scenes.find((s) => s.id === sceneId)
  const title = meta?.title ?? fallbackTitle
  const chapterIndex = meta && outline ? outline.chapters.findIndex((c) => c.id === meta.chapterId) : -1
  const chapter = chapterIndex >= 0 ? outline!.chapters[chapterIndex] : null
  const inChapter = meta && outline ? outline.scenes.filter((s) => s.chapterId === meta.chapterId).sort((a, b) => a.position - b.position) : []
  const sceneIndex = inChapter.findIndex((s) => s.id === sceneId)
  const eyebrow = chapter ? chapterLabel(chapterIndex + 1, chapter.title) : ''
  const parts = [
    sceneIndex >= 0 ? `Scene ${sceneIndex + 1} of ${inChapter.length}` : '',
    card.pov ? `Told through ${card.pov}` : '',
    card.when
  ].filter(Boolean)

  return (
    <div data-page-title className="desk-page-head select-none font-sans">
      <p className="flex h-4 items-center gap-2.5">
        {eyebrow ? (
          <>
            <span className="desk-caps truncate">{eyebrow}</span>
            <i aria-hidden className="h-px w-7 shrink-0 bg-line-strong" />
          </>
        ) : null}
      </p>
      {editing ? (
        <div className="mt-3 flex h-[52px] items-center">
          <InlineTitle
            label="Scene title"
            value={title}
            className="h-[52px] font-heading text-[44px] font-semibold tracking-[-0.012em]"
            onCommit={(t) => actions.renameScene(sceneId, t)}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <h1 className="mt-3">
          <button
            type="button"
            title="Rename this scene"
            onClick={() => setEditing(true)}
            className="desk-scene-title -mx-1.5 max-w-full rounded-lg px-1.5 text-left outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {title || 'Untitled scene'}
          </button>
        </h1>
      )}
      {/* The quiet line opens the scene's card; Scene details at its end opens the drawer (with the issues counted). */}
      <div className="desk-page-meta mt-2 flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5 text-muted">
        {parts.length ? (
          <button
            type="button"
            title="Open this scene’s card"
            onClick={() => openSceneTab('card')}
            className="desk-meta-line -mx-1.5 flex flex-wrap items-center gap-x-2 rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {parts.map((p, i) => (
              <span key={p} className="flex items-center gap-2">
                {i > 0 ? <i aria-hidden className="h-[3px] w-[3px] rounded-full bg-faint" /> : null}
                <span>{p}</span>
              </span>
            ))}
          </button>
        ) : null}
        <SceneDetails sceneId={sceneId} />
      </div>
    </div>
  )
}
