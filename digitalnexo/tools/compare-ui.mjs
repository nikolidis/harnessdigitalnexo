#!/usr/bin/env node
// Compara en un navegador la interfaz de Digital Nexo con la del original en la misma version.
//
// Arranca una tras otra las dos aplicaciones web (el original compilado en otra carpeta
// y esta copia), las dos contra el servidor de modelo simulado del repositorio, y recorre
// las mismas pantallas en ambas: inicio, una conversacion completa, trayectoria, menus del
// compositor, ajustes, complementos y tareas. De cada pantalla apunta todos los controles
// (botones, pestanas, interruptores, opciones de menu) y los errores del navegador.
//
// Falla si Digital Nexo tiene errores de consola, de pagina o HTTP, si hace peticiones
// fuera de la maquina, o si entre las dos interfaces hay una diferencia que no este en
// `ui-differences.json` (las que son a proposito: cuenta, comentarios, telemetria).
//
// Uso:  node digitalnexo/tools/compare-ui.mjs <carpeta-del-original-compilado> [--write]
//       CHROME_PATH=/ruta/a/chrome para usar otro navegador. Sale con 3 si no hay navegador.
// `--write` guarda las diferencias encontradas como las esperadas (revisarlas antes).

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instrument, mockModelRows, walkPage } from './ui-walk.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const args = process.argv.slice(2)
const write = args.includes('--write')
const original = args.find((arg) => !arg.startsWith('--'))
if (!original || !existsSync(join(original, 'apps', 'cli', 'src', 'bin.ts'))) {
  console.error('uso: compare-ui.mjs <carpeta-del-original-compilado> [--write]')
  process.exit(2)
}
const EXPECTED = join(here, 'ui-differences.json')
const ANSWER = 'Respuesta de la prueba de interfaz 5148.'
const MINIMUM_SURFACES = 9
const MINIMUM_CONTROLS = 200

const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
let chromium
try {
  ({ chromium } = createRequire(join(root, 'apps', 'web', 'package.json'))('playwright'))
}
catch {
  console.error('No se puede cargar playwright desde apps/web: ejecutar antes `pnpm install`.')
  process.exit(3)
}
if (!existsSync(chrome)) {
  console.error(`No hay navegador en ${chrome}. Indicar uno con CHROME_PATH; sin navegador este paso se omite.`)
  process.exit(3)
}

const scratch = mkdtempSync(join(tmpdir(), 'dn-ui-'))
const children = []

/** Puerto TCP libre en la interfaz local. */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)) })
  })
}

/** Lanza un proceso de una de las dos copias y espera a que su salida cumpla `ready`. */
function launch(cwd, argv, env, ready) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, argv, { cwd, env: { ...process.env, ...env } })
    children.push(child)
    let output = ''
    const timer = setTimeout(() => fail(new Error(`sin respuesta en 180 s: ${argv.slice(-4).join(' ')}\n${output.slice(-400)}`)), 180_000)
    const onData = (chunk) => {
      output += chunk
      const match = ready.exec(output)
      if (match) { clearTimeout(timer); done({ child, match }) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`termino con ${code}: ${output.slice(-400)}`)) })
  })
}

function stop(child) {
  return new Promise((done) => {
    if (child.exitCode !== null) return done()
    child.once('exit', done)
    child.kill('SIGTERM')
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 4000)
  })
}

/** Recorre una de las dos interfaces y devuelve lo que ofrece cada pantalla y lo que fallo. */
async function walk(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' })
  const page = await context.newPage()
  const log = instrument(page)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('button').first().waitFor({ state: 'visible', timeout: 60_000 })
  const result = await walkPage(page, { answer: ANSWER })
  await context.close()
  return { ...result, log: { ...log, externas: [...log.externas] } }
}

let exitCode = 0
try {
  const modelPort = await freePort()
  const modelRows = [...mockModelRows(modelPort), '']
  // El modelo simulado como proveedor de terceros, y una carpeta de documentos propia para que
  // cada aplicacion cree sola su espacio de trabajo inicial (en un servidor no hay `xdg-user-dir`).
  const overlayFor = (tag) => {
    const path = join(scratch, `capa-${tag}.yml`)
    writeFileSync(path, [
      '- id: workspace-controller',
      '  config:',
      `    documentsDirectory: ${join(scratch, `documentos-${tag}`)}`,
      ...modelRows,
    ].join('\n'))
    return path
  }
  await launch(root, ['--import', 'tsx', 'packages/test-support/llm-mock-server/src/bin.ts', '--port', String(modelPort), '--sequence', 'success', '--repeat-last', '--success-text', ANSWER], {}, /"type":"ready"/)

  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-default-apps', '--disable-features=OptimizationHints,MediaRouter,Translate', '--metrics-recording-only'],
  })
  const results = {}
  for (const [tag, cwd] of [['original', resolve(original)], ['digitalnexo', root]]) {
    const env = { DSH_HOME: join(scratch, `home-${tag}`), SIMULADO_API_KEY: 'clave-de-prueba' }
    const { child, match } = await launch(cwd, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--patch', overlayFor(tag), '--no-open', '--port', String(await freePort())], env, /dsh web: (http:\/\/[^\s]+)/)
    results[tag] = await walk(browser, match[1])
    await stop(child)
  }
  await browser.close()

  const { original: base, digitalnexo: ours } = results
  const expected = existsSync(EXPECTED) ? JSON.parse(readFileSync(EXPECTED, 'utf8')) : { soloOriginal: [], soloDigitalNexo: [] }
  const onlyBase = new Set()
  const onlyOurs = new Set()
  const unexpected = []
  let compared = 0
  const names = [...new Set([...Object.keys(base.surfaces), ...Object.keys(ours.surfaces)])].sort()
  for (const name of names) {
    const left = new Set(base.surfaces[name] ?? [])
    const right = new Set(ours.surfaces[name] ?? [])
    compared += new Set([...left, ...right]).size
    for (const control of left) if (!right.has(control)) { onlyBase.add(control); if (!expected.soloOriginal.includes(control)) unexpected.push(`${name}: solo en el original: ${control}`) }
    for (const control of right) if (!left.has(control)) { onlyOurs.add(control); if (!expected.soloDigitalNexo.includes(control)) unexpected.push(`${name}: solo en Digital Nexo: ${control}`) }
  }

  console.log(`Titulo: original ${JSON.stringify(base.title)}, Digital Nexo ${JSON.stringify(ours.title)}`)
  console.log(`Avisos de primer arranque: original ${base.notices.length}, Digital Nexo ${ours.notices.length}`)
  console.log(`Comparados ${compared} controles en ${names.length} pantallas: ${names.join(', ')}`)
  console.log(`Diferencias esperadas presentes: ${[...onlyBase, ...onlyOurs].filter((c) => expected.soloOriginal.includes(c) || expected.soloDigitalNexo.includes(c)).length}`)

  const problems = []
  if (!base.answered) problems.push('el original no mostro la respuesta del modelo simulado: el recorrido no vale como referencia')
  if (!ours.answered) problems.push('Digital Nexo no mostro la respuesta del modelo simulado')
  for (const [kind, entries] of Object.entries(ours.log)) for (const entry of entries) problems.push(`Digital Nexo, ${kind}: ${entry}`)
  if (ours.title !== 'Digital Nexo') problems.push(`el titulo de la pestana es ${JSON.stringify(ours.title)}`)
  if (names.length < MINIMUM_SURFACES || compared < MINIMUM_CONTROLS) problems.push(`el recorrido solo alcanzo ${names.length} pantallas y ${compared} controles: las etiquetas de la interfaz han cambiado y hay que actualizar este guion (no encontrados: ${[...new Set([...base.missing, ...ours.missing])].join(', ')})`)
  if (write) {
    writeFileSync(EXPECTED, `${JSON.stringify({ soloOriginal: [...onlyBase].sort(), soloDigitalNexo: [...onlyOurs].sort() }, null, 1)}\n`)
    console.log(`Diferencias guardadas como esperadas en ${EXPECTED}: revisarlas una a una.`)
  }
  else problems.push(...unexpected.map((line) => `diferencia no esperada, ${line}`))
  const gone = [...expected.soloOriginal.filter((c) => !onlyBase.has(c)), ...expected.soloDigitalNexo.filter((c) => !onlyOurs.has(c))]
  if (gone.length && !write) console.log(`Diferencias esperadas que ya no aparecen (revisar ui-differences.json): ${gone.join(' ; ')}`)
  const baseErrors = Object.values(base.log).flat().length
  if (baseErrors) console.log(`El original tambien registra ${baseErrors} error(es) en este entorno.`)

  if (problems.length) {
    console.error(`INTERFAZ DISTINTA O CON ERRORES (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    exitCode = 1
  }
  else console.log('La interfaz de Digital Nexo coincide con la del original salvo en las diferencias esperadas, sin errores ni peticiones externas.')
}
catch (failure) {
  console.error(`No se pudo completar la comparacion: ${failure?.message ?? failure}`)
  exitCode = 1
}
finally {
  await Promise.all(children.map(stop))
  rmSync(scratch, { recursive: true, force: true })
}
process.exit(exitCode)
