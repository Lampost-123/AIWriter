// The phone on the same Wi-Fi is another window on this computer. Worlds, the AI and the voices stay here.
// The phone asks over the local network; these calls are the same ones the window uses.

/** Where the phone page and its calls live on the computer (never the speech engine's port). */
export const PHONE_PORT = 8770

/** A code typed on the phone, stored as six digits. */
export function makePhoneCode(roll: number): string {
  return String(Math.abs(Math.trunc(roll)) % 1_000_000).padStart(6, '0')
}

/** Six digits, ignoring spaces. '' when there aren't six. */
export function normalizePhoneCode(input: string): string {
  const digits = input.replace(/\D/g, '')
  return digits.length === 6 ? digits : ''
}

/** The code as it is shown ("482 193"). */
export function showPhoneCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/** What Settings shows for the phone, and what the phone has joined. */
export interface PhoneLink {
  /** The phone is allowed to connect. */
  on: boolean
  /** Pages to open on the phone, one for each network this computer is on. */
  addresses: string[]
  /** The code to type on the phone (six digits). */
  code: string
  /** Why the phone cannot connect, in plain words. '' when it can, or while the link is off. */
  problem: string
}

/** What the phone window paints before the first frame (the same values the desktop window gets). */
export interface PhoneHello {
  theme: 'light' | 'dark' | 'sepia'
  accent: string | null
  look: 'new' | 'classic'
  deskReady: boolean
}

export interface PhoneApi {
  /** The address and code for the phone, and whether it can connect. */
  getPhoneLink(): Promise<PhoneLink>
  /** Allow the phone, or stop it. */
  setPhoneLink(on: boolean): Promise<PhoneLink>
  /** A new code. The phone has to type it again. */
  newPhoneCode(): Promise<PhoneLink>
}
