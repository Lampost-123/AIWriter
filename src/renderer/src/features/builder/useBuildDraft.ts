import { useCallback, useEffect, useRef, useState } from 'react'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import type { Entry, ID, Origin } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { SaveStatus } from '@/features/world/parts/saver'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { aiAfterSave, entryText, markOf, nonEmpty, originNow, patchFor, profileKeys, valuesOf } from './builderLogic'

/** A field as it is on screen: its words, the AI's words for it (see markOf) if it had any, and who they come from. */
export interface FieldState {
  value: string
  ai: string | undefined
  origin: Origin
}

export interface BuildDraft {
  /** The profile on screen, Adam's unsaved typing included. */
  values: BuilderValues
  /** The entry, once it has a name and has been made. */
  entry: Entry | null
  /** The AI's words by key, for "Drafted by AI" (see markOf). */
  ai: Readonly<Record<string, string>>
  /** Adam typed in a field: it is his, and saved after a quiet pause. */
  set(key: string, value: string): void
  /**
   * Adam kept AI words: shown at once and saved as drafted by AI. Only empty fields are filled,
   * unless `replace` (he picked one of the options for that field). Rejects if it couldn't be saved,
   * leaving the fields as they were.
   */
  keep(chosen: BuilderValues, opts?: { replace?: boolean }): Promise<void>
  /** A field as it is now, to put back later with `revert`. */
  fieldNow(key: string): FieldState
  /**
   * Puts a field back as it was (Undo after an option replaced it), with who made its words: the AI's
   * and those read from the story are saved as theirs again at once, Adam's as his after the usual
   * pause. Rejects if it couldn't be saved, leaving the field as it was.
   */
  revert(key: string, was: FieldState): Promise<void>
  /** Writes anything waiting now. Never rejects. */
  flush(): Promise<void>
  status: SaveStatus
  error: string | null
  /** The latest values, for jobs that start between renders. */
  current(): BuilderValues
  /** The entry as of the latest save (it may have been made a moment ago). */
  entryNow(): Entry | null
  /** A save made elsewhere on this screen (a picture added): the entry as it is now. */
  noteSaved(e: Entry): void
}

const filled = (v: string | undefined): boolean => !!v?.trim()

/** `to` with `key` set to `v`, or without it when `v` is undefined. */
function withKey<T>(to: Readonly<Record<string, T>>, key: string, v: T | undefined): Record<string, T> {
  const out = { ...to }
  if (v === undefined) delete out[key]
  else out[key] = v
  return out
}

/**
 * A profile being built step by step. Nothing is made until it has a name (leaving before then
 * leaves nothing behind); from then on it saves itself silently, like the entry page, and anything
 * still waiting is written when the screen closes, the world switches or the window closes.
 */
export function useBuildDraft(kind: BuilderKind, initial: Entry | null, storyId: ID | null): BuildDraft {
  const [values, setValues] = useState<BuilderValues>(() => (initial ? valuesOf(kind, initial) : {}))
  const valuesRef = useRef(values)
  // The profile as last saved: a save sends only what changed since.
  const base = useRef<BuilderValues>(initial ? valuesOf(kind, initial) : {})
  const [entry, setEntry] = useState<Entry | null>(initial)
  const entryRef = useRef(initial)
  const [ai, setAi] = useState<Record<string, string>>(() => (initial ? aiAfterSave(kind, {}, initial) : {}))
  const aiRef = useRef(ai)
  const bump = useApp((s) => s.bumpEntries)

  const show = (next: BuilderValues): void => {
    valuesRef.current = next
    setValues(next)
  }
  const showAi = (next: Record<string, string>): void => {
    aiRef.current = next
    setAi(next)
  }

  // A saved copy came back: who wrote each field now, with the words as they were sent.
  const adopt = useCallback(
    (saved: Entry, sent: BuilderValues): void => {
      entryRef.current = saved
      setEntry(saved)
      const next = aiAfterSave(kind, aiRef.current, saved)
      for (const k of Object.keys(sent)) if (next[k]) next[k] = sent[k]
      showAi(next)
      bump()
    },
    [kind, bump]
  )

  const save = async (): Promise<void> => {
    const v = valuesRef.current
    const e = entryRef.current
    if (!e) {
      // Made once it has a name, with the AI words Adam kept marked as the AI's.
      if (!filled(v.name)) return
      const aiKeys = Object.keys(aiRef.current).filter((k) => markOf(k, v[k] ?? '', aiRef.current) === 'ai')
      const sent = { ...v }
      const made = await api.createBuilderEntry({ kind, values: nonEmpty(sent), aiKeys, storyId })
      base.current = sent
      adopt(made, nonEmpty(sent))
      return
    }
    const patch = patchFor(kind, v, base.current)
    if (!patch) return
    const saved = await api.updateEntry(e.id, patch.input)
    base.current = { ...base.current, ...patch.sent }
    adopt(saved, patch.sent)
  }

  const name = values.name?.trim()
  const autosave = useAutosave<number>(save, { what: name ? `"${name}"` : `this ${kind}` })
  const tick = useRef(0)
  const { schedule } = autosave

  const set = useCallback(
    (key: string, value: string): void => {
      show({ ...valuesRef.current, [key]: value })
      schedule(++tick.current)
    },
    [schedule]
  )

  const keep = useCallback(
    async (chosen: BuilderValues, opts: { replace?: boolean } = {}): Promise<void> => {
      const before = { values: valuesRef.current, base: { ...base.current }, ai: aiRef.current }
      const applied: BuilderValues = {}
      for (const [k, v] of Object.entries(chosen)) {
        if (!filled(v) || (!opts.replace && filled(valuesRef.current[k]))) continue
        applied[k] = v
      }
      if (!Object.keys(applied).length) return
      show({ ...valuesRef.current, ...applied })
      showAi({ ...aiRef.current, ...applied })
      const e = entryRef.current
      if (!e) {
        // No entry yet: these are saved with it, as the AI's, once it has a name.
        schedule(++tick.current)
        return
      }
      // Counted as saved already, so a save of Adam's typing meanwhile doesn't send them as his.
      Object.assign(base.current, applied)
      try {
        const saved = await api.keepSuggestions(e.id, applied, { replace: !!opts.replace })
        adopt(saved, applied)
      } catch (err) {
        const restore = (from: BuilderValues, to: BuilderValues): BuilderValues => {
          const out = { ...to }
          for (const k of Object.keys(applied)) {
            if (from[k] === undefined) delete out[k]
            else out[k] = from[k]
          }
          return out
        }
        show(restore(before.values, valuesRef.current))
        showAi(restore(before.ai, aiRef.current))
        base.current = restore(before.base, base.current)
        throw err
      }
    },
    [adopt, schedule]
  )

  const fieldNow = useCallback((key: string): FieldState => {
    const value = valuesRef.current[key] ?? ''
    return { value, ai: aiRef.current[key], origin: originNow(key, value, entryRef.current, base.current, aiRef.current) }
  }, [])

  const revert = useCallback(
    async (key: string, was: FieldState): Promise<void> => {
      const before = { value: valuesRef.current[key], ai: aiRef.current[key], base: base.current[key] }
      const ai = { ...aiRef.current }
      if (was.ai === undefined) delete ai[key]
      else ai[key] = was.ai
      showAi(ai)
      show({ ...valuesRef.current, [key]: was.value })
      const e = entryRef.current
      if (!e || was.origin === 'adam') {
        // His words, saved as his after the usual pause (or with the entry, once it has a name, the
        // AI's words among them marked as the AI's).
        schedule(++tick.current)
        return
      }
      // Counted as saved already, so a save of Adam's typing meanwhile doesn't send them as his.
      base.current[key] = was.value
      try {
        const saved = await api.restoreBuilderField(e.id, key, was.value, was.origin)
        adopt(saved, { [key]: was.value })
      } catch (err) {
        // Back to what is saved, unless Adam has typed in the field since.
        if ((valuesRef.current[key] ?? '') === was.value) {
          show(withKey(valuesRef.current, key, before.value))
          showAi(withKey(aiRef.current, key, before.ai))
        }
        base.current = withKey(base.current, key, before.base)
        throw err
      }
    },
    [adopt, schedule]
  )

  // Something else changed the entry (the memory keeper, its page in another view): fields Adam
  // hasn't touched since the last save show the newer words.
  const rev = useApp((s) => s.entriesRev)
  useEffect(() => {
    const e = entryRef.current
    if (!e) return
    let live = true
    api
      .getEntry(e.id)
      .then((fresh) => {
        const known = entryRef.current
        if (!live || !known || fresh.id !== known.id || fresh.updatedAt <= known.updatedAt) return
        const next = { ...valuesRef.current }
        let changed = false
        for (const key of profileKeys(kind)) {
          const was = base.current[key] ?? ''
          const now = entryText(fresh, key)
          if ((next[key] ?? '') !== was || now === was) continue
          next[key] = now
          base.current[key] = now
          changed = true
        }
        entryRef.current = fresh
        setEntry(fresh)
        showAi(aiAfterSave(kind, aiRef.current, fresh))
        if (changed) show(next)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [rev, kind])

  const current = useCallback(() => valuesRef.current, [])
  const entryNow = useCallback(() => entryRef.current, [])
  const noteSaved = useCallback((e: Entry) => {
    if (entryRef.current?.id !== e.id) return
    entryRef.current = e
    setEntry(e)
  }, [])
  return {
    values,
    entry,
    ai,
    set,
    keep,
    fieldNow,
    revert,
    flush: autosave.flush,
    status: autosave.status,
    error: autosave.error,
    current,
    entryNow,
    noteSaved
  }
}
