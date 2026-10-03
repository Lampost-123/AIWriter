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
