// The Export story and Export series bible dialogs (milestone 6, World files and export). Mounted once in
// the workspace; opened from the story menu in the binder and the command palette (exportStore.ts).
// Pick what to export and the format, then Export… asks where to save it (the system's own dialog).
// The dialog says how the export is getting on, and closes once the file is saved, with a toast
// "Exported ‘X’" and Show in folder.

import { useEffect, useRef, useState } from 'react'
import type { ID, Outline } from '@shared/types'
import type { BibleFormat, ManuscriptFormat } from '@shared/contracts/transfer'
import { Button, Dialog, Field, Select, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { Segmented } from '@/features/generate/parts'
import { openExportBible, remember, remembered, useExportDialogs } from './exportStore'
import {
  BIBLE_FORMATS,
  chapterLabel,
  chapterPicked,
  MANUSCRIPT_FORMATS,
  progressText,
  scopeOf,
  toggleChapter,
  toggleScene,
  type ScopeKind
} from './transferLogic'
import { announceExported, withProgress } from './worldFiles'
import { useNewLook } from '@/features/look/look'
import { FormatCards } from './FormatCards'

const FORMAT_KEY = 'aiwrite.export.format'
const BIBLE_FORMAT_KEY = 'aiwrite.export.bibleFormat'

export function ExportDialogs(): React.JSX.Element {
  return (
    <>
      <ExportStoryDialog />
      <ExportBibleDialog />
    </>
  )
}

/** What is happening under the dialog's choices: the export's progress, or why it couldn't be done. Its line is always there, so nothing moves. */
function Status({ busy, step, error, fraction = null }: { busy: boolean; step: string | null; error: string | null; fraction?: number | null }): React.JSX.Element {
  const isNew = useNewLook()
  // The New look: the export under way as ink filling a line, its step in words above it.
  if (isNew && busy && !error && step) {
    return (
      <div className="mt-4 flex min-h-5 flex-col gap-1.5 text-[12.5px]" aria-live="polite">
        <span className="text-muted">{step}</span>
        <span aria-hidden className="ex-progress" data-known={fraction != null || undefined}>
          <i style={fraction != null ? { transform: `scaleX(${Math.max(0.02, Math.min(1, fraction))})` } : undefined} />
        </span>
      </div>
    )
  }
  return (
    <div className="mt-4 flex min-h-5 items-center gap-2 text-[12.5px]" aria-live="polite">
      {error ? (
        <p className="text-danger">{error}</p>
      ) : busy ? (
        <>
          <Spinner size={13} className="text-muted" />
          <span className="text-muted">{step ?? 'Choose where to save it…'}</span>
        </>
      ) : null}
    </div>
  )
}

function ExportStoryDialog(): React.JSX.Element {
  const request = useExportDialogs((s) => s.story)
  const [outline, setOutline] = useState<Outline | null>(null)
  const [kind, setKind] = useState<ScopeKind>('story')
  const [chapterId, setChapterId] = useState<ID | null>(null)
  const [picked, setPicked] = useState<Set<ID>>(new Set())
  const [format, setFormat] = useState<ManuscriptFormat>(() => remembered(FORMAT_KEY, MANUSCRIPT_FORMATS.map((f) => f.value), 'docx'))
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [fraction, setFraction] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isNew = useNewLook()

  // A fresh start each time it opens: the whole story, the open scene's chapter ready under "One chapter".
  useEffect(() => {
    if (!request) return
    let live = true
    setOutline(null)
    setKind('story')
    setError(null)
    setStep(null)
    api
      .getOutline(request.storyId)
      .then((o) => {
        if (!live) return
        setOutline(o)
        setChapterId(o.chapters.some((c) => c.id === request.chapterId) ? request.chapterId : (o.chapters[0]?.id ?? null))
        setPicked(new Set(o.scenes.map((s) => s.id)))
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [request])

  const close = (): void => useExportDialogs.setState({ story: null })
  const scope = outline ? scopeOf(outline, kind, chapterId, picked) : null

  const run = async (): Promise<void> => {
    if (!request || !scope || busy) return
    const asked = request
    setBusy(true)
    setStep(null)
    setError(null)
    remember(FORMAT_KEY, format)
    try {
      await flushAll()
      const done = await withProgress((jobId) => api.exportStory({ jobId, storyId: asked.storyId, scope, format }), {
        onProgress: (p) => {
          setStep(progressText(p.step, p.fraction))
          setFraction(p.fraction)
        }
      })
      if (done) {
        announceExported(done)
        if (useExportDialogs.getState().story === asked) close()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  const title = outline?.story.title.trim() || 'Untitled story'
  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && close()}
      title="Export story"
      description={outline ? `“${title}”` : ' '}
      width={isNew ? 600 : 540}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!scope} onClick={() => void run()}>
            Export…
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted">What to export</span>
          <Segmented<ScopeKind>
            label="What to export"
            value={kind}
            onChange={(k) => {
              setKind(k)
              setError(null)
            }}
            options={[
              { value: 'story', label: 'Whole story' },
              { value: 'chapter', label: 'One chapter' },
              { value: 'selection', label: 'Choose…' }
            ]}
          />
        </div>
        {kind === 'chapter' ? (
          <Field label="Chapter">
            {(id) => (
              <Select
                id={id}
                value={chapterId}
                onChange={setChapterId}
                placeholder={outline?.chapters.length === 0 ? 'This story has no chapters yet' : 'Choose a chapter…'}
                options={(outline?.chapters ?? []).map((c) => ({ value: c.id, label: chapterLabel(outline!, c.id) }))}
              />
            )}
          </Field>
        ) : null}
        {kind === 'selection' && outline ? <ScenePicker outline={outline} picked={picked} onChange={setPicked} /> : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted">Format</span>
          {isNew ? (
            <FormatCards<ManuscriptFormat> label="Format" value={format} onChange={setFormat} options={MANUSCRIPT_FORMATS} />
          ) : (
            <Segmented<ManuscriptFormat> label="Format" value={format} onChange={setFormat} options={MANUSCRIPT_FORMATS} />
          )}
          <p className="text-[12px] text-faint">{MANUSCRIPT_FORMATS.find((f) => f.value === format)?.hint}</p>
        </div>
        <div className="flex flex-col items-start gap-1">
          <p className="text-[12px] leading-relaxed text-faint">
            Chapter headings, scene breaks, italics and bold are kept. Anything in Recently deleted is left out.
          </p>
          {request ? (
            <button
              type="button"
              className="text-[12px] text-muted underline underline-offset-2 hover:text-fg"
              onClick={() => openExportBible(request.storyId)}
            >
              Export the series bible instead
            </button>
          ) : null}
        </div>
      </div>
      <Status busy={busy} step={step} error={error} fraction={fraction} />
    </Dialog>
  )
}

/** A checkbox that can show "some" (a chapter with only some of its scenes picked). */
function Check({ state, onChange, label }: { state: 'all' | 'some' | 'none'; onChange: () => void; label: string }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      onChange={onChange}
      className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
    />
  )
}

function ScenePicker({ outline, picked, onChange }: { outline: Outline; picked: Set<ID>; onChange: (p: Set<ID>) => void }): React.JSX.Element {
  const count = outline.scenes.filter((s) => picked.has(s.id)).length
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted">Chapters and scenes</span>
        <span className="flex gap-3 text-[12px]">
          <button type="button" className="text-muted hover:text-fg" onClick={() => onChange(new Set(outline.scenes.map((s) => s.id)))}>
            All
          </button>
          <button type="button" className="text-muted hover:text-fg" onClick={() => onChange(new Set())}>
            None
          </button>
        </span>
      </div>
      <div role="group" aria-label="Chapters and scenes" className="max-h-[240px] overflow-y-auto rounded-md border border-line bg-page px-1 py-1">
        {outline.chapters.length === 0 ? <p className="px-2 py-1.5 text-[13px] text-faint">This story has no chapters yet.</p> : null}
        {outline.chapters.map((c) => {
          const label = chapterLabel(outline, c.id)
          const scenes = outline.scenes.filter((s) => s.chapterId === c.id)
          return (
            <div key={c.id}>
              <label className="flex h-7 items-center gap-2 rounded px-2 text-[13px] font-medium text-fg hover:bg-surface-2">
                <Check state={chapterPicked(outline, picked, c.id)} label={label} onChange={() => onChange(toggleChapter(outline, picked, c.id))} />
                <span className="truncate">{label}</span>
              </label>
              {scenes.map((s) => (
                <label key={s.id} className="flex h-7 items-center gap-2 rounded pl-7 pr-2 text-[13px] text-fg hover:bg-surface-2">
                  <Check state={picked.has(s.id) ? 'all' : 'none'} label={s.title || 'Untitled scene'} onChange={() => onChange(toggleScene(picked, s.id))} />
                  <span className="min-w-0 flex-1 truncate">{s.title || 'Untitled scene'}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-faint">
                    {s.wordCount ? `${s.wordCount.toLocaleString()} words` : 'No words yet'}
                  </span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
      <p className="text-[12px] text-faint">
        {count === 0 ? 'Pick at least one scene.' : `${count} of ${outline.scenes.length} scene${outline.scenes.length === 1 ? '' : 's'} picked.`}
      </p>
    </div>
  )
}

function ExportBibleDialog(): React.JSX.Element {
  const request = useExportDialogs((s) => s.bible)
  const stories = useApp((s) => s.stories)
  const [storyId, setStoryId] = useState<ID | null>(null)
  const [format, setFormat] = useState<BibleFormat>(() => remembered(BIBLE_FORMAT_KEY, BIBLE_FORMATS.map((f) => f.value), 'pdf'))
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  const [fraction, setFraction] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isNew = useNewLook()

  useEffect(() => {
    if (!request) return
    setStoryId(request.storyId)
    setError(null)
    setStep(null)
  }, [request])

  const close = (): void => useExportDialogs.setState({ bible: null })

  const run = async (): Promise<void> => {
    if (!request || !storyId || busy) return
    const asked = request
    setBusy(true)
    setStep(null)
    setError(null)
    remember(BIBLE_FORMAT_KEY, format)
    try {
      await flushAll()
      const done = await withProgress((jobId) => api.exportBible({ jobId, storyId, format }), {
        onProgress: (p) => {
          setStep(progressText(p.step, p.fraction))
          setFraction(p.fraction)
        }
      })
      if (done) {
        announceExported(done)
        if (useExportDialogs.getState().bible === asked) close()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => !o && close()}
      title="Export series bible"
      description="Your characters, places, lore and everything else in the codex, with the timeline and the plot threads."
      width={500}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!storyId} onClick={() => void run()}>
            Export…
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="As of the end of" hint="Each entry is shown as it stands when this story ends.">
          {(id) => (
            <Select
              id={id}
              value={storyId}
              onChange={setStoryId}
              options={stories.map((s) => ({ value: s.id, label: s.title.trim() || 'Untitled story' }))}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-muted">Format</span>
          {isNew ? (
            <FormatCards<BibleFormat> label="Format" value={format} onChange={setFormat} options={BIBLE_FORMATS} />
          ) : (
            <Segmented<BibleFormat> label="Format" value={format} onChange={setFormat} options={BIBLE_FORMATS} className="self-start" />
          )}
          <p className="text-[12px] text-faint">{BIBLE_FORMATS.find((f) => f.value === format)?.hint}</p>
        </div>
      </div>
      <Status busy={busy} step={step} error={error} fraction={fraction} />
    </Dialog>
  )
}
