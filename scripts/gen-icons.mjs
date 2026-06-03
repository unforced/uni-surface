// Generate PWA app icons (warm cream + clay/sage sprout) with the local Chrome.
// One-off tool, like the screenshot script — not shipped. Run: node scripts/gen-icons.mjs
import puppeteer from 'puppeteer-core'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const here = dirname(fileURLToPath(import.meta.url))
const pub = join(here, '..', 'public')
mkdirSync(pub, { recursive: true })

// The sprout, scaled and centered into the inner ~58% (maskable safe zone).
// Full-bleed cream background so it reads on both "any" and "maskable" masks.
function svg(size, { bleed = true } = {}) {
  const cream1 = '#f7f1e6', cream2 = '#fdf9f1'
  const sage = '#7d8c6a', clay = '#c06b4a'
  const mossWash = '#e7ecd9', terraWash = '#f4ddd0'
  const r = bleed ? 0 : size * 0.22 // rounded only for the non-maskable variant
  // Place the 24x24 glyph in the central safe zone.
  const g = size * 0.5 // glyph box edge
  const off = (size - g) / 2
  const sw = (24 / g) // stroke scale back to glyph units handled by viewBox
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${cream2}"/><stop offset="1" stop-color="${cream1}"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <g transform="translate(${off} ${off}) scale(${g / 24})" fill="none"
     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 21c0-4 0-7 0-9" stroke="${sage}" stroke-width="1.8"/>
    <path d="M12 13c-3.2 0-5.5-2-5.5-5C9.5 8 12 9.8 12 13Z" fill="${mossWash}" stroke="${sage}"/>
    <path d="M12 11c0-2.6 2-4.6 5-4.6C17 9 14.8 11 12 11Z" fill="${terraWash}" stroke="${clay}"/>
    <circle cx="12" cy="21.5" r="1.3" fill="${clay}" stroke="none"/>
  </g>
</svg>`
}

const targets = [
  { name: 'pwa-192.png', size: 192, bleed: false },
  { name: 'pwa-512.png', size: 512, bleed: false },
  { name: 'maskable-512.png', size: 512, bleed: true },
  { name: 'apple-touch-icon.png', size: 180, bleed: false },
  { name: 'favicon-64.png', size: 64, bleed: false },
]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
try {
  for (const t of targets) {
    const page = await browser.newPage()
    await page.setViewport({ width: t.size, height: t.size, deviceScaleFactor: 1 })
    const markup = svg(t.size, { bleed: t.bleed })
    await page.goto('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup))
    const buf = await page.screenshot({ omitBackground: false, clip: { x: 0, y: 0, width: t.size, height: t.size } })
    writeFileSync(join(pub, t.name), buf)
    await page.close()
    console.log('wrote', t.name, t.size)
  }
  // Also drop the raw maskable SVG for reference.
  writeFileSync(join(pub, 'icon.svg'), svg(512, { bleed: false }))
} finally {
  await browser.close()
}
