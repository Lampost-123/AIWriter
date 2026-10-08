// Small marks the desk's Check room shares (UI overhaul, Check room): how serious an issue is, in form (an icon and a
// word, in the severity's ink: red only for must fix), each kind of issue's icon, and a link to an entry drawn as a tiny
// card with the entry's own drawing (the world's drawing library) on its kind's tint.
import type { ReactNode } from 'react'
import type { IssueKind, IssueSeverity } from '@shared/contracts/checks'
import type { EntryKind, ID } from '@shared/types'
import {
  BookOpen,
  Brain,
  CircleAlert,
  Clock,
  Eye,
  Feather,
  LibraryBig,
  Link2,
  MessageSquareQuote,
  Palette,
  Repeat2,
  Spool,
  TextQuote,
  Type,
  type IconType
} from '@/components/ui/icons'
import { Motif } from '@/components/art/Motif'
import { cn } from '@/lib/cn'
import { useArt, useEntryMotifs } from '@/features/world/art/artStore'
import { KIND_ICONS } from '@/features/world/kindIcons'

export const SEVERITY_ICONS: Record<IssueSeverity, IconType> = { 'must-fix': CircleAlert, warning: Eye, minor: Feather }

export const ISSUE_KIND_ICONS: Record<IssueKind, IconType> = {
  fact: BookOpen,
  knowledge: Brain,
  timeline: Clock,
  voice: MessageSquareQuote,
  style: Palette,
  continuity: Link2,
  thread: Spool,
  story: LibraryBig,
  phrase: TextQuote,
  repetition: Repeat2,
  spelling: Type
}

/** The severity as a small pill: its icon and its word, in its ink. */
export function SeverityPill({ severity, children }: { severity: IssueSeverity; children: ReactNode }): React.JSX.Element {
  const Icon = SEVERITY_ICONS[severity]
  return (
    <span className="ck-sev" data-severity={severity}>
      <Icon size={13} aria-hidden />
      {children}
    </span>
  )
}

const KIND_CLASS: Record<EntryKind, string> = {
  character: 'em-char',
  place: 'em-place',
  group: 'em-group',
  item: 'em-item',
  lore: 'em-lore',
  event: 'em-event',
  thread: 'em-thread',
  glossary: 'em-gloss'
}

/** Each entry's kind and drawing, by id (from the world's entries as the drawing library reads them). */
export function useEntryLook(): (id: ID) => { kind: EntryKind | null; motif: string | null } {
  const motifs = useEntryMotifs()
  const entries = useArt((s) => s.listed.entries)
  const kinds = new Map(entries.map((e) => [e.id, e.kind]))
  return (id) => ({ kind: kinds.get(id) ?? null, motif: motifs.get(id) ?? null })
}

/** An entry as a small card: its drawing on its kind's tint, then its name (and what about it). */
export function EntryMark({
  kind,
  motif,
  name,
  detail,
  onClick,
  title,
  className,
  style
}: {
  kind: EntryKind | null
  motif: string | null
  name: string
  detail?: string | null
  onClick?: () => void
  title?: string
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const Icon = kind ? KIND_ICONS[kind] : BookOpen
  const body = (
    <>
      <span className="em-tile" aria-hidden>
        {motif ? <Motif id={motif} size={18} /> : <Icon size={13} />}
      </span>
      <span className="em-name">{name}</span>
      {detail ? <span className="em-detail">{detail}</span> : null}
    </>
  )
  const cls = cn('entry-mark', kind ? KIND_CLASS[kind] : 'em-none', className)
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title} style={style}>
      {body}
    </button>
  ) : (
    <span className={cls} title={title} style={style}>
      {body}
    </span>
  )
}
