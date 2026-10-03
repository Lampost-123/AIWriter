// Sound effects under Read aloud: the one Web Audio graph for the window. Its context is made the first time a sound
// is wanted (Listen is a press of a button, so it may play at once). Everything goes through a master gain set from
// Settings' "Sounds volume", and three buses: the ambience (one bed at a time, looping, faded in, crossed to the next
// and faded out), the effects (fired at once, a few at a time) and the Sounds view's Listen. While a line is spoken
// the ambience dips and the effects a little; they come back in the breath between lines. Pausing the reading
// suspends the context, so a bed or an effect part-way through carries on exactly where it was. The decisions are in
// mixerLogic.ts.
//
// Sounds come from the app-wide library (api.soundAudio): one not made yet is skipped without a word, and fetched
// again once 'sounds:ready' says it is made. Nothing here ever shows an error or holds reading up.
import { create } from 'zustand'
import type { ClipSound } from '@shared/contracts/readAloud'
import type { SoundKind } from '@shared/contracts/sounds'
import { api, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import {
  BED_CROSSFADE,
  BED_DUCK_DB,
  BED_FADE_IN,
  BED_FADE_OUT,
  DUCK_RAMP,
  EFFECT_DUCK_DB,
  EFFECT_FADE_IN,
  KEEP_BYTES,
  LEVEL_RAMP,
  Lru,
  PREVIEW_BED_SECONDS,
  STOP_FADE,
  bedChange,
  cueVolume,
  dbToGain,
  decodedBytes,
  effectsToDrop,
  volumeGain
} from './mixerLogic'

interface Voice {
  soundId: string
  src: AudioBufferSourceNode
  gain: GainNode
  /** Its own volume (cueVolume): what its gain rises to. */
  volume: number
}

/** The Sounds view's Listen: which sound is playing (or being got ready) on its own. */
export const usePreview = create<{ playing: string | null; loading: string | null }>(() => ({ playing: null, loading: null }))

/** The test log (tests/e2e/sounds.spec.ts): each sound reading reached, when localStorage asks for it. */
function logEdge(sound: Pick<ClipSound, 'edge' | 'soundId' | 'cueId'>, played: boolean): void {
  try {
    if (localStorage.getItem('aiwrite.soundsLog') !== '1') return
    const w = window as unknown as { __aiwriteSounds?: unknown[] }
    ;(w.__aiwriteSounds ??= []).push({ edge: sound.edge, soundId: sound.soundId, cueId: sound.cueId, played })
  } catch {
    // No storage here: nothing is logged.
  }
}

/** Moves a gain smoothly from where it is now to `to` over `seconds`, starting at `at` on the audio clock. */
function ramp(param: AudioParam, to: number, at: number, seconds: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at)
  else {
    param.cancelScheduledValues(at)
    param.setValueAtTime(param.value, at)
  }
  param.linearRampToValueAtTime(to, at + Math.max(0.005, seconds))
}

class Mixer {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bedBus: GainNode | null = null
  private fxBus: GainNode | null = null
  private previewBus: GainNode | null = null
  private bed: Voice | null = null
  /** The ambience reading wants now, made or not: once it is made, it starts (at its own volume). */
  private wantedBed: string | null = null
  private wantedVolume = 1
  private effects: Voice[] = []
  private preview: Voice | null = null
  private previewTimer: ReturnType<typeof setTimeout> | null = null
  /** Reading is paused: the context is suspended (Listen in the Sounds view may wake it, with reading's buses silent). */
  private paused = false
  private held = false
  private ducked = false
  private readonly buffers = new Lru<string, AudioBuffer>(KEEP_BYTES, decodedBytes)
  private readonly pending = new Map<string, Promise<AudioBuffer | null>>()
  /** Bumped by every Listen and Stop: a Listen still getting ready when another starts (or Stop) never plays. */
  private listenSeq = 0
  /** Bumped by forget(): a sound fetched before it is never kept. */
  private generation = 0

  /** The audio clock, made on first use. Null where the window has no Web Audio (never in the app). */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    if (typeof AudioContext === 'undefined') return null
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = volumeGain(useApp.getState().settings?.speech.soundVolume ?? 0.5)
    this.master.connect(ctx.destination)
    this.bedBus = ctx.createGain()
    this.fxBus = ctx.createGain()
    this.previewBus = ctx.createGain()
    for (const bus of [this.bedBus, this.fxBus, this.previewBus]) bus.connect(this.master)
    // The volume follows Settings as it is saved (the slider sets it live while it moves).
    useApp.subscribe((now, before) => {
      const v = now.settings?.speech.soundVolume
      if (v !== before.settings?.speech.soundVolume && v != null) this.setVolume(v)
    })
    // A sound made since reading wanted it: an ambience still wanted starts now; anything else is fetched next time.
    onEvent('sounds:ready', ({ soundId, ok }) => {
      if (!ok) return
      // Made again under the same id: the copy kept here is out of date.
      if (this.bed?.soundId !== soundId) this.buffers.delete(soundId)
      if (this.wantedBed === soundId && this.bed?.soundId !== soundId) this.setBed(soundId, 0, this.wantedVolume)
    })
    return ctx
  }

  private get now(): number {
    return this.ctx?.currentTime ?? 0
  }

  /** A sound decoded and ready to play, or null when it isn't made yet (or can't be had). Fetched once at a time. */
  load(soundId: string): Promise<AudioBuffer | null> {
    if (!soundId) return Promise.resolve(null)
    const have = this.buffers.get(soundId)
    if (have) return Promise.resolve(have)
    const ctx = this.ensure()
    if (!ctx) return Promise.resolve(null)
    let got = this.pending.get(soundId)
    if (!got) {
      const generation = this.generation
      got = api
        .soundAudio(soundId)
        .then(async (bytes) => {
          if (!bytes) return null
          // decodeAudioData takes the bytes over, so it gets a copy of its own.
          const copy = new Uint8Array(bytes).buffer
          const buffer = await ctx.decodeAudioData(copy)
          // Cleared meanwhile (Clear sounds): not kept, and not played.
          if (generation !== this.generation) return null
          this.buffers.set(soundId, buffer)
          return buffer
        })
        .catch(() => null)
        .finally(() => {
          if (this.pending.get(soundId) === got) this.pending.delete(soundId)
        })
      this.pending.set(soundId, got)
    }
    return got
  }

  /** True when the sound is decoded and can play this moment. */
  ready(soundId: string): boolean {
    return !!soundId && this.buffers.has(soundId)
  }

  /** Live, as the slider moves. */
  setVolume(volume: number): void {
    if (!this.master || !this.ctx) return
    ramp(this.master.gain, volumeGain(volume), this.now, 0.08)
  }

  /** On while a line is spoken: the ambience dips about 8 dB and the effects a little; off in the breath after it. */
  duck(on: boolean): void {
    if (on === this.ducked) return
    this.ducked = on
    if (!this.ctx || !this.bedBus || !this.fxBus || this.held) return
    ramp(this.bedBus.gain, on ? dbToGain(BED_DUCK_DB) : 1, this.now, DUCK_RAMP)
    ramp(this.fxBus.gain, on ? dbToGain(EFFECT_DUCK_DB) : 1, this.now, DUCK_RAMP)
  }

  /**
   * The ambience reading wants (null or '': none). The same one carries on; another crosses over to it; none fades
   * it out; the same one at another volume moves to it. One not made yet starts when it is, if it is still wanted.
   * `delay`: seconds from now on the audio clock. `volume`: its own volume (1 as made).
   */
  setBed(soundId: string | null, delay = 0, volume?: number | null): void {
    const id = soundId || null
    const level = cueVolume(volume)
    this.wantedBed = id
    this.wantedVolume = level
    const change = bedChange(this.bed?.soundId ?? null, id, this.bed?.volume, level)
    if (change === 'keep') return
    if (change === 'level' && this.bed) {
      this.bed.volume = level
      ramp(this.bed.gain.gain, level, this.now + delay, LEVEL_RAMP)
      return
    }
    const ctx = id || this.bed ? this.ensure() : null
    if (!ctx) return
    if (!id) return this.fadeOutBed(BED_FADE_OUT, delay)
    const buffer = this.buffers.get(id)
    if (!buffer) {
      // Not here yet: the old one ends now (one ambience at a time), and the new one comes in once it is.
      this.fadeOutBed(BED_CROSSFADE, delay)
      void this.load(id).then((b) => {
        if (b && this.wantedBed === id && this.bed?.soundId !== id) this.startBed(id, b, 0, this.wantedVolume)
      })
      return
    }
    this.startBed(id, buffer, delay, level)
  }

  private startBed(soundId: string, buffer: AudioBuffer, delay: number, volume: number): void {
    const ctx = this.ctx
    if (!ctx || !this.bedBus) return
    const at = this.now + delay
    const old = this.bed
    if (old) this.fade(old, at, BED_CROSSFADE)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(volume, at + (old ? BED_CROSSFADE : BED_FADE_IN))
    src.connect(gain).connect(this.bedBus)
    src.start(at)
    this.bed = { soundId, src, gain, volume }
  }

  private fadeOutBed(seconds: number, delay = 0): void {
    const old = this.bed
    this.bed = null
    if (old) this.fade(old, this.now + delay, seconds)
  }

  /** Fades a voice out and lets it go. */
  private fade(v: Voice, at: number, seconds: number): void {
    ramp(v.gain.gain, 0, at, seconds)
    try {
      v.src.stop(at + seconds + 0.05)
    } catch {
      // Already stopped.
    }
  }

  /**
   * A one-off effect, at once (or `delay` seconds from now), at its own volume. One not made yet is skipped, and
   * fetched for next time.
   */
  fire(sound: Pick<ClipSound, 'edge' | 'soundId' | 'cueId' | 'volume'>, delay = 0): void {
    const buffer = sound.soundId ? this.buffers.get(sound.soundId) : undefined
    logEdge(sound, !!buffer)
    if (!buffer) {
      if (sound.soundId) void this.load(sound.soundId)
      return
    }
    const ctx = this.ensure()
    if (!ctx || !this.fxBus) return
    const at = this.now + delay
    for (const old of this.effects.splice(0, effectsToDrop(this.effects.length))) this.fade(old, at, 0.08)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    const volume = cueVolume(sound.volume)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(volume, at + EFFECT_FADE_IN)
    src.connect(gain).connect(this.fxBus)
    const voice = { soundId: sound.soundId, src, gain, volume }
    src.onended = () => {
      this.effects = this.effects.filter((v) => v !== voice)
    }
    src.start(at)
    this.effects.push(voice)
  }

  /** An ambience edge reached by the reading (logged for the tests like an effect). */
  bedEdge(sound: Pick<ClipSound, 'edge' | 'soundId' | 'cueId' | 'volume'>, bed: string | null, delay = 0): void {
    logEdge(sound, bed ? this.ready(bed) : true)
    this.setBed(bed, delay, sound.volume)
  }

  /**
   * The reading's scene was muted (the reading bar's button): its ambience and effects fade out at once, without
   * touching whether the reading is paused. Its next lines are planned again without sounds.
   */
  silence(): void {
    this.wantedBed = null
    if (!this.ctx) return
    const voices = [...(this.bed ? [this.bed] : []), ...this.effects]
    this.bed = null
    this.effects = []
    for (const v of voices) this.fade(v, this.now, 0.6)
  }

  /** The ambience reading wants now (for a jump: the clip shown says which). */
  get bedWanted(): string | null {
    return this.wantedBed
  }

  /** Reading paused: everything holds where it is. */
  pause(): void {
    if (this.paused) return
    this.paused = true
    if (!this.ctx) return
    if (!this.preview) void this.ctx.suspend().catch(() => undefined)
    else this.hold()
  }

  /** Listen plays while reading is paused: reading's own sounds go silent (the clock runs for Listen). */
  private hold(): void {
    if (this.held || !this.bedBus || !this.fxBus) return
    this.held = true
    for (const bus of [this.bedBus, this.fxBus]) {
      bus.gain.cancelScheduledValues(0)
      bus.gain.setValueAtTime(0, this.now)
    }
  }

  /** Reading carries on: everything goes on from exactly where it was (a Listen still playing stops first). */
  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.stopListening()
    if (this.held) this.release()
    if (this.ctx) void this.ctx.resume().catch(() => undefined)
  }

  /** Reading stopped: everything fades out quickly. */
  stop(seconds = STOP_FADE): void {
    this.wantedBed = null
    this.ducked = false
    const ctx = this.ctx
    if (!ctx) {
      // Nothing was ever played: only the reading's state goes back to the start.
      this.paused = false
      this.held = false
      return
    }
    const voices = [...(this.bed ? [this.bed] : []), ...this.effects]
    this.bed = null
    this.effects = []
    if (this.paused || ctx.state === 'suspended') {
      // Silent while suspended anyway: they go at once, and the clock runs again for whatever comes next.
      for (const v of voices) {
        try {
          v.src.stop()
        } catch {
          // Already stopped.
        }
      }
      this.paused = false
      if (this.held) this.release()
      void ctx.resume().catch(() => undefined)
    } else for (const v of voices) this.fade(v, this.now, seconds)
    if (this.bedBus && this.fxBus && !this.held) {
      ramp(this.bedBus.gain, 1, this.now, DUCK_RAMP)
      ramp(this.fxBus.gain, 1, this.now, DUCK_RAMP)
    }
  }

  /**
   * The sound library was cleared (or put back): nothing decoded before is played again. The ambience fades out; it
   * comes back by itself if reading still wants it and its sound is made again.
   */
  /** One sound made again (a new take, or back to the earlier one): its copy here is out of date. */
  forgetSound(soundId: string): void {
    this.buffers.delete(soundId)
    this.pending.delete(soundId)
  }

  forget(): void {
    this.generation++
    this.buffers.clear()
    this.pending.clear()
    this.stopListening()
    if (this.bed) this.fadeOutBed(STOP_FADE)
  }

  /** The end of reading (no scene to carry on into): the ambience fades out gently, and any effect rings out. */
  endBed(): void {
    this.wantedBed = null
    this.duck(false)
    if (this.bed) this.fadeOutBed(BED_FADE_OUT)
  }

  // ---------- Listen, in the Sounds view ----------

  /**
   * Plays one sound on its own at the volume set (an ambience for a few seconds, then it fades). False when it isn't
   * made yet. While reading is paused, its sounds stay silent and still.
   */
  async listen(soundId: string, kind: SoundKind, volume?: number | null): Promise<boolean> {
    this.stopListening()
    const mine = ++this.listenSeq
    usePreview.setState({ loading: soundId, playing: null })
    const buffer = await this.load(soundId)
    // Another Listen, or Stop, meanwhile: this one never plays.
    if (mine !== this.listenSeq) return !!buffer
    const ctx = this.ctx
    if (!buffer || !ctx || !this.previewBus) {
      usePreview.setState({ loading: null })
      return false
    }
    // Reading's own sounds hold their places, silent, while this plays. A pause may have just asked the clock to
    // stop (its suspend still on its way), so the clock is always asked to run again, after it.
    if (this.paused) this.hold()
    if (this.paused || this.held || ctx.state !== 'running') await ctx.resume().catch(() => undefined)
    if (mine !== this.listenSeq) return true
    usePreview.setState({ loading: null })
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = kind === 'ambience'
    const gain = ctx.createGain()
    const at = this.now
    const level = cueVolume(volume)
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(level, at + (kind === 'ambience' ? 0.4 : EFFECT_FADE_IN))
    src.connect(gain).connect(this.previewBus)
    const voice = { soundId, src, gain, volume: level }
    src.onended = () => {
      if (this.preview === voice) this.listened()
    }
    src.start(at)
    this.preview = voice
    usePreview.setState({ playing: soundId })
    if (kind === 'ambience') {
      const seconds = Math.min(PREVIEW_BED_SECONDS, Math.max(2, buffer.duration * 2))
      this.previewTimer = setTimeout(() => {
        if (this.preview === voice) this.fade(voice, this.now, 1)
      }, seconds * 1000)
    }
    return true
  }

  /** Listen's volume as its slider moves (the sound playing, if it is that one, follows at once). */
  setListenVolume(soundId: string, volume: number): void {
    const v = this.preview
    if (!v || v.soundId !== soundId) return
    v.volume = cueVolume(volume)
    ramp(v.gain.gain, v.volume, this.now, 0.08)
  }

  /** Stops Listen (a quick fade). */
  stopListening(): void {
    this.listenSeq++
    if (this.previewTimer) clearTimeout(this.previewTimer)
    this.previewTimer = null
    const v = this.preview
    if (v) {
      this.preview = null
      this.fade(v, this.now, 0.15)
      this.listened()
    } else if (this.held) this.listened()
    if (usePreview.getState().loading) usePreview.setState({ loading: null })
  }

  private listened(): void {
    this.preview = null
    usePreview.setState({ playing: null })
    if (this.held) {
      this.release()
      // Reading is still paused: back to holding still.
      if (this.paused && this.ctx) void this.ctx.suspend().catch(() => undefined)
    }
  }

  /** Reading's buses back as they were. */
  private release(): void {
    this.held = false
    if (!this.bedBus || !this.fxBus) return
    this.bedBus.gain.setValueAtTime(this.ducked ? dbToGain(BED_DUCK_DB) : 1, this.now)
    this.fxBus.gain.setValueAtTime(this.ducked ? dbToGain(EFFECT_DUCK_DB) : 1, this.now)
  }
}

/** The window's one mixer. */
export const mixer = new Mixer()
