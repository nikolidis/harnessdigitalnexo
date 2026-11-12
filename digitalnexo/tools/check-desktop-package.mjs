#!/usr/bin/env node
// Comprueba que la aplicación de escritorio empaquetada lleva dentro los paquetes que Digital Nexo
// añade al original: la marca y los buscadores Exa y Perplexity. El runtime de `dsh` va dentro del
// archivo `app.asar` (fuera solo quedan los binarios nativos), así que se lista ese archivo.
//
// Uso: node digitalnexo/tools/check-desktop-package.mjs <carpeta resources de la aplicación>
// Sale con 1 si falta alguno.

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED = ['@deepseek-ai/dsh-web-search-exa', '@deepseek-ai/dsh-web-search-perplexity', '@digitalnexo/dsh-client-ui-brand']

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const resources = process.argv[2]
if (resources === undefined) {
  console.error('uso: check-desktop-package.mjs <carpeta resources de la aplicación>')
  process.exit(2)
}
// @electron/asar llega con electron-builder, que es dependencia de la aplicación de escritorio.
const builder = createRequire(join(root, 'apps', 'desktop', 'package.json')).resolve('app-builder-lib')
const asar = createRequire(builder)('@electron/asar')
const archive = join(resolve(resources), 'app.asar')
const files = new Set(asar.listPackage(archive, { isPack: false }).map(path => path.replaceAll('\\', '/')))
const missing = REQUIRED.filter(name => !files.has(`/dsh/node_modules/${name}/package.json`))
console.log(`${archive}: ${files.size} entradas`)
for (const name of REQUIRED) console.log(`  ${missing.includes(name) ? 'FALTA' : 'ok   '} ${name}`)
if (missing.length > 0) process.exit(1)
