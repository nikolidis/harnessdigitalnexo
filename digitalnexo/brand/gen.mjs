// Rebuild the Digital Nexo wordmark as vector outlines from the same recipe the
// website uses: "DIGITALNEXO" in Inter ExtraBold (800), letter-spacing -0.05em,
// followed by an accent-coloured period. Output: path data + geometry as JSON.
//
// Usage: cd digitalnexo/brand && npm install && node gen.mjs   (rewrites logo.json)
import { readFileSync, writeFileSync } from 'node:fs'
import opentype from 'opentype.js'

const fontBuffer = readFileSync(new URL('./node_modules/@fontsource/inter/files/inter-latin-800-normal.woff', import.meta.url))
const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength))

const TRACKING_EM = -0.05
const round = n => Math.round(n * 1000) / 1000

/** Lay out text at `size` px with tracking; returns per-glyph paths positioned from x=0, baseline y=0. */
function layout(text, size) {
  const scale = size / font.unitsPerEm
  const glyphs = font.stringToGlyphs(text)
  let x = 0
  const parts = []
  glyphs.forEach((glyph, i) => {
    const path = glyph.getPath(x, 0, size)
    parts.push({ char: text[i], path, x })
    let advance = glyph.advanceWidth * scale
    if (i < glyphs.length - 1) advance += font.getKerningValue(glyph, glyphs[i + 1]) * scale
    x += advance + TRACKING_EM * size
  })
  return { parts, width: x - TRACKING_EM * size }
}

function bbox(paths) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const p of paths) {
    const b = p.getBoundingBox()
    x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2)
  }
  return { x1, y1, x2, y2 }
}

/** Translate path commands and serialise with 3 decimals. */
function toData(path, dx, dy) {
  const out = []
  for (const c of path.commands) {
    if (c.type === 'M') out.push(`M${round(c.x + dx)} ${round(c.y + dy)}`)
    else if (c.type === 'L') out.push(`L${round(c.x + dx)} ${round(c.y + dy)}`)
    else if (c.type === 'C') out.push(`C${round(c.x1 + dx)} ${round(c.y1 + dy)} ${round(c.x2 + dx)} ${round(c.y2 + dy)} ${round(c.x + dx)} ${round(c.y + dy)}`)
    else if (c.type === 'Q') out.push(`Q${round(c.x1 + dx)} ${round(c.y1 + dy)} ${round(c.x + dx)} ${round(c.y + dy)}`)
    else if (c.type === 'Z') out.push('Z')
  }
  return out.join('')
}

function build(text, size) {
  const { parts } = layout(text + '.', size)
  const letters = parts.slice(0, -1).map(p => p.path)
  const dot = parts[parts.length - 1].path
  const all = bbox([...letters, dot])
  const dx = -all.x1
  const dy = -all.y1
  return {
    text,
    fontSize: size,
    width: round(all.x2 - all.x1),
    height: round(all.y2 - all.y1),
    letters: letters.map(p => toData(p, dx, dy)).join(''),
    dot: toData(dot, dx, dy),
  }
}

const capHeight = (font.tables.os2.sCapHeight ?? 1490) / font.unitsPerEm
const result = {
  font: { family: font.names.fontFamily?.en, subfamily: font.names.fontSubfamily?.en, version: font.names.version?.en, unitsPerEm: font.unitsPerEm, capHeight },
  // Sizes chosen so the cap height is exactly 100 units; consumers scale by viewBox.
  wordmark: build('DIGITALNEXO', 100 / capHeight),
  monogram: build('D', 100 / capHeight),
}
writeFileSync(new URL('./logo.json', import.meta.url), JSON.stringify(result, null, 1))
console.log(JSON.stringify({ font: result.font, wordmark: { w: result.wordmark.width, h: result.wordmark.height, len: result.wordmark.letters.length }, monogram: { w: result.monogram.width, h: result.monogram.height, len: result.monogram.letters.length, dot: result.monogram.dot.length } }, null, 1))
