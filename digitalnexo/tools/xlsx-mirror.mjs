#!/usr/bin/env node
// Permite instalar dependencias en un entorno que no llega a cdn.sheetjs.com.
//
// El proyecto original fija `xlsx` a un .tgz de cdn.sheetjs.com. Donde ese dominio
// esta bloqueado, `pnpm install` falla. `on` redirige `xlsx` a la republicacion en
// npm `@e965/xlsx` (misma version) SOLO en la copia de trabajo; `off` deja
// `pnpm-workspace.yaml` y `pnpm-lock.yaml` como los quiere el repositorio, con la
// referencia original. Nunca se confirma el estado `on`.
//
// Uso:  node digitalnexo/tools/xlsx-mirror.mjs on    (antes de pnpm install)
//       node digitalnexo/tools/xlsx-mirror.mjs off   (antes de git add / git commit)

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mode = process.argv[2]
if (mode !== 'on' && mode !== 'off') { console.error('uso: xlsx-mirror.mjs on|off'); process.exit(2) }

const VERSION = '0.20.3'
const URL = `https://cdn.sheetjs.com/xlsx-${VERSION}/xlsx-${VERSION}.tgz`
const MIRROR = `@e965/xlsx@${VERSION}`
const ORIGINAL_INTEGRITY = 'sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA=='
const WORKSPACE_LINES = [
  '  # SOLO LOCAL (no confirmar): este entorno no llega a cdn.sheetjs.com.',
  `  xlsx: 'npm:${MIRROR}'`,
]

const workspacePath = join(root, 'pnpm-workspace.yaml')
const lockPath = join(root, 'pnpm-lock.yaml')
let workspace = readFileSync(workspacePath, 'utf8')
let lock = readFileSync(lockPath, 'utf8')

if (!workspace.includes(URL) && !readFileSync(lockPath, 'utf8').includes('xlsx')) {
  console.log('El proyecto ya no depende de xlsx: esta herramienta sobra.')
  process.exit(0)
}

// Estado `off` primero, siempre; `on` solo toca pnpm-workspace.yaml y deja que pnpm reescriba el lockfile.
workspace = workspace.split('\n').filter((line) => !/^\s+xlsx: 'npm:@e965\/xlsx@/.test(line) && !/^\s+# (SOLO LOCAL|LOCAL BUILD ONLY)/.test(line)).join('\n')
lock = lock
  .replace(/^ {2}xlsx: npm:@e965\/xlsx@[^\n]*\n/m, '')
  .replaceAll(`specifier: npm:${MIRROR}`, `specifier: ${URL}`)
  .replaceAll(`version: '${MIRROR}'`, `version: ${URL}`)
  .replace(/^ {2}'@e965\/xlsx@[^']*':\n {4}resolution: \{[^\n]*\}\n {4}engines: \{node: '>=0\.8'\}\n {4}hasBin: true\n\n/m, '')
  .replace(/^ {2}'@e965\/xlsx@[^']*': \{\}\n\n/m, '')
const packageBlock = `  xlsx@${URL}:\n    resolution: {integrity: ${ORIGINAL_INTEGRITY}, tarball: ${URL}}\n    version: ${VERSION}\n    engines: {node: '>=0.8'}\n    hasBin: true\n\n`
const snapshotBlock = `  xlsx@${URL}: {}\n\n`
if (!lock.includes(packageBlock)) lock = insertSorted(lock, 'packages', packageBlock)
if (!lock.includes(snapshotBlock)) lock = insertSorted(lock, 'snapshots', snapshotBlock)

/** Inserta un bloque en una seccion del lockfile respetando el orden alfabetico de sus claves. */
function insertSorted(text, section, block) {
  const start = text.indexOf(`\n${section}:\n`)
  if (start < 0) throw new Error(`pnpm-lock.yaml no tiene la seccion ${section}`)
  const nextSection = /\n[a-zA-Z]+:\n/g
  nextSection.lastIndex = start + section.length + 2
  const end = nextSection.exec(text)?.index ?? text.length
  const body = text.slice(start, end)
  const key = (line) => line.replace(/^ {2}'?/, '').replace(/'?:.*$/, '')
  const mine = key(block.split('\n')[0])
  const heads = [...body.matchAll(/^ {2}\S[^\n]*$/gm)]
  const after = heads.find((h) => key(h[0]).localeCompare(mine, 'en') > 0)
  const at = after ? start + after.index : end + 1
  return text.slice(0, at) + block + text.slice(at)
}

if (mode === 'on') {
  const anchor = /^overrides:\n/m
  if (!anchor.test(workspace)) throw new Error('pnpm-workspace.yaml no tiene bloque overrides')
  workspace = workspace.replace(anchor, `overrides:\n${WORKSPACE_LINES.join('\n')}\n`)
}
writeFileSync(workspacePath, workspace)
if (mode === 'off') writeFileSync(lockPath, lock)
console.log(mode === 'on'
  ? 'xlsx redirigido a npm en la copia de trabajo. Ejecutar `pnpm install`; antes de confirmar, `xlsx-mirror.mjs off`.'
  : 'pnpm-workspace.yaml y pnpm-lock.yaml restaurados a la referencia original de xlsx.')
