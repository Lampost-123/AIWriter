// Settings › About and updates › On your phone. The phone is another window on this computer.
import { useEffect, useState } from 'react'
import { showPhoneCode, type PhoneLink } from '@shared/contracts/phone'
import { Button, SettingsSection } from '@/components/ui'
import { api } from '@/lib/api'
import { plainReason } from '@/lib/reason'

const STARTING = 'The phone link is starting.'
/** How many times a starting link is checked again (every 400 ms) before it is left to Try again. */
const STARTING_TRIES = 15

export function PhoneLinkSettings(): React.JSX.Element {
  const [link, setLink] = useState<PhoneLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)

  const show = (next: PhoneLink): void => {
    setLink(next)
    setError('')
  }
  const refresh = (): void => {
    void api
      .getPhoneLink()
      .then(show)
      .catch((e: unknown) => setError(`Couldn’t check the phone link. ${plainReason(e)}`))
  }
  const tryAgain = (): void => {
    setTries(0)
    refresh()
  }

  useEffect(() => {
    refresh()
  }, [])

  // While it starts it is checked again a few times, then left to Try again.
  const starting = link?.problem === STARTING
  useEffect(() => {
    if (!starting || tries >= STARTING_TRIES) return
    const timer = setTimeout(() => {
      setTries((n) => n + 1)
      refresh()
    }, 400)
    return () => clearTimeout(timer)
  }, [link, starting, tries])

  const run = (work: () => Promise<PhoneLink>): void => {
    setBusy(true)
    void work()
      .then(show)
      .catch((e: unknown) => setError(plainReason(e)))
      .finally(() => setBusy(false))
  }

  const stuck = starting && tries >= STARTING_TRIES ? 'The phone link is taking a while to start.' : ''
  const problem = error || stuck || (link?.problem && !starting ? link.problem : '')
  const problemLine = problem ? (
    <p className="text-[13px] text-danger" role="alert">
      {problem}{' '}
      <button type="button" className="font-medium text-accent hover:underline" onClick={tryAgain}>
        Try again
      </button>
    </p>
  ) : null

  return (
    <SettingsSection
      title="On your phone"
      description="Use AI Write on your phone, on the same Wi-Fi. The phone is another window. Your worlds, the AI and the voices stay on this computer. Talking still uses this computer’s microphone. Change a scene on one screen at a time; the last save is the one kept."
    >
      {link?.on ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[13px] text-muted">On the phone, open</p>
            {link.addresses.length ? (
              <ul className="mt-1 flex flex-col gap-1">
                {link.addresses.map((address) => (
                  <li key={address} className="select-all font-mono text-[14px] text-fg">
                    {address}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-muted">{link.problem === STARTING ? 'Starting…' : ''}</p>
            )}
          </div>
          <div>
            <p className="text-[13px] text-muted">Then type this code</p>
            <p className="mt-1 font-mono text-[28px] tracking-[0.25em] text-fg">{showPhoneCode(link.code)}</p>
          </div>
          {problemLine}
          <p className="text-[13px] text-muted">
            If the phone cannot open the page, allow AI Write on private networks when Windows asks.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => api.newPhoneCode())}>
              New code
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => api.setPhoneLink(false))}>
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {problemLine}
          <div>
            <Button variant="primary" size="sm" disabled={busy} loading={busy} onClick={() => run(() => api.setPhoneLink(true))}>
              Allow your phone
            </Button>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
