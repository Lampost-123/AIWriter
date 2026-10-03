// One icon set for the whole app (the New look): every icon goes through here. Classic draws today's Lucide line icons,
// exactly as before; the New look draws Phosphor's two-tone (duotone) icons, filled when `selected` (the chosen area,
// row or tab) and for a solid shape (`fill="currentColor"`, the Stop square). Import icons from here, never from
// lucide-react directly, by their Lucide names (`import { Check } from '@/components/ui/icons'`),
// or by name (`<Icon name="Check" />`). A new icon is one line in ICONS below (its Lucide and its Phosphor), then
// `node build/phosphor-icons.mjs` to add the Phosphor's shapes to phosphorShapes.ts.
import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes } from 'react'
import * as L from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import { PHOSPHOR, type Shape } from './phosphorShapes'
import { useLook } from '@/features/look/look'

export interface IconProps extends LucideProps {
  /** Selected or active (the chosen area, row or tab): filled in the New look. */
  selected?: boolean
}
export type IconType = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

/** Each icon: its Lucide (Classic), its Phosphor (the New look), and whether the Phosphor is mirrored. */
const ICONS = {
  AlertTriangle: [L.AlertTriangle, 'Warning'],
  AlignLeft: [L.AlignLeft, 'TextAlignLeft'],
  Archive: [L.Archive, 'Archive'],
  ArrowDown: [L.ArrowDown, 'ArrowDown'],
  ArrowDownToLine: [L.ArrowDownToLine, 'ArrowLineDown'],
  ArrowLeft: [L.ArrowLeft, 'ArrowLeft'],
  ArrowRight: [L.ArrowRight, 'ArrowRight'],
  ArrowUpRight: [L.ArrowUpRight, 'ArrowUpRight'],
  AudioLines: [L.AudioLines, 'Waveform'],
  BetweenHorizontalStart: [L.BetweenHorizontalStart, 'RowsPlusTop'],
  Bold: [L.Bold, 'TextB'],
  BookA: [L.BookA, 'BookBookmark'],
  BookOpen: [L.BookOpen, 'BookOpen'],
  BookOpenText: [L.BookOpenText, 'BookOpenText'],
  BookPlus: [L.BookPlus, 'Books'],
  BookmarkPlus: [L.BookmarkPlus, 'BookmarkSimple'],
  Brain: [L.Brain, 'Brain'],
  CalendarDays: [L.CalendarDays, 'CalendarDots'],
  CalendarRange: [L.CalendarRange, 'CalendarBlank'],
  ChartColumn: [L.ChartColumn, 'ChartBar'],
  Check: [L.Check, 'Check'],
  CheckCircle2: [L.CheckCircle2, 'CheckCircle'],
  ChevronDown: [L.ChevronDown, 'CaretDown'],
  ChevronLeft: [L.ChevronLeft, 'CaretLeft'],
  ChevronRight: [L.ChevronRight, 'CaretRight'],
  ChevronUp: [L.ChevronUp, 'CaretUp'],
  ChevronsUpDown: [L.ChevronsUpDown, 'CaretUpDown'],
  CircleAlert: [L.CircleAlert, 'WarningCircle'],
  CircleArrowUp: [L.CircleArrowUp, 'ArrowCircleUp'],
  CircleCheck: [L.CircleCheck, 'CheckCircle'],
  CircleDashed: [L.CircleDashed, 'CircleDashed'],
  ClipboardPaste: [L.ClipboardPaste, 'Clipboard'],
  ClipboardType: [L.ClipboardType, 'ClipboardText'],
  Clock: [L.Clock, 'Clock'],
  CloudUpload: [L.CloudUpload, 'CloudArrowUp'],
  Coffee: [L.Coffee, 'Coffee'],
  Coins: [L.Coins, 'Coins'],
  Columns3: [L.Columns3, 'Columns'],
  Compass: [L.Compass, 'Compass'],
  CookingPot: [L.CookingPot, 'CookingPot'],
  Copy: [L.Copy, 'Copy'],
  Cpu: [L.Cpu, 'Cpu'],
  DoorOpen: [L.DoorOpen, 'DoorOpen'],
  Download: [L.Download, 'DownloadSimple'],
  Drama: [L.Drama, 'MaskHappy'],
  Droplet: [L.Droplet, 'Drop'],
  ExternalLink: [L.ExternalLink, 'ArrowSquareOut'],
  Eye: [L.Eye, 'Eye'],
  EyeOff: [L.EyeOff, 'EyeSlash'],
  Feather: [L.Feather, 'Feather'],
  FileArchive: [L.FileArchive, 'FileArchive'],
  FileDown: [L.FileDown, 'FileArrowDown'],
  FilePlus2: [L.FilePlus2, 'FilePlus'],
  FileSearch: [L.FileSearch, 'FileMagnifyingGlass'],
  FileText: [L.FileText, 'FileText'],
  FileUp: [L.FileUp, 'FileArrowUp'],
  FileX2: [L.FileX2, 'FileX'],
  Flag: [L.Flag, 'Flag'],
  Flame: [L.Flame, 'Fire'],
  Focus: [L.Focus, 'FrameCorners'],
  FoldVertical: [L.FoldVertical, 'ArrowsInLineVertical'],
  Folder: [L.Folder, 'Folder'],
  FolderInput: [L.FolderInput, 'FolderSimple'],
  FolderOpen: [L.FolderOpen, 'FolderOpen'],
  FolderPlus: [L.FolderPlus, 'FolderPlus'],
  FolderX: [L.FolderX, 'FolderMinus'],
  Gem: [L.Gem, 'Diamond'],
  Ghost: [L.Ghost, 'Ghost'],
  Globe2: [L.Globe2, 'GlobeHemisphereWest'],
  GripVertical: [L.GripVertical, 'DotsSixVertical'],
  Hand: [L.Hand, 'Hand'],
  HardDrive: [L.HardDrive, 'HardDrive'],
  HardDriveDownload: [L.HardDriveDownload, 'HardDrives'],
  Headphones: [L.Headphones, 'Headphones'],
  Heart: [L.Heart, 'Heart'],
  History: [L.History, 'ClockCounterClockwise'],
  Hourglass: [L.Hourglass, 'Hourglass'],
  House: [L.House, 'House'],
  ImagePlus: [L.ImagePlus, 'Image'],
  Info: [L.Info, 'Info'],
  Italic: [L.Italic, 'TextItalic'],
  KeyRound: [L.KeyRound, 'Key'],
  Keyboard: [L.Keyboard, 'Keyboard'],
  Landmark: [L.Landmark, 'Bank'],
  Laugh: [L.Laugh, 'Smiley'],
  Layers: [L.Layers, 'Stack'],
  LayoutGrid: [L.LayoutGrid, 'SquaresFour'],
  LibraryBig: [L.LibraryBig, 'Books'],
  Lightbulb: [L.Lightbulb, 'Lightbulb'],
  Link2: [L.Link2, 'LinkSimple'],
  ListChecks: [L.ListChecks, 'ListChecks'],
  ListOrdered: [L.ListOrdered, 'ListNumbers'],
  ListRestart: [L.ListRestart, 'ArrowCounterClockwise'],
  ListTree: [L.ListTree, 'TreeStructure'],
  Lock: [L.Lock, 'Lock'],
  MapPin: [L.MapPin, 'MapPin'],
  Maximize: [L.Maximize, 'CornersOut'],
  Merge: [L.Merge, 'GitMerge'],
  MessageCircle: [L.MessageCircle, 'ChatCircle'],
  MessageCircleQuestion: [L.MessageCircleQuestion, 'ChatTeardropDots'],
  MessageSquareQuote: [L.MessageSquareQuote, 'Quotes'],
  MessageSquareWarning: [L.MessageSquareWarning, 'ChatCenteredText'],
  MessagesSquare: [L.MessagesSquare, 'Chats'],
  Mic: [L.Mic, 'Microphone'],
  Minus: [L.Minus, 'Minus'],
  Monitor: [L.Monitor, 'Monitor'],
  Moon: [L.Moon, 'Moon'],
  MoreHorizontal: [L.MoreHorizontal, 'DotsThree'],
  Network: [L.Network, 'Graph'],
  NotebookText: [L.NotebookText, 'Notebook'],
  Palette: [L.Palette, 'Palette'],
  PanelLeft: [L.PanelLeft, 'SidebarSimple'],
  PanelRight: [L.PanelRight, 'SidebarSimple', true],
  Pause: [L.Pause, 'Pause'],
  PenLine: [L.PenLine, 'PencilSimpleLine'],
  Pencil: [L.Pencil, 'PencilSimple'],
  Pin: [L.Pin, 'PushPin'],
  PinOff: [L.PinOff, 'PushPinSlash'],
  Play: [L.Play, 'Play'],
  Plus: [L.Plus, 'Plus'],
  RefreshCw: [L.RefreshCw, 'ArrowClockwise'],
  Repeat2: [L.Repeat2, 'Repeat'],
  Rocket: [L.Rocket, 'Rocket'],
  RotateCcw: [L.RotateCcw, 'ArrowCounterClockwise'],
  Rows3: [L.Rows3, 'Rows'],
  Scissors: [L.Scissors, 'Scissors'],
  ScrollText: [L.ScrollText, 'Scroll'],
  Search: [L.Search, 'MagnifyingGlass'],
  SearchCheck: [L.SearchCheck, 'ListMagnifyingGlass'],
  SearchX: [L.SearchX, 'MagnifyingGlassMinus'],
  Send: [L.Send, 'PaperPlaneRight'],
  SeparatorHorizontal: [L.SeparatorHorizontal, 'ArrowsOutLineVertical'],
  Server: [L.Server, 'HardDrives'],
  Settings: [L.Settings, 'Gear'],
  Settings2: [L.Settings2, 'GearSix'],
  ShieldCheck: [L.ShieldCheck, 'ShieldCheck'],
  Shuffle: [L.Shuffle, 'Shuffle'],
  SkipBack: [L.SkipBack, 'SkipBack'],
  SkipForward: [L.SkipForward, 'SkipForward'],
  SlidersHorizontal: [L.SlidersHorizontal, 'SlidersHorizontal'],
  Sparkles: [L.Sparkles, 'Sparkle'],
  Spool: [L.Spool, 'Yarn'],
  Square: [L.Square, 'Stop'],
  SquarePen: [L.SquarePen, 'NotePencil'],
  StickyNote: [L.StickyNote, 'Note'],
  Sun: [L.Sun, 'Sun'],
  Swords: [L.Swords, 'Sword'],
  Target: [L.Target, 'Target'],
  TextQuote: [L.TextQuote, 'Quotes'],
  Timer: [L.Timer, 'Timer'],
  Trash2: [L.Trash2, 'Trash'],
  Type: [L.Type, 'TextT'],
  Undo2: [L.Undo2, 'ArrowUUpLeft'],
  UnfoldVertical: [L.UnfoldVertical, 'ArrowsOutLineVertical'],
  Unlink: [L.Unlink, 'LinkBreak'],
  UserPlus: [L.UserPlus, 'UserPlus'],
  UserRound: [L.UserRound, 'User'],
  UserRoundPen: [L.UserRoundPen, 'UserGear'],
  Users: [L.Users, 'Users'],
  Volume2: [L.Volume2, 'SpeakerHigh'],
  VolumeX: [L.VolumeX, 'SpeakerSlash'],
  WandSparkles: [L.WandSparkles, 'MagicWand'],
  Waves: [L.Waves, 'Waves'],
  X: [L.X, 'X'],
  Zap: [L.Zap, 'Lightning'],
  ZoomIn: [L.ZoomIn, 'MagnifyingGlassPlus'],
  ZoomOut: [L.ZoomOut, 'MagnifyingGlassMinus'],
} as const satisfies Record<string, readonly [L.LucideIcon, string, true?]>

export type IconName = keyof typeof ICONS

const draw = (shapes: Shape[]): React.ReactNode[] =>
  shapes.map(([tag, attrs, children], i) => createElement(tag, { key: i, ...attrs }, children ? draw(children) : undefined))

function make(name: IconName): IconType {
  const [Lucide, phosphor, mirrored] = ICONS[name] as readonly [L.LucideIcon, string, true?]
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon({ selected, ...props }, ref) {
    const look = useLook()
    if (look === 'classic') return createElement(Lucide, { ...props, ref })
    // Lucide's own stroke settings mean nothing here; a solid fill asks for the filled weight.
    const { size = 24, strokeWidth: _stroke, absoluteStrokeWidth: _absolute, fill, color = 'currentColor', ...rest } = props
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
export const ArrowRight = BY_NAME.ArrowRight
export const ArrowUpRight = BY_NAME.ArrowUpRight
export const AudioLines = BY_NAME.AudioLines
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
export const Cpu = BY_NAME.Cpu
export const DoorOpen = BY_NAME.DoorOpen
export const Download = BY_NAME.Download
export const Drama = BY_NAME.Drama
export const Droplet = BY_NAME.Droplet
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
export const HardDrive = BY_NAME.HardDrive
export const HardDriveDownload = BY_NAME.HardDriveDownload
export const Headphones = BY_NAME.Headphones
export const Heart = BY_NAME.Heart
export const History = BY_NAME.History
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
export const Link2 = BY_NAME.Link2
export const ListChecks = BY_NAME.ListChecks
export const ListOrdered = BY_NAME.ListOrdered
export const ListRestart = BY_NAME.ListRestart
export const ListTree = BY_NAME.ListTree
export const Lock = BY_NAME.Lock
export const MapPin = BY_NAME.MapPin
export const Maximize = BY_NAME.Maximize
export const Merge = BY_NAME.Merge
export const MessageCircle = BY_NAME.MessageCircle
export const MessageCircleQuestion = BY_NAME.MessageCircleQuestion
export const MessageSquareQuote = BY_NAME.MessageSquareQuote
export const MessageSquareWarning = BY_NAME.MessageSquareWarning
export const MessagesSquare = BY_NAME.MessagesSquare
export const Mic = BY_NAME.Mic
export const Minus = BY_NAME.Minus
export const Monitor = BY_NAME.Monitor
export const Moon = BY_NAME.Moon
export const MoreHorizontal = BY_NAME.MoreHorizontal
export const Network = BY_NAME.Network
export const NotebookText = BY_NAME.NotebookText
export const Palette = BY_NAME.Palette
export const PanelLeft = BY_NAME.PanelLeft
export const PanelRight = BY_NAME.PanelRight
export const Pause = BY_NAME.Pause
export const PenLine = BY_NAME.PenLine
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
export const Shuffle = BY_NAME.Shuffle
export const SkipBack = BY_NAME.SkipBack
export const SkipForward = BY_NAME.SkipForward
export const SlidersHorizontal = BY_NAME.SlidersHorizontal
export const Sparkles = BY_NAME.Sparkles
export const Spool = BY_NAME.Spool
export const Square = BY_NAME.Square
export const SquarePen = BY_NAME.SquarePen
export const StickyNote = BY_NAME.StickyNote
export const Sun = BY_NAME.Sun
export const Swords = BY_NAME.Swords
export const Target = BY_NAME.Target
export const TextQuote = BY_NAME.TextQuote
export const Timer = BY_NAME.Timer
export const Trash2 = BY_NAME.Trash2
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
export const Waves = BY_NAME.Waves
export const X = BY_NAME.X
export const Zap = BY_NAME.Zap
export const ZoomIn = BY_NAME.ZoomIn
export const ZoomOut = BY_NAME.ZoomOut
