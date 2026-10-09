// How each drawing in the drawing library comes alive (UI overhaul, "living art"): a quiet idle loop where a single
// drawing is the picture (the story home's cover, the dossier's portrait), and a small movement when the card or button
// it sits on is hovered. The lantern's flame flickers, the lighthouse's beam turns, the water ripples, the boat bobs,
// the stars twinkle, the bell swings, a seal or a crown glints... Most drawings have both; every one moves on hover.
// motifMotion.css draws each movement; the parts that move are marked in the drawings (motifShapes.ts, data-part).
// Pure data, unit-tested (motifMotion.test.ts): every move named here exists, and every part it needs is drawn.

/** A drawing's movements: the whole drawing, or one of its parts (the flame, the beam, the water...). */
export type MotifMove =
  // The whole drawing.
  | 'bob' // rocks on the water
  | 'sway' // bends a little in the wind, from its foot
  | 'swing' // swings from where it hangs
  | 'float' // rises and falls a pixel or two
  | 'tilt' // leans a few degrees and back
  | 'turn' // turns a little, as a key in a lock
  | 'spin' // a coin turning on its edge
  | 'lift' // rises 2px, as if picked up
  | 'blink' // the eye closes and opens
  | 'glint' // a small spark of light on it, now and then
  // A part of it.
  | 'flicker' // the flame
  | 'beam' // the lighthouse's light, sweeping from one side to the other
  | 'ripple' // the water's lines
  | 'twinkle' // a star
  | 'rays' // the sun's rays turning
  | 'needle' // the compass needle settling
  | 'clapper' // the bell's clapper
  | 'flap' // the wings
  | 'sand' // the sand running through
  | 'smoke' // the chimney's smoke
  | 'flag' // the flag on the tower
  | 'window' // a lit window
  | 'route' // the dotted route on the map

export interface MotifMotion {
  /** Its idle loop where it is the one picture (none: it rests until hovered). */
  idle: MotifMove[]
  /** What it does when its card or button is hovered. */
  hover: MotifMove[]
  /** Where a glint shows, in its 48 by 48 box (for 'glint'). */
  glint?: [number, number]
}

/** The parts of a drawing that each part-move moves (motifShapes.ts marks them with data-part). */
export const MOVE_PARTS: Partial<Record<MotifMove, string[]>> = {
  flicker: ['flame'],
  beam: ['beam-l', 'beam-r', 'lamp'],
  ripple: ['water'],
  twinkle: ['twinkle'],
  rays: ['rays'],
  needle: ['needle'],
  clapper: ['clapper'],
  flap: ['wings'],
  sand: ['sand-top', 'sand-bottom'],
  smoke: ['smoke'],
  flag: ['flag'],
  window: ['window'],
  route: ['route']
}

export const MOTIF_MOTION: Record<string, MotifMotion> = {
  lantern: { idle: ['flicker', 'swing'], hover: ['flicker', 'swing'] },
  letter: { idle: ['glint'], hover: ['glint', 'lift'], glint: [27.5, 23] },
  ship: { idle: ['bob', 'ripple'], hover: ['bob', 'ripple'] },
  boat: { idle: ['bob', 'ripple'], hover: ['bob', 'ripple'] },
  anchor: { idle: ['swing'], hover: ['swing'] },
  key: { idle: ['glint'], hover: ['turn', 'glint'], glint: [12, 30] },
  sword: { idle: ['glint'], hover: ['tilt', 'glint'], glint: [17, 14] },
  shield: { idle: ['glint'], hover: ['glint', 'lift'], glint: [31, 13] },
  crown: { idle: ['glint'], hover: ['glint', 'float'], glint: [24, 10] },
  ring: { idle: ['glint'], hover: ['glint', 'float'], glint: [24, 9] },
  cup: { idle: ['glint'], hover: ['glint', 'tilt'], glint: [30, 11] },
  coin: { idle: ['glint'], hover: ['spin', 'glint'], glint: [30, 19] },
  tower: { idle: ['window'], hover: ['window', 'lift'] },
  castle: { idle: ['flag'], hover: ['flag', 'window'] },
  lighthouse: { idle: ['beam'], hover: ['beam'] },
  house: { idle: ['smoke', 'window'], hover: ['smoke', 'window'] },
  bridge: { idle: ['ripple'], hover: ['ripple'] },
  gate: { idle: ['glint'], hover: ['glint', 'lift'], glint: [26.3, 30] },
  stairs: { idle: [], hover: ['lift'] },
  tree: { idle: ['sway'], hover: ['sway'] },
  forest: { idle: ['sway'], hover: ['sway'] },
  mountain: { idle: ['glint'], hover: ['glint', 'lift'], glint: [20, 10] },
  wave: { idle: ['ripple', 'float'], hover: ['ripple', 'tilt'] },
  moon: { idle: ['twinkle', 'float'], hover: ['twinkle', 'float'] },
  sun: { idle: ['rays'], hover: ['rays'] },
  star: { idle: ['twinkle'], hover: ['twinkle', 'turn'] },
  flame: { idle: ['flicker'], hover: ['flicker'] },
  candle: { idle: ['flicker'], hover: ['flicker'] },
  bell: { idle: ['swing'], hover: ['swing', 'clapper'] },
  book: { idle: [], hover: ['lift'] },
  quill: { idle: ['tilt'], hover: ['tilt'] },
  scroll: { idle: [], hover: ['lift'] },
  map: { idle: ['route'], hover: ['route', 'lift'] },
  compass: { idle: ['needle'], hover: ['needle'] },
  hourglass: { idle: ['sand'], hover: ['sand', 'tilt'] },
  eye: { idle: ['blink'], hover: ['blink'] },
  mask: { idle: [], hover: ['tilt'] },
  rose: { idle: ['sway'], hover: ['sway'] },
  bird: { idle: ['flap', 'float'], hover: ['flap', 'float'] },
  raven: { idle: [], hover: ['tilt'] },
  wolf: { idle: [], hover: ['tilt'] },
  horse: { idle: [], hover: ['tilt'] }
}

/** A drawing's movements (a drawing not in the list gets a small lift on hover, and no idle). */
export function motifMotion(id: string): MotifMotion {
  return MOTIF_MOTION[id] ?? { idle: [], hover: ['lift'] }
}
