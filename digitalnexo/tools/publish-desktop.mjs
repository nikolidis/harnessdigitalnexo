#!/usr/bin/env node
// Publica en GitHub los instaladores de escritorio ya probados por el flujo `Escritorio`.
//
// Toma de la carpeta indicada el instalador de Windows, la AppImage y el .deb que dejó el
// empaquetado, los copia con nombres fijos (para que los enlaces de `releases/latest/download/...`
// no cambien de una versión a otra), calcula `SHA256SUMS.txt` y crea o actualiza la versión
// `escritorio-v<versión>` apuntando al commit actual, marcada como la más reciente.
//
// Uso (en GitHub Actions, con GH_TOKEN, GITHUB_SHA y GITHUB_REPOSITORY):
//   node digitalnexo/tools/publish-desktop.mjs <carpeta-con-los-paquetes> [--dry-run]

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dryRun = process.argv.includes('--dry-run')
const folder = process.argv.slice(2).find(arg => !arg.startsWith('--'))
if (folder === undefined) {
  console.error('uso: publish-desktop.mjs <carpeta-con-los-paquetes> [--dry-run]')
  process.exit(2)
}
const version = JSON.parse(readFileSync(join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version
const repository = process.env.GITHUB_REPOSITORY ?? 'nikolidis/harnessdigitalnexo'
const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const tag = `escritorio-v${version}`

const found = readdirSync(resolve(folder), { recursive: true }).map(String)
/** El único fichero de la carpeta que cumple `pattern`; falla si falta o hay varios. */
function pick(pattern, what) {
  const matches = found.filter(path => pattern.test(basename(path)))
  if (matches.length !== 1) throw new Error(`se esperaba un ${what} en ${folder} y hay ${matches.length}: ${found.join(', ')}`)
  if (!basename(matches[0]).includes(`-${version}-`)) throw new Error(`${matches[0]} no es de la versión ${version}`)
  return join(resolve(folder), matches[0])
}
const assets = [
  { from: pick(/^digitalnexo-.*-win-x64\.exe$/, 'instalador de Windows'), name: 'Digital-Nexo-Windows-x64-Setup.exe' },
  { from: pick(/^digitalnexo-.*-linux-x86_64\.AppImage$/, 'AppImage'), name: 'Digital-Nexo-Linux-x86_64.AppImage' },
  { from: pick(/^digitalnexo-.*-linux-amd64\.deb$/, 'paquete .deb'), name: 'Digital-Nexo-Linux-amd64.deb' },
]

const out = join(tmpdir(), 'publicacion-escritorio')
rmSync(out, { recursive: true, force: true })
mkdirSync(out)
const sums = []
for (const asset of assets) {
  const target = join(out, asset.name)
  copyFileSync(asset.from, target)
  const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
  sums.push(`${hash}  ${asset.name}`)
  console.log(`${asset.name}: ${(statSync(target).size / 2 ** 20).toFixed(1)} MiB (${basename(asset.from)})`)
}
writeFileSync(join(out, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)

const download = (name) => `https://github.com/${repository}/releases/latest/download/${name}`
const notes = `Aplicación de escritorio de Digital Nexo ${version}, compilada desde el commit ${commit.slice(0, 10)}. Antes de publicarse, cada paquete se instaló en una máquina limpia de GitHub y se recorrió su interfaz completa (conversación con un modelo de prueba, ajustes, complementos, tareas) sin errores.

## Windows 10 y 11 (64 bits)

1. Descarga [Digital-Nexo-Windows-x64-Setup.exe](${download('Digital-Nexo-Windows-x64-Setup.exe')}) y ábrelo.
2. El instalador no está firmado con un certificado de editor, así que SmartScreen avisa: pulsa **Más información → Ejecutar de todas formas**.
3. Se instala solo para tu usuario, sin permisos de administrador, en \`%LOCALAPPDATA%\\Programs\\Digital Nexo\`, con acceso en el menú Inicio. Se desinstala desde Configuración → Aplicaciones.

## Linux (64 bits)

- **Ubuntu, Debian y derivadas**: descarga [Digital-Nexo-Linux-amd64.deb](${download('Digital-Nexo-Linux-amd64.deb')}) e instálalo con \`sudo apt install ./Digital-Nexo-Linux-amd64.deb\`. Aparece en el menú de aplicaciones y como la orden \`digitalnexo\`.
- **Otras distribuciones**: [Digital-Nexo-Linux-x86_64.AppImage](${download('Digital-Nexo-Linux-x86_64.AppImage')}). Necesita FUSE 2 (\`libfuse2\`); dale permiso de ejecución con \`chmod +x Digital-Nexo-Linux-x86_64.AppImage\` y ábrela. Si en Ubuntu 23.10 o posterior no llega a abrirse, ábrela con \`--no-sandbox\` o usa el .deb, que sí instala el perfil de AppArmor que necesita el aislamiento.

## Primer uso

Añade tu proveedor de modelos y su clave API en **Configuración → Modelos**. La aplicación no inicia sesión en ninguna cuenta ni envía telemetría.

## Actualizaciones

No se actualiza sola: cuando haya una versión nueva, descárgala desde esta página e instálala encima; tus sesiones y ajustes se conservan. Comparte la carpeta de datos \`~/.dsh\` con DeepSeek Harness, así que no conviene tener abiertas a la vez las dos aplicaciones de escritorio.

Las sumas SHA-256 de los tres paquetes están en \`SHA256SUMS.txt\`.
`
writeFileSync(join(out, 'NOTAS.md'), notes)

const files = [...assets.map(asset => join(out, asset.name)), join(out, 'SHA256SUMS.txt')]
const title = `Digital Nexo ${version} · escritorio (Windows y Linux)`
if (dryRun) {
  console.log(`(simulación) ${tag} -> ${commit}\n${title}\n${notes}`)
  process.exit(0)
}
const gh = (args) => execFileSync('gh', args, { stdio: 'inherit' })
const exists = spawnSync('gh', ['release', 'view', tag, '--repo', repository], { stdio: 'ignore' }).status === 0
if (exists) {
  // Misma versión, commit nuevo: la etiqueta pasa al commit actual y los paquetes se sustituyen.
  gh(['api', '--method', 'PATCH', `repos/${repository}/git/refs/tags/${tag}`, '-f', `sha=${commit}`, '-F', 'force=true'])
  gh(['release', 'upload', tag, ...files, '--clobber', '--repo', repository])
  gh(['release', 'edit', tag, '--title', title, '--notes-file', join(out, 'NOTAS.md'), '--latest', '--repo', repository])
}
else {
  gh(['release', 'create', tag, ...files, '--target', commit, '--title', title, '--notes-file', join(out, 'NOTAS.md'), '--latest', '--repo', repository])
}
console.log(`Publicado: https://github.com/${repository}/releases/tag/${tag}`)
