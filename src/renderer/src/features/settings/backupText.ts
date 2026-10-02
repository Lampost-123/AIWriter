import type { BackupInfo } from '@shared/types'

// Words and numbers for the Backups and About screens. No React, so it can be unit-tested.

export const REASON_LABELS: Record<BackupInfo['reason'], string> = {
  launch: 'When opened',
  timer: 'Every 30 minutes',
  manual: 'Made by you',
  'before-restore': 'Before a restore',
  'before-migration': 'Before an update'
}

export const reasonLabel = (reason: string): string => REASON_LABELS[reason as BackupInfo['reason']] ?? 'Backup'

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} bytes`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Today at 22:15", "Yesterday at 09:30", or "Wed 24 Sept 2026 at 22:15", in Adam's locale. */
export function formatBackupDate(iso: string, now: Date = new Date(), locale?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(d)
  if (sameDay(d, now)) return `Today at ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return `Yesterday at ${time}`
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
  }).format(d)
  return `${date} at ${time}`
}

/** The date for the middle of a sentence: "today at 09:05", while "Thu 24 Sept at 14:00" keeps its capital. */
export function inSentence(when: string): string {
  return /^(Today|Yesterday) /.test(when) ? when.charAt(0).toLowerCase() + when.slice(1) : when
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const days = Math.round(h / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
