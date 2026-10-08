// The desk's story home (UI overhaul, D5.1): the lamp mark and the story's name in the top bar open it. The story as a
// book: its generated cover, its title and premise, how much it holds, Continue writing where Adam left off, ideas for
// the next planned scene, and the last lines he wrote. Under it the chapters stand on a shelf, each with its scenes as
// dots and how far along it is; then the open plot threads, the cast, and this week's writing; and a quiet footer with
// the memory and the story's checks. The first time it shows in a session its pieces arrive in turn (the book tips up,
// lines rise, the shelf slides in, the bars grow); never again, never from the keyboard, never with less motion.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { ThreadsBoard } from '@shared/contracts/worldViews'
import type { ID } from '@shared/types'
import { ArrowRight, ChevronDown, Palette, Plus, RotateCcw, X } from '@/components/ui/icons'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import * as actions from '@/features/binder/actions'
import { useOutline } from '@/features/binder/outlineStore'
import { openConsistency } from '@/features/consistency/checkStore'
import { useGoals } from '@/features/goals/goalStore'
import { streakOf, weekOf } from '@/features/goals/goalLogic'
import { askIdeas, ideasKey, useSceneIdeas } from '@/features/outline/ideasStore'
import { cardIsEmpty } from '@/features/outline/ideasLogic'
import { parseIdeas } from '@/features/outline/parse'
import { useStoryLabels, useStoryLabelsLoader } from '@/features/stories/labels'
import { inShelfOrder } from '@/features/stories/storiesLogic'
import { Portrait } from '@/features/views/Portrait'
import { editedText } from '@/features/start/startLogic'
import { numberWords } from '@shared/numberWords'
import { useArrival } from '@/layout/desk/arrival'
import { GUTTER, useDeskFrame, useSheetGlide } from '@/layout/desk/deskFit'
import { useEntryMotifs } from '@/features/world/art/artStore'
import { CoverPicker } from '@/features/world/art/MotifPicker'
import { BookCover } from './BookCover'
import { useStoryCover } from './cover'
import {
  bookKicker,
  castOf,
  homeScale,
  homeTwoColumns,
  chapterAria,
  chapterShelf,
  checkLine,
  lastLines,
  memoryLine,
  nextPlannedScene,
  sceneWhere,
  statsLabel,
  storyStats,
  threadRows,
  threadsAside,
  type ShelfChapter,
  type ThreadRow
} from './homeLogic'
import './home.css'

const fmt = (x: number): string => x.toLocaleString('en-GB')
/** An arriving piece's delay. */
const at = (ms: number): CSSProperties => ({ '--d': `${ms}ms` }) as CSSProperties

/** Loads something for the home, again whenever `deps` change; null until it arrives (or when it fails). */
function useLoad<T>(load: () => Promise<T> | null, deps: unknown[]): T | null {
  const [value, setValue] = useState<{ key: string; v: T } | null>(null)
  const key = JSON.stringify(deps)
  useEffect(() => {
    let live = true
    const p = load()
    if (!p) return
    p.then((v) => live && setValue({ key, v })).catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value ? value.v : null
}

export function StoryHome(): React.JSX.Element {
  const storyId = useApp((s) => s.storyId)
  const sceneId = useApp((s) => s.sceneId)
  const stories = useApp((s) => s.stories)
  const world = useApp((s) => s.world)
  const outlineRev = useApp((s) => s.outlineRev)
  const entriesRev = useApp((s) => s.entriesRev)
  const memoryRev = useApp((s) => s.memoryRev)
  const memoryStatus = useApp((s) => s.memoryStatus)
  const { outline } = useOutline()
  const story = stories.find((s) => s.id === storyId) ?? null
  const order = useStoryLabels((s) => s.order)
  useStoryLabelsLoader()
  const arriving = useArrival('home')
  // Beside the story's spine, as every room is (layout/desk/rooms.ts): the home keeps clear of it, centred in the room it
  // leaves, and glides across with it as it opens out or collapses.
  const frame = useDeskFrame()
  const glide = useSheetGlide(frame)

  const board = useLoad<ThreadsBoard>(() => (storyId ? api.getThreadsBoard(storyId) : null), [storyId, outlineRev, memoryRev])
  const codex = useLoad<CodexCard[]>(() => api.listCodex(), [entriesRev, memoryRev, world?.id])
  const issues = useLoad(() => (storyId ? api.issueCounts(storyId) : null), [storyId, outlineRev, memoryRev])
  const last = useLoad(() => (sceneId ? api.getScene(sceneId) : null), [sceneId, outlineRev])
  const cover = useStoryCover(story, world)
  const motifs = useEntryMotifs()

  const stats = outline ? storyStats(outline) : null
  const shelf = useMemo(() => (outline ? chapterShelf(outline, sceneId) : []), [outline, sceneId])
  const lastScene = outline && sceneId ? outline.scenes.find((s) => s.id === sceneId) : undefined
  const threads = board && outline ? threadRows(board, outline, sceneId) : null
  const cast = codex ? castOf(codex, storyId) : null
  const kicker = story ? bookKicker(story.id, inShelfOrder(stories, order)) : 'Book One'
  const title = story?.title.trim() || 'Untitled story'

  // A big screen: the whole home drawn larger, filling the room beside the spine (homeScale), and centred in its height.
  const homeRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = homeRef.current
    if (!el) return
    const measure = (): void => {
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0
      setRoom((r) => (r.w === el.clientWidth - pad && r.h === el.clientHeight ? r : { w: el.clientWidth - pad, h: el.clientHeight }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const twoColumns = homeTwoColumns(room.w)
  const scale = homeScale(room.w, room.h, twoColumns)

  const continueWriting = (): void => {
    if (sceneId) useApp.getState().selectScene(sceneId)
    else useApp.getState().navigate({ kind: 'write' })
  }

  return (
    <div
      ref={homeRef}
      data-desk-home
      data-arrive={arriving || undefined}
      data-scale={scale > 1 ? scale : undefined}
      className="desk-home absolute inset-0 overflow-y-auto overflow-x-hidden"
      style={{ paddingLeft: frame.leftMin - GUTTER, transition: glide }}
    >
      <div
        className="home-col"
        data-columns={twoColumns ? 'two' : undefined}
        aria-label={`Story home: ${title}`}
        role="region"
        style={room.h ? { zoom: scale, minHeight: Math.floor(room.h / scale) } : undefined}
      >
        <section className="home-hero" aria-label="The book">
          <div className="home-book-col">
            <button
              type="button"
              className="home-book a-book"
              style={at(40)}
              onClick={continueWriting}
              aria-label={lastScene ? `Open the book where you left off, at ${lastScene.title}` : 'Open the book'}
            >
              <BookCover title={title} kicker={kicker} foot={world ? `A ${world.name.replace(/^Sample world:\s*/i, '')} story` : ''} hue={cover.hue} art={cover.art} />
            </button>
            {story ? (
              <CoverPicker story={story} motif={cover.motif} hue={cover.hue}>
                <button type="button" className="home-cover-btn a-rise" style={at(420)}>
                  <Palette size={13} />
                  Change the cover
                </button>
              </CoverPicker>
            ) : null}
          </div>
          <div className="home-hb">
            <p className="home-eyebrow a-rise" style={at(140)}>
              <span className="desk-caps">{[world?.name.replace(/^Sample world:\s*/i, ''), kicker].filter(Boolean).join(' · ')}</span>
              <span className="home-eb-rule" aria-hidden />
            </p>
            <h1 className="home-title a-rise" style={at(190)}>
              {title}
            </h1>
            {story?.premise.trim() ? (
              <p className="home-premise a-rise" style={at(240)}>
                {story.premise.trim()}
              </p>
            ) : null}
            {stats ? (
              <p className="home-stats a-rise" style={at(290)} aria-label={statsLabel(stats)}>
                <span>
                  <b>{fmt(stats.words)}</b> {stats.words === 1 ? 'word' : 'words'}
                </span>
                <i aria-hidden />
                <span>
                  <b>{fmt(stats.chapters)}</b> {stats.chapters === 1 ? 'chapter' : 'chapters'}
                </span>
                <i aria-hidden />
                <span>
                  <b>{fmt(stats.scenes)}</b> {stats.scenes === 1 ? 'scene' : 'scenes'}
                </span>
                <i aria-hidden />
                <span>
                  <b>{fmt(stats.done)}</b> done
                </span>
              </p>
            ) : null}
            <div className="home-actions a-rise" style={at(340)}>
              <button type="button" className="home-cta" onClick={continueWriting}>
                <span className="home-cta-txt">
                  <span className="home-cta-label">Continue writing</span>
                  {lastScene ? (
                    <span className="home-cta-sub">
                      {lastScene.title || 'Untitled scene'}
                      {outline ? ` · ${sceneWhere(outline, lastScene.id).replace(/, scene \d+$/, '')}` : ''}
                    </span>
                  ) : null}
                </span>
                <span className="home-cta-go" aria-hidden>
                  <ArrowRight size={18} />
                </span>
              </button>
              {outline ? <NextIdeas sceneId={sceneId} /> : null}
            </div>
            {last && last.text.trim() ? (
              <div className="home-teaser a-rise" style={at(390)}>
                <span className="home-ribbon" aria-hidden />
                <div className="home-teaser-head">
                  <span className="desk-caps">The last lines · {last.title || 'Untitled scene'}</span>
                  <span className="home-teaser-when">{editedText(last.updatedAt).replace(/^Edited /, '')}</span>
                </div>
                <p className="home-teaser-txt">{lastLines(last.text)}</p>
              </div>
            ) : null}
          </div>
        </section>

        {/* The right-hand column on an ultrawide screen (just part of the one column otherwise). */}
        <div className="home-right">
        <Shelf shelf={shelf} storyId={storyId} />

        <section className="home-lower" aria-label="Threads, cast and this week">
          <div className="home-lc a-up" style={at(600)}>
            <div className="home-lc-head">
              <span className="desk-caps">Open threads</span>
              {threads?.length ? <span className="home-aside">{threadsAside(threads)}</span> : null}
            </div>
            {threads ? (
              threads.length ? (
                <div className="home-threads">
                  {threads.slice(0, 4).map((t, i) => (
                    <Thread key={t.id} t={t} delay={720 + i * 60} />
                  ))}
                </div>
              ) : (
                <p className="home-empty">No plot threads yet. They come from the scene cards and the memory.</p>
              )
            ) : null}
          </div>
          <div className="home-lc a-up" style={at(660)}>
            <div className="home-lc-head">
              <span className="desk-caps">Cast</span>
            </div>
            {cast ? (
              cast.people.length ? (
                <button type="button" className="home-cast" onClick={() => useApp.getState().navigate({ kind: 'codex' })} aria-label={`Cast: ${[...cast.people.map((p) => p.name), ...cast.others].join(', ')}. ${cast.line}. Open the world.`}>
                  <span className="home-pts">
                    {/* Side by side, each with its name under it (cut short, it shows whole on hover); the rest as "+N". */}
                    {cast.people.map((p, i) => (
                      <span key={p.id} className="home-pt" style={at(740 + i * 50)} title={p.name}>
                        <span className="home-pt-face a-pop">
                          <Portrait entry={p} size={52} motif={motifs.get(p.id)} />
                        </span>
                        <span className="home-pt-name">{p.name.split(' ')[0]}</span>
                      </span>
                    ))}
                    {cast.others.length ? (
                      <span className="home-pt is-more" style={at(740 + cast.people.length * 50)} title={`Also: ${cast.others.join(', ')}`}>
                        <span className="home-pt-face home-pt-more a-pop">+{cast.others.length}</span>
                        <span className="home-pt-name">more</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="home-cast-count">
                    <span>{cast.line}</span>
                    <ArrowRight size={14} />
                  </span>
                  {cast.places.length ? (
                    <span className="home-cast-places">
                      <span className="home-kdot" aria-hidden />
                      <span className="truncate" title={cast.places.join(', ')}>
                        {cast.places.join(', ')}
                      </span>
                    </span>
                  ) : null}
                </button>
              ) : (
                <p className="home-empty">Nobody in the world yet.</p>
              )
            ) : null}
          </div>
          <div className="home-lc a-up" style={at(720)}>
            <Week />
          </div>
        </section>

        <Footer memory={memoryLine(memoryStatus)} check={checkLine(issues)} storyId={storyId} />
        </div>
      </div>
    </div>
  )
}

/** "Next scene ideas": three directions for the next planned scene, asked for only when opened. */
function NextIdeas({ sceneId }: { sceneId: ID | null }): React.JSX.Element | null {
  const { outline } = useOutline()
  const worldId = useApp((s) => s.world?.id ?? null)
  const target = outline ? nextPlannedScene(outline, sceneId) : null
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  // Only a planned scene whose card says nothing yet about what happens.
  const card = useLoad(() => (target ? api.getScene(target.id) : null), [target?.id])
  const session = useSceneIdeas((s) => (target ? s.sessions[ideasKey(worldId, target.id)] : undefined))
  const ideas = session ? parseIdeas(session.text, session.status !== 'running') : []
  if (!target || !outline || !card || card.id !== target.id || !cardIsEmpty(card.card)) return null

  const show = (): void => {
    setClosing(false)
    setOpen(true)
    if (!session || session.status === 'error' || session.hidden) void askIdeas(target.id)
  }
  const close = (): void => {
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 140)
  }
  const thinking = session?.status === 'running' && !ideas.length
  return (
    <div className="relative">
      <button type="button" className={cn('home-ideas-btn', open && 'is-on')} aria-haspopup="dialog" aria-expanded={open} onClick={() => (open ? close() : show())}>
        <span className={cn('home-lamp-dot', session?.status === 'running' && 'is-busy')} aria-hidden />
        <span>Next scene ideas</span>
        <ChevronDown size={14} className="home-chev" />
      </button>
      {open ? (
        <div className={cn('home-ideas', closing && 'is-out')} role="dialog" aria-label="Ideas for the next scene">
          <div className="home-ideas-head">
            <span className={cn('home-lamp-dot', session?.status === 'running' && 'is-busy')} aria-hidden />
            <span className="home-ideas-title">Ideas for the next scene</span>
            <button type="button" className="home-ibtn" aria-label="Close ideas" onClick={close}>
              <X size={14} />
            </button>
          </div>
          <div className="home-ideas-sub">
            {target.title || 'Untitled scene'} · {sceneWhere(outline, target.id)} · planned
          </div>
          {thinking ? (
            <div className="home-ideas-wait" role="status">
              <span>Reading the last scenes and your plan…</span>
              <i />
              <i />
              <i />
            </div>
          ) : session?.problem && !ideas.length ? (
            <p className="home-ideas-problem" role="alert">
              {session.problem.message}
            </p>
          ) : (
            <ol className="home-idea-list">
              {ideas.map((idea, i) => (
                <li key={i} className="home-idea" style={at(i * 60)}>
                  <span className="home-idea-n">{['i.', 'ii.', 'iii.', 'iv.', 'v.'][i] ?? `${i + 1}.`}</span>
                  <span className="home-idea-t">
                    {idea.title ? <b>{idea.title}. </b> : null}
                    {idea.summary}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <div className="home-ideas-foot">
            <button type="button" className="home-btn-ghost" disabled={session?.status === 'running'} onClick={() => void askIdeas(target.id)}>
              <RotateCcw size={14} />
              <span>Try again</span>
            </button>
            <button
              type="button"
              className="home-btn-sec"
              onClick={() => outline && useApp.getState().navigate({ kind: 'board', storyId: outline.story.id, ideasFor: target.id })}
            >
              Add to the plan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** The chapters on a shelf: one card each (its numeral, its scenes as dots, how far along), scrolled to Adam's. */
function Shelf({ shelf, storyId }: { shelf: ShelfChapter[]; storyId: ID | null }): React.JSX.Element {
  const row = useRef<HTMLDivElement>(null)
  const current = shelf.findIndex((c) => c.current)
  // Adam's chapter in view (at once: nothing glides on arrival).
  useLayoutEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[data-current-chapter]')
    if (el && row.current) row.current.scrollLeft = Math.max(0, el.offsetLeft - row.current.clientWidth / 2 + el.offsetWidth / 2)
  }, [current, shelf.length])
  const openBoard = (chapterId?: ID): void => {
    if (storyId) useApp.getState().navigate({ kind: 'board', storyId, ...(chapterId ? { chapterId } : {}) })
  }
  const addChapter = async (): Promise<void> => {
    if (!storyId) return
    const id = await actions.addChapter(storyId)
    if (id) toast('Added a chapter. Its scenes go on the story board.', { action: { label: 'Open the board', run: () => openBoard(id) } })
  }
  return (
    <section className="home-shelf" aria-label="Chapters">
      <div className="home-shelf-head a-rise" style={at(420)}>
        <div className="home-sh-side">
          <span className="desk-caps">Chapters</span>
          <span className="home-hair" />
        </div>
        <Fleuron />
        <div className="home-sh-side">
          <span className="home-hair" />
          <button type="button" className="home-quiet-link" onClick={() => openBoard()}>
            <span>Open the story board</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div className="home-shelf-row" ref={row}>
        {shelf.map((c, i) => (
          <div key={c.id} className="home-shelf-item a-left" style={at(460 + Math.min(i, 6) * 60)} data-current-chapter={c.current || undefined}>
            <button type="button" className={cn('home-chap', c.current && 'is-current')} aria-label={chapterAria(c)} onClick={() => openBoard(c.id)}>
              <span className="home-chap-num">{c.numeral}</span>
              <span className="home-chap-body">
                <span className="desk-caps">{c.label}</span>
                <span className="home-chap-title" title={c.title || undefined}>
                  {c.title || <em>Untitled</em>}
                </span>
                <span className="home-chap-meta">
                  <span className="home-sdots">
                    {c.scenes.slice(0, 9).map((s) => (
                      <span key={s.id} className={cn('home-sdot', `st-${s.status}`, s.current && 'is-cur')} title={`${s.title || 'Untitled scene'} · ${s.status}${s.current ? ' · you are here' : ''}`}>
                        <Ring status={s.status} />
                      </span>
                    ))}
                    {c.scenes.length > 9 ? <span className="home-more">+{c.scenes.length - 9}</span> : null}
                  </span>
                  <span className="tabular-nums">{fmt(c.words)} words</span>
                </span>
              </span>
              <span className="home-chap-arc">
                <Arc chapter={c} />
                <span className={cn('home-arc-cap', c.state === 'done' && 'is-ok')}>{c.state === 'done' ? 'Done' : c.state === 'empty' ? 'Empty' : 'In progress'}</span>
              </span>
            </button>
          </div>
        ))}
        <div className="home-shelf-item a-left" style={at(460 + Math.min(shelf.length, 6) * 60)}>
          <button type="button" className="home-add-chap" onClick={() => void addChapter()}>
            <span className="home-add-ic">
              <Plus size={14} />
            </span>
            <span className="home-add-t">Add chapter</span>
            <span className="home-add-s">Chapter {numberWords(shelf.length + 1)}</span>
          </button>
        </div>
      </div>
      <div className="home-plank a-fade" style={at(440)} aria-hidden />
    </section>
  )
}

/** A scene's ring: planned hollow, drafted half, revised three-quarters, done filled with a tick. */
function Ring({ status }: { status: string }): React.JSX.Element {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden>
      {status === 'done' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5.1 8.2l1.9 1.9 3.9-4" fill="none" stroke="var(--card)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {status === 'drafted' ? <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" /> : null}
          {status === 'revised' ? <path d="M8 1.75a6.25 6.25 0 1 1-6.25 6.25H8z" fill="currentColor" /> : null}
        </>
      )}
    </svg>
  )
}

/** A chapter's ring of progress: one segment per scene (done, written, planned), "2/2" inside. */
function Arc({ chapter }: { chapter: ShelfChapter }): React.JSX.Element {
  const total = Math.max(1, chapter.scenes.length)
  const r = 20
  const c = 2 * Math.PI * r
  const gap = chapter.scenes.length > 1 ? 4 : 0
  const seg = c / total - gap
  return (
    <span className="home-arc">
      <svg width={48} height={48} viewBox="0 0 48 48" aria-hidden>
        {chapter.scenes.length ? (
          chapter.scenes.map((s, i) => (
            <circle
              key={s.id}
              className={cn('home-seg', s.status === 'done' ? 'is-done' : s.status === 'planned' ? 'is-plan' : 'is-draft')}
              cx="24"
              cy="24"
              r={r}
              transform={`rotate(${-90 + (360 / total) * i + (gap / c) * 180} 24 24)`}
              style={{ strokeDasharray: `${Math.max(1, seg)} ${c}`, '--seg': Math.max(1, seg), ...at(620 + i * 80) } as CSSProperties}
            />
          ))
        ) : (
          <circle className="home-seg is-plan" cx="24" cy="24" r={r} />
        )}
      </svg>
      <span className="home-arc-lbl">
        {chapter.done}/{chapter.scenes.length}
      </span>
    </span>
  )
}

/** A plot thread with its little string: from where it was set up to now (open, fraying) or to its knot (resolved). */
function Thread({ t, delay }: { t: ThreadRow; delay: number }): React.JSX.Element {
  const x = (f: number | null): number => 4 + (f ?? 0) * 140
  const from = x(t.from)
  const to = t.to == null ? from + 30 : Math.max(from + 6, x(t.to))
  const wave = (a: number, b: number): string => {
    const steps = Math.max(1, Math.round((b - a) / 11))
    const w = (b - a) / steps
    let d = `M${a.toFixed(1)} 8`
    for (let i = 0; i < steps; i++) d += `q${(w / 2).toFixed(1)}-3.4 ${w.toFixed(1)} 0`
    return d
  }
  return (
    <button
      type="button"
      className={cn('home-thread', `is-${t.state}`)}
      onClick={() => useApp.getState().navigate({ kind: 'threads' })}
      aria-label={`${t.state === 'resolved' ? 'Resolved thread' : t.state === 'planned' ? 'Planned thread' : 'Open thread'}: ${t.name}. ${t.note}.`}
    >
      <span className="home-th-q">{t.name}</span>
      <span className="home-th-row">
        <svg className="home-th-svg a-clip" style={at(delay)} width={160} height={16} viewBox="0 0 160 16" aria-hidden>
          <path className="th-track" d="M2 8H152" />
          <path className="th-line" d={wave(from, to)} />
          {t.state === 'open' ? <path className="th-fray" d={`M${to} 8l5-3M${to} 8l5 3M${to} 8h6`} /> : null}
          <circle className="th-origin" cx={from} cy="8" r="2.4" />
          {t.state === 'resolved' ? <circle className="th-knot" cx={to} cy="8" r="3.2" /> : null}
        </svg>
        <span className="home-th-note">{t.note}</span>
      </span>
    </button>
  )
}

/** This week's writing (on this computer, across every story): a bar a day, the daily target, the streak. */
function Week(): React.JSX.Element {
  const days = useGoals((s) => s.days)
  const today = useGoals((s) => s.today)
  const daily = useApp((s) => s.settings?.goals?.daily ?? null)
  const week = weekOf(days ?? [], today)
  const total = week.reduce((a, d) => a + d.words, 0)
  const top = Math.max(daily ?? 0, ...week.map((d) => d.words), 1) * 1.15
  const streak = streakOf(days ?? [], daily, today)
  const H = 64
  const label = week.map((d) => `${d.today ? 'today' : d.label} ${fmt(d.words)}`).join(', ')
  return (
    <div className="home-week">
      <div className="home-lc-head">
        {/* (Every story's words count here, not only this one's, so it says so.) */}
        <span className="desk-caps home-wk-caps">Your writing this week, across all your stories</span>
        {streak && streak.days > 0 ? (
          <span className="home-streak">
            <span className="home-streak-dots" aria-hidden>
              {Array.from({ length: Math.min(7, streak.days) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            <span>
              {fmt(streak.days)} {streak.days === 1 ? 'day' : 'days'} in a row
            </span>
          </span>
        ) : null}
      </div>
      <div className="home-wk-total">
        <span className="home-wk-num">{fmt(total)}</span>
        <span className="home-wk-lbl">{total === 1 ? 'word' : 'words'} this week</span>
        <span className="home-wk-today">
          <span className="home-wk-sw" aria-hidden />
          <span>{fmt(week[6].words)} today</span>
        </span>
      </div>
      <div className="home-plot" role="img" aria-label={`Words written each day for the last 7 days: ${label}.${daily ? ` Daily target ${fmt(daily)}.` : ''}`}>
        <span className="home-plot-base" />
        {week.map((d, i) =>
          d.words > 0 ? (
            <span
              key={d.date}
              className={cn('home-bar a-bar', d.today && 'is-today')}
              style={{ left: `calc(${i} * (100% - 52px) / 7 + 6px)`, height: Math.max(3, (d.words / top) * H), ...at(740 + i * 30) }}
              title={`${d.today ? 'Today' : d.label} · ${fmt(d.words)} words`}
            />
          ) : (
            <span key={d.date} className="home-zero" style={{ left: `calc(${i} * (100% - 52px) / 7 + 6px)` }} title={`${d.label} · no words`} />
          )
        )}
        {daily ? (
          <>
            <span className="home-goal" style={{ bottom: (daily / top) * H }} aria-hidden />
            <span className="home-goal-lbl" style={{ bottom: (daily / top) * H - 6 }}>
              Target {fmt(daily)}
            </span>
          </>
        ) : null}
      </div>
      <div className="home-days" aria-hidden>
        {week.map((d, i) => (
          <span key={d.date} className={cn('home-day', d.today && 'is-today')} style={{ left: `calc(${i} * (100% - 52px) / 7)` }}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function Footer({ memory, check, storyId }: { memory: { text: string; ok: boolean }; check: { text: string; ok: boolean }; storyId: ID | null }): React.JSX.Element {
  const item = (icon: ReactNode, text: string, ok: boolean, onClick: () => void): React.JSX.Element => (
    <button type="button" className={cn('home-foot-item', !ok && 'is-warn')} onClick={onClick}>
      {icon}
      <span>{text}</span>
    </button>
  )
  return (
    <footer className="home-foot a-fade" style={at(900)}>
      {item(
        <svg width={15} height={15} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="10" cy="10" r="7.25" />
          <path d="M6.8 10.2l2.2 2.2 4.2-4.6" />
        </svg>,
        memory.text,
        memory.ok,
        () => useApp.getState().navigate({ kind: 'memory', sceneId: null })
      )}
      <span className="home-foot-sep" aria-hidden />
      {item(
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
          <path d="M9.4 12.2l1.8 1.8 3.4-3.6" />
        </svg>,
        check.text,
        check.ok,
        () => storyId && openConsistency(storyId)
      )}
    </footer>
  )
}

function Fleuron(): React.JSX.Element {
  return (
    <svg className="home-fleuron" width="44" height="14" viewBox="0 0 44 14" aria-hidden>
      <path d="M22 3.2c1.6 1.8 1.6 5.8 0 7.6c-1.6-1.8-1.6-5.8 0-7.6z" fill="currentColor" />
      <path d="M19 7c-3.2 0-4.6-3.4-8-3.4c-2.6 0-4 1.8-4 3.4s1.4 3.4 4 3.4c1.7 0 2.6-1.1 2.6-2.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M25 7c3.2 0 4.6-3.4 8-3.4c2.6 0 4 1.8 4 3.4s-1.4 3.4-4 3.4c-1.7 0-2.6-1.1-2.6-2.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="2.6" cy="7" r="1" fill="currentColor" />
      <circle cx="41.4" cy="7" r="1" fill="currentColor" />
    </svg>
  )
}
