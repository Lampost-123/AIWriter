import { BookA, CalendarDays, Flag, Gem, MapPin, ScrollText, Spool, Users, type IconType } from '@/components/ui/icons'
import type { EntryKind } from '@shared/types'

/** One icon per kind of world entry, used wherever a kind is shown (the binder, empty pages, pickers). */
export const KIND_ICONS: Record<EntryKind, IconType> = {
  character: Users,
  place: MapPin,
  group: Flag,
  item: Gem,
  lore: ScrollText,
  event: CalendarDays,
  thread: Spool,
  glossary: BookA
}

/**
 * The New look: each kind's ink (styles.css, --k-*), for a kind's tile (its icon on its own soft tint), its words,
 * and a card's top edge. Whole class names, so Tailwind finds them. In Classic the inks are the quiet greys of before.
 */
export const KIND_INK: Record<EntryKind, { tile: string; text: string; edge: string; soft: string }> = {
  character: { tile: 'bg-k-char-soft text-k-char', text: 'text-k-char', edge: 'bg-k-char', soft: 'bg-k-char-soft' },
  place: { tile: 'bg-k-place-soft text-k-place', text: 'text-k-place', edge: 'bg-k-place', soft: 'bg-k-place-soft' },
  group: { tile: 'bg-k-group-soft text-k-group', text: 'text-k-group', edge: 'bg-k-group', soft: 'bg-k-group-soft' },
  item: { tile: 'bg-k-item-soft text-k-item', text: 'text-k-item', edge: 'bg-k-item', soft: 'bg-k-item-soft' },
  lore: { tile: 'bg-k-lore-soft text-k-lore', text: 'text-k-lore', edge: 'bg-k-lore', soft: 'bg-k-lore-soft' },
  event: { tile: 'bg-k-event-soft text-k-event', text: 'text-k-event', edge: 'bg-k-event', soft: 'bg-k-event-soft' },
  thread: { tile: 'bg-k-thread-soft text-k-thread', text: 'text-k-thread', edge: 'bg-k-thread', soft: 'bg-k-thread-soft' },
  glossary: { tile: 'bg-k-gloss-soft text-k-gloss', text: 'text-k-gloss', edge: 'bg-k-gloss', soft: 'bg-k-gloss-soft' }
}
