import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseNotesText } from '../../src/main/services/updateText'

// build/release-notes.md goes on the release page and, through latest.yml, under "What's new" in the
// app (spec: plain words for Adam). Bumping the version means writing that version's notes.
const root = resolve(__dirname, '../..')
const notes = readFileSync(resolve(root, 'build/release-notes.md'), 'utf8')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }

describe('release notes', () => {
  it("are this version's notes", () => {
    expect(notes.split('\n')[0].replace(/\r$/, '')).toBe(`<!-- version: ${version} -->`)
  })

  it('show in full under "What\'s new", without the version line', () => {
    const shown = releaseNotesText(notes)
    expect(shown.endsWith('…')).toBe(false)
    expect(shown).not.toContain('version:')
    expect(shown.split('\n').length).toBeGreaterThan(1)
  })
})
