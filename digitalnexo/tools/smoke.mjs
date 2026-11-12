#!/usr/bin/env node
// Prueba de humo de extremo a extremo, sin navegador y sin ninguna clave real.
//
// Arranca el servidor de modelo simulado que trae el propio repositorio, lo declara
// como proveedor de terceros y comprueba que:
//   1. el perfil `headless` responde una tarea con ese proveedor;
//   2. al modelo no se le ofrece ninguna herramienta de DeepSeek ni un `web_search`
//      sin buscador detras, y si `web_fetch`;
//   3. al montar cada buscador de terceros que mantiene Digital Nexo (Exa, Perplexity),
//      `web_search` si se ofrece;
//   4. el perfil `web` arranca y sirve la pagina con el titulo y los iconos de Digital Nexo.
//
// Uso:  node digitalnexo/tools/smoke.mjs      (sale con 1 si algo falla)

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ANSWER = 'RESPUESTA-DE-HUMO-7391'
const scratch = mkdtempSync(join(tmpdir(), 'dn-smoke-'))
const home = join(scratch, 'home')
const children = []
const problems = []
const done = []

/** Puerto TCP libre en la interfaz local. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)) })
  })
}

/** Lanza un proceso del repositorio y resuelve cuando su salida cumple `ready`, o al terminar. */
function launch(args, { ready, timeoutMs, env = {} }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, DSH_HOME: home, SIMULADO_API_KEY: 'clave-de-humo', ...env } })
    children.push(child)
    let stdout = ''
    let stderr = ''
    const finish = (result) => { clearTimeout(timer); resolve({ child, stdout, stderr, ...result }) }
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk; const match = ready?.exec(stdout); if (match) finish({ match }) })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('exit', (code) => finish({ code }))
  })
}

/** Nombres de las herramientas declaradas al modelo en la sesion mas reciente del directorio de datos. */
function declaredTools() {
  const logs = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (name.endsWith('.jsonl.zstd')) logs.push([stat.mtimeMs, path])
    }
  }
  walk(join(home, 'sessions'))
  logs.sort((a, b) => b[0] - a[0])
  const names = new Set()
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') {
      if (typeof value.name === 'string' && (value.input_schema || value.inputSchema || value.parameters)) names.add(value.name)
      Object.values(value).forEach(visit)
    }
  }
  for (const line of zstdDecompressSync(readFileSync(logs[0][1])).toString('utf8').split('\n')) {
    if (!line.includes('"request/header"')) continue
    visit(JSON.parse(line))
  }
  return [...names].sort()
}

try {
  const modelPort = await freePort()
  const overlay = join(scratch, 'modelo-simulado.yml')
  writeFileSync(overlay, [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      simulado:',
    '        displayName: Modelo simulado',
    '        apiKeyEnv: SIMULADO_API_KEY',
    '        api: anthropic-messages',
    `        baseURL: http://127.0.0.1:${modelPort}`,
    '        models:',
    '          - id: mock-model',
    '            name: Modelo de prueba',
    '- id: agent-default-model',
    '  config:',
    '    provider: simulado',
    '    model: mock-model',
    '',
  ].join('\n'))

  const model = await launch(['--import', 'tsx', 'packages/test-support/llm-mock-server/src/bin.ts', '--port', String(modelPort), '--sequence', 'success', '--repeat-last', '--success-text', ANSWER], { ready: /"type":"ready"/, timeoutMs: 60_000 })
  if (!model.match) throw new Error(`el modelo simulado no arranco: ${model.stderr.trim().split('\n').at(-1) ?? 'sin salida'}`)

  // 1. Una tarea completa en el perfil sin interfaz.
  const task = await launch(['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'headless', '--patch', overlay, 'Responde con una frase.'], { timeoutMs: 180_000 })
  if (task.code === 0 && task.stdout.includes(ANSWER)) done.push('headless: la tarea se responde con un proveedor de terceros')
  else problems.push(`headless: salida ${task.timedOut ? 'agotada' : task.code}; respuesta ${JSON.stringify(task.stdout.trim().slice(0, 120))}; ${task.stderr.trim().split('\n').at(-1) ?? ''}`)

  // 2. Lo que se le ofrecio al modelo en esa tarea.
  if (task.code === 0) {
    const tools = declaredTools()
    const foreign = tools.filter((name) => /deepseek/i.test(name))
    if (tools.length === 0) problems.push('no se encontro la lista de herramientas en el registro de la sesion')
    if (foreign.length) problems.push(`herramientas de DeepSeek ofrecidas al modelo: ${foreign.join(', ')}`)
    if (tools.includes('web_search')) problems.push('se ofrece web_search sin ningun buscador montado')
    if (tools.length && !tools.includes('web_fetch')) problems.push('falta web_fetch')
    if (tools.length && !foreign.length && !tools.includes('web_search') && tools.includes('web_fetch')) done.push(`herramientas: ${tools.length} declaradas, ninguna de DeepSeek, sin web_search, con web_fetch`)
  }

  // 3. Con un buscador de terceros montado, la busqueda web aparece. La clave es falsa: no se llama al buscador.
  const SEARCH_PROVIDERS = [
    ['web-search-exa', '@deepseek-ai/dsh-web-search-exa', 'EXA_API_KEY'],
    ['web-search-perplexity', '@deepseek-ai/dsh-web-search-perplexity', 'PERPLEXITY_API_KEY'],
  ]
  for (const [id, name, keyVariable] of SEARCH_PROVIDERS) {
    const withSearch = join(scratch, `${id}.yml`)
    writeFileSync(withSearch, `${readFileSync(overlay, 'utf8')}- insert:\n    - id: ${id}\n      name: '${name}'\n`)
    const searchTask = await launch(['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'headless', '--patch', withSearch, 'Responde con una frase.'], { timeoutMs: 180_000, env: { [keyVariable]: 'clave-falsa-de-humo' } })
    if (searchTask.code !== 0) problems.push(`${id}: la tarea no termina con el buscador montado (salida ${searchTask.timedOut ? 'agotada' : searchTask.code}): ${searchTask.stderr.trim().split('\n').at(-1) ?? ''}`)
    else if (!declaredTools().includes('web_search')) problems.push(`${id}: montado y con clave, pero no se ofrece web_search`)
    else done.push(`${id}: al montarlo se ofrece web_search`)
  }

  // 4. La interfaz web arranca y sirve la marca.
  const web = await launch(['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--patch', overlay, '--no-open', '--port', String(await freePort())], { ready: /dsh web: (http:\/\/[^\s]+)/, timeoutMs: 180_000 })
  if (!web.match) problems.push(`web: no arranco (${web.timedOut ? 'tiempo agotado' : `salida ${web.code}`}): ${web.stderr.trim().split('\n').at(-1) ?? ''}`)
  else {
    // La direccion con clave responde con una cookie de sesion y redirige; se sigue a mano como haria un navegador.
    const url = new URL(web.match[1])
    const entry = await fetch(url, { redirect: 'manual' })
    const cookie = entry.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    const headers = { cookie }
    const page = await fetch(new URL(entry.headers.get('location') ?? './', url), { headers })
    const html = await page.text()
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]
    const icon = await fetch(new URL('./favicon.svg', url), { headers })
    const mark = icon.ok ? await icon.text() : ''
    if (page.status !== 200) problems.push(`web: la pagina responde ${page.status}`)
    if (title !== 'Digital Nexo') problems.push(`web: el titulo es ${JSON.stringify(title)}`)
    // `@deepseek-ai/` es el ambito npm de los paquetes del original: aparece en las rutas de los modulos, no en pantalla.
    if (/deepseek/i.test(html.replaceAll('@deepseek-ai/', ''))) problems.push('web: la pagina inicial nombra a DeepSeek fuera de los nombres de paquete')
    if (!icon.ok || !mark.includes('<svg')) problems.push(`web: favicon.svg responde ${icon.status}`)
    if (page.status === 200 && title === 'Digital Nexo' && icon.ok) done.push('web: arranca y sirve la pagina con el titulo y el icono de Digital Nexo')
  }
}
catch (failure) {
  problems.push(String(failure?.message ?? failure))
}
finally {
  for (const child of children) child.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  rmSync(scratch, { recursive: true, force: true })
}

for (const line of done) console.log(`  ok  ${line}`)
if (problems.length) {
  console.error(`PRUEBA DE HUMO FALLIDA (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
console.log('Prueba de humo correcta.')
