#!/usr/bin/env node
// Compara dos ejecuciones de la bateria de pruebas: la del original sin tocar (rama
// `upstream`) y la de Digital Nexo, hechas en la misma maquina.
//
// La bateria del original tiene pruebas que dependen del entorno (IPv6, permisos de
// root, flujos de GitHub que esta distribucion no lleva). Por eso el criterio no es
// "cero fallos", sino "ningun fallo que el original no tenga tambien aqui".
//
// Cada ejecucion se obtiene con:
//   node_modules/.bin/vitest run --reporter=json --outputFile=<fichero.json>
//
// Uso:  node digitalnexo/tools/compare-tests.mjs <original.json> <digitalnexo.json> [--verbose]
//       node digitalnexo/tools/compare-tests.mjs --failed-files <digitalnexo.json>
// La primera forma sale con 1 si Digital Nexo tiene fallos propios. La segunda lista los
// ficheros de prueba con algun fallo, para ejecutar solo esos en el original: el informe
// del original puede ser parcial, porque solo se consulta para las pruebas que fallan aqui.

import { readFileSync } from 'node:fs'

const flags = process.argv.slice(2).filter((arg) => arg.startsWith('--'))
const [basePath, oursPath] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const listFailedFiles = flags.includes('--failed-files')
if (!basePath || (!oursPath && !listFailedFiles)) {
  console.error('uso: compare-tests.mjs <original.json> <digitalnexo.json> [--verbose] | --failed-files <digitalnexo.json>')
  process.exit(2)
}

/** Estado por prueba, con la ruta del fichero relativa a la raiz de cada copia. */
function load(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'))
  const files = report.testResults.map((f) => f.name)
  const root = files.reduce((prefix, name) => { while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1); return prefix }, files[0] ?? '')
  const tests = new Map()
  const brokenFiles = new Set()
  for (const file of report.testResults) {
    const rel = file.name.slice(root.length)
    if (file.status === 'failed' && file.assertionResults.length === 0) brokenFiles.add(rel)
    for (const t of file.assertionResults) tests.set(`${rel} > ${t.fullName}`, t.status)
  }
  const failedFiles = report.testResults.filter((f) => f.status === 'failed').map((f) => f.name.slice(root.length)).sort()
  return { tests, brokenFiles, failedFiles, total: report.numTotalTests, failed: report.numFailedTests, files: files.length }
}

if (listFailedFiles) {
  console.log(load(basePath).failedFiles.join('\n'))
  process.exit(0)
}

const base = load(basePath)
const ours = load(oursPath)
const own = []
const shared = []
for (const [name, status] of ours.tests) {
  if (status !== 'failed') continue
  // Los nombres de prueba que citan el producto cambian con la marca; se comparan sin ella.
  const inBase = base.tests.get(name) ?? base.tests.get(name.replaceAll('Digital Nexo', 'DSH'))
  if (inBase === 'failed') shared.push(name)
  else own.push(`${name}  [en el original: ${inBase ?? 'no existe'}]`)
}
for (const file of ours.brokenFiles) (base.brokenFiles.has(file) ? shared : own).push(`${file} > (el fichero no carga)`)
const skippedOnlyHere = [...ours.tests].filter(([name, status]) => (status === 'skipped' || status === 'pending') && base.tests.get(name) === 'passed').map(([name]) => name)

console.log(`Original:     ${base.files} ficheros, ${base.total} pruebas, ${base.failed} fallidas`)
console.log(`Digital Nexo: ${ours.files} ficheros, ${ours.total} pruebas, ${ours.failed} fallidas`)
console.log(`Fallos que tambien tiene el original en esta maquina: ${shared.length}`)
console.log(`Pruebas que aqui se omiten y en el original pasan: ${skippedOnlyHere.length} (las de la cuenta de DeepSeek, desactivada)`)
if (flags.includes('--verbose')) for (const name of skippedOnlyHere) console.log(`  ~ ${name}`)
if (own.length) {
  console.error(`\nFALLOS PROPIOS DE DIGITAL NEXO (${own.length}):\n${own.map((n) => `  - ${n}`).join('\n')}`)
  process.exit(1)
}
console.log('\nNingun fallo propio de Digital Nexo.')
