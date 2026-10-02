// Address helpers shared by the main process and the interface.

/** True for a server on this computer or the local network (LM Studio, Ollama...). */
export function isLocalUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return true
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  // A name with no dot in it ("gpu-box") can only be a computer on the local network.
  if (!m) return !host.includes('.') && !host.includes(':') && host.length > 0
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    // Private networks like Tailscale.
    (a === 100 && b >= 64 && b <= 127)
  )
}
