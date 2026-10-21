// One icon set for the whole app: every icon goes through here. It draws Phosphor's two-tone (duotone) icons, filled
// when `selected` (the chosen area, row or tab) and for a solid shape (`fill="currentColor"`, the Stop square). Import
// icons from here by their names (`import { Check } from '@/components/ui/icons'`, the names Lucide gave them when the
// app drew Lucide's), or by name (`<Icon name="Check" />`). A new icon is one line in ICONS below (its Phosphor), then
// `node build/phosphor-icons.mjs` to add the Phosphor's shapes to phosphorShapes.ts.
import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from 'react'
import { PHOSPHOR, type Shape } from './phosphorShapes'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: string | number
  /** Selected or active (the chosen area, row or tab): filled. */
  selected?: boolean
}
export type IconType = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

/** Each icon: its Phosphor, and whether it is mirrored. */
const ICONS = {
  AlertTriangle: ['Warning'],
  AlignLeft: ['TextAlignLeft'],
  Archive: ['Archive'],
  ArrowDown: ['ArrowDown'],
  ArrowDownToLine: ['ArrowLineDown'],
  ArrowLeft: ['ArrowLeft'],
  ArrowLeftRight: ['ArrowsLeftRight'],
  ArrowRight: ['ArrowRight'],
  ArrowUpRight: ['ArrowUpRight'],
  AudioLines: ['Waveform'],
  BadgeCheck: ['SealCheck'],
  BetweenHorizontalStart: ['RowsPlusTop'],
  Bold: ['TextB'],
  BookA: ['BookBookmark'],
  BookOpen: ['BookOpen'],
  BookOpenText: ['BookOpenText'],
  BookPlus: ['Books'],
  BookmarkPlus: ['BookmarkSimple'],
  Brain: ['Brain'],
  CalendarDays: ['CalendarDots'],
  CalendarRange: ['CalendarBlank'],
  CaseSensitive: ['TextAa'],
  ChartColumn: ['ChartBar'],
  Check: ['Check'],
  CheckCircle2: ['CheckCircle'],
  ChevronDown: ['CaretDown'],
  ChevronLeft: ['CaretLeft'],
  ChevronRight: ['CaretRight'],
  ChevronUp: ['CaretUp'],
  ChevronsUpDown: ['CaretUpDown'],
  CircleAlert: ['WarningCircle'],
  CircleArrowUp: ['ArrowCircleUp'],
  CircleCheck: ['CheckCircle'],
  CircleDashed: ['CircleDashed'],
  CircleHelp: ['Question'],
  CircleSlash: ['Prohibit'],
  CircleX: ['XCircle'],
  ClipboardPaste: ['Clipboard'],
  ClipboardType: ['ClipboardText'],
  Clock: ['Clock'],
  CloudUpload: ['CloudArrowUp'],
  Coffee: ['Coffee'],
  Coins: ['Coins'],
  Columns3: ['Columns'],
  Compass: ['Compass'],
  CookingPot: ['CookingPot'],
  Copy: ['Copy'],
  CornerDownRight: ['ArrowBendDownRight'],
  Cpu: ['Cpu'],
  DoorOpen: ['DoorOpen'],
  Download: ['DownloadSimple'],
  Drama: ['MaskHappy'],
  Droplet: ['Drop'],
  Ear: ['Ear'],
  ExternalLink: ['ArrowSquareOut'],
  Eye: ['Eye'],
  EyeOff: ['EyeSlash'],
  Feather: ['Feather'],
  FileArchive: ['FileArchive'],
  FileDown: ['FileArrowDown'],
  FilePlus2: ['FilePlus'],
  FileSearch: ['FileMagnifyingGlass'],
  FileText: ['FileText'],
  FileUp: ['FileArrowUp'],
  FileX2: ['FileX'],
  Flag: ['Flag'],
  Flame: ['Fire'],
  Focus: ['FrameCorners'],
  FoldVertical: ['ArrowsInLineVertical'],
  Folder: ['Folder'],
  FolderInput: ['FolderSimple'],
  FolderOpen: ['FolderOpen'],
  FolderPlus: ['FolderPlus'],
  FolderX: ['FolderMinus'],
  Gem: ['Diamond'],
  Ghost: ['Ghost'],
  Globe2: ['GlobeHemisphereWest'],
  GripVertical: ['DotsSixVertical'],
  Hand: ['Hand'],
  Handshake: ['Handshake'],
  HardDrive: ['HardDrive'],
  HardDriveDownload: ['HardDrives'],
  Headphones: ['Headphones'],
  Heart: ['Heart'],
  History: ['ClockCounterClockwise'],
  IdCard: ['IdentificationCard'],
  Hourglass: ['Hourglass'],
  House: ['House'],
  ImagePlus: ['Image'],
  Info: ['Info'],
  Italic: ['TextItalic'],
  KeyRound: ['Key'],
  Keyboard: ['Keyboard'],
  Landmark: ['Bank'],
  Laugh: ['Smiley'],
  Layers: ['Stack'],
  LayoutGrid: ['SquaresFour'],
  LibraryBig: ['Books'],
  Lightbulb: ['Lightbulb'],
  List: ['ListBullets'],
  Link2: ['LinkSimple'],
  ListChecks: ['ListChecks'],
  ListOrdered: ['ListNumbers'],
  ListPlus: ['ListPlus'],
  ListRestart: ['ArrowCounterClockwise'],
  ListTree: ['TreeStructure'],
  Lock: ['Lock'],
  MapPin: ['MapPin'],
  Maximize: ['CornersOut'],
  Merge: ['GitMerge'],
  MessageCircle: ['ChatCircle'],
  MessageCircleMore: ['ChatCircleDots'],
  MessageCircleQuestion: ['ChatTeardropDots'],
  MessageSquareQuote: ['Quotes'],
  MessageSquareWarning: ['ChatCenteredText'],
  MessagesSquare: ['Chats'],
  Mic: ['Microphone'],
  Minus: ['Minus'],
  Monitor: ['Monitor'],
  Mountain: ['Mountains'],
  Moon: ['Moon'],
  MoreHorizontal: ['DotsThree'],
  Network: ['Graph'],
  NotebookText: ['Notebook'],
  Palette: ['Palette'],
  PanelLeft: ['SidebarSimple'],
  PanelRight: ['SidebarSimple', true],
  Pause: ['Pause'],
  PenLine: ['PencilSimpleLine'],
  Pilcrow: ['Paragraph'],
  Pencil: ['PencilSimple'],
  Pin: ['PushPin'],
  PinOff: ['PushPinSlash'],
  Play: ['Play'],
  Plus: ['Plus'],
  RefreshCw: ['ArrowClockwise'],
  Repeat2: ['Repeat'],
  Rocket: ['Rocket'],
  RotateCcw: ['ArrowCounterClockwise'],
  Rows3: ['Rows'],
  Scissors: ['Scissors'],
  ScrollText: ['Scroll'],
  Search: ['MagnifyingGlass'],
  SearchCheck: ['ListMagnifyingGlass'],
  SearchX: ['MagnifyingGlassMinus'],
  Send: ['PaperPlaneRight'],
  SeparatorHorizontal: ['ArrowsOutLineVertical'],
  Server: ['HardDrives'],
  Settings: ['Gear'],
  Settings2: ['GearSix'],
  ShieldCheck: ['ShieldCheck'],
  Shrink: ['ArrowsIn'],
  Shuffle: ['Shuffle'],
  SkipBack: ['SkipBack'],
  SkipForward: ['SkipForward'],
  SlidersHorizontal: ['SlidersHorizontal'],
  Sparkles: ['Sparkle'],
  Spool: ['Yarn'],
  Square: ['Stop'],
  SquarePen: ['NotePencil'],
  SquareStack: ['Cards'],
  Star: ['Star'],
  StickyNote: ['Note'],
  Sun: ['Sun'],
  Swords: ['Sword'],
  Target: ['Target'],
  TextQuote: ['Quotes'],
  Timer: ['Timer'],
  Trash2: ['Trash'],
  TextCursorInput: ['CursorText'],
  Type: ['TextT'],
  Undo2: ['ArrowUUpLeft'],
  UnfoldVertical: ['ArrowsOutLineVertical'],
  Unlink: ['LinkBreak'],
  UserPlus: ['UserPlus'],
  UserRound: ['User'],
  UserRoundPen: ['UserGear'],
  Users: ['Users'],
  Volume2: ['SpeakerHigh'],
  VolumeX: ['SpeakerSlash'],
  WandSparkles: ['MagicWand'],
  Wrench: ['Wrench'],
  Waves: ['Waves'],
  X: ['X'],
  Zap: ['Lightning'],
  ZoomIn: ['MagnifyingGlassPlus'],
  ZoomOut: ['MagnifyingGlassMinus'],
} as const satisfies Record<string, readonly [string, true?]>

export type IconName = keyof typeof ICONS

const draw = (shapes: Shape[]): React.ReactNode[] =>
  shapes.map(([tag, attrs, children], i) => createElement(tag, { key: i, ...attrs }, children ? draw(children) : undefined))

function make(name: IconName): IconType {
  const [phosphor, mirrored] = ICONS[name] as readonly [string, true?]
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({ selected, ...props }, ref) {
    // A stroke width means nothing to a filled shape; a solid fill asks for the filled weight.
    const { size = 24, strokeWidth: _stroke, fill, color = 'currentColor', ...rest } = props
    const shapes = PHOSPHOR[phosphor][selected || fill === 'currentColor' ? 'fill' : 'duotone']
    return createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 256 256',
        'aria-hidden': true,
        ...rest,
        ref,
        width: size,
        height: size,
        fill: color,
        transform: mirrored ? 'scale(-1, 1)' : undefined
      },
      draw(shapes)
    )
  })
  Icon.displayName = name
  return Icon
}

/** An icon by name: <Icon name="Check" size={14} />. */
export const Icon = forwardRef<SVGSVGElement, IconProps & { name: IconName }>(function Icon({ name, ...props }, ref) {
  return createElement(BY_NAME[name], { ...props, ref })
})

const BY_NAME = Object.fromEntries(Object.keys(ICONS).map((n) => [n, make(n as IconName)])) as Record<IconName, IconType>

export const AlertTriangle = BY_NAME.AlertTriangle
export const AlignLeft = BY_NAME.AlignLeft
export const Archive = BY_NAME.Archive
export const ArrowDown = BY_NAME.ArrowDown
export const ArrowDownToLine = BY_NAME.ArrowDownToLine
export const ArrowLeft = BY_NAME.ArrowLeft
export const ArrowLeftRight = BY_NAME.ArrowLeftRight
export const ArrowRight = BY_NAME.ArrowRight
export const ArrowUpRight = BY_NAME.ArrowUpRight
export const AudioLines = BY_NAME.AudioLines
export const BadgeCheck = BY_NAME.BadgeCheck
export const BetweenHorizontalStart = BY_NAME.BetweenHorizontalStart
export const Bold = BY_NAME.Bold
export const BookA = BY_NAME.BookA
export const BookOpen = BY_NAME.BookOpen
export const BookOpenText = BY_NAME.BookOpenText
export const BookPlus = BY_NAME.BookPlus
export const BookmarkPlus = BY_NAME.BookmarkPlus
export const Brain = BY_NAME.Brain
export const CalendarDays = BY_NAME.CalendarDays
export const CalendarRange = BY_NAME.CalendarRange
export const CaseSensitive = BY_NAME.CaseSensitive
export const ChartColumn = BY_NAME.ChartColumn
export const Check = BY_NAME.Check
export const CheckCircle2 = BY_NAME.CheckCircle2
export const ChevronDown = BY_NAME.ChevronDown
export const ChevronLeft = BY_NAME.ChevronLeft
export const ChevronRight = BY_NAME.ChevronRight
export const ChevronUp = BY_NAME.ChevronUp
export const ChevronsUpDown = BY_NAME.ChevronsUpDown
export const CircleAlert = BY_NAME.CircleAlert
export const CircleArrowUp = BY_NAME.CircleArrowUp
export const CircleCheck = BY_NAME.CircleCheck
export const CircleDashed = BY_NAME.CircleDashed
export const CircleHelp = BY_NAME.CircleHelp
export const CircleSlash = BY_NAME.CircleSlash
export const CircleX = BY_NAME.CircleX
export const ClipboardPaste = BY_NAME.ClipboardPaste
export const ClipboardType = BY_NAME.ClipboardType
export const Clock = BY_NAME.Clock
export const CloudUpload = BY_NAME.CloudUpload
export const Coffee = BY_NAME.Coffee
export const Coins = BY_NAME.Coins
export const Columns3 = BY_NAME.Columns3
export const Compass = BY_NAME.Compass
export const CookingPot = BY_NAME.CookingPot
export const Copy = BY_NAME.Copy
export const CornerDownRight = BY_NAME.CornerDownRight
export const Cpu = BY_NAME.Cpu
export const DoorOpen = BY_NAME.DoorOpen
export const Download = BY_NAME.Download
export const Drama = BY_NAME.Drama
export const Droplet = BY_NAME.Droplet
export const Ear = BY_NAME.Ear
export const ExternalLink = BY_NAME.ExternalLink
export const Eye = BY_NAME.Eye
export const EyeOff = BY_NAME.EyeOff
export const Feather = BY_NAME.Feather
export const FileArchive = BY_NAME.FileArchive
export const FileDown = BY_NAME.FileDown
export const FilePlus2 = BY_NAME.FilePlus2
export const FileSearch = BY_NAME.FileSearch
export const FileText = BY_NAME.FileText
export const FileUp = BY_NAME.FileUp
export const FileX2 = BY_NAME.FileX2
export const Flag = BY_NAME.Flag
export const Flame = BY_NAME.Flame
export const Focus = BY_NAME.Focus
export const FoldVertical = BY_NAME.FoldVertical
export const Folder = BY_NAME.Folder
export const FolderInput = BY_NAME.FolderInput
export const FolderOpen = BY_NAME.FolderOpen
export const FolderPlus = BY_NAME.FolderPlus
export const FolderX = BY_NAME.FolderX
export const Gem = BY_NAME.Gem
export const Ghost = BY_NAME.Ghost
export const Globe2 = BY_NAME.Globe2
export const GripVertical = BY_NAME.GripVertical
export const Hand = BY_NAME.Hand
export const Handshake = BY_NAME.Handshake
export const HardDrive = BY_NAME.HardDrive
export const HardDriveDownload = BY_NAME.HardDriveDownload
export const Headphones = BY_NAME.Headphones
export const Heart = BY_NAME.Heart
export const History = BY_NAME.History
export const IdCard = BY_NAME.IdCard
export const Hourglass = BY_NAME.Hourglass
export const House = BY_NAME.House
export const ImagePlus = BY_NAME.ImagePlus
export const Info = BY_NAME.Info
export const Italic = BY_NAME.Italic
export const KeyRound = BY_NAME.KeyRound
export const Keyboard = BY_NAME.Keyboard
export const Landmark = BY_NAME.Landmark
export const Laugh = BY_NAME.Laugh
export const Layers = BY_NAME.Layers
export const LayoutGrid = BY_NAME.LayoutGrid
export const LibraryBig = BY_NAME.LibraryBig
export const Lightbulb = BY_NAME.Lightbulb
export const List = BY_NAME.List
export const Link2 = BY_NAME.Link2
export const ListChecks = BY_NAME.ListChecks
export const ListOrdered = BY_NAME.ListOrdered
export const ListPlus = BY_NAME.ListPlus
export const ListRestart = BY_NAME.ListRestart
export const ListTree = BY_NAME.ListTree
export const Lock = BY_NAME.Lock
export const MapPin = BY_NAME.MapPin
export const Maximize = BY_NAME.Maximize
export const Merge = BY_NAME.Merge
export const MessageCircle = BY_NAME.MessageCircle
export const MessageCircleMore = BY_NAME.MessageCircleMore
export const MessageCircleQuestion = BY_NAME.MessageCircleQuestion
export const MessageSquareQuote = BY_NAME.MessageSquareQuote
export const MessageSquareWarning = BY_NAME.MessageSquareWarning
export const MessagesSquare = BY_NAME.MessagesSquare
export const Mic = BY_NAME.Mic
export const Minus = BY_NAME.Minus
export const Monitor = BY_NAME.Monitor
export const Mountain = BY_NAME.Mountain
export const Moon = BY_NAME.Moon
export const MoreHorizontal = BY_NAME.MoreHorizontal
export const Network = BY_NAME.Network
export const NotebookText = BY_NAME.NotebookText
export const Palette = BY_NAME.Palette
export const PanelLeft = BY_NAME.PanelLeft
export const PanelRight = BY_NAME.PanelRight
export const Pause = BY_NAME.Pause
export const PenLine = BY_NAME.PenLine
export const Pilcrow = BY_NAME.Pilcrow
export const Pencil = BY_NAME.Pencil
export const Pin = BY_NAME.Pin
export const PinOff = BY_NAME.PinOff
export const Play = BY_NAME.Play
export const Plus = BY_NAME.Plus
export const RefreshCw = BY_NAME.RefreshCw
export const Repeat2 = BY_NAME.Repeat2
export const Rocket = BY_NAME.Rocket
export const RotateCcw = BY_NAME.RotateCcw
export const Rows3 = BY_NAME.Rows3
export const Scissors = BY_NAME.Scissors
export const ScrollText = BY_NAME.ScrollText
export const Search = BY_NAME.Search
export const SearchCheck = BY_NAME.SearchCheck
export const SearchX = BY_NAME.SearchX
export const Send = BY_NAME.Send
export const SeparatorHorizontal = BY_NAME.SeparatorHorizontal
export const Server = BY_NAME.Server
export const Settings = BY_NAME.Settings
export const Settings2 = BY_NAME.Settings2
export const ShieldCheck = BY_NAME.ShieldCheck
export const Shrink = BY_NAME.Shrink
export const Shuffle = BY_NAME.Shuffle
export const SkipBack = BY_NAME.SkipBack
export const SkipForward = BY_NAME.SkipForward
export const SlidersHorizontal = BY_NAME.SlidersHorizontal
export const Sparkles = BY_NAME.Sparkles
export const Spool = BY_NAME.Spool
export const Square = BY_NAME.Square
export const SquarePen = BY_NAME.SquarePen
export const SquareStack = BY_NAME.SquareStack
export const Star = BY_NAME.Star
export const StickyNote = BY_NAME.StickyNote
export const Sun = BY_NAME.Sun
export const Swords = BY_NAME.Swords
export const Target = BY_NAME.Target
export const TextQuote = BY_NAME.TextQuote
export const Timer = BY_NAME.Timer
export const Trash2 = BY_NAME.Trash2
export const TextCursorInput = BY_NAME.TextCursorInput
export const Type = BY_NAME.Type
export const Undo2 = BY_NAME.Undo2
export const UnfoldVertical = BY_NAME.UnfoldVertical
export const Unlink = BY_NAME.Unlink
export const UserPlus = BY_NAME.UserPlus
export const UserRound = BY_NAME.UserRound
export const UserRoundPen = BY_NAME.UserRoundPen
export const Users = BY_NAME.Users
export const Volume2 = BY_NAME.Volume2
export const VolumeX = BY_NAME.VolumeX
export const WandSparkles = BY_NAME.WandSparkles
export const Wrench = BY_NAME.Wrench
export const Waves = BY_NAME.Waves
export const X = BY_NAME.X
export const Zap = BY_NAME.Zap
export const ZoomIn = BY_NAME.ZoomIn
export const ZoomOut = BY_NAME.ZoomOut
