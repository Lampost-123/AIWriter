// Values on the phone link. JSON has no bytes and no undefined; spoken audio is bytes, and some calls
// pass undefined. Portrait addresses use a scheme the phone's browser will not load, so they become a
// page on this same link.

const BYTES = '$aiw'
const UNDEF = '$aiu'
const PORTRAIT = 'aiwrite-image://entry/'
export const PHONE_PORTRAIT = '/__phone/image/entry/'

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function mapString(value: string, from: string, to: string): string {
  return value.includes(from) ? value.replaceAll(from, to) : value
}

/** A value ready to send as JSON. */
export function encodeWire(value: unknown): unknown {
  if (value === undefined) return { [UNDEF]: 1 }
  if (isBytes(value)) return { [BYTES]: bytesToBase64(value) }
  if (typeof value === 'string') return mapString(value, PORTRAIT, PHONE_PORTRAIT)
  if (Array.isArray(value)) return value.map((item) => encodeWire(item))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = encodeWire(item)
    return out
  }
  return value
}

/** A value just received as JSON. */
export function decodeWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decodeWire(item))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 1 && keys[0] === BYTES && typeof record[BYTES] === 'string') return base64ToBytes(record[BYTES])
    if (keys.length === 1 && keys[0] === UNDEF) return undefined
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(record)) out[key] = decodeWire(item)
    return out
  }
  if (typeof value === 'string') return mapString(value, PHONE_PORTRAIT, PORTRAIT)
  return value
}
