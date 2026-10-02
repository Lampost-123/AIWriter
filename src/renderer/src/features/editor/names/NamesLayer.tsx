// Names in the page: keeps the underlines in step with the world's entries, keeps the Cast tab's
// "Named in the text" in step with the scene's words, and shows the hover card over a name.
import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { isMac } from '@/lib/api'
import { useApp } from '@/lib/store'
import { cardPosition, HoverCard } from './HoverCard'
import { HoverIntent, type HoverTarget } from './hoverIntent'
import { EMPTY_INDEX, entriesNamedIn, updateNameIndex } from './nameMatch'
import { setNamedInScene, useSceneNames } from './sceneNames'
import { NAMES_EXTENSION, NAME_CLASS, nameAt, nameIndex, setNameIndex, setNameOpener } from './underlines'

/** How long after typing stops the Cast tab's "Named in the text" catches up. */
const NAMED_DELAY = 400

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock'])

export function NamesLayer({ editor, sceneId }: { editor: Editor; sceneId: ID | null }): React.JSX.Element | null {
  const writing = useApp((s) => s.view.kind === 'write')
  const { data } = useSceneNames(sceneId, writing)
  const [indexKey, setIndexKey] = useState(nameIndex().key)

  // Another world: its names aren't known until they load, so the last world's go at once.
  const worldId = useApp((s) => s.world?.id ?? null)
  const lastWorld = useRef(worldId)
  useEffect(() => {
    if (lastWorld.current === worldId) return
    lastWorld.current = worldId
    if (setNameIndex(EMPTY_INDEX) && !editor.isDestroyed) {
      editor.commands.updateDecorations(NAMES_EXTENSION)
      setIndexKey(EMPTY_INDEX.key)
    }
  }, [worldId, editor])

  // A name, alias or kind changed: underline again, without touching the document.
  useEffect(() => {
    if (!data || editor.isDestroyed) return
    if (setNameIndex(updateNameIndex(nameIndex(), data.entries))) {
      editor.commands.updateDecorations(NAMES_EXTENSION)
      setIndexKey(nameIndex().key)
    }
  }, [data, editor])

  // Ctrl+click on a name shows it beside the page.
  useEffect(() => {
    setNameOpener((id) => useApp.getState().peekEntry(id))
    return () => setNameOpener(null)
  }, [])

  // The entries named in the text, for the Cast tab: when the scene opens, when the names change and
  // a moment after typing stops. After this frame, so a scene being swapped in is read, not the last.
  useEffect(() => {
    if (!sceneId) return
    const read = (): void => {
      if (editor.isDestroyed) return
      const doc = editor.state.doc
      setNamedInScene(sceneId, entriesNamedIn(doc.textBetween(0, doc.content.size, '\n\n', '\n'), nameIndex()))
    }
    let timer = setTimeout(read, 0)
    const onUpdate = (): void => {
      clearTimeout(timer)
      timer = setTimeout(read, NAMED_DELAY)
    }
    editor.on('update', onUpdate)
    return () => {
      clearTimeout(timer)
      editor.off('update', onUpdate)
    }
  }, [editor, sceneId, indexKey])

  // ----- The hover card -----

  const [target, setTarget] = useState<HoverTarget<HTMLElement> | null>(null)
  const intentRef = useRef<HoverIntent<HTMLElement> | null>(null)

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    const intent = new HoverIntent<HTMLElement>(setTarget)
    intentRef.current = intent
    const mac = isMac()
    const onMove = (e: MouseEvent): void => {
      // Never while selecting with the mouse.
      const el = e.buttons ? null : e.target instanceof Element ? e.target.closest<HTMLElement>(`.${NAME_CLASS}`) : null
      const id = el ? nameAt(el) : null
      if (el && id) intent.enterName(id, el)
      else intent.leaveName()
    }
    const onLeave = (): void => intent.leaveName()
    // With the shortcut key held, names show they can be clicked.
    const showMod = (on: boolean): void => {
      dom.classList.toggle('aw-mod', on)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === (mac ? 'Meta' : 'Control')) showMod(true)
      // Any key but a lone modifier closes the card (holding Ctrl to click the name keeps it).
      if (!MODIFIER_KEYS.has(e.key)) intent.dismiss()
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === (mac ? 'Meta' : 'Control')) showMod(false)
    }
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Element && e.target.closest('[data-hover-card]'))) intent.dismiss()
    }
    const onBlur = (): void => {
      showMod(false)
      intent.dismiss()
    }
    const onScroll = (): void => intent.dismiss()
    dom.addEventListener('mousemove', onMove)
    dom.addEventListener('mouseleave', onLeave)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    return () => {
      intent.destroy()
      intentRef.current = null
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [editor])

  // Another scene, or another page over this one: the card goes.
  useEffect(() => {
    intentRef.current?.dismiss()
  }, [sceneId, writing])

  const entry = target && data?.sceneId === sceneId ? data.entries.find((e) => e.id === target.id) : undefined
  if (!target || !entry || !writing || !target.anchor.isConnected) return null
  const at = cardPosition(target.anchor.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight })
  return (
    <HoverCard
      entry={entry}
      at={at}
      onEnter={() => intentRef.current?.enterCard()}
      onLeave={() => intentRef.current?.leaveCard()}
      onOpen={() => {
        intentRef.current?.dismiss()
        useApp.getState().peekEntry(entry.id)
      }}
    />
  )
}
