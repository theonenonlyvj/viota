// Generates public/og-image.png (1200x630) — the Neon-Night social preview.
// Run: node scripts/gen-og-image.mjs   (from packages/client)
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const client = join(here, '..')
// resvg needs TTF/OTF FILE PATHS (fontFiles), and does not decode @fontsource's
// woff2. These static TTFs are vendored from google/fonts for a reproducible render.
const fontsDir = join(here, 'fonts')
const fontFiles = [
  join(fontsDir, 'LuckiestGuy-Regular.ttf'),
  join(fontsDir, 'Fredoka-VF.ttf'),
].filter(existsSync)

// --- a stylized Iota card (colored rounded tile + white shape + number) ---
function card(x, y, rot, color, shape, num) {
  const s = 118 // tile size
  const cx = s / 2, cy = s / 2 + 6
  let glyph = ''
  if (shape === 'circle') glyph = `<circle cx="${cx}" cy="${cy}" r="26" fill="#fff"/>`
  else if (shape === 'square') glyph = `<rect x="${cx - 24}" y="${cy - 24}" width="48" height="48" rx="6" fill="#fff"/>`
  else if (shape === 'triangle') glyph = `<path d="M${cx} ${cy - 28} L${cx + 27} ${cy + 22} L${cx - 27} ${cy + 22} Z" fill="#fff"/>`
  else if (shape === 'plus') glyph = `<path d="M${cx - 9} ${cy - 28} h18 v19 h19 v18 h-19 v19 h-18 v-19 h-19 v-18 h19 Z" fill="#fff"/>`
  else glyph = `<path d="M${cx} ${cy - 30} l8 20 l22 2 l-16 15 l5 22 l-19 -12 l-19 12 l5 -22 l-16 -15 l22 -2 Z" fill="#fff"/>` // wild star
  return `<g transform="translate(${x} ${y}) rotate(${rot})" filter="url(#cardShadow)">
    <rect x="0" y="0" width="${s}" height="${s}" rx="16" fill="${color}"/>
    <rect x="0" y="0" width="${s}" height="${s}" rx="16" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="2"/>
    <text x="14" y="30" font-family="Fredoka" font-weight="600" font-size="26" fill="rgba(255,255,255,.92)">${num}</text>
    ${glyph}
  </g>`
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="g1" cx="16%" cy="20%" r="55%"><stop offset="0%" stop-color="#ff7a45" stop-opacity=".55"/><stop offset="55%" stop-color="#ff7a45" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="42%" cy="82%" r="55%"><stop offset="0%" stop-color="#ff3d9a" stop-opacity=".48"/><stop offset="55%" stop-color="#ff3d9a" stop-opacity="0"/></radialGradient>
    <radialGradient id="g3" cx="70%" cy="22%" r="58%"><stop offset="0%" stop-color="#7c5cff" stop-opacity=".55"/><stop offset="55%" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
    <radialGradient id="g4" cx="88%" cy="80%" r="58%"><stop offset="0%" stop-color="#22d3ee" stop-opacity=".5"/><stop offset="55%" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="70%"><stop offset="55%" stop-color="#05030a" stop-opacity="0"/><stop offset="100%" stop-color="#05030a" stop-opacity=".62"/></radialGradient>
    <filter id="cardShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#05030a" flood-opacity=".55"/></filter>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="26" flood-color="#22d3ee" flood-opacity=".45"/></filter>
  </defs>

  <rect width="1200" height="630" fill="#0a0612"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  <rect width="1200" height="630" fill="url(#g3)"/>
  <rect width="1200" height="630" fill="url(#g4)"/>
  <rect width="1200" height="630" fill="url(#vig)"/>

  <!-- drifting cards (right) -->
  ${card(830, 96, -9, '#2f6bff', 'circle', 4)}
  ${card(980, 150, 10, '#e01f47', 'plus', 2)}
  ${card(786, 300, 6, '#f2b807', 'square', 1)}
  ${card(946, 356, -6, '#18b26b', 'triangle', 3)}
  ${card(1040, 470, 12, '#7c5cff', 'wild', 0)}

  <!-- left column -->
  <text x="86" y="300" font-family="Luckiest Guy" font-size="130" fill="#ffffff" filter="url(#glow)">vi<tspan fill="#22d3ee">o</tspan>ta</text>
  <text x="90" y="360" font-family="Fredoka" font-weight="500" font-size="31" fill="#eef1f6">Match on color, shape, and number.</text>
  <text x="92" y="416" font-family="Fredoka" font-weight="600" font-size="19" letter-spacing="3" fill="#b9d6e0">2–4 PLAYERS · FREE · NO DOWNLOAD</text>
</svg>`

const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Fredoka' },
  background: '#0a0612',
})
const png = resvg.render().asPng()
const out = join(client, 'public/og-image.png')
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes), fontFiles: ${fontFiles.length}`)
