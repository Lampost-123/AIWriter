// One reading of a scene: plans its clips (the main process says who says each line, how, and in which
// voice), gets their audio three ahead, plays them one after another with a breath between, moves the
// highlight sentence by sentence and keeps it in view (Follow along). Adam can keep editing while it reads:
// the clip playing finishes, and the next ones are planned again from the words as they now stand, from
// where that clip ends on the page (highlight.ts keeps that place through the edits). With Mark who says what it
// also plans again where each plan asks (markAhead.ts), so the AI's notes keep ahead of it.
import type { Editor } from '@tiptap/core'
import type { PlannedClip, ReadingRequest } from '@shared/contracts/readAloud'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, onEvent } from '@/lib/api'
import { useApp } from '@/lib/store'
import { ClipPlayer, clipAudio, hasAudio, playRate, PLAY_FAILED } from './audio'
import { FollowAlong } from './follow'
import { barRoom, readingPlace, setReadingPlace, type ReadingPlace } from './highlight'
import { reachedMarkAhead, type MarkAhead } from './markAhead'
import { forPlan, hasWords, pageParagraphs, placeOf, posIn, type PageParagraph } from './pageText'
import { toFetch } from './prefetch'

export type ReadingPhase = 'starting' | 'playing' | 'waiting' | 'paused' | 'stopped' | 'finished' | 'problem'

/** What the bar above the page shows. */
export interface ReadingBar {
  phase: ReadingPhase
  /** Who is speaking, and how ("Mara", "quiet and wary"). */
  who: string
  how: string
  /** What the bar says when nobody is speaking: getting ready, stopped, the end, or what went wrong. */
  note: string
  /** A problem's next step: the speech settings (and trying again once it is fixed), or trying again. */
  fix: 'settings' | 'retry' | null
  /** A problem with one line (it stays lit): reading can skip it and carry on after it. */
  skip?: boolean
}

export interface SessionHooks {
  /** The bar changed. */
  bar(bar: ReadingBar): void
  /** Reading reached the end of the scene's words. */
  end(): void
}

/** How long marking a line may hold up the reading before it carries on by the rules. */
const MARK_WAIT_MS = 30_000
/** A clip that takes longer than this to get shows "getting the next lines ready". */
const SLOW_MS = 250
/** Paragraphs before the start sent along, so the rules know who is talking. */
const BEFORE = 60

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class Session {
  private queue: PlannedClip[] = []
  private current: PlannedClip | null = null
  private sentence = -1
  /** Each paragraph's words when the queue was planned. */
  private texts = new Map<string, string>()
  /** Each paragraph's place on the page when the queue was planned. */
  private order = new Map<string, number>()
  /** Mark who says what: where to plan again, so the AI's notes keep ahead of the reading. */
  private markAhead: MarkAhead | null = null
  /** Bumped on every edit; a plan made before the latest edit is out of date. */
  private version = 0
  private plannedAt = -1
  private planSeq = 0
  private alive = true
  private running = false
  private paused = false
  private wake: (() => void)[] = []
  private readonly player = new ClipPlayer()
  private readonly follow: FollowAlong
  /** Clips whose audio couldn't be had: not tried again ahead of time. */
  private readonly failed = new Set<string>()
  /** Paragraphs already waited on for the AI's marks. */
  private readonly waited = new Set<string>()
  private replanTimer: ReturnType<typeof setTimeout> | null = null
  private replanFirst = 0
  private toldMarks = false
  private stopWaiting: (() => void) | null = null
  private bar: ReadingBar = { phase: 'starting', who: '', how: '', note: 'Getting the first lines ready…', fix: null }
  private readonly offs: (() => void)[] = []

  constructor(
    readonly editor: Editor,
    readonly sceneId: ID,
    scroller: () => HTMLElement | null,
    private readonly hooks: SessionHooks
  ) {
    this.follow = new FollowAlong(scroller, barRoom)
    const onUpdate = (): void => this.edited()
    editor.on('update', onUpdate)
    this.offs.push(() => editor.off('update', onUpdate))
    this.offs.push(onEvent('readAloud:marked', (e) => this.marked(e)))
    // Adam scrolling, clicking or typing in the page: Follow along leaves it alone for a while.
    const el = scroller()
    if (el) {
      const hold = (): void => this.follow.hold()
      for (const type of ['wheel', 'touchmove', 'mousedown', 'keydown'] as const) el.addEventListener(type, hold, { passive: true })
      this.offs.push(() => {
        for (const type of ['wheel', 'touchmove', 'mousedown', 'keydown'] as const) el.removeEventListener(type, hold)
      })
    }
  }

  /** True until it is stopped, closed, or reaches the end. */
  get active(): boolean {
    return this.alive
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** Where reading is on the page now (mapped through Adam's edits). */
  place(): ReadingPlace {
    return readingPlace(this.editor.state)
  }

  /**
   * Starts reading from a place on the page. `quick`: a new reading, whose first clip is one sentence. `note`: what the
   * bar says until the first line plays.
   */
  async start(pos: number, quick: boolean, note = 'Getting the first lines ready…'): Promise<void> {
    this.setPlace({ clip: { from: pos, to: pos }, sentence: null })
    this.show({ phase: 'starting', who: '', how: '', note, fix: null })
    if (!(await this.plan(quick))) return
    void this.run()
  }

  pause(): void {
    if (!this.alive || this.paused) return
    this.paused = true
    this.player.pause()
    this.show({ ...this.bar, phase: 'paused' })
  }

  resume(): void {
    if (!this.alive || !this.paused) return
    this.paused = false
    this.player.resume()
    this.show({ ...this.bar, phase: this.current ? 'playing' : 'starting' })
    const wake = this.wake
    this.wake = []
    wake.forEach((fn) => fn())
  }

  setRate(rate: number): void {
    this.player.setRate(rate)
  }

  /** Stops reading. `keepPlace`: the bar stays, and Listen again carries on from the clip that was playing. */
  stop(keepPlace: boolean, bar?: Partial<ReadingBar>): void {
    if (this.alive) {
      this.alive = false
      this.player.stop()
      this.follow.cancel()
      if (this.replanTimer) clearTimeout(this.replanTimer)
      this.stopWaiting?.()
      this.wake.forEach((fn) => fn())
      this.wake = []
      this.offs.forEach((off) => off())
      void api.stopReadingMarks(this.sceneId).catch(() => undefined)
    }
    if (!this.editor.isDestroyed) this.setPlace(keepPlace ? { sentence: null } : { sentence: null, clip: null })
    if (bar) this.show({ ...this.bar, ...bar })
  }

  // ---------- Planning ----------

  private rate(): number {
    return playRate(useApp.getState().settings?.speech.speed)
  }

  /** The request for reading from the place reading is at now, with the paragraphs' words as they stand. */
  private request(quick: boolean): { req: ReadingRequest; texts: Map<string, string> } {
    const all = pageParagraphs(this.editor.state.doc)
    const texts = new Map(all.map((p) => [p.pid, p.text]))
    const from = this.place().clip?.to
    const at = from == null ? null : placeOf(all, from)
    if (!at) return { req: { sceneId: this.sceneId, paragraphs: [] }, texts }
    let i = at.index
    let offset = at.offset
    // From the first words after that place.
    while (i < all.length && !hasWords({ text: all[i].text.slice(offset) })) {
      i++
      offset = 0
    }
    const words = (p: PageParagraph): boolean => hasWords(p)
    return {
      req: {
        sceneId: this.sceneId,
        paragraphs: all.slice(i).filter(words).map(forPlan),
        before: all
          .slice(Math.max(0, i - BEFORE), i)
          .filter(words)
          .map(forPlan),
        offset: i < all.length ? offset : 0,
        quick,
        pids: all.map((p) => p.pid)
      },
      texts
    }
  }

  /** Plans the clips from where reading is. False when reading ended (a problem) while it planned. */
  private async plan(quick: boolean): Promise<boolean> {
    const seq = ++this.planSeq
    const version = this.version
    const made = this.request(quick)
    try {
      const plan = made.req.paragraphs.length ? await api.planReading(made.req) : { clips: [], marking: [] }
      if (!this.alive) return false
      // A later plan, made from newer words, wins.
      if (seq !== this.planSeq) return true
      this.queue = plan.clips
      this.texts = made.texts
      this.order = new Map([...made.texts.keys()].map((pid, i) => [pid, i]))
      this.markAhead = plan.markAhead ?? null
      this.plannedAt = version
      void this.prefetch()
      return true
    } catch (e) {
      if (!this.alive || seq !== this.planSeq) return this.alive
      this.problem(e)
      return false
    }
  }

  private get stale(): boolean {
    return this.plannedAt !== this.version
  }

  /** Adam edited the page: plan again from the words as they now stand. */
  private edited(): void {
    if (!this.alive) return
    this.follow.hold()
    this.replanSoon()
  }

  /** The plan is out of date: plan again once things settle (within two seconds), so the clips ahead are got in time. */
  private replanSoon(): void {
    this.version++
    if (this.replanTimer) clearTimeout(this.replanTimer)
    const now = Date.now()
    if (!this.replanFirst) this.replanFirst = now
    const wait = Math.max(0, Math.min(500, this.replanFirst + 2000 - now))
    this.replanTimer = setTimeout(() => {
      this.replanTimer = null
      this.replanFirst = 0
      if (this.alive && this.stale) void this.plan(false)
    }, wait)
  }

  /** The AI finished marking some paragraphs: plan again so their clips get their speakers and tones. */
  private marked(e: { sceneId: ID; pids: string[]; error: string | null }): void {
    if (!this.alive || e.sceneId !== this.sceneId) return
    if (e.error) {
      // It couldn't: those lines are read by the rules, as planned already, and nothing waits for them.
      if (!this.toldMarks) {
        this.toldMarks = true
        toast(e.error)
      }
      for (const pid of e.pids) this.waited.add(pid)
      return
    }
    if (e.pids.some((pid) => this.queue.some((c) => c.pid === pid))) this.replanSoon()
  }

  /** Waits for the AI's marks on a paragraph (or for a while, or for the reading to stop). */
  private marksFor(pid: string): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        off()
        if (this.stopWaiting === done) this.stopWaiting = null
        resolve()
      }
      const off = onEvent('readAloud:marked', (e) => {
        if (e.sceneId === this.sceneId && e.pids.includes(pid)) done()
      })
      const timer = setTimeout(done, MARK_WAIT_MS)
      this.stopWaiting = done
    })
  }

  // ---------- Playing ----------

  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.alive) {
        if (this.stale) {
          if (!(await this.plan(false))) return
          continue
        }
        const next = this.queue[0]
        if (!next) {
          this.end()
          return
        }
        if (next.waits && !this.waited.has(next.pid)) {
          this.show({ ...this.bar, phase: this.paused ? 'paused' : 'waiting', note: 'Working out who says what…' })
          await this.marksFor(next.pid)
          this.waited.add(next.pid)
          this.version++
          continue
        }
        const slow = setTimeout(() => {
          if (!this.alive || this.paused) return
          if (this.current) this.show({ ...this.bar, phase: 'waiting', note: 'Getting the next lines ready…' })
          else if (this.bar.phase !== 'starting') this.show({ ...this.bar, phase: 'starting', note: 'Getting the first lines ready…' })
        }, SLOW_MS)
        let url: string
        try {
          url = await clipAudio(next.key, next.clip)
        } catch (e) {
          if (this.alive) this.problem(e, next)
          return
        } finally {
          clearTimeout(slow)
        }
        if (!this.alive) return
        // An edit while it was being got: plan again first (the audio is kept, by its key, if it is still wanted).
        if (this.stale) continue
        if (this.paused) {
          await new Promise<void>((r) => this.wake.push(r))
          continue
        }
        this.queue.shift()
        if (!this.showClip(next)) continue
        void this.prefetch()
        const end = await this.player.play(url, this.rate(), (p) => this.progress(next, p))
        if (!this.alive || end === 'stopped') return
        if (end === 'failed') {
          // Audio the window can't play: say so, rather than racing silently through the scene.
          this.problem(new Error(PLAY_FAILED), next)
          return
        }
        if (next.restMs) await sleep(next.restMs / this.rate())
      }
    } finally {
      this.running = false
    }
  }

  /** Gets the next clips' audio, one at a time and in order, three ahead of the one playing. */
  private prefetching = false
  private async prefetch(): Promise<void> {
    if (this.prefetching) return
    this.prefetching = true
    try {
      while (this.alive) {
        const list = this.current ? [this.current, ...this.queue] : this.queue
        const [key] = toFetch(list, 0, (k) => hasAudio(k) || this.failed.has(k))
        const clip = key ? list.find((c) => c.key === key) : null
        if (!clip) return
        await clipAudio(clip.key, clip.clip).catch(() => this.failed.add(clip.key))
      }
    } finally {
      this.prefetching = false
    }
  }

  /** Where a clip is on the page now; null when its paragraph's words have changed. */
  private onPage(clip: PlannedClip): { from: number; to: number } | null {
    const p = pageParagraphs(this.editor.state.doc).find((x) => x.pid === clip.pid)
    if (!p || p.text !== this.texts.get(clip.pid)) return null
    return { from: posIn(p, clip.from), to: posIn(p, clip.to) }
  }

  /** A clip starts: the highlight goes on its first sentence, and the bar says who and how. */
  private showClip(clip: PlannedClip): boolean {
    const at = this.onPage(clip)
    if (!at) {
      // Its words changed after all: plan again from here.
      this.version++
      return false
    }
    this.current = clip
    this.sentence = -1
    this.setPlace({ clip: at })
    this.progress(clip, 0)
    this.show({ phase: this.paused ? 'paused' : 'playing', who: clip.who, how: clip.how, note: '', fix: null })
    // Mark who says what: the reading has reached where it asks again, so the AI notes the next part ahead of it.
    if (this.markAhead && reachedMarkAhead(clip, this.markAhead, this.order)) {
      this.markAhead = null
      this.replanSoon()
    }
    return true
  }

  /** How far through the clip it is: the highlight moves to the sentence being said (by its share of the words). */
  private progress(clip: PlannedClip, at: number): void {
    if (!this.alive || this.current !== clip || this.editor.isDestroyed) return
    const lengths = clip.sentences.map(([a, b]) => Math.max(1, b - a))
    const total = lengths.reduce((a, b) => a + b, 0)
    let i = 0
    for (let sum = lengths[0] ?? 0; i < lengths.length - 1 && at * total >= sum; ) sum += lengths[++i]
    if (i === this.sentence) return
    this.sentence = i
    const range = this.place().clip
    const s = clip.sentences[i]
    if (!range || !s) return
    // Within the clip as it stands on the page now.
    const from = Math.min(range.to, range.from + (s[0] - clip.from))
    const to = Math.min(range.to, range.from + (s[1] - clip.from))
    this.setPlace({ sentence: to > from ? { from, to } : null })
    if (to > from) this.followTo(from)
  }

  private followTo(pos: number): void {
    if (!useApp.getState().settings?.speech.followAlong || useApp.getState().view.kind !== 'write') return
    try {
      this.follow.bring(this.editor.view.coordsAtPos(pos).top)
    } catch {
      // Not on screen: nothing to follow.
    }
  }

  /** The end of the scene's words. */
  private end(): void {
    this.current = null
    this.stop(true)
    this.hooks.end()
  }

  /**
   * Reading can't go on: says why in plain words, with the next step. `clip`: the line that couldn't be read, which
   * stays lit (all of it, as Skip this line skips all of it) and in view, to try again or skip; otherwise reading
   * carries on from where it got to.
   */
  private problem(e: unknown, clip?: PlannedClip): void {
    const code = e instanceof ApiError ? e.code : undefined
    // The speech engine's own problems are short here: the bar's button opens the settings where they are fixed.
    const note =
      code === 'speech-not-running'
        ? "The speech engine isn't running."
        : code === 'voices-not-ready'
          ? "The voices aren't ready yet."
          : e instanceof Error && e.message
            ? e.message
            : 'Reading aloud stopped. Try again.'
    const engine = code === 'speech-not-running' || code === 'voices-not-ready'
    // The speech engine's problems are no one line's: skipping a line wouldn't help.
    const failed = !engine && clip ? this.onPage(clip) : null
    const place = this.place().clip
    // Where Try again starts: the line that failed; else the end of the clip read last (or, when the clip that
    // failed was showing, its start).
    const from = place ? (clip && clip === this.current ? place.from : place.to) : null
    this.stop(true, { phase: 'problem', who: '', how: '', note, fix: engine ? 'settings' : 'retry', skip: !!failed })
    if (failed) {
      this.setPlace({ clip: failed, sentence: failed })
      this.followTo(failed.from)
    } else if (from != null) this.setPlace({ clip: { from, to: from } })
  }

  private show(bar: ReadingBar): void {
    this.bar = bar
    this.hooks.bar(bar)
  }

  private setPlace(place: Partial<ReadingPlace>): void {
    if (this.editor.isDestroyed) return
    this.editor.view.dispatch(setReadingPlace(this.editor.state.tr, place))
  }
}
