// The start screen's picture (UI overhaul, "living art", after the Start mockup board): a harbour at dusk. The
// lighthouse on the headland has its lamp lit and its beam sweeps slowly over the sea; the lamp flickers a little and
// its glow breathes; the sea rolls, the light lies on the water and glints; a small boat drifts past the town's lit
// windows, bobbing; a few stars come and go. Every loop is seconds long and moves only a few pixels.
//
// Drawn in the theme's colours (living.css, --hb-*: the sky takes the accent, so it suits every look and theme, and
// the lamp is a pale lamp light, never the AI's amber). It is built in layers, one per moving thing, each its own
// SVG with the same 1040 by 288 drawing box, so each moves by transform or opacity alone and is never painted again:
// the stage covers the frame like a picture cut to fit (living.css, .hb-stage). The still parts (sky, town, sea,
// headland, tower) are two pictures painted once. Still while the window is hidden or left, and with less motion.
import { cn } from '@/lib/cn'
import { watchWindowForArt } from './living'
import './living.css'

const BOX = '0 0 1040 288'

/** One full-size layer of the picture. */
function Layer({ className, children }: { className?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <svg className={cn('hb-layer', className)} viewBox={BOX} preserveAspectRatio="none" aria-hidden>
      {children}
    </svg>
  )
}

const WAVE = (y: number, step: number, rise: number, count: number): string => {
  let d = `M-80 ${y}q${step / 2}-${rise} ${step} 0`
  for (let i = 1; i < count; i++) d += `t${step} 0`
  return d
}

export function Harbour({ className, style }: { className?: string; style?: React.CSSProperties }): React.JSX.Element {
  watchWindowForArt()
  return (
    <div aria-hidden className={cn('hb la', className)} style={style} data-living-art="harbour">
      <div className="hb-stage">
        {/* The sky, the far shore and its town, the sea: painted once. */}
        <Layer>
          <defs>
            <linearGradient id="hb-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--hb-sky-1)" />
              <stop offset="0.34" stopColor="var(--hb-sky-2)" />
              <stop offset="0.6" stopColor="var(--hb-sky-3)" />
              <stop offset="0.82" stopColor="var(--hb-sky-4)" />
              <stop offset="1" stopColor="var(--hb-horizon)" />
            </linearGradient>
            <radialGradient id="hb-sun" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="var(--hb-sun)" stopOpacity="0.95" />
              <stop offset="0.35" stopColor="var(--hb-sun)" stopOpacity="0.45" />
              <stop offset="1" stopColor="var(--hb-sun)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="hb-sea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--hb-sea-1)" />
              <stop offset="0.2" stopColor="var(--hb-sea-2)" />
              <stop offset="0.62" stopColor="var(--hb-sea-3)" />
              <stop offset="1" stopColor="var(--hb-night)" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="1040" height="204" fill="url(#hb-sky)" />
          <ellipse cx="330" cy="202" rx="320" ry="130" fill="url(#hb-sun)" />
          <path d="M96 150 C180 141 300 142 430 148 C360 156 210 158 96 150 Z" fill="var(--hb-cloud)" opacity="0.38" />
          <path d="M500 118 C580 110 690 111 790 118 C700 125 590 126 500 118 Z" fill="var(--hb-cloud)" opacity="0.24" />
          <path d="M40 112 C90 106 160 107 220 112 C170 117 100 118 40 112 Z" fill="var(--hb-cloud)" opacity="0.18" />
          <path d="M0 204 L0 176 C36 170 74 164 114 168 C156 172 196 184 246 190 C276 194 302 199 330 204 Z" fill="var(--hb-land-far)" />
          <path
            d="M18 184 L18 170 L25 164 L32 170 L32 167 L44 167 L44 161 L50 156 L56 161 L56 168 L64 168 L64 164 L72 158 L80 164 L80 172 L90 172 L90 168 L97 163 L104 168 L104 176 L116 176 L116 173 L122 168 L128 173 L128 186 Z"
            fill="var(--hb-roof)"
          />
          <g fill="var(--hb-window)">
            <rect x="22" y="174" width="2.2" height="2.6" />
            <rect x="38" y="177" width="2.2" height="2.6" opacity="0.8" />
            <rect x="48.5" y="164" width="2.2" height="2.6" />
            <rect x="52" y="172" width="2.2" height="2.6" opacity="0.7" />
            <rect x="70" y="167" width="2.2" height="2.6" />
            <rect x="95" y="171" width="2.2" height="2.6" opacity="0.85" />
            <rect x="120.5" y="177" width="2.2" height="2.6" />
          </g>
          <rect x="0" y="200" width="1040" height="88" fill="url(#hb-sea)" />
          <rect x="0" y="199.4" width="1040" height="1.6" fill="var(--hb-horizon)" opacity="0.5" />
          <g fill="none" stroke="var(--hb-gull)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.7">
            <path d="M560 100q5-5 10 0q5-5 10 0" />
            <path d="M588 113q4-4 8 0q4-4 8 0" />
          </g>
        </Layer>

        {/* Stars, in three sets that come and go at their own pace. */}
        <Layer className="hb-star lp hb-st1">
          <circle cx="70" cy="34" r="1.6" fill="var(--hb-star)" />
          <circle cx="618" cy="50" r="1.1" fill="var(--hb-star)" />
        </Layer>
        <Layer className="hb-star lp hb-st2">
          <circle cx="196" cy="68" r="1.2" fill="var(--hb-star)" />
          <circle cx="972" cy="30" r="1.4" fill="var(--hb-star)" />
        </Layer>
        <Layer className="hb-star lp hb-st3">
          <circle cx="468" cy="26" r="1.5" fill="var(--hb-star)" />
          <circle cx="760" cy="22" r="1" fill="var(--hb-star)" />
        </Layer>

        {/* The sea's swells, rolling a few pixels to and fro. */}
        <Layer className="hb-wave lp hb-w1">
          <path d={WAVE(226, 60, 3, 22)} />
        </Layer>
        <Layer className="hb-wave lp hb-w2">
          <path d={WAVE(246, 80, 4, 16)} />
        </Layer>
        <Layer className="hb-wave lp hb-w3">
          <path d={WAVE(268, 100, 5, 13)} />
        </Layer>

        {/* The last light lying on the water, glinting. */}
        <Layer className="hb-glint lp hb-g1">
          <rect x="292" y="205" width="78" height="2.2" rx="1.1" opacity="0.85" />
          <rect x="276" y="221" width="104" height="2.4" rx="1.2" opacity="0.55" />
          <rect x="262" y="243" width="70" height="2.6" rx="1.3" opacity="0.4" />
        </Layer>
        <Layer className="hb-glint lp hb-g2">
          <rect x="304" y="212" width="52" height="2" rx="1" opacity="0.7" />
          <rect x="340" y="232" width="62" height="2.4" rx="1.2" opacity="0.45" />
          <rect x="296" y="257" width="92" height="2.6" rx="1.3" opacity="0.3" />
          <rect x="586" y="281" width="20" height="1.8" rx="0.9" opacity="0.5" />
          <rect x="604" y="268" width="14" height="1.6" rx="0.8" opacity="0.4" />
        </Layer>
        <Layer className="hb-glint lp hb-g3">
          <rect x="250" y="274" width="120" height="2.8" rx="1.4" opacity="0.24" />
          <rect x="388" y="266" width="40" height="2.2" rx="1.1" opacity="0.28" />
          <rect x="572" y="240" width="30" height="2" rx="1" opacity="0.38" />
        </Layer>

        {/* The boat, drifting slowly across and bobbing on the swell. */}
        <div className="hb-drift lp">
          <Layer className="hb-bob lp">
            <g transform="translate(500 236)">
              <rect x="-12" y="8" width="24" height="1.6" rx="0.8" fill="var(--hb-lamp)" opacity="0.3" />
              <path d="M-15 0 L15 0 L10 6 L-10 6 Z" fill="var(--hb-hull)" />
              <rect x="-0.7" y="-24" width="1.4" height="24" fill="var(--hb-hull)" />
              <path d="M1.5 -22 L1.5 -2 L14 -2 Z" fill="var(--hb-sail)" />
              <path d="M-1.5 -19 L-1.5 -2 L-10 -2 Z" fill="var(--hb-sail-2)" />
              <circle cx="0" cy="-6" r="1.3" fill="var(--hb-window)" />
            </g>
          </Layer>
        </div>

        {/* The lighthouse's beam, sweeping slowly to and fro over the sea. */}
        <Layer className="hb-beam lp">
          <defs>
            <linearGradient id="hb-beam-l" gradientUnits="userSpaceOnUse" x1="840" y1="0" x2="330" y2="0">
              <stop offset="0" stopColor="var(--hb-lamp)" stopOpacity="0.66" />
              <stop offset="0.4" stopColor="var(--hb-lamp)" stopOpacity="0.26" />
              <stop offset="1" stopColor="var(--hb-lamp)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="hb-beam-r" gradientUnits="userSpaceOnUse" x1="840" y1="0" x2="1050" y2="0">
              <stop offset="0" stopColor="var(--hb-lamp)" stopOpacity="0.55" />
              <stop offset="1" stopColor="var(--hb-lamp)" stopOpacity="0" />
            </linearGradient>
            <filter id="hb-soft" x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <g filter="url(#hb-soft)">
            <path d="M840 82 L330 34 L330 132 L840 91 Z" fill="url(#hb-beam-l)" />
            <path d="M840 82 L1060 66 L1060 106 L840 91 Z" fill="url(#hb-beam-r)" />
          </g>
        </Layer>

        {/* The headland, the keeper's house and the tower: painted once. */}
        <Layer>
          <defs>
            <linearGradient id="hb-tower" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--hb-tower)" />
              <stop offset="0.55" stopColor="var(--hb-tower-2)" />
              <stop offset="1" stopColor="var(--hb-tower-shade)" />
            </linearGradient>
          </defs>
          <path
            d="M596 288 C624 268 660 246 700 230 C738 214 762 194 790 176 C808 165 824 159 846 158 C882 157 922 164 962 172 C992 178 1018 182 1040 184 L1040 288 Z"
            fill="var(--hb-land)"
          />
          <path
            d="M700 230 C738 214 762 194 790 176 C808 165 824 159 846 158 C882 157 922 164 962 172 C992 178 1018 182 1040 184"
            fill="none"
            stroke="var(--hb-rim)"
            strokeWidth="1.4"
            opacity="0.55"
          />
          <path
            d="M672 288 C712 270 748 254 776 240 C800 228 816 212 838 204 C866 196 900 204 930 220 C962 238 1004 256 1040 266 L1040 288 Z"
            fill="var(--hb-land-near)"
          />
          <path d="M861 159 L861 147 L874 139 L887 147 L887 160 Z" fill="var(--hb-roof)" />
          <rect x="867" y="150" width="4" height="4.5" fill="var(--hb-window)" />
          <rect x="877" y="150" width="4" height="4.5" fill="var(--hb-window)" opacity="0.7" />
          <path d="M827 160 L853 160 L849 98 L831 98 Z" fill="url(#hb-tower)" />
          <path d="M828.2 142 L851.8 142 L851.3 134 L828.7 134 Z" fill="var(--hb-band)" />
          <path d="M829.7 118 L850.3 118 L849.8 110 L830.2 110 Z" fill="var(--hb-band)" />
          <rect x="837" y="150" width="6" height="10" rx="3" fill="var(--hb-door)" />
          <rect x="825" y="94" width="30" height="5" rx="1.5" fill="var(--hb-iron)" />
          <rect x="832" y="79" width="16" height="15" rx="1.5" fill="var(--hb-lamp-room)" />
          <rect x="839.4" y="79" width="1.2" height="15" fill="var(--hb-iron)" opacity="0.35" />
          <path d="M829 80 L851 80 L846 72 Q840 66 834 72 Z" fill="var(--hb-iron)" />
          <rect x="839.3" y="61" width="1.4" height="7" fill="var(--hb-iron)" />
        </Layer>

        {/* The lamp itself, flickering a little, and its glow, breathing. */}
        <Layer className="hb-flame lp">
          <circle cx="840" cy="86.5" r="4.2" fill="var(--hb-lamp-core)" />
        </Layer>
        <Layer className="hb-glow lp">
          <defs>
            <radialGradient id="hb-glow" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="var(--hb-lamp-core)" stopOpacity="1" />
              <stop offset="0.22" stopColor="var(--hb-lamp)" stopOpacity="0.78" />
              <stop offset="0.55" stopColor="var(--hb-lamp)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--hb-lamp)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="840" cy="86" r="58" fill="url(#hb-glow)" />
        </Layer>
        <span className="hb-vignette" />
      </div>
      <span className="hb-rim" />
    </div>
  )
}
