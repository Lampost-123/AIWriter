import { describe, expect, it } from 'vitest'
import type { EditInput } from '@shared/contracts/edits'
import { editInput, MAX_CHARS } from './input'

const raw = (o: Partial<EditInput>): EditInput => ({
  taskId: 't1',
  sceneId: 's1',
  tool: 'condense',
  selection: 'Words.',
  before: '',
  after: '',
  ...o
})

describe('an edit as the window sends it', () => {
  it('keeps the end of a very long text before the words (the words just before them), and the start of the rest', () => {
    const early = 'Long ago. '.repeat(50_000)
    const near = 'She opened the door.'
    const out = editInput(raw({ before: `${early}${near}`, after: `${near}${early}`, selection: `${near}${early}` }))
    expect(out.before.length).toBe(MAX_CHARS)
    expect(out.before.endsWith(near)).toBe(true)
    expect(out.after.length).toBe(MAX_CHARS)
    expect(out.after.startsWith(near)).toBe(true)
    expect(out.selection.startsWith(near)).toBe(true)
    // A scene of any usual length goes as it is.
    expect(editInput(raw({ before: 'One.\n\nTwo. ' })).before).toBe('One.\n\nTwo. ')
  })

  it('needs a known tool, and something to go on for Rewrite and Change tone', () => {
    expect(() => editInput(raw({ tool: 'shout' as EditInput['tool'] }))).toThrow('Something went wrong starting that. Try again.')
    expect(() => editInput(raw({ tool: 'rewrite', direction: '  ' }))).toThrow('Say how to rewrite the words first.')
    expect(() => editInput(raw({ tool: 'tone' }))).toThrow('Pick a tone first.')
    expect(editInput(raw({ tool: 'tone', direction: ' Eerie ' })).direction).toBe('Eerie')
    expect(editInput(raw({ tool: 'continue', continueAs: 'inline' })).continueAs).toBe('inline')
    expect(editInput(raw({ tool: 'continue' })).continueAs).toBe('paragraph')
  })
})
