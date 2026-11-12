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
//   - ningun proceso de la aplicacion sale de la maquina salvo lo admitido en ALLOWED_CHROMIUM_URLS:
//     se muestrean cada medio segundo los sockets de su arbol de procesos (`ss` en Linux,
//     `Get-NetTCPConnection` en Windows), porque el proceso principal y el Host no pasan por la ventana;
//     el Host no puede abrir ninguna, y las de Chromium se cotejan con su registro de red (`--log-net-log`).
// Lista para revisar, sin fallar, cada linea visible que nombre DeepSeek fuera del aviso de atribucion.
// Guarda una captura por pantalla y `informe.json` en la carpeta de salida.
//
// Uso:  node digitalnexo/tools/smoke-desktop.mjs <ejecutable> [argumentos de la aplicacion] [--out <carpeta>] [--no-sandbox]
//       En Linux sin pantalla, delante: xvfb-run -a
// Sale con 1 si algo falla.

import { execFile, spawn, spawnSync } from 'node:child_process'
import { reverse } from 'node:dns/promises'
import { promisify } from 'node:util'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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

const LOOPBACK = /^(?:127\.|::1$|::ffff:127\.|0\.0\.0\.0$|::$|\*$|localhost$)/

/**
 * Trafico de Chromium admitido, con su motivo. Todo lo demas que salga de la maquina hace fallar la prueba.
 * El corrector ortografico de Electron descarga en Windows y Linux el diccionario del idioma de la
 * interfaz desde la red de Google (`redirector.gvt1.com`, que redirige a otro `*.gvt1.com`), igual que el original.
 */
const ALLOWED_CHROMIUM_URLS = [
  { pattern: /^https:\/\/[a-z0-9.-]+\.gvt1\.com\/edgedl\/chrome\/dict\/[a-z0-9-]+\.bdic(?:[?#]|$)/u, motivo: 'diccionario del corrector ortografico de Electron' },
]

/**
 * Direcciones http(s) fuera de la maquina que pidio Chromium, leidas del registro de red (`--log-net-log`).
 * El registro queda sin cerrar si la aplicacion termina a la fuerza, asi que se busca por texto.
 * @returns Lista sin repeticiones, en orden de aparicion.
 */
function chromiumUrls(netLogPath) {
  let text = ''
  try { text = readFileSync(netLogPath, 'utf8') }
  catch (failure) { throw new Error(`no hay registro de red de Chromium en ${netLogPath}: ${failure.message}`) }
  const urls = new Set()
  for (const [, url] of text.matchAll(/"(?:url|location|new_url)":"((?:https?|wss?):\/\/[^"]+)"/gu)) {
    const host = new URL(url).hostname.replace(/^\[|\]$/gu, '')
    if (!LOOPBACK.test(host)) urls.add(url)
  }
  return [...urls]
}

/** Entrada del proceso Host en su linea de ordenes (`.../@deepseek-ai/dsh-desktop-host/lib/index.js`). */
const HOST_ENTRY = /dsh-desktop-host[\\/]+lib[\\/]+index\.js/u

/**
 * Muestrea las conexiones de red del arbol de procesos que cuelga de `rootPid`, distinguiendo el lado
 * del Host (el proceso `dsh-desktop-host` y todo lo que lanza: pnpm, Python, herramientas) del lado de
 * Chromium (proceso principal, red, ventanas, GPU). El trafico del Host no pasa por Chromium.
 * @returns `stop()`, que deja de muestrear y devuelve las conexiones con destino fuera de la maquina.
 */
function watchConnections(rootPid) {
  const found = new Map()
  const remember = (side, process, peer) => {
    const host = peer.replace(/:\d+$/u, '').replace(/^\[|\]$/gu, '').replace(/%.*$/u, '')
    if (!LOOPBACK.test(host) && !found.has(peer)) found.set(peer, { destino: peer, host, lado: side, proceso: process })
  }
  if (process.platform === 'win32') {
    const script = `$root = ${rootPid}
while ($true) {
  $all = @{}
  Get-CimInstance Win32_Process | ForEach-Object { $all[[int]$_.ProcessId] = $_ }
  $tree = New-Object 'System.Collections.Generic.HashSet[int]'; [void]$tree.Add($root)
  do { $grew = $false; foreach ($id in @($all.Keys)) { if (-not $tree.Contains($id) -and $tree.Contains([int]$all[$id].ParentProcessId)) { [void]$tree.Add($id); $grew = $true } } } while ($grew)
  $hostSide = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($id in $tree) { if ("$($all[$id].CommandLine)" -match 'dsh-desktop-host[\\\\/]+lib[\\\\/]+index\\.js') { [void]$hostSide.Add($id) } }
  do { $grew = $false; foreach ($id in $tree) { if (-not $hostSide.Contains($id) -and $hostSide.Contains([int]$all[$id].ParentProcessId)) { [void]$hostSide.Add($id); $grew = $true } } } while ($grew)
  Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Listen' -and $tree.Contains([int]$_.OwningProcess) } |
    ForEach-Object { $side = if ($hostSide.Contains([int]$_.OwningProcess)) { 'host' } else { 'chromium' }; '{0} {1} {2} {3}:{4}' -f $side, $_.OwningProcess, $all[[int]$_.OwningProcess].Name, $_.RemoteAddress, $_.RemotePort }
  'muestra'
  Start-Sleep -Milliseconds 500
}`
    const sampler = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let samples = 0
    let pending = ''
    let errors = ''
    sampler.stderr.on('data', (chunk) => { errors = `${errors}${chunk}`.slice(-2000) })
    sampler.stdout.on('data', (chunk) => {
      pending += chunk
      const lines = pending.split(/\r?\n/u)
      pending = lines.pop()
      for (const line of lines) {
        if (line.trim() === 'muestra') { samples += 1; continue }
        const [side, pid, name, peer] = line.trim().split(' ')
        if (peer) remember(side, `${name} ${pid}`, peer.includes('.') ? peer : `[${peer.replace(/:(\d+)$/u, ']:$1')}`)
      }
    })
    return { stop: async () => {
      sampler.kill()
      if (samples === 0) throw new Error(`no se pudieron muestrear las conexiones (PowerShell no devolvio ninguna muestra: ${errors.trim()})`)
      return [...found.values()]
    } }
  }
  const run = promisify(execFile)
  let stopped = false
  const sample = async () => {
    const processes = new Map()
    for (const line of (await run('ps', ['-eo', 'pid=,ppid=,args='], { maxBuffer: 16 * 2 ** 20 })).stdout.trim().split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s?(.*)$/u.exec(line)
      if (match) processes.set(Number(match[1]), { ppid: Number(match[2]), args: match[3] })
    }
    const tree = new Set([rootPid])
    for (let grew = true; grew;) {
      grew = false
      for (const [pid, { ppid }] of processes) if (!tree.has(pid) && tree.has(ppid)) { tree.add(pid); grew = true }
    }
    const hostSide = new Set([...tree].filter(pid => HOST_ENTRY.test(processes.get(pid)?.args ?? '')))
    for (let grew = true; grew;) {
      grew = false
      for (const pid of tree) if (!hostSide.has(pid) && hostSide.has(processes.get(pid)?.ppid)) { hostSide.add(pid); grew = true }
    }
    for (const line of (await run('ss', ['-tunpH'])).stdout.split('\n')) {
      const columns = line.trim().split(/\s+/u)
      if (columns.length < 6 || columns[1] === 'LISTEN' || columns[1] === 'UNCONN') continue
      const owners = [...line.matchAll(/\("([^"]+)",pid=(\d+)/gu)].filter(([, , pid]) => tree.has(Number(pid)))
      if (owners.length === 0) continue
      const side = owners.some(([, , pid]) => hostSide.has(Number(pid))) ? 'host' : 'chromium'
      remember(side, owners.map(([, name, pid]) => `${name} ${pid}`).join(', '), columns[5])
    }
  }
  let samples = 0
  let failure
  const loop = (async () => {
    while (!stopped) {
      await sample().then(() => { samples += 1 }, (error) => { failure = error })
      await new Promise(done => setTimeout(done, 500))
    }
  })()
  return { stop: async () => {
    stopped = true
    await loop
    if (samples === 0) throw new Error(`no se pudieron muestrear las conexiones (${failure?.message ?? 'sin muestras'})`)
    return [...found.values()]
  } }
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
let connections
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
  const netLog = join(scratch, 'netlog.json')
  const args = [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(scratch, 'electron')}`, '--lang=es', `--log-net-log=${netLog}`]
  if (values['no-sandbox']) args.push('--no-sandbox')
  // Lo que sigue al ejecutable pasa a la aplicacion tal cual (p. ej. la carpeta de la app con un Electron sin empaquetar).
  args.push(...positionals.slice(1))
  const app = spawn(executable, args, {
    env: { ...process.env, DSH_HOME: home, SIMULADO_API_KEY: 'clave-de-prueba', ELECTRON_ENABLE_LOGGING: '1' },
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(app)
  connections = watchConnections(app.pid)
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
      const at = line.search(/deepseek/iu)
      if (at >= 0 && !/construido sobre|built on/iu.test(line)) brand.add(`${name}: …${line.slice(Math.max(0, at - 70), at + 70).trim()}…`)
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
  if (connections !== undefined) {
    const external = await connections.stop().catch((failure) => { problems.push(failure.message); return [] })
    for (const connection of external) {
      connection.nombre = await Promise.race([
        reverse(connection.host).then(names => names.join(', '), () => ''),
        new Promise(done => setTimeout(() => done(''), 3000)),
      ])
    }
    report.conexionesExternas = external
    // El trafico de Chromium se explica con su registro de red; el del Host no tiene excusa en esta prueba.
    let urls = []
    try { urls = chromiumUrls(join(scratch, 'netlog.json')) }
    catch (failure) { problems.push(failure.message) }
    const allowed = urls.flatMap(url => ALLOWED_CHROMIUM_URLS.filter(rule => rule.pattern.test(url)).map(rule => ({ url, motivo: rule.motivo })))
    report.urlsChromium = urls
    report.urlsAdmitidas = allowed
    for (const url of urls) if (!allowed.some(entry => entry.url === url)) problems.push(`peticion de Chromium fuera de la maquina: ${url}`)
    for (const { destino, nombre, lado, proceso } of external) {
      const where = `${destino}${nombre ? ` (${nombre})` : ''} desde ${proceso}`
      if (lado === 'host') problems.push(`conexion del Host fuera de la maquina: ${where}`)
      else if (allowed.length === 0) problems.push(`conexion de Chromium fuera de la maquina sin peticion que la explique: ${where}`)
    }
  }
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
if (report.urlsAdmitidas?.length) console.log(`Trafico admitido de Chromium:\n${report.urlsAdmitidas.map(({ url, motivo }) => `  - ${url} (${motivo})`).join('\n')}`)
if (report.marcaDeepSeek?.length) console.log(`Menciones de DeepSeek para revisar:\n${report.marcaDeepSeek.map(line => `  - ${line}`).join('\n')}`)
if (problems.length) {
  console.error(`PRUEBA DE ESCRITORIO FALLIDA (${problems.length}):\n${problems.map(p => `  - ${p}`).join('\n')}`)
  if (report.salidaAplicacion) console.error(`--- ultimas lineas de la aplicacion ---\n${report.salidaAplicacion}`)
  process.exit(1)
}
console.log('Prueba de escritorio correcta: espacio de trabajo directo, aviso de Digital Nexo, respuesta del modelo, sin errores y sin salir de la maquina fuera de lo admitido.')
