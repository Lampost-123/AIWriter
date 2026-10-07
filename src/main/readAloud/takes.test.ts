import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TakeStore } from './takes'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('Redo this line', () => {
  it('counts each line’s takes and keeps them', () => {
    dir = mkdtempSync(join(tmpdir(), 'takes-'))
    const file = join(dir, 'takes.json')
    const takes = new TakeStore(file)
    expect(takes.get('a')).toBe(0)
    expect(takes.next('a')).toBe(1)
    expect(takes.next('a')).toBe(2)
    expect(new TakeStore(file).get('a')).toBe(2)
  })
})
