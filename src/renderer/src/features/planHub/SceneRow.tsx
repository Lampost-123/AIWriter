// A planned scene in Build with AI's story line (2026-10-20), with what the AI can do for it, inline in its row:
//   Ideas: three directions for the scene (next scene ideas, features/outline/ideasStore), what Adam has in mind first if
//     he likes; Use this fills its card (Undo in the toast);
//   Interview me: a few short questions, then its card's empty parts filled from the answers (planInterviewStore);
//   Fill the card: the scene's card planned from the story so far, only its empty parts (scenePlanStore, Undo);
//   Write it: the scene on the writing page, a draft started the usual way (Generate). Beat by beat stays there.
// A written scene is a plain link to its page.

import { useEffect, useId, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Lightbulb, MessageCircleQuestion, PenLine, Plus, Sparkles, Square, SquarePen, X } from '@/components/ui/icons'
import { Button, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { pressShortcut } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { FreshText } from '@/features/planning/FreshText'
import { PlanInterview, usePlanSession } from '@/features/outline/PlanInterview'
import { closePlanInterview, startPlanInterview } from '@/features/outline/planInterviewStore'
import { applyIdea, askIdeas, ideasKey, setWish, stopIdeas, useSceneIdeas } from '@/features/outline/ideasStore'
import { parseIdeas, type SceneIdea } from '@/features/outline/parse'
import { planScene, scenePlanKey, stopScenePlan, useScenePlans } from '@/features/outline/scenePlanStore'
import { sceneName, type LineScene } from './hubLogic'
import { HubStatus } from './HubStatus'
import { openTool } from './hubStore'
import type { SceneTool } from './buildLogic'

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

export function SceneRow({
  storyId,
  scene,
  chapterNo,
  tool,
  lit,
  note
}: {
  storyId: ID
  scene: LineScene
  /** Its chapter's number, for its name ("Ch 3 · Sc 2"). */
  chapterNo: number
  /** The tool open in its row, if any. */
  tool: SceneTool | null
  lit: boolean
  /** Under it: what the story has moved on from (the drift note). */
  note?: React.ReactNode
}): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id)
  const filling = useScenePlans((s) => s.plans[scenePlanKey(worldId, scene.id)])
  const interview = usePlanSession({ kind: 'scene', sceneId: scene.id })
  const written = scene.words > 0
  // The interview over (its answers on the card, or stopped): its row closes too.
  const had = useRef(!!interview)
  useEffect(() => {
    if (had.current && !interview && tool === 'interview') openTool(storyId, scene.id, null)
    had.current = !!interview
  }, [interview, tool, storyId, scene.id])
  const toggle = (t: SceneTool): void => {
    if (tool === t) {
      if (t === 'interview' && interview) closePlanInterview({ kind: 'scene', sceneId: scene.id })
      return openTool(storyId, scene.id, null)
    }
    if (t === 'interview' && !interview) startPlanInterview({ kind: 'scene', sceneId: scene.id })
    openTool(storyId, scene.id, t)
  }
  const fill = (): void => {
    void planScene(scene.id).then((r) => {
      if (r.status === 'error' && r.error) toast(r.error, { tone: 'danger' })
    })
  }
  const named = `Ch ${chapterNo} · ${sceneName(scene)}`
  return (
    <div className={cn('hub-scene build-scene', lit && 'is-lit', tool && 'is-open')} data-scene-row={scene.id} role="group" aria-label={named}>
      <div className="build-scene-row">
        <button type="button" className="hub-scene-link build-scene-name" onClick={() => useApp.getState().selectScene(scene.id, storyId)} title={written ? 'Open this scene' : 'Open this scene to write it'}>
          {sceneName(scene)}
        </button>
        {written ? (
          <span className="hub-row-state">written</span>
        ) : (
          <span className="build-scene-tools">
            <button type="button" className={cn('hub-row-btn is-quiet', tool === 'ideas' && 'is-on')} aria-expanded={tool === 'ideas'} onClick={() => toggle('ideas')} data-scene-tool="ideas" title="Three directions for this scene, from the plan, the open threads and the story so far">
              <Lightbulb size={12} aria-hidden />
              Ideas
            </button>
            <button
              type="button"
              className={cn('hub-row-btn is-quiet', tool === 'interview' && 'is-on')}
              aria-expanded={tool === 'interview'}
              onClick={() => toggle('interview')}
              data-scene-tool="interview"
              title="A few short questions about what this scene’s card doesn’t say yet, then its empty parts filled from your answers"
            >
              <MessageCircleQuestion size={12} aria-hidden />
              Interview me
            </button>
            {filling?.status === 'running' ? (
              <span className="build-scene-busy">
                <HubStatus text="Filling the card…" size={18} />
                <button type="button" className="hub-row-btn is-quiet" onClick={() => stopScenePlan(scene.id)} aria-label="Stop filling the card">
                  <Square size={9} fill="currentColor" aria-hidden />
                  Stop
                </button>
              </span>
            ) : (
              <button type="button" className="hub-row-btn is-quiet" onClick={fill} data-scene-tool="fill" title="Plan this scene’s card from the story so far. Only its empty parts are filled; Undo takes them off.">
                <SquarePen size={12} aria-hidden />
                Fill the card
              </button>
            )}
            <button type="button" className="hub-row-btn" onClick={() => writeScene(storyId, scene.id)} data-scene-tool="write" title="Open this scene and write a draft of it from its card">
              <PenLine size={12} aria-hidden />
              Write it
            </button>
          </span>
        )}
      </div>
      {note}
      {tool === 'ideas' && !written ? <IdeasInline sceneId={scene.id} onClose={() => openTool(storyId, scene.id, null)} /> : null}
      {tool === 'interview' && !written && interview ? (
        <div className="build-scene-in">
          <PlanInterview target={{ kind: 'scene', sceneId: scene.id }} />
        </div>
      ) : null}
    </div>
  )
}

/** Next scene ideas for one planned scene, inline: what Adam has in mind, then three ideas with Use this. */
function IdeasInline({ sceneId, onClose }: { sceneId: ID; onClose: () => void }): React.JSX.Element {
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
