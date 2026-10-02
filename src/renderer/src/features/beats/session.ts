// The Beat by beat session (milestone 4): one at a time, on one scene. It lasts until Adam finishes it,
// starts a new draft of the scene (Generate) or switches worlds. Opening another scene pauses it (a beat
// being written stops there, as Generate's drafts do) and coming back carries on where it was; so does
// going to another page. flow.ts changes it; the bar and the toolbar button show it.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import type { BeatMode, BeatParagraphs } from './sessionLogic'

/** Between beats ('paused'), getting a beat ready ('starting'), writing it into the page, or stopping it. */
export type BeatPhase = 'paused' | 'starting' | 'writing' | 'stopping'

export interface BeatSession {
  /** Kept with each beat's record (params.beat.sessionId). */
  id: ID
  worldId: ID
  sceneId: ID
  mode: BeatMode
  /** The paragraphs each beat wrote (see sessionLogic.ts). */
  paragraphs: BeatParagraphs
  /** Which record wrote each of those paragraphs, by paragraph id (so the bar knows which version of a beat is on the page). */
  owners: Record<string, ID>
  /** The records that ended part-way: stopped, cut off, or with a problem after some of their words. */
  partWay: ID[]
  /** The scene as it was before the session's first words is kept in its History (or there was nothing on the page to keep). */
  kept: boolean
  /** How many beats are on the page, worked out from the page as it changes. */
  written: number
  /** The record of the last beat on the page (the version showing), worked out with `written`. */
  last: ID | null
  /** The bar points to a beat whose start is out of sight below: the one being written, or one that finished there until it is seen. */
  below: { index: number; writing: boolean } | null
  phase: BeatPhase
  /** The beat being written, or getting ready: which, its record once it has one, whether it is a rewrite, and Adam's note for it. */
  current: { index: number; generationId: ID | null; again: boolean; steer: string } | null
  /** Why a request is being tried again (a rate limit or a busy server), while it is. */
  retrying: string | null
  /** Adam's note for the next beat, as typed in the bar. */
  steer: string
  /** The scene card's beats, as last read. */
  beats: string[]
}

/** What the Beat by beat button (or the bar) is asking: where the first beat goes, or what is missing first. */
export interface BeatQuestion {
  sceneId: ID
  kind: 'choose' | 'no-beats' | 'need-model'
  /** Asked from the keyboard, so the answer that has the keyboard shows it. */
  byKey: boolean
  /** Where the question shows: under the toolbar button, or over the bar's Write button. */
  from: 'button' | 'bar'
  /** The scene card's beats, as read when Adam asked (a session started by the answer begins with them). */
  beats: string[]
}

interface BeatsState {
  session: BeatSession | null
  question: BeatQuestion | null
  /** Bumped to put the keyboard in the bar's box. */
  focusRev: number
}

export const useBeats = create<BeatsState>(() => ({ session: null, question: null, focusRev: 0 }))

/** Changes the session, if there still is one. */
export function patchSession(patch: Partial<BeatSession> | ((s: BeatSession) => Partial<BeatSession>)): void {
  const s = useBeats.getState().session
  if (!s) return
  useBeats.setState({ session: { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } })
}

/** Puts the keyboard in the bar's box, once the bar shows. */
export const focusBar = (): void => useBeats.setState((s) => ({ focusRev: s.focusRev + 1 }))
