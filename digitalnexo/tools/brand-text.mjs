#!/usr/bin/env node
// Renombra el producto en los textos visibles de la interfaz: "DSH" / "DeepSeek Harness" -> "Digital Nexo".
//
// Es idempotente: se ejecuta despues de cada fusion con el proyecto original para
// cubrir los textos nuevos que traiga. Solo toca el VALOR de las entradas de los
// ficheros `locales.ts`; nunca nombres de paquete (`@deepseek-ai/...`), el comando
// `dsh`, extensiones ni identificadores. Las lineas que atribuyen el origen
// ("construido sobre DeepSeek Harness") se conservan, y los textos de la cuenta de
// DeepSeek (`ui-settings-account`, desactivada en Digital Nexo) se dejan como estan.
//
// Uso:  node digitalnexo/tools/brand-text.mjs            aplica
//       node digitalnexo/tools/brand-text.mjs --check    no escribe; sale con 1 si queda algo por renombrar

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const check = process.argv.includes('--check')
const PRODUCT = 'Digital Nexo'
const SKIP_PACKAGES = ['packages/client/ui-settings-account/']
const WELCOME_FILE = 'packages/client/ui-settings-models/src/client/locales.ts'

// Atribucion deliberada al proyecto original, en los ocho idiomas.
const KEEP = /built on|基于开源项目|を基盤|construido sobre|repose sur|basiert auf|построен на основе|é construído sobre/
// Limites en ASCII a proposito: en japones y chino el nombre va pegado a las letras vecinas.
const COMPOUND = /(?<![A-Za-z0-9_@/.-])DSH-(?=[A-Za-zÄÖÜäöüß])/g
const TOKEN = /(?<![A-Za-z0-9_@/.-])(DeepSeek Harness|DSH)(?![A-Za-z0-9_]|\.[A-Za-z0-9_]|-[A-Za-z]*[a-z])/g
const KEYED = /^(\s*(?:'[^']*'|"[^"]*"|[\w$]+)\s*:\s*)(.*)$/
const CONTINUATION = /^(\s*)(['"`].*)$/

function rename(value) {
  if (value.includes('@deepseek-ai/') || KEEP.test(value)) return value
  return value.replace(COMPOUND, `${PRODUCT.replace(' ', '-')}-`).replace(TOKEN, PRODUCT)
}

function* localeFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib' || name === 'dist' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* localeFiles(path)
    else if (name === 'locales.ts') yield path
  }
}

const welcome = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'welcome-notice.json'), 'utf8'))
// Mismo criterio de comillas que el formateador del repo: dobles solo si el texto lleva apostrofos.
function quote(text) {
  const mark = text.includes("'") && !text.includes('"') ? '"' : "'"
  return mark + text.replaceAll('\\', '\\\\').replaceAll(mark, `\\${mark}`).replaceAll('\n', '\\n') + mark
}

let total = 0
const touched = []
for (const path of localeFiles(join(root, 'packages'))) {
  const rel = relative(root, path).split(sep).join('/')
  if (SKIP_PACKAGES.some((prefix) => rel.startsWith(prefix))) continue
  const before = readFileSync(path, 'utf8')
  let language = null
  let hits = 0
  const after = before.split('\n').map((line) => {
    const block = /^export const (\w+)\b/.exec(line)
    if (block) language = block[1]
    if (rel === WELCOME_FILE) {
      const notice = /^(\s*'?welcomeBody'?:\s*)(.*?)(,?\s*)$/.exec(line)
      if (notice && language && welcome[language]) {
        const next = `${notice[1]}${quote(welcome[language])}${notice[3]}`
        if (next !== line) hits += 1
        return next
      }
    }
    const keyed = KEYED.exec(line)
    const parts = keyed ?? CONTINUATION.exec(line)
    if (!parts) return line
    const value = rename(parts[2])
    if (value === parts[2]) return line
    hits += 1
    return parts[1] + value
  }).join('\n')
  if (hits === 0) continue
  total += hits
  touched.push(`${String(hits).padStart(4)}  ${rel}`)
  if (!check) writeFileSync(path, after)
}

// Textos que no viven en un `locales.ts`: el titulo de las compilaciones propias (lo que
// se ve en la pestana y, sin plugin de marca, en la barra lateral) y las expectativas de
// las pruebas que comprueban esos textos. Cada regla es [fichero o carpeta, patron, sustituto].
const LITERALS = [
  ['packages/client/locale/src/locales', /^(\s*'brand\.localBuild': ).*,$/gm, `$1'${PRODUCT}',`],
  ['packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx', /DSH Local Build/g, PRODUCT],
  ['packages/experimental/liveshare/tests/viewer-brand.client.spec.tsx', /DSH (\d)/g, `${PRODUCT} $1`],
  ['packages/experimental/client-ui-voice-input/tests/preparation.client.spec.tsx', /运行 DSH 的机器/g, `运行 ${PRODUCT} 的机器`],
]
for (const [target, pattern, replacement] of LITERALS) {
  const full = join(root, target)
  let files
  try { files = statSync(full).isDirectory() ? readdirSync(full).filter((n) => n.endsWith('.ts')).map((n) => join(full, n)) : [full] }
  catch { console.log(`   ?  ${target} ya no existe: revisar la regla en brand-text.mjs`); continue }
  for (const path of files) {
    const before = readFileSync(path, 'utf8')
    const after = before.replace(pattern, replacement)
    if (after === before) continue
    total += 1
    touched.push(`   1  ${relative(root, path).split(sep).join('/')}`)
    if (!check) writeFileSync(path, after)
  }
}

for (const line of touched) console.log(line)
console.log(`${check ? 'PENDIENTE' : 'APLICADO'}: ${total} lineas en ${touched.length} ficheros`)
if (check && total > 0) process.exit(1)
