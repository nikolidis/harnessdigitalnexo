#!/usr/bin/env node
// Comprueba que los perfiles que distribuye Digital Nexo siguen sin ningun servicio de DeepSeek.
//
// Compone cada perfil con `dsh --profile <p> --dump-default-config` y falla si:
//   - una fila que la capa Digital Nexo desactiva vuelve a estar activa o ya no existe
//     (el proyecto original la renombro: hay que actualizar `digitalnexo.patch.yml`);
//   - aparece activa una fila de DeepSeek, telemetria, analitica o comentarios que no
//     este en la lista de permitidas de abajo;
//   - el perfil web pierde la marca, el modelo por defecto vuelve a ser de DeepSeek,
//     o la busqueda web deja de ocultarse cuando no hay proveedor;
//   - la composicion escribe avisos (un parche que no encuentra su fila).
// Ademas compara las filas con `digitalnexo/composition-baseline.json` y lista las
// que entran o salen, para revisarlas. `--write` regenera esa referencia.
//
// Uso:  node digitalnexo/tools/check-composition.mjs [--write]

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const write = process.argv.includes('--write')
const PROFILES = ['web', 'headless', 'acp', 'sdk', 'sdk-minimal']
const LAYERS = ['base', 'web-app', 'acp-app', 'sdk-minimal'].map((b) => `packages/bundle/${b}/digitalnexo.patch.yml`)
const BASELINE = join(root, 'digitalnexo', 'composition-baseline.json')
const SUSPECT = /deepseek|otel|telemetry|analytics|feedback/
// Filas activas cuyo nombre coincide con SUSPECT pero no hablan con DeepSeek. Cada una con su motivo.
const ALLOWED = new Map(Object.entries(JSON.parse(readFileSync(join(root, 'digitalnexo', 'tools', 'allowed-rows.json'), 'utf8'))))

/** Filas (`- id:` a cualquier profundidad) del volcado, con su estado y su configuracion en texto. */
function rows(dump) {
  const found = []
  let current = null
  for (const line of dump.split('\n')) {
    const start = /^(\s*)- id: (\S+)\s*$/.exec(line)
    if (start) {
      current = { id: start[2].replaceAll("'", ''), indent: start[1].length, name: '', state: 'activa', body: '' }
      found.push(current)
      continue
    }
    if (!current) continue
    const field = new RegExp(`^ {${current.indent + 2}}(name|disabled): (.*)$`).exec(line)
    if (field?.[1] === 'name') current.name = field[2].replaceAll("'", '')
    else if (field?.[1] === 'disabled') current.state = field[2].trim() === 'true' ? 'desactivada' : field[2].trim() === 'false' ? 'activa' : 'condicional'
    else current.body += `${line}\n`
  }
  return found
}

const mustBeOff = new Set()
for (const layer of LAYERS) {
  const text = readFileSync(join(root, layer), 'utf8')
  for (const m of text.matchAll(/^- id: (\S+)\n {2}disabled: true$/gm)) mustBeOff.add(m[1])
}

const problems = []
const notes = []
const seenOff = new Set()
const snapshot = {}
const home = mkdtempSync(join(tmpdir(), 'dn-composition-'))
for (const profile of PROFILES) {
  const run = spawnSync(process.execPath, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', profile, '--dump-default-config'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, DSH_HOME: join(home, profile) }, maxBuffer: 64 * 1024 * 1024,
  })
  if (run.status !== 0) { problems.push(`${profile}: no se pudo componer (salida ${run.status}): ${run.stderr.trim().split('\n').at(-1)}`); continue }
  if (run.stderr.trim()) problems.push(`${profile}: la composicion escribio avisos:\n${run.stderr.trim()}`)
  const list = rows(run.stdout)
  snapshot[profile] = list.map((r) => `${r.id}  ${r.name}  ${r.state}`).sort()
  for (const row of list) {
    if (mustBeOff.has(row.id)) {
      seenOff.add(row.id)
      if (row.state !== 'desactivada') problems.push(`${profile}: la fila "${row.id}" deberia estar desactivada y esta ${row.state}`)
    }
    else if (row.state !== 'desactivada' && SUSPECT.test(`${row.id} ${row.name.replace(/^@[^/]+\//, '')}`) && !ALLOWED.has(row.id)) {
      problems.push(`${profile}: fila sospechosa ${row.state}: "${row.id}" (${row.name}). Desactivarla en digitalnexo.patch.yml o justificarla en digitalnexo/tools/allowed-rows.json`)
    }
  }
  const model = list.find((r) => r.id === 'agent-default-model')
  if (model && /provider: deepseek/.test(model.body)) problems.push(`${profile}: el modelo por defecto vuelve a apuntar a DeepSeek`)
  if (profile === 'web') {
    if (list.find((r) => r.id === 'ui-brand-digitalnexo')?.state !== 'activa') problems.push('web: falta la fila de marca ui-brand-digitalnexo')
    if (!/readyRequiresProvider: true/.test(list.find((r) => r.id === 'web')?.body ?? '')) problems.push('web: la fila "web" ha perdido readyRequiresProvider: true')
  }
}
rmSync(home, { recursive: true, force: true })
for (const id of mustBeOff) if (!seenOff.has(id)) problems.push(`la fila "${id}" que desactiva la capa Digital Nexo ya no existe en ningun perfil (renombrada o eliminada en el original)`)

if (write) writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 1)}\n`)
else if (existsSync(BASELINE)) {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  for (const profile of PROFILES) {
    const before = new Set(baseline[profile] ?? [])
    const after = new Set(snapshot[profile] ?? [])
    for (const row of after) if (!before.has(row)) notes.push(`+ ${profile}: ${row}`)
    for (const row of before) if (!after.has(row)) notes.push(`- ${profile}: ${row}`)
  }
}

if (notes.length) console.log(`Cambios de composicion respecto a la referencia (${notes.length}):\n${notes.join('\n')}\n`)
if (problems.length) {
  console.error(`COMPOSICION INCORRECTA (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`Composicion correcta: ${PROFILES.map((p) => `${p} ${snapshot[p].length} filas`).join(', ')}; ${mustBeOff.size} filas de DeepSeek desactivadas.${write ? ' Referencia regenerada.' : ''}`)
