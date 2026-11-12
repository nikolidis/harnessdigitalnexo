// Build the Digital Nexo artwork of the desktop application and its Windows installer from logo.json:
//   apps/desktop/resources/icon.svg, icon.png               application icon (Linux packages, About panel)
//   apps/desktop/resources/icon-windows.svg, .png           Windows application, installer and uninstaller icon
//   apps/desktop/resources/icon-macos.svg, .png             macOS icon (inset tile; this distribution builds no macOS package)
//   apps/desktop/resources/tray-windows.ico                 Windows tray icon, one bitmap per display scale
//   apps/desktop/installer/assets/brand*.png                installer header, light and dark, 1x and 2x
//   apps/desktop/installer/assets/uninstaller-sidebar.png   uninstaller side panel
//
// Usage (from the repository root, after `pnpm install`):
//   node digitalnexo/brand/build-desktop-assets.mjs            # writes straight into the repository
//   node digitalnexo/brand/build-desktop-assets.mjs /tmp/out    # writes everything into one folder to review
// Rendering uses the Playwright Chromium the repository already depends on; set DIGITALNEXO_CHROME to the
// path of an installed Chrome to use that one instead.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const L = JSON.parse(readFileSync(new URL('./logo.json', import.meta.url)))
const review = process.argv[2]
const out = review ?? fileURLToPath(new URL('./.out-desktop', import.meta.url))
mkdirSync(out, { recursive: true })

// Same palette as build-assets.mjs (website theme).
const INK = '#1e2228'
const PAPER = '#ffffff'
const ACCENT = '#754740'
const ACCENT_LIGHT = '#e59c8f'
const LIGHT_TILE = '#f4f4f5'
const round = n => Math.round(n * 1000) / 1000

/**
 * SVG of the square "D." tile on a transparent canvas.
 * @param {{ edge: number, inset: number, radius: number, ratio: number, tile: string, glyph: string, accent: string }} o
 *   canvas edge, transparent margin on each side, corner radius and glyph height as fractions of the tile edge.
 */
function tile({ edge, inset = 0, radius = 0.225, ratio = 0.56, tile = INK, glyph = PAPER, accent = ACCENT_LIGHT }) {
  const size = edge - 2 * inset
  const scale = (size * ratio) / L.monogram.height
  const x = inset + (size - L.monogram.width * scale) / 2
  const y = inset + (size - L.monogram.height * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}" fill="none">`
    + `<rect x="${inset}" y="${inset}" width="${size}" height="${size}" rx="${round(size * radius)}" fill="${tile}"/>`
    + `<g transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})">`
    + `<path d="${L.monogram.letters}" fill="${glyph}"/><path d="${L.monogram.dot}" fill="${accent}"/></g></svg>\n`
}

/** Installer header: tile above the wordmark, centred on a transparent canvas of the original's 600x196 layout. */
function header({ scale, dark }) {
  const width = 600 * scale
  const height = 196 * scale
  const tileEdge = 104 * scale
  const tileX = (width - tileEdge) / 2
  const tileY = 18 * scale
  const markHeight = 26 * scale
  const markScale = markHeight / L.wordmark.height
  const markWidth = L.wordmark.width * markScale
  const markX = (width - markWidth) / 2
  const markY = 148 * scale
  const inner = tile({ edge: tileEdge, ...(dark ? { tile: LIGHT_TILE, glyph: INK, accent: ACCENT } : {}) })
    .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\n$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`
    + `<g transform="translate(${round(tileX)} ${round(tileY)})">${inner}</g>`
    + `<g transform="translate(${round(markX)} ${round(markY)}) scale(${round(markScale)})">`
    + `<path d="${L.wordmark.letters}" fill="${dark ? PAPER : INK}"/><path d="${L.wordmark.dot}" fill="${dark ? ACCENT_LIGHT : ACCENT}"/></g></svg>\n`
}

/** Uninstaller side panel: the original's light grey background with the tile in the middle. */
function sidebar() {
  const inner = tile({ edge: 112 }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\n$/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314" fill="none">`
    + `<rect width="164" height="314" fill="#f3f4f6"/><g transform="translate(26 101)">${inner}</g></svg>\n`
}

const svgs = {
  'icon.svg': tile({ edge: 1024 }),
  'icon-windows.svg': tile({ edge: 1024, inset: 32 }),
  'icon-macos.svg': tile({ edge: 1024, inset: 100, radius: 0.2237 }),
}
for (const [name, svg] of Object.entries(svgs)) writeFileSync(`${out}/${name}`, svg)

async function launch() {
  const { chromium } = createRequire(`${ROOT}apps/web/package.json`)('playwright')
  const executablePath = process.env.DIGITALNEXO_CHROME
  return chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) })
}
const browser = await launch()
async function png(path, width, height, svg, transparent = true) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg style="display:block" ')}</body></html>`)
  const bytes = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } })
  await page.close()
  if (path !== undefined) writeFileSync(path, bytes)
  return bytes
}
await png(`${out}/icon.png`, 1024, 1024, svgs['icon.svg'])
await png(`${out}/icon-windows.png`, 1024, 1024, svgs['icon-windows.svg'])
await png(`${out}/icon-macos.png`, 1024, 1024, svgs['icon-macos.svg'])
await png(`${out}/brand.png`, 600, 196, header({ scale: 1, dark: false }))
await png(`${out}/brand-2x.png`, 1200, 392, header({ scale: 2, dark: false }))
await png(`${out}/brand-dark.png`, 600, 196, header({ scale: 1, dark: true }))
await png(`${out}/brand-dark-2x.png`, 1200, 392, header({ scale: 2, dark: true }))
const sidebarPng = await png(undefined, 164, 314, sidebar(), false)

// Tray: each size rendered separately so small bitmaps stay sharp; the tile fills the bitmap with a 1px margin.
const TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64]
const trayBitmaps = []
for (const size of TRAY_SIZES) {
  trayBitmaps.push({ size, png: await png(undefined, size, size, tile({ edge: size, inset: size >= 32 ? 2 : 1, ratio: 0.6 })) })
}
await browser.close()

/** Pack PNG bitmaps into one ICO file (PNG-compressed entries, read by Windows Vista and later). */
function packIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach((entry, index) => {
    const at = 6 + 16 * index
    header.writeUInt8(entry.size % 256, at)
    header.writeUInt8(entry.size % 256, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(entry.png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })
  return Buffer.concat([header, ...entries.map(entry => entry.png)])
}
writeFileSync(`${out}/tray-windows.ico`, packIco(trayBitmaps))

// The sidebar is stored as RGB like the original: decode the screenshot and drop its alpha channel.
const { default: sharp } = await import(createRequire(`${ROOT}apps/desktop/package.json`).resolve('sharp'))
await sharp(sidebarPng).removeAlpha().png().toFile(`${out}/uninstaller-sidebar.png`)

if (review === undefined) {
  for (const name of ['icon.svg', 'icon.png', 'icon-windows.svg', 'icon-windows.png', 'icon-macos.svg', 'icon-macos.png', 'tray-windows.ico']) {
    copyFileSync(`${out}/${name}`, `${ROOT}apps/desktop/resources/${name}`)
  }
  for (const name of ['brand.png', 'brand-2x.png', 'brand-dark.png', 'brand-dark-2x.png', 'uninstaller-sidebar.png']) {
    copyFileSync(`${out}/${name}`, `${ROOT}apps/desktop/installer/assets/${name}`)
  }
  console.log('desktop brand assets written into the repository')
} else {
  console.log('desktop brand assets written to', out)
}
