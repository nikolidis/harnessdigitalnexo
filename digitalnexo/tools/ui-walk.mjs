// Recorrido de la interfaz de Digital Nexo en un navegador, compartido por `compare-ui.mjs`
// (Web contra el original) y `smoke-desktop.mjs` (aplicación de escritorio empaquetada).
//
// Las etiquetas son las de la interfaz en español: quien lo use fija el idioma español
// (contexto del navegador `es-ES`, o la preferencia `locale` del perfil).

/** Controles visibles de la pagina, como `rol|etiqueta`, sin las partes que cambian solas (horas, contadores). */
export const controls = (page) => page.evaluate(() => {
  const norm = (text) => text.replace(/\s+/g, ' ').trim()
    .replace(/, actual: .*$/i, ', actual: *').replace(/\b\d{1,2}:\d{2}\b/g, '*:*')
    .replace(/\s(ahora|ayer|hace \d+ \S+|\d+ ?(s|min|m|h|d|sem))$/i, '').replace(/\d[\d.,]*\s*(tok\/s|tok|%)/gi, '* $1').slice(0, 60)
  const selector = 'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="tab"],[role="switch"],[role="option"],a[href]'
  const found = []
  for (const element of document.querySelectorAll(selector)) {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    if (box.width < 2 || box.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue
    found.push(`${element.getAttribute('role') || element.tagName.toLowerCase()}|${norm(element.getAttribute('aria-label') || element.getAttribute('title') || element.innerText || '')}`)
  }
  return [...new Set(found)].sort()
})

/**
 * Apunta errores de consola, de pagina y HTTP, y las peticiones que salen de la maquina.
 * @param page - pagina de Playwright.
 * @param local - origenes propios de la aplicacion, ademas de 127.0.0.1 y localhost.
 * @returns registro que se va llenando mientras la pagina vive.
 */
export function instrument(page, local = []) {
  const log = { consola: [], pagina: [], http: [], externas: new Set() }
  page.on('console', (message) => { if (message.type() === 'error') log.consola.push(message.text().slice(0, 200)) })
  page.on('pageerror', (error) => log.pagina.push(String(error).slice(0, 200)))
  page.on('response', (response) => { if (response.status() >= 400) log.http.push(`${response.status()} ${new URL(response.url()).pathname.slice(0, 80)}`) })
  page.on('request', (request) => {
    const target = new URL(request.url())
    if (['127.0.0.1', 'localhost'].includes(target.hostname) || ['data:', 'blob:', 'about:', 'devtools:', 'chrome-extension:'].includes(target.protocol)) return
    if (local.includes(target.protocol) || local.includes(target.origin)) return
    log.externas.add(target.origin)
  })
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}))
  return log
}

/**
 * Recorre una pagina ya abierta: avisos de primer arranque, una conversacion completa con el modelo
 * simulado, trayectoria, menus del compositor, ajustes, complementos y tareas.
 * @param page - pagina con la aplicacion cargada (ya hay algun boton visible).
 * @param options - `answer`: texto que devuelve el modelo simulado; `shot`: funcion opcional que guarda
 *   una captura con el nombre de cada pantalla.
 * @returns titulo, avisos que se cerraron, si llego la respuesta, controles por pantalla y etiquetas no encontradas.
 */
export async function walkPage(page, { answer, shot = async () => {} }) {
  const surfaces = {}
  const missing = []
  const record = async (name) => { await page.waitForTimeout(1200); surfaces[name] = await controls(page); await shot(name) }
  const click = async (name, { role = 'button', exact = false } = {}) => {
    const target = page.getByRole(role, { name, exact }).first()
    if (!(await target.isVisible().catch(() => false))) { missing.push(String(name)); return false }
    await target.click({ timeout: 8000 }).catch(() => {})
    return true
  }
  const escape = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(500) }

  await page.waitForTimeout(2500)
  const title = await page.title()
  const notices = []
  for (let index = 0; index < 4; index++) {
    const notice = page.locator('[role="dialog"]').first()
    if (!(await notice.isVisible().catch(() => false))) break
    notices.push((await notice.innerText()).replace(/\s+/g, ' ').slice(0, 400))
    if (index === 0) await shot('aviso')
    await notice.locator('button').last().click().catch(() => {})
    await page.waitForTimeout(900)
  }
  await record('inicio')

  // Una conversacion completa contra el modelo simulado.
  await click('Nueva sesión')
  await page.waitForTimeout(1200)
  const composer = page.locator('[contenteditable="true"], textarea').first()
  await composer.waitFor({ state: 'visible', timeout: 30_000 })
  await composer.click()
  await page.keyboard.type('Hola, responde con una frase.')
  await page.waitForTimeout(400)
  await click('Enviar mensaje')
  const answered = await page.getByText(answer).first().waitFor({ state: 'visible', timeout: 90_000 }).then(() => true, () => false)
  await page.waitForTimeout(2500)
  await record('conversacion')
  if (await click('Trayectoria', { role: 'tab' })) await record('trayectoria')
  if (await click('Chat', { role: 'tab' })) await page.waitForTimeout(500)

  if (await click('Agregar archivos o ejecutar comandos')) { await record('menu-del-compositor'); await escape() }
  if (await click('Seleccionar modelo')) { await record('menu-de-modelos'); await escape() }
  if (await click('Modo de acceso')) { await record('menu-de-permisos'); await escape() }

  // Ajustes: directos en una interfaz, tras el menu de cuenta en la otra.
  let settings = await page.getByRole('button', { name: 'Configuración', exact: true }).first().isVisible().catch(() => false)
  if (settings) await page.getByRole('button', { name: 'Configuración', exact: true }).first().click()
  else if (await click('Menú de cuenta')) {
    await page.waitForTimeout(600)
    settings = await click('Configuración', { role: 'menuitem', exact: true })
  }
  if (settings) {
    await record('ajustes')
    for (const section of ['General', 'Modelos', 'Complementos integrados', 'Ajustes preestablecidos del agente']) {
      if (await click(section, { exact: true })) await record(`ajustes/${section}`)
    }
    await click('Cerrar')
    await page.waitForTimeout(700)
  }

  if (await click('Complementos', { exact: true })) await record('complementos')
  if (await click('Tareas de automatización', { exact: true })) await record('tareas')
  if (await click('Más', { exact: true })) { await record('mas'); await escape() }
  return { title, notices, answered, surfaces, missing }
}

/**
 * Filas de configuracion que declaran el modelo simulado como proveedor de terceros y lo eligen por defecto.
 * @param port - puerto del servidor de modelo simulado en 127.0.0.1.
 * @returns lineas YAML para un `cordis.patch.yml`.
 */
export function mockModelRows(port) {
  return [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      simulado:',
    '        displayName: Modelo simulado',
    '        apiKeyEnv: SIMULADO_API_KEY',
    '        api: anthropic-messages',
    `        baseURL: http://127.0.0.1:${port}`,
    '        models:',
    '          - id: mock-model',
    '            name: Modelo de prueba',
    '- id: agent-default-model',
    '  config:',
    '    provider: simulado',
    '    model: mock-model',
  ]
}
