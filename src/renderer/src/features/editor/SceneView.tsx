import { EditorContent, useEditor } from '@tiptap/react'
import { ArrowDown, FilePlus2, Feather, RotateCcw } from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ID, SceneStatus } from '@shared/types'
import { Button, EmptyState, Spinner, toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge, setEditorBridge } from '@/lib/editorBridge'
import { registerDiscarder, registerFlusher } from '@/lib/flush'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { useOutline, useOutlineStore } from '@/features/binder/outlineStore'
import { widePageFrom } from '@/layout/fitPanels'
import { SceneController } from './controller'
import { sceneExtensions } from './extensions'
import { onFocusRequest, requestEditorFocus, takeFocusRequest } from './focusRequest'
import { NamesLayer } from './names/NamesLayer'
import { SelectionLayer } from './selection/SelectionLayer'
import { onPutBackRequest, takePutBack } from './putBack'
import { onRevealRequest, takeReveal } from './reveal'
import { SceneHeader } from './SceneHeader'
import { SuggestionLayer } from '@/features/edits/SuggestionLayer'
import { BeatBar } from '@/features/beats/BeatBar'
import { ReadAloudBar } from '@/features/readAloud/ReadAloudBar'
import { SpeakerLabelsLayer } from '@/features/readAloud/SpeakerLabelsLayer'
import { LiveChecksLayer } from '@/features/liveChecks/LiveChecksLayer'
import { FirstSceneGuide } from '@/features/setup/FirstSceneGuide'
import { TypewriterLayer } from '@/features/typing/TypewriterLayer'
import { FindBar } from '@/features/find/FindBar'
import './editor.css'

/** The centre of the window when writing: the open scene, or a way to start one. */
export function SceneView(): React.JSX.Element {
  const sceneId = useApp((s) => s.sceneId)
  return sceneId ? <SceneEditor sceneId={sceneId} /> : <NoScene />
}

/** True once `on` has stayed true for `ms`, so quick loads never flash a spinner. */
function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!on) {
      setShown(false)
      return
    }
    const t = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on && shown
}

interface Shown {
  id: ID
  title: string
  status: SceneStatus
}

function SceneEditor({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const worldId = useApp((s) => s.world?.id ?? null)
  const prefs = useApp((s) => s.settings?.editor)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const ctrlRef = useRef<SceneController | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftBelow, setDraftBelow] = useState(false)
  // The writing view stays in place (hidden) while another page shows, so a draft keeps writing.
  const writing = useApp((s) => s.view.kind === 'write')

  // One editor for the life of the view; scenes are swapped into it. Typing never re-renders React.
  // Options are created once so re-renders never reconfigure the editor.
  const [options] = useState(() => ({
    extensions: sceneExtensions(),
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'scene-prose', spellcheck: 'true', 'aria-label': 'Scene text', 'aria-multiline': 'true' }
    }
  }))
  const editor = useEditor(options, [])

  useEffect(() => {
    const ctrl = new SceneController(editor, () => scrollerRef.current, {
      onShow: (scene) =>
        flushSync(() => {
          setShown({ id: scene.id, title: scene.title, status: scene.status })
          setError(null)
        }),
      onError: (message) => setError(message),
      onDraftBelow: (below) => setDraftBelow(below)
    })
    ctrlRef.current = ctrl
    setEditorBridge(ctrl.bridge)
    const offFlush = registerFlusher(() => ctrl.flush())
    const offDiscard = registerDiscarder(() => ctrl.discard())
    const offFocus = onFocusRequest(() => {
      // While another page covers the writing view, the request waits for it to come back.
      if (useApp.getState().view.kind !== 'write') return
      if (takeFocusRequest(ctrl.sceneId)) ctrl.focus()
    })
    return () => {
      offFocus()
      offDiscard()
      if (editorBridge() === ctrl.bridge) setEditorBridge(null)
      ctrl.destroy()
      ctrlRef.current = null
      // A save still on its way (or retrying) stays in the window-close flush until it lands.
      ctrl.whenIdle(offFlush)
    }
  }, [editor])

  useEffect(() => {
    void ctrlRef.current?.open(sceneId)
  }, [sceneId, worldId, editor])

  // Leaving the page (for a world page, Settings, What the AI saw...) keeps Adam's place. This runs
  // as the view goes, while the page is still on screen; the cleanup above runs once it has gone.
  useLayoutEffect(() => () => ctrlRef.current?.remember(), [])

  // Another page covers the writing view: let go of the keyboard (the page can't be typed in
  // while hidden). Coming back puts the caret back in the page, where it was.
  const wasWriting = useRef(writing)
  useLayoutEffect(() => {
    const was = wasWriting.current
    wasWriting.current = writing
    if (!writing) {
      ctrlRef.current?.remember()
      if (editor.view.hasFocus()) (document.activeElement as HTMLElement | null)?.blur()
      return
    }
    if (!was) {
      const ctrl = ctrlRef.current
      ctrl?.updateDraftBelow()
      const idle = !document.activeElement || document.activeElement === document.body
      if (ctrl && (takeFocusRequest(ctrl.sceneId) || idle)) ctrl.focus()
    }
  }, [writing, editor])

  // "What changed" asked to show the words a fact came from: once the scene is on screen, select them.
  useEffect(() => {
    const tryReveal = (): void => {
      const ctrl = ctrlRef.current
      if (!ctrl || !shown || shown.id !== ctrl.sceneId || useApp.getState().view.kind !== 'write') return
      const asked = takeReveal(ctrl.sceneId)
      if (!asked) return
      // After this frame's focus and scroll restore, so they don't undo it.
      requestAnimationFrame(() => {
        if (!ctrl.revealWords(asked.quote, { wholeWord: asked.wholeWord })) toast("Those words aren't in the scene any more.")
      })
    }
    tryReveal()
    return onRevealRequest(tryReveal)
  }, [shown, writing])

  // A draft's record asked to put back the text that draft replaced: once the scene is on screen, do it.
  useEffect(() => {
    const tryPutBack = (): void => {
      const ctrl = ctrlRef.current
      if (!ctrl || !shown || shown.id !== ctrl.sceneId || useApp.getState().view.kind !== 'write') return
      const req = takePutBack(ctrl.sceneId)
      if (!req) return
      // After this frame's focus and scroll restore, so they don't undo it.
      requestAnimationFrame(() => ctrl.putBack(req.sceneId, req.doc, req.text))
    }
    tryPutBack()
    return onPutBackRequest(tryPutBack)
  }, [shown, writing])

  // Ctrl+S saves straight away (it already saves on its own; this is for peace of mind).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useApp.getState().view.kind !== 'write') return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void ctrlRef.current?.flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loadingSlow = useDelayed(!shown && !error, 300)
  const fontSize = prefs?.fontSize ?? 19
  const lineHeight = prefs?.lineHeight ?? 1.7
  const pageWidth = prefs?.pageWidth ?? 70

  // The page's padding is 40 px either side, or 24 on a narrow page (a small window, or large text
  // squeezing the words), leaving the room to the words. Decided before the page is drawn, so the
  // words never show re-wrapped for a moment.
  const wideFrom = widePageFrom(fontSize, pageWidth)
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    setWide(el.offsetWidth >= wideFrom)
    const ro = new ResizeObserver(() => flushSync(() => setWide(el.offsetWidth >= wideFrom)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [wideFrom])

  /**
   * Clicking the empty page below the text puts the cursor at the end. Only presses on the page itself:
   * pop-ups opened from the page (a name's card, the Add to memory form) reach here through React too.
   */
  const onPageMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    const prose = editor.view.dom
    if (e.button !== 0 || !e.currentTarget.contains(e.target as Node) || prose.contains(e.target as Node)) return
    if (e.clientY > prose.getBoundingClientRect().bottom) {
      e.preventDefault()
      editor.commands.focus('end')
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-page">
      {shown && !error ? (
        <SceneHeader sceneId={shown.id} fallbackTitle={shown.title} fallbackStatus={shown.status} />
      ) : (
        <div className="h-12 shrink-0 border-b border-line/70" />
      )}
      <ReadAloudBar editor={editor} sceneId={shown && !error ? shown.id : null} scrollerRef={scrollerRef} />
      {/* Milestone 6: the first scene's guide, above the page (never over the words). */}
      {shown && !error ? <FirstSceneGuide sceneId={shown.id} /> : null}
      <div
        ref={scrollerRef}
        onScroll={() => {
          ctrlRef.current?.follow.onScroll()
          if (draftBelow) ctrlRef.current?.updateDraftBelow()
        }}
        onMouseDown={onPageMouseDown}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div
          ref={columnRef}
          data-paragraphs={prefs?.paragraphStyle ?? 'spaced'}
          data-typewriter={prefs?.typewriter ? 'on' : undefined}
          className={cn('mx-auto pb-[38vh] pt-12 font-serif', wide ? 'px-10' : 'px-6', !(shown && !error) && 'invisible')}
          style={{ fontSize, lineHeight, maxWidth: `calc(${pageWidth}ch + 5rem)` }}
        >
          <EditorContent editor={editor} />
        </div>
        <NamesLayer editor={editor} sceneId={shown && !error ? shown.id : null} />
        <SelectionLayer editor={editor} sceneId={shown && !error ? shown.id : null} scrollerRef={scrollerRef} />
        <SuggestionLayer editor={editor} sceneId={shown && !error ? shown.id : null} scrollerRef={scrollerRef} />
        <SpeakerLabelsLayer editor={editor} sceneId={shown && !error ? shown.id : null} />
        <LiveChecksLayer editor={editor} sceneId={shown && !error ? shown.id : null} />
        <TypewriterLayer editor={editor} scrollerRef={scrollerRef} />
        {error ? (
          <div className="absolute inset-0 flex items-start justify-center pt-[14vh]">
            <EmptyState
              icon={<Feather size={20} />}
              title="This scene couldn’t be opened"
              actions={
                <Button icon={<RotateCcw size={14} />} onClick={() => ctrlRef.current?.retry(sceneId)}>
                  Try again
                </Button>
              }
            >
              {error} Your writing is safe; try again, or pick another scene in the binder.
            </EmptyState>
          </div>
        ) : loadingSlow ? (
          <div className="absolute inset-x-0 top-[18vh] flex justify-center text-faint animate-fade-in">
            <Spinner size={18} />
          </div>
        ) : null}
      </div>
      {draftBelow && !error ? (
        // Over the page, so nothing moves: where the new draft is being written.
        <button
          type="button"
          onClick={() => ctrlRef.current?.revealDraft()}
          className="absolute bottom-5 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-ai/40 bg-ai-soft px-3.5 text-[12.5px] font-medium text-ai shadow-pop transition-colors duration-150 hover:border-ai animate-fade-in"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-ai animate-pulse" aria-hidden />
          Writing the new draft below
          <ArrowDown size={13} aria-hidden />
        </button>
      ) : null}
      {shown && !error ? <BeatBar sceneId={shown.id} /> : null}
      {/* Writing by hand: find and replace in the scene (Ctrl+F), over the top of the page. */}
      <FindBar editor={editor} sceneId={shown && !error ? shown.id : null} scrollerRef={scrollerRef} />
    </div>
  )
}

/** Opens a new scene at the end of the story (making a chapter or story first if needed). */
async function addSceneAtEnd(): Promise<void> {
  const { storyId } = useApp.getState()
  if (!storyId) return
  const cached = useOutlineStore.getState().outline
  const outline = cached && cached.story.id === storyId ? cached : await api.getOutline(storyId)
  const chapterId = outline.chapters[outline.chapters.length - 1]?.id ?? (await actions.addChapter(storyId))
  if (!chapterId) return
  const id = await actions.addScene(chapterId)
  if (id) requestEditorFocus(id)
}

function NoScene(): React.JSX.Element {
  const { outline } = useOutline()
  const storyId = useApp((s) => s.storyId)
  const [busy, setBusy] = useState(false)
  useEffect(() => useApp.getState().setSceneWords(0), [])
  const hasScenes = !!outline && outline.scenes.length > 0
  return (
    <div className="flex h-full items-start justify-center bg-page pt-[16vh]">
      <EmptyState
        icon={<Feather size={20} />}
        title={hasScenes ? 'No scene open' : 'Nothing written yet'}
        actions={
          <Button
            variant="primary"
            icon={<FilePlus2 size={15} />}
            loading={busy}
            onClick={() => {
              // With no story yet, the New story dialog starts one.
              if (!storyId) return useApp.getState().setNewStoryOpen(true)
              setBusy(true)
              void addSceneAtEnd().finally(() => setBusy(false))
            }}
          >
            {storyId ? 'Add a scene' : 'New story…'}
          </Button>
        }
      >
        {hasScenes
          ? 'Pick a scene in the binder, or add a new one to keep writing.'
          : storyId
            ? 'Scenes are where the writing happens. Add one, fill in its card, and write or press Generate.'
            : 'Start a story, then add scenes to write in.'}
      </EmptyState>
    </div>
  )
}
