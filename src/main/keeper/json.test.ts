import { describe, expect, it } from 'vitest'
import { CUT_OFF, parseLenient, readingReply } from './json'

describe('a reply that is a bare list', () => {
  const two = '[{"from": "Tam Orrin", "to": "Wren Ashby", "type": "cousin"}, {"from": "Wren Ashby", "to": "The Lantern Guild", "type": "member",}]'

  it('is read as the list, with words around it or the usual slips', () => {
    expect(parseLenient(two)).toEqual({
      ok: true,
      value: [
        { from: 'Tam Orrin', to: 'Wren Ashby', type: 'cousin' },
        { from: 'Wren Ashby', to: 'The Lantern Guild', type: 'member' }
      ]
    })
    expect(parseLenient(`Here they are:\n${two}\nThat is all.`)).toMatchObject({ ok: true, value: [{ from: 'Tam Orrin' }, { from: 'Wren Ashby' }] })
    expect(parseLenient('[]')).toEqual({ ok: true, value: [] })
  })

  it('is read from a code fence, the list alone in it', () => {
    expect(parseLenient(`Sure:\n\`\`\`json\n${two}\n\`\`\``)).toMatchObject({ ok: true, value: [{ type: 'cousin' }, { type: 'member' }] })
    expect(parseLenient('```\n["Tam Orrin", "Wren Ashby"]\n```')).toEqual({ ok: true, value: ['Tam Orrin', 'Wren Ashby'] })
  })

  it('still reads the object of a reply whose brackets are only words, or one whose object comes first', () => {
    expect(parseLenient('[draft] {"facts": [], "add": [], "clashes": []}')).toEqual({ ok: true, value: { facts: [], add: [], clashes: [] } })
    expect(parseLenient('See [1] below. {"a": 1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseLenient('{"relationships": [{"from": "Tam Orrin"}]}')).toEqual({ ok: true, value: { relationships: [{ from: 'Tam Orrin' }] } })
    // Cut off before the list ends: its first whole object, as before.
    expect(parseLenient('[{"from": "Tam Orrin"}, {"from": "Wr')).toEqual({ ok: true, value: { from: 'Tam Orrin' } })
    expect(parseLenient('[{"from": "Tam')).toEqual({ ok: false, why: CUT_OFF })
  })

  it('is not an object, so a reading reply says so', () => {
    const r = parseLenient(two)
    expect(r.ok && readingReply(r.value)).toEqual({ ok: false, why: 'it was not a JSON object' })
  })
})
