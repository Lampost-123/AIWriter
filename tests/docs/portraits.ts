// Portraits for the sample cast, painted in the window: flat, faceless head-and-shoulders pictures in the
// sample world's colours (dusk sea, lamp light). Made here, so no picture comes from anywhere else.

export interface PortraitLook {
  sky: [string, string]
  glow: string
  skin: string
  hair: string
  /** short: cropped; bob: chin length; swept: thick and swept back. */
  cut: 'short' | 'bob' | 'swept'
  coat: string
  collar: string
  /** How broad the shoulders are (1 is average). */
  broad: number
}

export const LOOKS: Record<string, PortraitLook> = {
  'Wren Halloway': { sky: ['#22324d', '#c9874f'], glow: 'rgba(255,214,150,0.55)', skin: '#e2b896', hair: '#2b211c', cut: 'short', coat: '#c79a2e', collar: '#a37c1f', broad: 0.92 },
  'Edric Halloway': { sky: ['#1c2a40', '#7d6a5a'], glow: 'rgba(255,224,170,0.40)', skin: '#d9a888', hair: '#ece8e1', cut: 'swept', coat: '#2f3e57', collar: '#24304a', broad: 1.12 },
  'Ansel Crane': { sky: ['#2b3a3f', '#8ea3a1'], glow: 'rgba(230,240,235,0.35)', skin: '#e5c2a6', hair: '#8c8782', cut: 'short', coat: '#23313b', collar: '#b08d3c', broad: 0.88 },
  'Iska Vey': { sky: ['#3a3446', '#b79a8c'], glow: 'rgba(255,230,210,0.40)', skin: '#c99878', hair: '#16130f', cut: 'bob', coat: '#7d7f86', collar: '#64666d', broad: 0.95 }
}

/** A script for the window: paints the portrait and gives it to the entry. */
export const paintPortrait = (entryId: string, look: PortraitLook): string => `(async () => {
  const L = ${JSON.stringify(look)}
  const W = 640, H = 800
  const c = new OffscreenCanvas(W, H)
  const g = c.getContext('2d')
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, L.sky[0]); sky.addColorStop(1, L.sky[1])
  g.fillStyle = sky; g.fillRect(0, 0, W, H)
  // The light's beam, far off.
  g.save(); g.globalAlpha = 0.18; g.fillStyle = '#fff3d6'
  g.beginPath(); g.moveTo(W, 120); g.lineTo(-40, 40); g.lineTo(-40, 230); g.closePath(); g.fill(); g.restore()
  const glow = g.createRadialGradient(330, 360, 20, 330, 360, 330)
  glow.addColorStop(0, L.glow); glow.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = glow; g.fillRect(0, 0, W, H)
  const cx = 320, b = L.broad
  // Hair behind the head (a bob falls to the chin).
  g.fillStyle = L.hair
  if (L.cut === 'bob') { g.beginPath(); g.ellipse(cx, 400, 132, 150, 0, 0, Math.PI * 2); g.fill() }
  // Shoulders and coat.
  g.fillStyle = L.coat
  g.beginPath(); g.moveTo(cx - 290 * b, H); g.bezierCurveTo(cx - 280 * b, 650, cx - 170 * b, 595, cx, 590); g.bezierCurveTo(cx + 170 * b, 595, cx + 280 * b, 650, cx + 290 * b, H); g.closePath(); g.fill()
  // Neck.
  g.fillStyle = L.skin
  g.beginPath(); g.moveTo(cx - 42, 470); g.lineTo(cx + 42, 470); g.lineTo(cx + 48, 610); g.quadraticCurveTo(cx, 640, cx - 48, 610); g.closePath(); g.fill()
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(cx - 44, 500, 88, 40)
  // Collar.
  g.fillStyle = L.collar
  g.beginPath(); g.moveTo(cx - 120 * b, 600); g.lineTo(cx - 40, 585); g.lineTo(cx, 700); g.lineTo(cx - 70, 690); g.closePath(); g.fill()
  g.beginPath(); g.moveTo(cx + 120 * b, 600); g.lineTo(cx + 40, 585); g.lineTo(cx, 700); g.lineTo(cx + 70, 690); g.closePath(); g.fill()
  // Head, lit from the left.
  g.fillStyle = L.skin
  g.beginPath(); g.ellipse(cx, 385, 100, 128, 0, 0, Math.PI * 2); g.fill()
  const shade = g.createLinearGradient(cx - 100, 0, cx + 100, 0)
  shade.addColorStop(0.55, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(40,20,10,0.22)')
  g.fillStyle = shade; g.beginPath(); g.ellipse(cx, 385, 100, 128, 0, 0, Math.PI * 2); g.fill()
  // Ears.
  g.fillStyle = L.skin
  g.beginPath(); g.ellipse(cx - 98, 395, 16, 26, 0, 0, Math.PI * 2); g.fill()
  g.beginPath(); g.ellipse(cx + 98, 395, 16, 26, 0, 0, Math.PI * 2); g.fill()
  // Hair on top.
  g.fillStyle = L.hair
  g.beginPath()
  if (L.cut === 'swept') {
    g.moveTo(cx - 104, 380); g.bezierCurveTo(cx - 118, 250, cx - 40, 225, cx + 10, 228); g.bezierCurveTo(cx + 90, 230, cx + 122, 290, cx + 104, 380)
    g.bezierCurveTo(cx + 92, 320, cx + 60, 292, cx, 290); g.bezierCurveTo(cx - 60, 292, cx - 92, 320, cx - 104, 380)
  } else if (L.cut === 'bob') {
    g.moveTo(cx - 112, 470); g.bezierCurveTo(cx - 128, 280, cx - 50, 240, cx + 10, 240); g.bezierCurveTo(cx + 90, 240, cx + 132, 300, cx + 112, 470)
    g.bezierCurveTo(cx + 100, 380, cx + 92, 330, cx + 40, 312); g.bezierCurveTo(cx - 10, 330, cx - 60, 320, cx - 88, 340); g.bezierCurveTo(cx - 98, 380, cx - 100, 420, cx - 112, 470)
  } else {
    g.moveTo(cx - 106, 400); g.bezierCurveTo(cx - 116, 270, cx - 50, 236, cx + 6, 236); g.bezierCurveTo(cx + 84, 236, cx + 120, 290, cx + 106, 400)
    g.bezierCurveTo(cx + 98, 350, cx + 80, 322, cx + 40, 318); g.bezierCurveTo(cx + 10, 334, cx - 40, 326, cx - 70, 338); g.bezierCurveTo(cx - 90, 352, cx - 100, 372, cx - 106, 400)
  }
  g.closePath(); g.fill()
  // A soft vignette.
  const v = g.createRadialGradient(cx, 400, 260, cx, 400, 560)
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.28)')
  g.fillStyle = v; g.fillRect(0, 0, W, H)
  const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.9 })
  const res = await window.aiwrite.invoke('setEntryImage', ${JSON.stringify(entryId)}, { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
  if (!res.ok) throw new Error(res.error.message)
  return res.value.image
})()`
