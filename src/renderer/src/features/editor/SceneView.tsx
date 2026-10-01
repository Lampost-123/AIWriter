import { EditorContent, useEditor } from '@tiptap/react'
import { FilePlus2, Feather, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ID, SceneStatus } from '@shared/types'
import { Button, EmptyState, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { editorBridge, setEditorBridge } from '@/lib/editorBridge'
import { registerFlusher } from '@/lib/flush'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { useOutline, useOutlineStore } from '@/features/binder/outlineStore'
import { SceneController } from './controller'
import { sceneExtensions } from './extensions'
import { onFocusRequest, requestEditorFocus, takeFocusRequest } from './focusRequest'
import { SceneHeader } from './SceneHeader'
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

  // One editor for the life of the view; scenes are swapped into it. Typing never re-renders React.
  const editor = useEditor(
    {
      extensions: sceneExtensions(),
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: 'scene-prose', spellcheck: 'true', 'aria-label': 'Scene text', 'aria-multiline': 'true' }
      }
    },
    []
  )

  useEffect(() => {
    const ctrl = new SceneController(editor, () => scrollerRef.current, {
      onShow: (scene) =>
        flushSync(() => {
          setShown({ id: scene.id, title: scene.title, status: scene.status })
          setError(null)
        }),
      onError: (message) => setError(message)
    })
    ctrlRef.current = ctrl
    setEditorBridge(ctrl.bridge)
    const offFlush = registerFlusher(() => ctrl.flush())
    const offFocus = onFocusRequest(() => {
      if (takeFocusRequest(ctrl.sceneId)) ctrl.focus()
    })
    return () => {
      offFlush()
      offFocus()
      if (editorBridge() === ctrl.bridge) setEditorBridge(null)
      ctrl.destroy()
      ctrlRef.current = null
    }
  }, [editor])

  useEffect(() => {
    void ctrlRef.current?.open(sceneId)
  }, [sceneId, worldId, editor])

  // Ctrl+S saves straight away (it already saves on its own; this is for peace of mind).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
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

  /** Clicking the empty page below the text puts the cursor at the end. */
  const onPageMouseDown = (e: React.MouseEvent): void => {
    const prose = editor.view.dom
    if (e.button !== 0 || prose.contains(e.target as Node)) return
    if (e.clientY > prose.getBoundingClientRect().bottom) {
      e.preventDefault()
      editor.commands.focus('end')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      {shown ? (
        <SceneHeader sceneId={shown.id} fallbackTitle={shown.title} fallbackStatus={shown.status} />
      ) : (
        <div className="h-12 shrink-0 border-b border-line/70" />
      )}
      <div
        ref={scrollerRef}
        onScroll={() => ctrlRef.current?.follow.onScroll()}
        onMouseDown={onPageMouseDown}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        <div
          ref={columnRef}
          className={shown && !error ? 'mx-auto px-10 pb-[38vh] pt-12 font-serif' : 'invisible mx-auto px-10 pb-[38vh] pt-12 font-serif'}
          style={{ fontSize, lineHeight, maxWidth: `calc(${pageWidth}ch + 5rem)` }}
        >
          <EditorContent editor={editor} />
        </div>
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
    </div>
  )
}

/** Opens a new scene at the end of the story (making a chapter or story first if needed). */
async function addSceneAtEnd(): Promise<void> {
  const { storyId } = useApp.getState()
  if (!storyId) {
    await actions.newStory()
    return
  }
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
              setBusy(true)
              void addSceneAtEnd().finally(() => setBusy(false))
            }}
          >
            Add a scene
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
