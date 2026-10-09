// Each builder step's icon on the steps' rail and in the Review's cards (the app's icons: Phosphor's two-tone in the
// New look, Lucide in Classic), by kind and step.
import {
  BadgeCheck,
  Drama,
  Ear,
  Flag,
  Gem,
  Handshake,
  History,
  Hourglass,
  IdCard,
  KeyRound,
  MapPin,
  MessageSquareQuote,
  Mountain,
  ScrollText,
  Target,
  Users,
  Zap,
  Compass,
  Eye,
  type IconType
} from '@/components/ui/icons'
import type { BuilderKind } from '@shared/contracts/builder'

const ICONS: Record<BuilderKind, Record<string, IconType>> = {
  character: {
    basics: IdCard,
    looks: Eye,
    personality: Drama,
    backstory: KeyRound,
    arc: Compass,
    voice: MessageSquareQuote,
    relationships: Handshake,
    review: BadgeCheck
  },
  place: { basics: MapPin, look: Mountain, senses: Ear, history: ScrollText, people: Users, review: BadgeCheck },
  group: { basics: Flag, goals: Target, ways: Handshake, review: BadgeCheck },
  item: { basics: Gem, powers: Zap, origin: Hourglass, review: BadgeCheck }
}

/** The icon for a step (a quiet clock for any step not named here). */
export const stepIcon = (kind: BuilderKind, stepId: string): IconType => ICONS[kind][stepId] ?? History
