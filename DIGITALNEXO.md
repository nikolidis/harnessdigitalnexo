# Digital Nexo sobre DeepSeek Harness

Esta es una distribución de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) con la marca Digital Nexo y sin los servicios de DeepSeek. El motor es el
del proyecto original, licencia MIT, sin tocar su arquitectura.

- **Base:** etiqueta `dsh-v0.2.2-rc.2`, commit `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`
  (la versión vigente está siempre en [`digitalnexo/UPSTREAM`](digitalnexo/UPSTREAM)).
- **Rama `upstream`:** el original en esa etiqueta, sin ningún cambio nuestro salvo
  que no lleva `.github/workflows` (son la integración continua de DeepSeek: aquí no
  pueden ejecutarse). Un commit por versión importada. Sirve para comparar y para
  actualizar.
- **Rama `main`:** `upstream` más los cambios de esta página. Tampoco lleva
  `.github/dependabot.yml`.

DeepSeek Harness es marca registrada de DeepSeek. Esta distribución no la usa en su
nombre ni se presenta como oficial: la nombra solo para decir sobre qué está
construida, que es lo que piden sus [normas de marca](BRAND_GUIDELINES.md).

## Arrancarlo

Hace falta Node 24.9 o superior y pnpm 11.

```sh
pnpm install
pnpm run build
pnpm dsh web
```

El comando imprime la dirección con su clave de acceso (`http://127.0.0.1:3080/?token=…`):
ábrela tal cual, sin la clave la página no entra. La primera vez no hay ningún modelo configurado: entra
en **Configuración → Modelos**, añade tu proveedor y su clave, y ya puedes trabajar.

## Qué cambia respecto al original

Todo lo que se quita está apagado desde una capa de configuración propia
(`digitalnexo.patch.yml`), no borrando código del original. Es a propósito: cuando
actualices, los conflictos salen en esos archivos en vez de desaparecer sin avisar.

### Fuera los servicios de DeepSeek

`packages/bundle/base/digitalnexo.patch.yml` (afecta a web, escritorio, headless, acp y sdk):

| Qué | Por qué |
|---|---|
| Cuenta DeepSeek (`deepseek-account`) | Esta distribución no tiene cuenta que iniciar |
| Rutas de modelo nativas `deepseek-official` y `deepseek-account` | Los modelos se configuran como proveedores de terceros |
| `session-log-deepseek` | Subía la conversación entera a la API de DeepSeek |
| `plugin-package-inventory-deepseek` | Enviaba la lista de plugins activos con cada petición |
| `deepseek-llm-api-extensions` | Registro que solo usan los dos anteriores |
| `otel` y `session-telemetry-otel` | Subían la conversación a `dsh-otel-collector.deepseeksvc.com` al dar feedback |
| Buscador DeepSeek (`web-search-deepseek`, `web-deepseek-api`) | Búsqueda web atada a la clave de DeepSeek |
| `command-feedback` (`/feedback`) | Solo servía para disparar esa subida |

El modelo por defecto pasa de `deepseek-flash` a `mistral-large-latest`. Mientras no
haya clave configurada, el selector pide elegir modelo, igual que hace el original
cuando no hay credencial.

`packages/bundle/web-app/digitalnexo.patch.yml` (solo la interfaz web) apaga además la
sección Cuenta, el menú de cuenta y sus avisos (`ui-settings-account`,
`ui-account-notifications`), los botones de 👍/👎 con su diálogo, las estadísticas de
la aplicación de escritorio, y la marca oficial (`ui-brand-official`), que incluye la
ballena que el original dibuja al hacer clic en la pantalla de inicio vacía.

Comparada en un navegador con el original en la misma versión
(`digitalnexo/tools/compare-ui.mjs`: inicio, una conversación completa, trayectoria,
menús del compositor, ajustes, complementos y tareas; 507 controles en 14 pantallas),
la interfaz solo difiere en eso: donde el original tiene el menú de cuenta («Más»:
Configuración, Comentarios, Iniciar sesión) aquí está directamente **Configuración**;
no están los 👍/👎, la orden «Comentarios», el interruptor de subir el registro de
sesión ni el proveedor DeepSeek en Modelos. Las diferencias admitidas están en
`digitalnexo/tools/ui-differences.json`; cualquier otra hace fallar la comparación.

`packages/bundle/acp-app/digitalnexo.patch.yml` y
`packages/bundle/sdk-minimal/digitalnexo.patch.yml` hacen lo mismo en esos dos
perfiles, que traen sus propios valores. `sdk-minimal` es el único perfil que no se
construye sobre `dsh-base`, así que repite las tres bajas y cambia la ruta de modelo
por el adaptador multiproveedor, leyendo `$MISTRAL_API_KEY` del entorno.

### Lo que sigue funcionando igual

Los proveedores de modelo de terceros (Mistral, Anthropic, OpenAI, Groq, OpenRouter y
el resto del catálogo, más cualquier gateway propio), la instalación de plugins desde
npm o Git, `web_fetch` anónimo, los agentes, las herramientas, los espacios de trabajo,
las tareas programadas y el resto de la aplicación.

### Búsqueda web

Recién instalado **no hay búsqueda web**: el único buscador que monta el original es el
de DeepSeek, y está apagado. El modelo no ve la herramienta `web_search` (sí `web_fetch`),
que es también lo que pasa en el original mientras no se inicia sesión en DeepSeek.
Esto lo decide `readyRequiresProvider: true` en la fila `web` de la capa: sin esa opción
se ofrecería al modelo un `web_search` que falla en cada llamada.

Para tenerla, monta un buscador de terceros. Esta distribución conserva los dos que el
original traía como opcionales hasta la `rc.1` y **eliminó en la `rc.2`**: Exa y
Perplexity (`packages/web/web-search-exa`, `packages/web/web-search-perplexity`). Desde
la `rc.2` los mantiene Digital Nexo, no DeepSeek. Añade a
`$DSH_HOME/profiles/web/cordis.patch.yml` (por defecto `~/.dsh/profiles/web/`):

```yaml
- insert:
    - id: web-search-exa
      name: '@deepseek-ai/dsh-web-search-exa'
```

y arranca con `EXA_API_KEY` en el entorno (o `web-search-perplexity`,
`@deepseek-ai/dsh-web-search-perplexity` y `PERPLEXITY_API_KEY`). Con un solo buscador
montado se elige solo; con varios, se elige en **Complementos → Búsqueda y obtención
web**, que lista los que haya montados. Cualquier otro buscador es un plugin que llame
a `ctx.web.registerSearchProvider()`.

### La marca

- `packages/client/ui-brand-digitalnexo`: el logo en la barra lateral y en la pantalla
  de inicio. Es un plugin que ocupa los mismos huecos que el oficial, que queda
  apagado. Sustituirlo no toca nada más.
- Iconos, favicon y manifiesto en `apps/web/public/`. El título de la pestaña sale de
  `DEFAULT_CLIENT_TITLE` en `apps/web/vite.config.ts` y de la entrada `brand.localBuild`
  de `packages/client/locale/src/locales/`.
- El nombre del producto en los textos de la interfaz, en los ocho idiomas.
- La carpeta de trabajo por defecto pasa de `Documentos/deepseek-harness` a
  `Documentos/digitalnexo`.

El logo se genera desde la receta de la web (`DIGITALNEXO` en Inter ExtraBold con el
punto en el color de acento). Ver `digitalnexo/brand/README.md` para regenerarlo.

### Lo que se deja a propósito

- **El comando sigue siendo `dsh`.** Renombrar el binario obliga a tocar cientos de
  archivos y rompe la documentación y los plugins de la comunidad.
- **Los paquetes siguen siendo `@deepseek-ai/dsh-*`.** Es el nombre con el que los
  plugins de terceros declaran sus dependencias: renombrarlos los rompería todos.
- **El modelo sigue leyendo «You are an AI agent powered by DeepSeek Harness»** en su
  prompt de sistema. Es cierto y afecta a cómo usa sus herramientas; cambiarlo es una
  línea en `packages/core/system-prompt/src/index.ts` si lo prefieres.

## Actualizar desde el original

El procedimiento completo, probado al pasar de la `rc.1` a la `rc.2`, está en
[`digitalnexo/ACTUALIZAR.md`](digitalnexo/ACTUALIZAR.md). En corto: se importa la
etiqueta nueva en `upstream`, se fusiona en una rama de trabajo, se vuelve a aplicar
la marca con `digitalnexo/tools/brand-text.mjs`, y `main` solo avanza si compila, si
`digitalnexo/tools/check-composition.mjs` confirma que no ha vuelto ningún servicio
de DeepSeek, si `digitalnexo/tools/smoke.mjs` completa una tarea de extremo a extremo
con un proveedor de terceros, y si las pruebas no tienen ningún fallo que el original
no tenga.

Es una versión preliminar y su propio aviso dice que habrá cambios que rompan la
compatibilidad.

## Compilar en una máquina sin salida a `cdn.sheetjs.com`

El original instala `xlsx` desde `cdn.sheetjs.com`. Si tu red no llega a ese dominio:

```sh
node digitalnexo/tools/xlsx-mirror.mjs on    # antes de pnpm install
node digitalnexo/tools/xlsx-mirror.mjs off   # antes de confirmar cambios
```

`on` apunta esa dependencia a `@e965/xlsx@0.20.3`, una republicación de terceros en npm
de la misma versión (no es el mismo fichero que distribuye SheetJS). Ese cambio **no
está en el repositorio**: es un apaño de entorno, no de producto.

## Lo que no está comprobado

- Exa y Perplexity pasan sus pruebas unitarias (respuestas simuladas) y `web_search`
  aparece al montarlos, pero no se ha hecho ninguna búsqueda con una clave real.
- Ningún proveedor de modelo se ha probado con una clave real: las conversaciones de
  prueba usan el servidor de modelo simulado del propio repositorio, declarado como
  proveedor de terceros.
- La batería `pnpm run test:snapshot` (reproducción de sesiones grabadas) y las
  comprobaciones de documentación `pnpm run doc-sync` no se ejecutan en las
  actualizaciones.
- La aplicación de escritorio no se ha compilado ni probado; solo la interfaz web y
  el perfil sin interfaz.
