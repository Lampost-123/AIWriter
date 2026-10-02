// Hold-to-talk, everywhere in the window (milestone 4): while the key Adam picked in Settings is held,
// dictation listens; letting go types what he said where the cursor was: the scene, a scene card field,
// the chat, the Quick start box or any other text box (targets.ts). A Ctrl, Shift or Alt key only listens
// when pressed on its own, so shortcuts such as Ctrl+C still work. Also shows dictation's marker
// ("Listening", "Writing it down") and keeps the microphone ready while dictation is on. Mounted once by App.
import { useEffect } from 'react'
import { toast, useToasts } from '@/components/ui'
import { isMac } from '@/lib/api'
import { useApp } from '@/lib/store'
import { isDictationKey, isModifierKey, keyName, MENU_KEY, pressedAlone } from './keys'
import { DictationMarker } from './Marker'
import { PRE_ROLL_SECONDS } from './mic'
import { dictationReady, notReadyNow, useDictationReady } from './ready'
import {
  cancelRecording,
  finishRecording,
  openSpeechSettings,
  pickingKey,
  revealRecording,
  setKeyDictation,
  startRecording
} from './session'
import { anchorFor, deliver, findTarget } from './targets'

/** A Ctrl, Shift or Alt key's marker waits this long, in case another key follows (a shortcut, not dictation). */
const SHORTCUT_GRACE_MS = 250
/** After the Menu key comes up, the menu it would open is kept shut for this long. */
const MENU_SHUT_MS = 600

export function DictationLayer(): React.JSX.Element {
  const key = useApp((s) => s.settings?.speech?.dictationKey ?? '')
  const ready = useDictationReady()

  // The microphone is kept ready (so the words said as the key goes down are kept) only while a key is
  // picked and the speech engine is ready; the session lets it go while the window is in the back.
  useEffect(() => {
    setKeyDictation(!!key && ready === true)
    return () => setKeyDictation(false)
  }, [key, ready])

  useHoldToTalk(key)
  return <DictationMarker />
}

/** Shows a message unless the same one is showing already (the key held again, say). */
function tell(message: string, settings = false): void {
  if (useToasts.getState().items.some((t) => t.message === message)) return
  toast(
    message,
    settings && useApp.getState().view.kind !== 'settings' ? { action: { label: 'Open Settings', run: openSpeechSettings } } : {}
  )
}

/** The held key: its recording, or what to say about why there isn't one. */
interface Held {
  id: number | null
  reveal?: ReturnType<typeof setTimeout>
  /** Said when the key comes up with no recording (dictation not ready, nowhere to type). */
  say?: () => void
}

function useHoldToTalk(key: string): void {
  useEffect(() => {
    if (!key) return
    const modifier = isModifierKey(key)
    const name = keyName(key, isMac())
    let held: Held | null = null
    let menuShutUntil = 0

    const begin = (): Held => {
      if (!dictationReady()) return { id: null, say: () => tell(notReadyNow(), true) }
      const target = findTarget()
      if (!target)
        return { id: null, say: () => tell(`Click where the words should go (the page or a text box), then hold ${name} again.`) }
      const id = startRecording({
        owner: 'key',
        by: 'key',
        preRoll: PRE_ROLL_SECONDS,
        // A Ctrl, Shift or Alt key shows its marker once it is clear no other key is coming.
        hidden: modifier,
        anchor: anchorFor(target),
        deliver: (text) => deliver(target, text)
      })
      // Null: a microphone button is listening already.
      if (id == null) return { id: null }
      return { id, reveal: modifier ? setTimeout(() => revealRecording(id), SHORTCUT_GRACE_MS) : undefined }
    }

    /** The key came up (or the window went to the back): write it down; `cancel` lets it go instead. */
    const end = (cancel: boolean): void => {
      const h = held
      if (!h) return
      held = null
      clearTimeout(h.reveal)
      if (h.id == null) {
        if (!cancel) h.say?.()
      } else if (cancel) cancelRecording(h.id)
      else finishRecording(h.id)
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (pickingKey()) return
      if (held) {
        if (isDictationKey(e, key)) {
          // The key repeats while it is held.
          if (!modifier) {
            e.preventDefault()
            e.stopPropagation()
          }
          return
        }
        // Another key while a Ctrl, Shift or Alt dictation key is down: it's a shortcut (Ctrl+C), not dictation.
        if (modifier) end(true)
        return
      }
      if (e.repeat || !isDictationKey(e, key) || !pressedAlone(e, key) || useApp.getState().restoring) return
      if (!modifier) {
        // The key is dictation's alone: nothing else in the window acts on it.
        e.preventDefault()
        e.stopPropagation()
      }
      held = begin()
      // Any other key says so straight away; a Ctrl, Shift or Alt key waits to see if it was a shortcut.
      if (!modifier && held.id == null) {
        held.say?.()
        held.say = undefined
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (!held || !isDictationKey(e, key)) return
      if (!modifier) {
        e.preventDefault()
        e.stopPropagation()
      }
      if (key === MENU_KEY) menuShutUntil = performance.now() + MENU_SHUT_MS
      end(false)
    }

    // Ctrl+click or Ctrl+scroll with a Ctrl dictation key: a shortcut too.
    const onPointer = (): void => {
      if (held && modifier) end(true)
    }
    // Switching to another window writes down what was said (the session stops the recording itself).
    const onBlur = (): void => end(held?.id == null)
    // The Menu key as the dictation key: its menu stays shut.
    const onMenu = (e: MouseEvent): void => {
      if (key === MENU_KEY && e.button !== 2 && (held || performance.now() < menuShutUntil)) e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('wheel', onPointer, { capture: true, passive: true })
    window.addEventListener('blur', onBlur)
    window.addEventListener('contextmenu', onMenu, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('wheel', onPointer, { capture: true })
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('contextmenu', onMenu, true)
      // The key was changed (or cleared) while held: let that recording go.
      end(true)
    }
  }, [key])
}
