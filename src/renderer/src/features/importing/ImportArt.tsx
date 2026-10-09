// The import page in the New look (UI overhaul, "first run, Settings and moving work in and out"):
// - DropZone: where a manuscript goes. A drawing of a manuscript on the desk; drop a .docx, .md or .txt on it (it
//   reads it as Choose a file does) or press Choose a file. A file held over it lifts the pages and lights the edge.
// - Turning: while a file is read, its pages turn one after another (a loop of about a second; still with less motion).
// - InkProgress: the memory reading an imported story, as a row of small pages, one a scene, that fill with the AI's
//   amber ink as they are read; the one being read glows. A story too long for a page each shows chapters' worth.
// - Imported: what came in, as cards (the story's book, its chapters, scenes and words).
import { useState } from 'react'
import type { CatchUpProgress, ImportResult } from '@shared/contracts/importing'
import { FileUp } from '@/components/ui/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { wordsText } from './split'
import './importing.css'

const ACCEPTED = /\.(docx|md|markdown|txt)$/i

export function DropZone({ reading, onChoose, onDrop }: { reading: boolean; onChoose: () => void; onDrop: (path: string) => void }): React.JSX.Element {
  const [over, setOver] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <div
      data-drop-zone
      data-over={over || undefined}
      data-reading={reading || undefined}
      className="im-drop mt-6 flex flex-col items-center px-8 pb-9 pt-8 text-center"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = e.dataTransfer.files[0]
        if (!file) return
        if (!ACCEPTED.test(file.name)) {
          setProblem('That isn’t a Word, Markdown or text file. Drop a .docx, .md or .txt.')
          return
        }
        const path = window.aiwrite.pathForFile?.(file) ?? ''
        if (!path) {
          setProblem('That file couldn’t be read from here. Use Choose a file instead.')
          return
        }
        setProblem(null)
        onDrop(path)
      }}
    >
      {reading ? <Turning /> : <Manuscript />}
      <p className="mt-5 font-heading text-[19px] font-semibold text-fg">{reading ? 'Reading the file…' : 'Drop a manuscript here'}</p>
      <p className="mt-1.5 max-w-[440px] text-[13px] leading-relaxed text-muted">
        A Word (.docx), Markdown (.md) or text (.txt) file. Chapters are found by their headings (“Chapter 12”, “Prologue”, Word’s heading
        styles), and scenes by breaks like * * *.
      </p>
      <Button variant="primary" size="lg" className="mt-5" icon={<FileUp size={15} />} loading={reading} onClick={onChoose}>
        {reading ? 'Reading the file…' : 'Choose a file…'}
      </Button>
      {problem ? <p className="mt-3 text-[12.5px] text-danger">{problem}</p> : null}
    </div>
  )
}

/** A manuscript on the desk: a few pages, the top one written on, a paper clip. */
function Manuscript(): React.JSX.Element {
  return (
    <span aria-hidden className="im-ms">
      <i className="im-ms-sheet is-3" />
      <i className="im-ms-sheet is-2" />
      <i className="im-ms-sheet is-1">
        <b className="im-ms-title" />
        <b />
        <b />
        <b />
        <b className="is-short" />
      </i>
      <i className="im-ms-clip" />
    </span>
  )
}

/** Pages turning, one after another, while the file is read. */
export function Turning(): React.JSX.Element {
  return (
    <span aria-hidden className="im-turn">
      <i className="im-turn-base" />
      <i className="im-turn-page" />
      <i className="im-turn-page" />
      <i className="im-turn-page" />
    </span>
  )
}

/** How many small pages the progress draws: one a scene, up to this many. */
const MAX_PAGES = 72

/** The memory reading the story: small pages filling with amber ink, the one being read glowing. */
export function InkProgress({ run }: { run: CatchUpProgress }): React.JSX.Element {
  const total = Math.max(1, run.scenes)
  const per = Math.max(1, Math.ceil(total / MAX_PAGES))
  const pages = Math.ceil(total / per)
  const filled = run.read / per
  const share = Math.min(1, run.read / total)
  return (
    <div className="im-ink" aria-hidden>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-heading text-[30px] font-semibold leading-none tabular-nums text-fg">{Math.round(share * 100)}%</span>
        <span className="text-[12px] text-faint">{per > 1 ? `Each page is ${per} scenes` : 'Each page is a scene'}</span>
      </div>
      <div className="im-ink-pages mt-3">
        {Array.from({ length: pages }, (_, i) => {
          const f = Math.max(0, Math.min(1, filled - i))
          const now = run.status === 'reading' && i === Math.floor(filled) && f < 1
          return (
            <span key={i} className={cn('im-ink-page', f >= 1 && 'is-full', now && 'is-now')}>
              <i style={{ height: `${f * 100}%` }} />
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** What came in, as cards: the story's book, then its chapters, scenes and words. */
export function Imported({ title, result }: { title: string; result: ImportResult }): React.JSX.Element {
  const stats: { label: string; value: string }[] = [
    ...(result.acts ? [{ label: result.acts === 1 ? 'Act' : 'Acts', value: result.acts.toLocaleString('en-US') }] : []),
    { label: result.chapters === 1 ? 'Chapter' : 'Chapters', value: result.chapters.toLocaleString('en-US') },
    { label: result.scenes === 1 ? 'Scene' : 'Scenes', value: result.scenes.toLocaleString('en-US') },
    { label: 'Words', value: result.words.toLocaleString('en-US') }
  ]
  return (
    <div className="@container mt-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="im-card im-story col-span-3 flex items-center gap-4 p-4" style={{ animationDelay: '0ms' }}>
          <span aria-hidden className="im-book">
            <i />
            <b>{title}</b>
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">New story</p>
            <p className="truncate font-heading text-[18px] font-semibold text-fg" title={title}>
              {title}
            </p>
            <p className="text-[12px] text-muted">{wordsText(result.words)}</p>
          </div>
        </div>
        {stats.slice(-3).map((s, i) => (
          <div key={s.label} className="im-card p-4" style={{ animationDelay: `${(i + 1) * 60}ms` }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{s.label}</p>
            <p className="mt-1 font-heading text-[28px] font-semibold leading-none tabular-nums text-fg">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
