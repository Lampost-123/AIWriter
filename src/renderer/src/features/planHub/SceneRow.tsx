// A scene's row on its chapter's page in Build with AI (Option A, "Zoom in", 2026-10-20; the story line's planned
// scene rows before): its name (a click opens the scene's own page here), how it stands, ONE obvious action, and the rest
// in a ⋯ menu. The action is Open once it is written (the writing page), Fill the card while its card says nothing, else
// Write it. In the menu, and on the scene's own page (ScenePage in ZoomPages.tsx), which share useSceneTools:
//   Ideas: three directions for the scene (next scene ideas, features/outline/ideasStore), what Adam has in mind first if
//     he likes; Use this fills its card (Undo in the toast);
//   Interview me: a few short questions, then its card's empty parts filled from the answers (planInterviewStore);
//   Fill the card: the scene's card planned from the story so far, only its empty parts (scenePlanStore, Undo);
//   Write it: the scene on the writing page, a draft started the usual way (Generate). Beat by beat stays there;
//   Open: the scene on the writing page.
// Ideas and the interview open under the row (one scene tool at a time: hubStore `tool`).

import { useEffect, useId, useRef, useState } from 'react'
import * as M from '@radix-ui/react-dropdown-menu'
import type { ID } from '@shared/types'
import { BookOpen, Lightbulb, MessageCircleQuestion, MoreHorizontal, PenLine, Plus, Sparkles, Square, SquarePen, X } from '@/components/ui/icons'
import { Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { pressShortcut } from '@/lib/shortcuts'
import { useApp, type View } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { FreshText } from '@/features/planning/FreshText'
import { PlanInterview, usePlanSession } from '@/features/outline/PlanInterview'
import { closePlanInterview, startPlanInterview } from '@/features/outline/planInterviewStore'
import { applyIdea, askIdeas, ideasKey, setWish, stopIdeas, useSceneIdeas } from '@/features/outline/ideasStore'
import { parseIdeas, type SceneIdea } from '@/features/outline/parse'
import { planScene, scenePlanKey, stopScenePlan, useScenePlans } from '@/features/outline/scenePlanStore'
import { RowMenuItem } from '@/features/binder/RowMenu'
import { sceneName, type LineScene } from './hubLogic'
import { HubStatus } from './HubStatus'
import { openTool } from './hubStore'
import type { SceneTool } from './buildLogic'
import { sceneStep, sceneView } from './zoomLogic'

/**
 * Write it: the scene on the writing page, then Generate, once its page is there (as pressing Generate would). Waits at
 * most a few seconds for the page; Adam is on it either way.
 */
export function writeScene(storyId: ID, sceneId: ID): void {
  useApp.getState().selectScene(sceneId, storyId)
  const until = Date.now() + 4000
  const go = (): void => {
    const app = useApp.getState()
    if (app.view.kind !== 'write' || app.sceneId !== sceneId) return
    if (editorBridge()?.sceneId === sceneId) {
      // A frame more, so the Generate controls are drawn for this scene.
      requestAnimationFrame(() => pressShortcut('generate'))
      return
    }
    if (Date.now() < until) requestAnimationFrame(go)
  }
  requestAnimationFrame(go)
}

/**
 * What the AI can do for a scene, for its row and its page: the tool open (Ideas or Interview me), opening and closing
 * them (the interview started or stopped with its tool), Fill the card (what went wrong in a toast) and whether its card
 * is being filled now.
 */
export function useSceneTools(
  storyId: ID,
  sceneId: ID,
  tool: SceneTool | null
): { filling: boolean; interview: boolean; toggle: (t: SceneTool) => void; fill: () => void; stopFill: () => void } {
  const worldId = useApp((s) => s.world?.id)
  const filling = useScenePlans((s) => s.plans[scenePlanKey(worldId, sceneId)]?.status === 'running')
  const interview = !!usePlanSession({ kind: 'scene', sceneId })
  // The interview over (its answers on the card, or stopped): its tool closes too.
  const had = useRef(interview)
  useEffect(() => {
    if (had.current && !interview && tool === 'interview') openTool(storyId, sceneId, null)
    had.current = interview
  }, [interview, tool, storyId, sceneId])
  const toggle = (t: SceneTool): void => {
    if (tool === t) {
      if (t === 'interview' && interview) closePlanInterview({ kind: 'scene', sceneId })
      return openTool(storyId, sceneId, null)
    }
    if (t === 'interview' && !interview) startPlanInterview({ kind: 'scene', sceneId })
    openTool(storyId, sceneId, t)
  }
  const fill = (): void => {
    void planScene(sceneId).then((r) => {
      if (r.status === 'error' && r.error) toast(r.error, { tone: 'danger' })
    })
  }
  return { filling, interview, toggle, fill, stopFill: () => stopScenePlan(sceneId) }
}

/** Ideas or the interview, open under a scene's row or on its page. */
export function SceneToolOpen({ storyId, sceneId, tool, interview }: { storyId: ID; sceneId: ID; tool: SceneTool | null; interview: boolean }): React.JSX.Element | null {
  if (tool === 'ideas') return <IdeasInline sceneId={sceneId} onClose={() => openTool(storyId, sceneId, null)} />
  if (tool === 'interview' && interview)
    return (
      <div className="build-scene-in">
        <PlanInterview target={{ kind: 'scene', sceneId }} />
      </div>
    )
  return null
}

/** "Filling the card…" with Stop, while the AI fills a scene's card. */
export function FillingNow({ onStop }: { onStop: () => void }): React.JSX.Element {
  return (
    <span className="build-scene-busy">
      <HubStatus text="Filling the card…" size={18} />
      <button type="button" className="hub-row-btn is-quiet" onClick={onStop} aria-label="Stop filling the card">
        <Square size={9} fill="currentColor" aria-hidden />
        Stop
      </button>
    </span>
  )
}

export function SceneRow({
  storyId,
  scene,
  chapterNo,
  tool,
  lit,
  emptyCard,
  back,
  note
}: {
  storyId: ID
  scene: LineScene
  /** Its chapter's number, for its name ("Ch 3 · Sc 2"). */
  chapterNo: number
  /** The tool open in its row, if any. */
  tool: SceneTool | null
  lit: boolean
  /** Its card says nothing yet (Fill the card is its action). */
  emptyCard: boolean
  /** The page Build with AI was opened from, kept when the scene's own page opens. */
  back?: { view: View; label: string }
  /** Under it: what the story has moved on from (the drift note). */
  note?: React.ReactNode
}): React.JSX.Element {
  const t = useSceneTools(storyId, scene.id, tool)
  const written = scene.words > 0
  const step = sceneStep(scene, emptyCard)
  const named = `Ch ${chapterNo} · ${sceneName(scene)}`
  const open = (): void => useApp.getState().selectScene(scene.id, storyId)
  const action =
    step === 'open' ? (
      <button type="button" className="hub-row-btn" onClick={open} data-scene-step="open" title="Open this scene on the writing page">
        <BookOpen size={12} aria-hidden />
        Open
      </button>
    ) : t.filling ? (
      <FillingNow onStop={t.stopFill} />
    ) : step === 'fill' ? (
      <button type="button" className="hub-row-btn" onClick={t.fill} data-scene-step="fill" title="Plan this scene’s card from the story so far. Undo takes it off.">
        <SquarePen size={12} aria-hidden />
        Fill the card
      </button>
    ) : (
      <button type="button" className="hub-row-btn" onClick={() => writeScene(storyId, scene.id)} data-scene-step="write" title="Open this scene and write a draft of it from its card">
        <PenLine size={12} aria-hidden />
        Write it
      </button>
    )
  const more = [
    { id: 'ideas', icon: <Lightbulb size={14} />, label: 'Ideas', on: () => t.toggle('ideas') },
    { id: 'interview', icon: <MessageCircleQuestion size={14} />, label: 'Interview me', on: () => t.toggle('interview') },
    { id: 'fill', icon: <SquarePen size={14} />, label: 'Fill the card', on: t.fill },
    { id: 'write', icon: <PenLine size={14} />, label: 'Write it', on: () => writeScene(storyId, scene.id) },
    { id: 'open', icon: <BookOpen size={14} />, label: 'Open', on: open }
  ].filter((i) => i.id !== step && !(i.id === 'fill' && t.filling))
  return (
    <div className={cn('hub-scene build-scene', lit && 'is-lit', tool && 'is-open')} data-scene-row={scene.id} role="group" aria-label={named}>
      <div className="build-scene-row">
        <button
          type="button"
          className="hub-scene-link build-scene-name"
          onClick={() => useApp.getState().navigate(sceneView(storyId, scene.id, { back }))}
          title="This scene’s own page: its card, ideas, interview and draft"
          data-scene-zoom={scene.id}
        >
          {sceneName(scene)}
        </button>
        <span className="hub-row-state">{written ? `written · ${scene.words.toLocaleString('en-GB')} words` : emptyCard ? 'nothing on its card yet' : 'planned'}</span>
        <span className="build-scene-tools">
          {action}
          <SceneMore label={`More for ${sceneName(scene)}`} items={more} />
        </span>
      </div>
      {note}
      <SceneToolOpen storyId={storyId} sceneId={scene.id} tool={tool} interview={t.interview} />
    </div>
  )
}

/** The ⋯ menu beside a scene's one action: the rest of what can be done for it. */
function SceneMore({ label, items }: { label: string; items: { id: string; icon: React.ReactNode; label: string; on: () => void }[] }): React.JSX.Element {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>
        <button type="button" className="hub-row-btn is-quiet build-more" aria-label={label} title="More" data-scene-more>
          <MoreHorizontal size={14} aria-hidden />
        </button>
      </M.Trigger>
      <M.Portal>
        <M.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[180px] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
        >
          {items.map((i) => (
            <RowMenuItem key={i.id} icon={i.icon} onSelect={i.on}>
              <span data-scene-tool={i.id}>{i.label}</span>
            </RowMenuItem>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

/** Next scene ideas for one planned scene, inline: what Adam has in mind, then three ideas with Use this. */
export function IdeasInline({ sceneId, onClose }: { sceneId: ID; onClose: () => void }): React.JSX.Element {
  const id = useId()
  const worldId = useApp((s) => s.world?.id)
  const key = ideasKey(worldId, sceneId)
  const session = useSceneIdeas((s) => s.sessions[key])
  const wish = useSceneIdeas((s) => s.wishes[key] ?? '')
  const running = session?.status === 'running'
  const ideas = session && !session.hidden ? parseIdeas(session.text, !running) : []
  const [gone, setGone] = useState<Set<number>>(new Set())
  useEffect(() => setGone(new Set()), [session?.taskId])
  const shown = ideas.map((idea, i) => ({ idea, i })).filter((x) => !gone.has(x.i))
  const used = !!session?.hidden

  const use = async (idea: SceneIdea): Promise<void> => {
    try {
      const { card } = await api.getScene(sceneId)
      applyIdea(sceneId, idea, card)
      useApp.getState().bumpOutline()
    } catch (e) {
      toast((e as Error).message, { tone: 'danger' })
    }
  }

  return (
    <section aria-labelledby={`${id}-t`} className="build-scene-in build-ideas" data-scene-ideas={sceneId}>
      <div className="build-ideas-head">
        <h4 id={`${id}-t`} className="build-ideas-t">
          <Lightbulb size={13} className="text-ai" aria-hidden /> Ideas for this scene
        </h4>
        <button type="button" className="build-panel-x" onClick={onClose} aria-label="Close the ideas">
          <X size={13} />
        </button>
      </div>
      <label htmlFor={`${id}-wish`} className="hub-label">
        What you have in mind, roughly (optional)
      </label>
      <AutoTextarea
        id={`${id}-wish`}
        value={wish}
        minRows={1}
        maxRows={5}
        placeholder="For example: she finds out who sent the letter."
        className="hub-box"
        onChange={(e) => setWish(sceneId, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !running) {
            e.preventDefault()
            void askIdeas(sceneId)
          }
        }}
      />
      {shown.length ? (
        <ol className="build-ideas-list">
          {shown.map(({ idea, i }) => (
            <li key={`${session?.taskId}-${i}`} className={cn('build-idea', !idea.complete && 'is-arriving')} data-idea>
              <div className="min-w-0 flex-1">
                <p className="build-idea-t">
                  <FreshText text={idea.title.trim() || `Idea ${i + 1}`} live={running} />
                </p>
                {idea.summary ? (
                  <p className="build-idea-s">
                    <FreshText text={idea.summary} live={running} />
                  </p>
                ) : null}
                {idea.beats.length ? <p className="build-idea-b">{idea.beats.length === 1 ? '1 beat' : `${idea.beats.length} beats`}: {idea.beats[0]}{idea.beats.length > 1 ? '…' : ''}</p> : null}
              </div>
              <div className="build-idea-actions">
                <Button size="sm" variant="ai" icon={<Plus size={12} />} disabled={!idea.complete} onClick={() => void use(idea)} aria-label={`Use “${idea.title.trim() || `Idea ${i + 1}`}”`}>
                  Use this
                </Button>
                <button type="button" className="hub-txt" onClick={() => setGone((g) => new Set([...g, i]))} aria-label={`Dismiss “${idea.title.trim() || `Idea ${i + 1}`}”`}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {used ? <p className="hub-go-s">One went on the scene’s card. Undo in its message takes it off and brings the ideas back.</p> : null}
      {session?.problem && !ideas.length && !running ? (
        <p className="cw-error" role="alert">
          {session.problem.message}
        </p>
      ) : null}
      {session?.note ? <p className="hub-go-s">{session.note}</p> : null}
      <div className="hub-go">
        {running ? (
          <>
            <HubStatus text={session?.retrying ?? (ideas.length ? `Writing idea ${Math.min(ideas.length, 3)} of 3…` : 'Reading the scenes before it, the plan and the open threads…')} size={20} />
            <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => stopIdeas(sceneId)}>
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" variant={ideas.length ? 'secondary' : 'ai'} icon={<Sparkles size={13} />} onClick={() => void askIdeas(sceneId)} data-ask-ideas>
            {ideas.length || used ? 'Three more ideas' : 'Suggest three ideas'}
          </Button>
        )}
      </div>
    </section>
  )
}
