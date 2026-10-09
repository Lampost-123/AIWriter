// Adapted from Poor-Mans-Holodeck's src/lib/dictate.ts (warmDictation, startDictation and the buffer it
// trims): the microphone opened at 16 kHz and kept open while dictation is on, holding the last moment of
// sound (heard.ts) so a recording can start a little before the key went down; a recording is the stretch
// from its start until it stops. The sound arrives through an AudioWorklet (recorder.worklet.js) instead of
// Holodeck's ScriptProcessor. Nothing is kept once a recording has been taken, and nothing is written anywhere.
import { DICTATION_SAMPLE_RATE } from '@shared/contracts/dictation'
// A file of its own, never written into the page as a data: address (the window's security rules only
// let it load scripts from the app itself).
import WORKLET from './recorder.worklet.js?url&no-inline'
import { endAfter, hear, KEEP_SECONDS, startBack, trimHeard, type Heard } from './heard'
import { takeSamples } from './wav'

const RATE = DICTATION_SAMPLE_RATE

/** Why the microphone couldn't be opened, in plain words with what to do. */
export class MicError extends Error {
  constructor(
    message: string,
    /** 'closed': the window went to the back while it was opening, which isn't a problem to show. */
    public kind: 'denied' | 'missing' | 'busy' | 'closed'
  ) {
    super(message)
  }
}

/** Where to let AI Write use the microphone, on this computer. */
export function micAllowWhere(): string {
  const platform = window.aiwrite?.platform
  return platform === 'win32'
    ? 'In Windows Settings › Privacy & security › Microphone, turn on access for desktop apps'
    : platform === 'darwin'
      ? 'In System Settings › Privacy & Security › Microphone, turn on AI Write'
      : "Allow AI Write to use the microphone in this computer's privacy settings"
}

/** The microphone isn't allowed: where to allow it, on this computer. */
const micDenied = (): string => `AI Write isn't allowed to use the microphone. ${micAllowWhere()}, then try again.`
export const MIC_MISSING = 'No microphone was found. Plug one in, then try again.'
export const MIC_BUSY =
  "The microphone couldn't be started. Close any other app that may be using it, or pick another microphone in Settings › Read aloud and dictation, then try again."

/** The open microphone, with what it has heard lately (Heard). */
interface Mic extends Heard {
  ctx: AudioContext
  stream: MediaStream
  /** The microphone asked for ('' for the computer's default). */
  deviceId: string
  /** The computer's default is in use because the microphone asked for isn't plugged in. */
  fellBack: boolean
  /** Recordings still to be taken: nothing they need is let go. */
  takes: Set<Take>
  closed: boolean
}

/** One recording: the sound from `from` on, until it is taken. */
export interface Take {
  mic: Mic
  from: number
}

let open: Mic | null = null
let opening: Promise<Mic> | null = null
/** Bumped by every close, so an opening that finishes after it lets go at once. */
let closes = 0
let level = 0

const levelListeners = new Set<(level: number) => void>()
const batchListeners = new Set<() => void>()
const endListeners = new Set<() => void>()

function micError(e: unknown): MicError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return new MicError(micDenied(), 'denied')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new MicError(MIC_MISSING, 'missing')
  return new MicError(MIC_BUSY, 'busy')
}

const AUDIO: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false }

/** The microphone's stream: the one asked for, or the default when that one isn't plugged in. */
async function streamFor(deviceId: string): Promise<{ stream: MediaStream; fellBack: boolean }> {
  if (window.aiwrite?.platform === 'phone') {
    throw new MicError('Talking is on this computer for now. Type on the phone, or hold the dictation key on the computer.', 'denied')
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError(MIC_MISSING, 'missing')
  if (deviceId) {
    try {
      return { stream: await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO, deviceId: { exact: deviceId } } }), fellBack: false }
    } catch (e) {
      if (micError(e).kind !== 'missing') throw micError(e)
    }
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO }), fellBack: !!deviceId }
  } catch (e) {
    throw micError(e)
  }
}

/** 0 for silence, 1 for very loud: the average loudness, in decibels from -60 to -10. */
export const levelOf = (rms: number): number => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 1e-6)) + 60) / 50))

/** Lets go of sound nobody needs: all but the last moment, or what a recording still to be taken holds. */
function trim(m: Mic): void {
  const starts = Array.from(m.takes, (t) => t.from)
  trimHeard(m, RATE * KEEP_SECONDS, starts)
}

function stop(m: Mic): void {
  m.closed = true
  m.stream.getTracks().forEach((t) => t.stop())
  void m.ctx.close().catch(() => undefined)
}

async function start(deviceId: string, closesNow: number): Promise<Mic> {
  const { stream, fellBack } = await streamFor(deviceId)
  const ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' })
  const m: Mic = { ctx, stream, deviceId, fellBack, chunks: [], origin: 0, total: 0, takenUntil: 0, takes: new Set(), closed: false }
  try {
    await ctx.audioWorklet.addModule(WORKLET)
    if (ctx.state === 'suspended') await ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'aiwrite-dictation', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit'
    })
    // Connected to the speakers at no volume, so the audio thread keeps it running; nothing is heard.
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(ctx.destination)
    node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
      if (m.closed) return
      hear(m, e.data.samples)
      trim(m)
      if (open !== m) return
      level = Math.max(levelOf(e.data.rms), level * 0.82)
      levelListeners.forEach((fn) => fn(level))
      batchListeners.forEach((fn) => fn())
    }
    // Unplugged while open: let it go, and tell whoever is recording.
    for (const t of stream.getAudioTracks()) {
      t.addEventListener('ended', () => {
        if (open !== m) return
        closeMic()
        endListeners.forEach((fn) => fn())
      })
    }
  } catch (e) {
    stop(m)
    throw e instanceof MicError ? e : micError(e)
  }
  if (closes !== closesNow) {
    // Closed while it was opening (the window went to the back): let it go straight away.
    stop(m)
    throw new MicError('', 'closed')
  }
  return m
}

/**
 * Opens the microphone (`deviceId`, or the computer's default for ''), or keeps it open. Resolves once
 * it is listening; says whether the default is in use because that microphone isn't plugged in.
 */
export async function openMic(deviceId: string): Promise<{ fellBack: boolean }> {
  if (open && open.deviceId === deviceId) return { fellBack: open.fellBack }
  if (opening) {
    const closesNow = closes
    const m = await opening.catch(() => null)
    // Closed while the other opening was under way (the window went to the back): stay closed.
    if (closes !== closesNow) throw new MicError('', 'closed')
    if (m && m === open && m.deviceId === deviceId) return { fellBack: m.fellBack }
  }
  if (open) closeMic()
  const p = start(deviceId, closes)
  opening = p
  try {
    const m = await p
    open = m
    return { fellBack: m.fellBack }
  } finally {
    if (opening === p) opening = null
  }
}

/** Closes the microphone (the window went to the back, or dictation is off). Recordings not yet taken keep their sound. */
export function closeMic(): void {
  closes++
  const m = open
  open = null
  if (level !== 0) {
    level = 0
    levelListeners.forEach((fn) => fn(0))
  }
  if (m) stop(m)
}

export const micIsOpen = (): boolean => open !== null

/** The microphone asked for, while it is open. */
export const openMicId = (): string | null => open?.deviceId ?? null

/** The computer's default is listening because the microphone asked for isn't plugged in. */
export const micFellBack = (): boolean => !!open?.fellBack

/**
 * Starts a recording now, `preRoll` seconds back where that much is held (never into the recording before it).
 * Null when the microphone isn't open.
 */
export function startTake(preRoll: number): Take | null {
  const m = open
  if (!m) return null
  const take = { mic: m, from: startBack(m, RATE * preRoll) }
  m.takes.add(take)
  return take
}

/** How long a recording has been going, in seconds. */
export const takeSeconds = (take: Take): number => (take.mic.total - take.from) / RATE

/**
 * The recording's sound, once `tailMs` more has arrived (the last word is still on its way from the
 * microphone as the key comes up), or straight away once the microphone has closed. Lets go of it after.
 */
export async function finishTake(take: Take, tailMs: number): Promise<Float32Array> {
  const m = take.mic
  const until = endAfter(m, (RATE * tailMs) / 1000)
  if (tailMs > 0 && !m.closed) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearInterval(check)
        clearTimeout(limit)
        resolve()
      }
      const check = setInterval(() => (m.closed || m.total >= until) && done(), 16)
      const limit = setTimeout(done, tailMs + 250)
    })
  }
  const heard = takeSamples(m.chunks, m.origin, take.from, Math.min(until, m.total))
  dropTake(take)
  return heard
}

/** Lets go of a recording without taking it. */
export function dropTake(take: Take): void {
  take.mic.takes.delete(take)
  trim(take.mic)
}

export const micLevel = (): number => level

/** Calls `fn` with the microphone's level as it changes (about 16 times a second while it is open). */
export function onMicLevel(fn: (level: number) => void): () => void {
  levelListeners.add(fn)
  return () => {
    levelListeners.delete(fn)
  }
}

/** Calls `fn` as each batch of sound arrives. */
export function onMicBatch(fn: () => void): () => void {
  batchListeners.add(fn)
  return () => {
    batchListeners.delete(fn)
  }
}

/** Calls `fn` when the microphone stops by itself (unplugged). */
export function onMicEnded(fn: () => void): () => void {
  endListeners.add(fn)
  return () => {
    endListeners.delete(fn)
  }
}

/** The microphones on this computer, for the picker. Their names show once the microphone has been used. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
  } catch {
    return []
  }
}
