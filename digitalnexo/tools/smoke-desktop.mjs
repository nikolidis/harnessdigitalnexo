#!/usr/bin/env node
// Prueba de la aplicación de escritorio YA EMPAQUETADA (o instalada), sin ninguna clave real.
//
// Arranca el ejecutable con un directorio de datos propio y el puerto de depuración remota abierto,
// declara como proveedor de terceros el servidor de modelo simulado del repositorio, se conecta a
// la ventana con Playwright y recorre la interfaz en español: aviso de primer arranque, una
// conversacion completa, ajustes, complementos y tareas. Comprueba que:
//   - se abre directamente el espacio de trabajo (no hay ventana de bienvenida ni inicio de sesion);
//   - el aviso de primer arranque es el de Digital Nexo;
//   - el modelo simulado responde;
//   - no hay errores de consola, de pagina ni HTTP, ni peticiones fuera de la maquina;
// Lista para revisar, sin fallar, cada linea visible que nombre DeepSeek fuera del aviso de atribucion.
// Guarda una captura por pantalla y `informe.json` en la carpeta de salida.
//
// Uso:  node digitalnexo/tools/smoke-desktop.mjs <ejecutable> [argumentos de la aplicacion] [--out <carpeta>] [--no-sandbox]
//       En Linux sin pantalla, delante: xvfb-run -a
// Sale con 1 si algo falla.

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { instrument, mockModelRows, walkPage } from './ui-walk.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string', default: 'smoke-desktop' }, 'no-sandbox': { type: 'boolean', default: false } },
})
const executable = positionals[0] === undefined ? undefined : resolve(positionals[0])
if (executable === undefined || !existsSync(executable)) {
  console.error('uso: smoke-desktop.mjs <ejecutable> [--out <carpeta>] [--no-sandbox]')
  process.exit(2)
}
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
const ANSWER = 'Respuesta de la prueba de escritorio 7310.'
const { chromium } = createRequire(join(root, 'apps', 'web', 'package.json'))('playwright')

const scratch = mkdtempSync(join(tmpdir(), 'dn-desktop-'))
const children = []
const problems = []
const report = { ejecutable: executable }
let appOutput = ''

/** Puerto TCP libre en la interfaz local. */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once('error', fail)
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)) })
  })
}

/** Termina un proceso y todos sus hijos (la aplicacion arranca su Host como proceso hijo). */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else {
    try { process.kill(-child.pid, 'SIGKILL') }
    catch { child.kill('SIGKILL') }
  }
}

/** Fallo definitivo dentro de una espera: corta la espera en vez de reintentar. */
class Abort extends Error {}

async function waitFor(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let value
    try { value = await check() }
    catch (failure) {
      if (failure instanceof Abort) throw failure
    }
    if (value) return value
    if (Date.now() > deadline) throw new Error(`tiempo agotado esperando ${what}`)
    await new Promise(done => setTimeout(done, 500))
  }
}

let browser
try {
  // 1. Modelo simulado.
  const modelPort = await freePort()
  const model = spawn(process.execPath, ['--import', 'tsx', 'packages/test-support/llm-mock-server/src/bin.ts',
    '--port', String(modelPort), '--sequence', 'success', '--repeat-last', '--success-text', ANSWER], { cwd: root })
  children.push(model)
  let modelOutput = ''
  model.stdout.on('data', chunk => { modelOutput += chunk })
  model.stderr.on('data', chunk => { modelOutput += chunk })
  await waitFor(async () => {
    if (model.exitCode !== null) throw new Abort(`el modelo simulado termino: ${modelOutput.slice(-400)}`)
    return modelOutput.includes('"type":"ready"')
  }, 120_000, 'el modelo simulado')

  // 2. Datos propios: perfil desktop con el modelo simulado, idioma español y carpeta de documentos.
  const home = join(scratch, 'home')
  mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), [
    '- id: workspace-controller',
    '  config:',
    `    documentsDirectory: ${JSON.stringify(join(scratch, 'documentos'))}`,
    '- id: locale',
    '  config:',
    '    preference: es',
    ...mockModelRows(modelPort),
    '',
  ].join('\n'))

  // 3. La aplicacion, con depuracion remota.
  const debugPort = await freePort()
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'electron')}`, '--lang=es']
  if (values['no-sandbox']) args.push('--no-sandbox')
  // Lo que sigue al ejecutable pasa a la aplicacion tal cual (p. ej. la carpeta de la app con un Electron sin empaquetar).
  args.push(...positionals.slice(1))
  const app = spawn(executable, args, {
    env: { ...process.env, DSH_HOME: home, SIMULADO_API_KEY: 'clave-de-prueba', ELECTRON_ENABLE_LOGGING: '1' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(app)
  app.stdout.on('data', chunk => { appOutput += chunk })
  app.stderr.on('data', chunk => { appOutput += chunk })
  const started = Date.now()

  await waitFor(async () => {
    if (app.exitCode !== null) throw new Abort(`la aplicacion termino al arrancar con codigo ${app.exitCode}`)
    return (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok
  }, 120_000, 'el puerto de depuracion')
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
  const appPage = () => browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('dsh-app://app'))
  const page = await waitFor(async () => appPage(), 120_000, 'la ventana de la aplicacion')
  const log = instrument(page, ['dsh-app:'])
  await waitFor(async () => page.locator('button').first().isVisible(), 180_000, 'el espacio de trabajo')
  report.segundosHastaEspacioDeTrabajo = Math.round((Date.now() - started) / 1000)
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})

  const windows = () => browser.contexts().flatMap(context => context.pages()).map(each => each.url())
  report.ventanas = windows()
  if (report.ventanas.some(url => url.includes('welcome'))) problems.push(`se abrio la ventana de bienvenida de DeepSeek: ${report.ventanas.join(', ')}`)

  const brand = new Set()
  const shot = async (name) => {
    await page.screenshot({ path: join(out, `${name.replaceAll('/', '-')}.png`) }).catch(() => {})
    const text = await page.locator('body').innerText().catch(() => '')
    for (const line of text.split('\n')) {
      if (/deepseek/i.test(line) && !/construido sobre|built on/i.test(line)) brand.add(`${name}: ${line.trim().slice(0, 120)}`)
    }
  }
  const result = await walkPage(page, { answer: ANSWER, shot })
  Object.assign(report, {
    titulo: result.title,
    avisos: result.notices,
    respondio: result.answered,
    pantallas: Object.fromEntries(Object.entries(result.surfaces).map(([name, list]) => [name, list.length])),
    controles: result.surfaces,
    noEncontrados: result.missing,
    errores: { ...log, externas: [...log.externas] },
    marcaDeepSeek: [...brand],
    ventanasAlFinal: windows(),
  })
  if (result.title !== 'Digital Nexo') problems.push(`el titulo de la ventana es ${JSON.stringify(result.title)}`)
  if (!result.notices.some(notice => notice.includes('Digital Nexo'))) problems.push(`no aparecio el aviso de primer arranque de Digital Nexo (avisos: ${JSON.stringify(result.notices)})`)
  if (!result.answered) problems.push('el modelo simulado no respondio en la conversacion')
  if (Object.keys(result.surfaces).length < 9) problems.push(`el recorrido solo alcanzo ${Object.keys(result.surfaces).length} pantallas (no encontrados: ${result.missing.join(', ')})`)
  for (const [kind, entries] of Object.entries(report.errores)) for (const entry of entries) problems.push(`${kind}: ${entry}`)
}
catch (failure) {
  problems.push(String(failure?.message ?? failure))
}
finally {
  await browser?.close().catch(() => {})
  for (const child of children) killTree(child)
  await new Promise(done => setTimeout(done, 1500))
  report.salidaAplicacion = appOutput.split('\n').slice(-80).join('\n')
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) }
  catch (failure) { console.warn(`no se pudo borrar ${scratch}: ${failure.message}`) }
}

report.problemas = problems
writeFileSync(join(out, 'informe.json'), `${JSON.stringify(report, null, 1)}\n`)
console.log(`Ventana: ${report.titulo ?? '?'}; espacio de trabajo en ${report.segundosHastaEspacioDeTrabajo ?? '?'} s; pantallas: ${Object.keys(report.pantallas ?? {}).length}`)
// Menciones de DeepSeek fuera del aviso de atribucion: se listan para revisarlas (nombres de paquetes
// `@deepseek-ai/*` en complementos integrados son esperables), no hacen fallar la prueba.
if (report.marcaDeepSeek?.length) console.log(`Menciones de DeepSeek para revisar:\n${report.marcaDeepSeek.map(line => `  - ${line}`).join('\n')}`)
if (problems.length) {
  console.error(`PRUEBA DE ESCRITORIO FALLIDA (${problems.length}):\n${problems.map(p => `  - ${p}`).join('\n')}`)
  if (report.salidaAplicacion) console.error(`--- ultimas lineas de la aplicacion ---\n${report.salidaAplicacion}`)
  process.exit(1)
}
console.log('Prueba de escritorio correcta: espacio de trabajo directo, aviso de Digital Nexo, respuesta del modelo, sin errores ni peticiones externas.')
