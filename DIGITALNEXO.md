# Digital Nexo sobre DeepSeek Harness

Esta es una distribución de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) con la marca Digital Nexo y sin los servicios de DeepSeek. El motor es el
del proyecto original, licencia MIT, sin tocar su arquitectura.

- **Base:** etiqueta `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`.
- **Rama `upstream`:** copia exacta de esa etiqueta, byte a byte, sin ningún cambio
  nuestro. Sirve para comparar y para actualizar.
- **Rama `main`:** `upstream` más los cambios de esta página.

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

Abre `http://127.0.0.1:3080`. La primera vez no hay ningún modelo configurado: entra
en **Configuración → Modelos**, añade tu proveedor y su clave, y ya puedes trabajar.

## Qué cambia respecto al original

Todo lo que se quita está apagado desde una capa de configuración propia
(`digitalnexo.patch.yml`), no borrando código del original. Es a propósito: cuando
actualices, los conflictos salen en esos archivos en vez de desaparecer sin avisar.

### Fuera los servicios de DeepSeek

`packages/bundle/base/digitalnexo.patch.yml` (afecta a web, escritorio, headless, acp y sdk):

| Qué | Por qué |
|---|---|
| Cuenta DeepSeek (`deepseek-account`) y su pantalla | Esta distribución no tiene cuenta que iniciar |
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
sección Cuenta y su API, la página de ajustes del buscador DeepSeek, los botones de
👍/👎 con su diálogo, y las estadísticas de la aplicación de escritorio.

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

`web_search` solo aparece cuando instalas un buscador con su clave (el original trae
Exa y Perplexity como opcionales). Sin ninguno, el modelo no ve esa herramienta; es el
comportamiento normal del original cuando no hay proveedor de búsqueda utilizable.

### La marca

- `packages/client/ui-brand-digitalnexo`: el logo en la barra lateral y en la pantalla
  de inicio. Es un plugin que ocupa los mismos huecos que el oficial, que queda
  apagado. Sustituirlo no toca nada más.
- Iconos, favicon y manifiesto en `apps/web/public/`, y el título de la pestaña en
  `scripts/client-build-environment.ts`.
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

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream --tags
git checkout upstream && git merge <nueva-etiqueta> && git checkout main && git merge upstream
```

Los conflictos saldrán casi siempre en los `digitalnexo.patch.yml`: ahí es donde
quieres verlos. Después, `pnpm install && pnpm run build` y comprueba en
**Configuración → Complementos** que no ha reaparecido nada de DeepSeek.

Es una versión preliminar y su propio aviso dice que habrá cambios que rompan la
compatibilidad. No actualices sin probar.

## Compilar en una máquina sin salida a `cdn.sheetjs.com`

El original instala `xlsx` directamente desde `cdn.sheetjs.com`. Si tu red no llega a
ese dominio, apunta esa dependencia a la copia publicada en npm añadiendo a
`pnpm-workspace.yaml`, en `overrides`:

```yaml
  xlsx: 'npm:@e965/xlsx@0.20.3'
```

Es el mismo 0.20.3. Ese cambio **no está en el repositorio**: es un apaño de entorno,
no de producto.
