import { describe, expect, it } from 'vitest'
import { clockTime, dayLabel, daysLeft, formatBackupDate, formatSize, inSentence, reasonLabel, timeAgo } from './backupText'

describe('backup words', () => {
  it('names every reason in plain words', () => {
    expect(reasonLabel('launch')).toBe('When opened')
    expect(reasonLabel('timer')).toBe('Every 30 minutes')
    expect(reasonLabel('manual')).toBe('Made by you')
    expect(reasonLabel('before-restore')).toBe('Before a restore')
    expect(reasonLabel('before-migration')).toBe('Before an update')
    expect(reasonLabel('something-new')).toBe('Backup')
  })

  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 bytes')
    expect(formatSize(1500)).toBe('1 KB')
    expect(formatSize(300 * 1024)).toBe('300 KB')
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatSize(42 * 1024 * 1024)).toBe('42 MB')
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })

  it('formats dates relative to today', () => {
    const now = new Date(2026, 9, 1, 22, 30) // local time
    expect(formatBackupDate(new Date(2026, 9, 1, 9, 5).toISOString(), now, 'en-GB')).toBe('Today at 09:05')
    expect(formatBackupDate(new Date(2026, 8, 30, 23, 59).toISOString(), now, 'en-GB')).toBe('Yesterday at 23:59')
    expect(formatBackupDate(new Date(2026, 8, 24, 14, 0).toISOString(), now, 'en-GB')).toMatch(/^Thu,? 24 Sept? at 14:00$/)
    expect(formatBackupDate(new Date(2025, 11, 31, 8, 0).toISOString(), now, 'en-GB')).toMatch(/^Wed,? 31 Dec 2025 at 08:00$/)
    expect(formatBackupDate('not a date', now)).toBe('not a date')
  })

  it('fits a date into a sentence without lowercasing a weekday', () => {
    const now = new Date(2026, 9, 1, 22, 30)
    expect(inSentence(formatBackupDate(new Date(2026, 9, 1, 9, 5).toISOString(), now, 'en-GB'))).toBe('today at 09:05')
    expect(inSentence(formatBackupDate(new Date(2026, 8, 30, 23, 59).toISOString(), now, 'en-GB'))).toBe('yesterday at 23:59')
    expect(inSentence(formatBackupDate(new Date(2026, 8, 24, 14, 0).toISOString(), now, 'en-GB'))).toMatch(/^Thu,? 24 Sept? at 14:00$/)
  })

  it('says how long ago', () => {
    const now = new Date('2026-10-01T12:00:00Z')
    expect(timeAgo('2026-10-01T11:59:30Z', now)).toBe('just now')
    expect(timeAgo('2026-10-01T11:59:00Z', now)).toBe('1 minute ago')
    expect(timeAgo('2026-10-01T11:15:00Z', now)).toBe('45 minutes ago')
    expect(timeAgo('2026-10-01T09:00:00Z', now)).toBe('3 hours ago')
    expect(timeAgo('2026-09-29T12:00:00Z', now)).toBe('2 days ago')
  })

  it('groups by day, says the time alone, and counts the days left in Recently deleted', () => {
    const now = new Date(2026, 9, 8, 21, 0)
    expect(dayLabel(new Date(2026, 9, 8, 9, 5).toISOString(), now, 'en-GB')).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 7, 23, 0).toISOString(), now, 'en-GB')).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 1, 12, 0).toISOString(), now, 'en-GB')).toMatch(/^Thursday,? 1 October$/)
    expect(dayLabel(new Date(2025, 9, 1, 12, 0).toISOString(), now, 'en-GB')).toMatch(/^Wednesday,? 1 October 2025$/)
    expect(clockTime(new Date(2026, 9, 8, 9, 5).toISOString(), 'en-GB')).toBe('09:05')
    expect(daysLeft(new Date(2026, 9, 8, 20, 0).toISOString(), now)).toBe(30)
    expect(daysLeft(new Date(2026, 8, 20, 21, 0).toISOString(), now)).toBe(12)
    expect(daysLeft(new Date(2026, 7, 1).toISOString(), now)).toBe(0)
  })
})
