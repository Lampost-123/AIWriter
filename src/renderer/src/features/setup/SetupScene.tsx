// The New look's picture beside the first-run setup (UI overhaul, "first run, Settings and moving work in and out"): the
// headland at dusk in the start screen's harbour colours, and its lighthouse brought to life as the setup goes on.
//
// What each step adds (the step showing is `stage`, 1 to 5; each one done adds light):
//   1  dusk, the lamp dark and the sea dim; the town's windows across the water
//   2  the lamp is lit: its flame flickers and its halo breathes
//   3  the beam starts to turn: a cone of light sweeping round, bright as it faces us, brightening the sea where it falls
//      and catching the boat's sail as it passes
//   4  the keeper's cottage and the tower's windows light up
//   5  the stars and the moon come out, and the sea is no longer dim
// Finishing (`finishing`): the beam makes one full, bright turn and two gulls go up off the headland (about 900 ms).
//
// Always: the swells roll and the foam breaks on the rocks, the boat bobs and drifts, a cloud drifts, the stars
// twinkle, and now and then a gull crosses. Every loop is seconds long and moves by transform or opacity alone.
//
// Built like the start screen's harbour (components/art/Harbour.tsx): one SVG per moving thing, all with the same 600 by
// 900 drawing box, so each moves as a whole (by transform or opacity on the layer itself) and nothing is painted again
// as it moves. The still parts (sky, shore, sea, headland, tower, cottage) are painted once. Still while the window is
// hidden or left and while Adam types (components/art/living.ts); with less motion it is a still picture of the light
// reached so far. The lamp's light is its own pale warm light, never the AI's amber.
import { cn } from '@/lib/cn'
import { watchWindowForArt } from '@/components/art/living'
import './setupScene.css'

const BOX = '0 0 600 900'

function Layer({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg className={cn('sx-layer', className)} viewBox={BOX} preserveAspectRatio="none" aria-hidden>
      {children}
    </svg>
  )
}

/** A layer that comes up (slowly, a moment) once `on`. */
function Fade({ on, className, children }: { on: boolean; className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={cn('sx-fade', className)} data-on={on || undefined}>
      {children}
    </div>
  )
}

const WAVE = (y: number, step: number, rise: number, count: number, from = -60): string => {
  let d = `M${from} ${y}q${step / 2}-${rise} ${step} 0`
  for (let i = 1; i < count; i++) d += `t${step} 0`
  return d
}

/** The tower's windows, bottom to top, and the step from which each is lit. */
const TOWER_WINDOWS: { y: number; from: number }[] = [
  { y: 500, from: 4 },
  { y: 452, from: 4 },
  { y: 404, from: 4 },
  { y: 356, from: 4 }
]

/** The town's windows across the water. */
const TOWN_WINDOWS: [number, number, number][] = [
  [30, 590, 1],
  [47, 597, 0.8],
  [66, 584, 1],
  [83, 593, 0.7],
  [100, 580, 0.9],
  [119, 590, 1],
  [137, 598, 0.75],
  [155, 586, 0.9],
  [173, 596, 0.8],
  [58, 600, 0.6]
]

/** The lamp, in the drawing. */
const LAMP = { x: 462, y: 276 }

export function SetupScene({ stage, finishing, className }: { stage: number; finishing?: boolean; className?: string }): React.JSX.Element {
  watchWindowForArt()
  const at = (k: number): boolean => !!finishing || stage >= k
  // How dim the sea and shore still are: dimmer at the start, clear by the last step.
  const dim = finishing ? 0 : [0.5, 0.5, 0.38, 0.26, 0.14, 0][Math.max(0, Math.min(5, stage))]
  return (
    <div aria-hidden className={cn('sx la', className)} data-stage={stage} data-finishing={finishing || undefined} data-living-art="setup">
      <div className="sx-stage">
        {/* ---------- The sky, the far shore and its town, the sea: painted once. ---------- */}
        <Layer>
          <defs>
            <linearGradient id="sx-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sx-sky-1)" />
              <stop offset="0.4" stopColor="var(--sx-sky-2)" />
              <stop offset="0.72" stopColor="var(--sx-sky-3)" />
              <stop offset="0.93" stopColor="var(--sx-sky-4)" />
              <stop offset="1" stopColor="var(--sx-horizon)" />
            </linearGradient>
            <radialGradient id="sx-sun" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="var(--sx-sun)" stopOpacity="0.8" />
              <stop offset="0.4" stopColor="var(--sx-sun)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--sx-sun)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sx-sea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sx-sea-1)" />
              <stop offset="0.22" stopColor="var(--sx-sea-2)" />
              <stop offset="0.7" stopColor="var(--sx-sea-3)" />
              <stop offset="1" stopColor="var(--sx-night)" />
            </linearGradient>
            <linearGradient id="sx-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sx-land-far)" />
              <stop offset="1" stopColor="var(--sx-land)" />
            </linearGradient>
          </defs>
          <rect width="600" height="642" fill="url(#sx-sky)" />
          <ellipse cx="140" cy="642" rx="300" ry="170" fill="url(#sx-sun)" />
          {/* The far shore: a ridge, then the town of steep roofs above the harbour wall. */}
          <path d="M-10 642 L-10 600 C30 588 70 582 110 586 C150 590 188 604 226 616 C246 622 262 632 276 642 Z" fill="url(#sx-far)" />
          <path
            d="M16 614 L16 598 L24 591 L32 598 L32 593 L44 593 L44 585 L51 579 L58 585 L58 593 L68 593 L68 588 L76 581 L84 588 L84 597 L94 597 L94 591 L102 585 L110 591 L110 601 L122 601 L122 595 L129 589 L136 595 L136 605 L148 605 L148 599 L156 593 L164 599 L164 611 L180 613 L180 620 L16 620 Z"
            fill="var(--sx-roof)"
          />
          <rect x="52" y="571" width="3" height="10" fill="var(--sx-roof)" />
          <path d="M8 624 L200 628 L216 640 L8 640 Z" fill="var(--sx-land)" />
          <rect x="0" y="640" width="600" height="260" fill="url(#sx-sea)" />
          <rect x="0" y="639.4" width="600" height="1.4" fill="var(--sx-horizon)" opacity="0.55" />
        </Layer>

        {/* The moon, and its halo: out once the setup nears its end. */}
        <Fade on={at(5)} className="sx-slow">
          <Layer>
            <defs>
              <radialGradient id="sx-moon-halo" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="var(--sx-moon)" stopOpacity="0.38" />
                <stop offset="1" stopColor="var(--sx-moon)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx="132" cy="138" r="64" fill="url(#sx-moon-halo)" />
            <path d="M138 112 a24 24 0 1 0 14 44 a20 20 0 1 1 -14 -44 z" fill="var(--sx-moon)" />
          </Layer>
        </Fade>

        {/* Stars, in three sets that come and go at their own pace; a few from the start, the rest at the end. */}
        <Layer className="sx-star lp sx-st1">
          <circle cx="60" cy="70" r="1.6" fill="var(--sx-star)" />
          <circle cx="540" cy="60" r="1.4" fill="var(--sx-star)" />
        </Layer>
        <Fade on={at(5)} className="sx-slow">
          <Layer className="sx-star lp sx-st2">
            <circle cx="170" cy="40" r="1.3" fill="var(--sx-star)" />
            <circle cx="420" cy="190" r="1.1" fill="var(--sx-star)" />
            <circle cx="250" cy="230" r="1" fill="var(--sx-star)" />
            <circle cx="330" cy="120" r="1.2" fill="var(--sx-star)" />
            <circle cx="575" cy="170" r="1" fill="var(--sx-star)" />
          </Layer>
          <Layer className="sx-star lp sx-st3">
            <circle cx="216" cy="96" r="1.1" fill="var(--sx-star)" />
            <circle cx="480" cy="140" r="1.5" fill="var(--sx-star)" />
            <circle cx="300" cy="30" r="1.2" fill="var(--sx-star)" />
            <circle cx="30" cy="260" r="1" fill="var(--sx-star)" />
            <circle cx="372" cy="262" r="0.9" fill="var(--sx-star)" />
          </Layer>
        </Fade>

        {/* A long cloud drifting slowly across, and a fainter one further off. */}
        <Layer className="sx-cloud lp">
          <defs>
            <filter id="sx-cloud-soft" x="-20%" y="-80%" width="140%" height="260%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          <g filter="url(#sx-cloud-soft)" fill="var(--sx-cloud)">
            <g opacity="0.24">
              <ellipse cx="110" cy="452" rx="90" ry="9" />
              <ellipse cx="150" cy="444" rx="46" ry="12" />
              <ellipse cx="200" cy="450" rx="60" ry="9" />
              <ellipse cx="96" cy="446" rx="30" ry="9" />
            </g>
            <g opacity="0.15">
              <ellipse cx="390" cy="370" rx="80" ry="7" />
              <ellipse cx="420" cy="364" rx="36" ry="9" />
            </g>
          </g>
        </Layer>

        {/* The town's windows across the water. */}
        <Layer className="sx-town">
          {TOWN_WINDOWS.map(([x, y, o], i) => (
            <rect key={i} x={x} y={y} width="3" height="3.4" rx="0.6" fill="var(--sx-window)" style={{ '--o': o, transitionDelay: `${i * 60}ms` } as React.CSSProperties} />
          ))}
        </Layer>

        {/* Where the beam falls on the sea: a patch of light that travels with it. */}
        <Fade on={at(3)}>
          <Layer className="sx-seaglow lp">
            <defs>
              <radialGradient id="sx-seaglow-g" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="var(--sx-glint)" stopOpacity="0.5" />
                <stop offset="0.5" stopColor="var(--sx-glint)" stopOpacity="0.16" />
                <stop offset="1" stopColor="var(--sx-glint)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse cx="300" cy="700" rx="150" ry="22" fill="url(#sx-seaglow-g)" />
          </Layer>
        </Fade>

        {/* The sea's swells, rolling a few pixels to and fro. */}
        <Layer className="sx-wave lp sx-w1">
          <path d={WAVE(664, 44, 3, 18)} />
        </Layer>
        <Layer className="sx-wave lp sx-w2">
          <path d={WAVE(704, 60, 4, 14)} />
        </Layer>
        <Layer className="sx-wave lp sx-w3">
          <path d={WAVE(760, 82, 5, 11)} />
        </Layer>
        <Layer className="sx-wave lp sx-w4">
          <path d={WAVE(830, 100, 6, 9)} />
        </Layer>

        {/* The lamp's light lying on the water, once it is lit. */}
        <Fade on={at(2)}>
          <Layer className="sx-path lp">
            <rect x="200" y="652" width="110" height="2.2" rx="1.1" opacity="0.6" />
            <rect x="160" y="676" width="150" height="2.4" rx="1.2" opacity="0.42" />
            <rect x="130" y="714" width="130" height="2.6" rx="1.3" opacity="0.3" />
            <rect x="70" y="760" width="170" height="2.8" rx="1.4" opacity="0.2" />
          </Layer>
        </Fade>

        {/* A small boat heading home, drifting across and bobbing on the swell; its sail catches the beam. */}
        <div className="sx-drift lp">
          <div className="sx-bob lp">
            <Layer>
              <g transform="translate(176 700)">
                <rect x="-18" y="11" width="36" height="2" rx="1" fill="var(--sx-lamp)" opacity="0.22" />
                <path d="M-22 0 L22 0 L15 9 L-15 9 Z" fill="var(--sx-hull)" />
                <path d="M-22 0 L22 0 L21 2 L-21 2 Z" fill="var(--sx-rim)" opacity="0.6" />
                <rect x="-1" y="-36" width="2" height="36" fill="var(--sx-hull)" />
                <path d="M2.5 -33 C10 -24 16 -12 20 -3 L2.5 -3 Z" fill="var(--sx-sail)" />
                <path d="M-2.5 -28 L-2.5 -3 L-14 -3 Z" fill="var(--sx-sail-2)" />
                <circle cx="0" cy="-9" r="1.7" fill="var(--sx-window)" />
              </g>
            </Layer>
            <Fade on={at(3)}>
              <Layer className="sx-sailglint lp">
                <path d="M178.5 667 C186 676 192 688 196 697 L178.5 697 Z" fill="var(--sx-lamp-core)" opacity="0.9" />
              </Layer>
            </Fade>
          </div>
        </div>

        {/* The sea and shore still dim before the lamp is lit (it clears step by step). */}
        <div className="sx-dim" style={{ opacity: dim }} />

        {/* The beam, turning round the lamp: a cone that narrows as it faces us or turns away, bright toward us. */}
        <Fade on={at(3)}>
          <Layer className="sx-beam lp">
            <defs>
              <linearGradient id="sx-beam-g" gradientUnits="userSpaceOnUse" x1={LAMP.x} y1="0" x2="-40" y2="0">
                <stop offset="0" stopColor="var(--sx-lamp)" stopOpacity="0.75" />
                <stop offset="0.45" stopColor="var(--sx-lamp)" stopOpacity="0.26" />
                <stop offset="1" stopColor="var(--sx-lamp)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="sx-beam-core" gradientUnits="userSpaceOnUse" x1={LAMP.x} y1="0" x2="80" y2="0">
                <stop offset="0" stopColor="var(--sx-lamp-core)" stopOpacity="0.7" />
                <stop offset="1" stopColor="var(--sx-lamp-core)" stopOpacity="0" />
              </linearGradient>
              <filter id="sx-soft" x="-10%" y="-40%" width="120%" height="180%">
                <feGaussianBlur stdDeviation="3" />
              </filter>
            </defs>
            <g filter="url(#sx-soft)">
              <path d={`M${LAMP.x} ${LAMP.y - 5} L-40 196 L-40 372 L${LAMP.x} ${LAMP.y + 5} Z`} fill="url(#sx-beam-g)" />
              <path d={`M${LAMP.x} ${LAMP.y - 2} L80 250 L80 310 L${LAMP.x} ${LAMP.y + 2} Z`} fill="url(#sx-beam-core)" />
            </g>
          </Layer>
        </Fade>

        {/* ---------- The headland, its rocks, the keeper's cottage and the tower: painted once. ---------- */}
        <Layer>
          <defs>
            <linearGradient id="sx-tower" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--sx-tower)" />
              <stop offset="0.5" stopColor="var(--sx-tower-2)" />
              <stop offset="1" stopColor="var(--sx-tower-shade)" />
            </linearGradient>
            <linearGradient id="sx-band" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--sx-band)" />
              <stop offset="0.55" stopColor="var(--sx-band)" />
              <stop offset="1" stopColor="var(--sx-band-shade)" />
            </linearGradient>
            <linearGradient id="sx-rock" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--sx-land)" />
              <stop offset="1" stopColor="var(--sx-land-near)" />
            </linearGradient>
          </defs>
          {/* The headland: a cliff of stacked rock down to the sea, grass along its top edge. */}
          <path
            d="M262 900 C272 840 292 784 318 744 C334 718 350 700 360 676 C370 650 382 624 400 600 C416 578 438 560 468 554 C508 546 556 548 600 556 L600 900 Z"
            fill="url(#sx-rock)"
          />
          {/* The rock's layers, catching a little light along their tops. */}
          <path
            d="M330 726 C352 720 372 722 390 730 M346 694 C366 686 388 688 408 696 M370 652 C390 644 414 646 432 654 M392 616 C414 606 440 606 462 612 M300 800 C324 790 350 790 372 800 M286 846 C310 836 340 836 362 846"
            fill="none"
            stroke="var(--sx-rock-face)"
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity="0.75"
          />
          <path
            d="M360 676 C370 650 382 624 400 600 C416 578 438 560 468 554 C508 546 556 548 600 556"
            fill="none"
            stroke="var(--sx-rim)"
            strokeWidth="2"
            opacity="0.6"
          />
          <path d="M330 900 C350 846 380 800 418 768 C450 740 492 726 532 730 C562 734 584 744 600 752 L600 900 Z" fill="var(--sx-land-near)" />
          <path d="M418 768 C450 740 492 726 532 730 C562 734 584 744 600 752" fill="none" stroke="var(--sx-rim)" strokeWidth="1.4" opacity="0.35" />
          {/* The keeper's cottage, its chimney and door. */}
          <path d="M506 556 L506 526 L530 508 L554 526 L554 556 Z" fill="var(--sx-cottage)" />
          <path d="M503 528 L530 506 L557 528 L553 531 L530 512 L507 531 Z" fill="var(--sx-roof)" />
          <rect x="539" y="508" width="6" height="14" fill="var(--sx-roof)" />
          <rect x="524" y="538" width="9" height="18" rx="1" fill="var(--sx-door)" />
          <rect x="512" y="532" width="8" height="9" rx="1" fill="var(--sx-door)" />
          <rect x="540" y="532" width="8" height="9" rx="1" fill="var(--sx-door)" />
          {/* The tower: lit side and shaded side, its two bands following the taper, the door. */}
          <path d="M438 556 L486 556 L478 296 L446 296 Z" fill="url(#sx-tower)" />
          <path d="M440.7 492 L483.3 492 L482.7 470 L441.3 470 Z" fill="url(#sx-band)" />
          <path d="M443.5 396 L480.5 396 L479.9 374 L444.1 374 Z" fill="url(#sx-band)" />
          <path d="M466 556 L486 556 L478 296 L470 296 Z" fill="var(--sx-tower-shade)" opacity="0.35" />
          <path d="M455 556 L455 536 Q462 528 469 536 L469 556 Z" fill="var(--sx-door)" />
          {TOWER_WINDOWS.map((w) => (
            <rect key={w.y} x="459" y={w.y} width="6" height="10" rx="3" fill="var(--sx-door)" opacity="0.85" />
          ))}
          {/* The gallery: its floor, rail and posts. */}
          <rect x="430" y="292" width="64" height="7" rx="2" fill="var(--sx-iron)" />
          <path d="M432 292 L432 280 M440 292 L440 280 M448 292 L448 280 M476 292 L476 280 M484 292 L484 280 M492 292 L492 280" stroke="var(--sx-iron)" strokeWidth="1.6" />
          <rect x="430" y="279" width="64" height="2" rx="1" fill="var(--sx-iron)" />
          {/* The lantern: glass panes between their bars, the dome and its vane. */}
          <rect x="446" y="256" width="32" height="36" rx="2" fill="var(--sx-glass)" />
          <path d="M454 256 L454 292 M462 256 L462 292 M470 256 L470 292" stroke="var(--sx-iron)" strokeWidth="1.4" opacity="0.7" />
          <path d="M441 258 L483 258 L474 242 Q462 230 450 242 Z" fill="var(--sx-iron)" />
          <rect x="460.6" y="218" width="2.8" height="16" fill="var(--sx-iron)" />
          <circle cx="462" cy="217" r="2.4" fill="var(--sx-iron)" />
        </Layer>

        {/* Foam breaking on the rocks at the cliff's foot, now and then. */}
        <Layer className="sx-foam lp">
          <path d="M282 774 q6 -4 12 0 t12 0 M308 738 q6 -4 12 0 M330 708 q5 -3 10 0" fill="none" stroke="var(--sx-foam)" strokeWidth="2" strokeLinecap="round" />
        </Layer>
        <Layer className="sx-foam lp sx-foam-2">
          <path d="M296 756 q6 -4 12 0 t10 0 M270 794 q6 -4 12 0" fill="none" stroke="var(--sx-foam)" strokeWidth="1.6" strokeLinecap="round" />
        </Layer>

        {/* The windows, lit step by step: the cottage's and the tower's at step four. */}
        <Fade on={at(4)}>
          <Layer>
            <rect x="512" y="532" width="8" height="9" rx="1" fill="var(--sx-window)" />
            <rect x="540" y="532" width="8" height="9" rx="1" fill="var(--sx-window)" opacity="0.85" />
            <rect x="506" y="556" width="48" height="3" fill="var(--sx-window)" opacity="0.18" />
            {TOWER_WINDOWS.map((w) => (
              <rect key={w.y} x="459" y={w.y} width="6" height="10" rx="3" fill="var(--sx-window)" />
            ))}
          </Layer>
        </Fade>

        {/* The lamp: lit at step two. Its halo breathes, its flame flickers, and it flares as the beam faces us. */}
        <Fade on={at(2)}>
          <Layer>
            <rect x="446" y="256" width="32" height="36" rx="2" fill="var(--sx-lamp-room)" opacity="0.75" />
            <path d="M454 256 L454 292 M470 256 L470 292" stroke="var(--sx-iron)" strokeWidth="1.4" opacity="0.4" />
          </Layer>
          <Layer className="sx-glow lp">
            <defs>
              <radialGradient id="sx-glow-g" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="var(--sx-lamp-core)" stopOpacity="1" />
                <stop offset="0.22" stopColor="var(--sx-lamp)" stopOpacity="0.75" />
                <stop offset="0.55" stopColor="var(--sx-lamp)" stopOpacity="0.2" />
                <stop offset="1" stopColor="var(--sx-lamp)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={LAMP.x} cy={LAMP.y} r="78" fill="url(#sx-glow-g)" />
          </Layer>
          <Layer className="sx-flicker lp">
            <circle cx={LAMP.x} cy={LAMP.y} r="6.5" fill="var(--sx-lamp-core)" />
          </Layer>
        </Fade>
        <Fade on={at(3)}>
          <Layer className="sx-flare lp">
            <defs>
              <radialGradient id="sx-flare-g" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="var(--sx-lamp-core)" stopOpacity="0.95" />
                <stop offset="0.3" stopColor="var(--sx-lamp)" stopOpacity="0.4" />
                <stop offset="1" stopColor="var(--sx-lamp)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle cx={LAMP.x} cy={LAMP.y} r="120" fill="url(#sx-flare-g)" />
          </Layer>
        </Fade>

        {/* A gull crossing now and then, high over the sea. */}
        <Layer className="sx-wander lp">
          <path d="M40 330q6 -6 12 0q6 -6 12 0" fill="none" stroke="var(--sx-gull)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </Layer>

        {/* Two gulls, up off the headland when the setup is done. */}
        <Layer className="sx-gulls">
          <g fill="none" stroke="var(--sx-gull)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path className="sx-gull sx-gull-1" d="M520 470q7-7 14 0q7-7 14 0" />
            <path className="sx-gull sx-gull-2" d="M556 494q5-5 10 0q5-5 10 0" />
          </g>
        </Layer>
        <span className="sx-vignette" />
      </div>
      <span className="sx-rim" />
    </div>
  )
}
