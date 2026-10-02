import { describe, expect, it } from 'vitest'
import { describeUpdateError, releaseNotesText, UPDATES_NOT_SET_UP } from '../../src/main/services/updateText'

describe('releaseNotesText', () => {
  it('turns GitHub release HTML into short plain text', () => {
    const html = '<h2>What&#39;s new</h2><ul><li>Faster <strong>saving</strong></li><li>Backups &amp; restore</li></ul><p>Thanks!</p>'
    expect(releaseNotesText(html)).toBe("What's new\n• Faster saving\n• Backups & restore\nThanks!")
  })

  it('handles Markdown and lists of notes', () => {
    expect(releaseNotesText('## Fixes\n- **Typing** no longer lags\n* See [the guide](https://x.y)')).toBe('Fixes\n• Typing no longer lags\n• See the guide')
    expect(releaseNotesText([{ version: '0.2.0', note: 'One' }, { version: '0.1.1', note: null }, { note: 'Two' }])).toBe('One\nTwo')
    expect(releaseNotesText(null)).toBe('')
    expect(releaseNotesText(undefined)).toBe('')
  })

  it('keeps the note short, ending on a whole word', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const out = releaseNotesText(long, 50)
    expect(out.length).toBeLessThanOrEqual(51)
    expect(out.endsWith('…')).toBe(true)
    const words = out.slice(0, -1).split(' ')
    expect(words.every((w, i) => w === `word${i}`)).toBe(true)
  })
})

describe('describeUpdateError', () => {
  it('treats a private or empty releases page as "not set up", not an error', () => {
    const cases = [
      new Error('HttpError: 404 \n"method: GET url: https://github.com/lampost-123/aiwriter/releases.atom\n\nPlease double check that your authentication token is correct.'),
      Object.assign(new Error('Unable to find latest version on GitHub'), { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }),
      Object.assign(new Error('Not Found'), { statusCode: 404 }),
      Object.assign(new Error('No published versions on GitHub'), { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' }),
      new Error("ENOENT: no such file or directory, open 'C:\\Program Files\\AI Write\\resources\\app-update.yml'")
    ]
    for (const e of cases) expect(describeUpdateError(e)).toEqual({ state: 'disabled', message: UPDATES_NOT_SET_UP })
  })

  it('a busy or failing server is "try again later", not "not set up"', () => {
    const busy = describeUpdateError(Object.assign(new Error('429 Too Many Requests'), { statusCode: 429, code: 'HTTP_ERROR_429' }))
    expect(busy.state).toBe('error')
    expect(describeUpdateError(Object.assign(new Error('502 Bad Gateway'), { statusCode: 502 })).state).toBe('error')
  })

  it('explains being offline in plain words', () => {
    const s = describeUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(s.state).toBe('error')
    expect(s.state === 'error' && s.message).toMatch(/internet connection/)
    expect(describeUpdateError(Object.assign(new Error('getaddrinfo ENOTFOUND github.com'), { code: 'ENOTFOUND' })).state).toBe('error')
  })

  it('never leaks raw error text', () => {
    const s = describeUpdateError(new Error('TypeError: Cannot read properties of undefined (reading "x")'))
    expect(s.state).toBe('error')
    expect(s.state === 'error' && s.message).not.toMatch(/TypeError|undefined/)
    expect(describeUpdateError('weird').state).toBe('error')
    expect(describeUpdateError(null).state).toBe('error')
  })
})
