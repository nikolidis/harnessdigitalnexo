# Actualizar Digital Nexo desde DeepSeek Harness

Procedimiento probado: es el que llevó esta distribución de `dsh-v0.2.2-rc.1` a
`dsh-v0.2.2-rc.2`. La versión que hay ahora está en [`UPSTREAM`](UPSTREAM).

## Reglas

1. **Se siguen las etiquetas de versión** `dsh-v*` del original que sean `-rc.N` o
   finales (sin sufijo). Las `-alpha` y `-beta` y la rama `master` no se siguen: entre
   dos `rc` hay más de mil commits de trabajo sin publicar.
2. **`main` solo avanza si todo está en verde**: fusión resuelta, compilación,
   `check-composition`, `smoke`, ninguna prueba que falle aquí y no en el original, y
   el flujo `Escritorio` de GitHub en verde sobre la rama de trabajo (paso 8).
   Si algo falla, el trabajo se sube a la rama `actualizacion/<etiqueta>` con un
   `digitalnexo/PENDIENTE.md` que diga qué falló, y `main` se queda como estaba.
3. **Lo que el original quita y sirve sin DeepSeek, se conserva.** Si una versión
   elimina un paquete útil para esta distribución (pasó en la `rc.2` con los
   buscadores Exa y Perplexity), se recupera de `main` y pasa a mantenerlo Digital
   Nexo: ver «Paquetes que el original eliminó».
4. **No se acepta una versión que recorte sin remedio.** Parar e informar, sin tocar
   `main`, si la nueva versión: cambia `LICENSE` a algo que no sea MIT; quita o
   condiciona a una cuenta los proveedores de modelo de terceros
   (`packages/llm/llm-pi-ai`) o la instalación de plugins; o hace obligatorio un
   servicio de DeepSeek (cuenta, telemetría) que la capa `digitalnexo.patch.yml` ya
   no pueda desactivar.
5. **No se reescribe historia** ni se fuerza ningún `push`. No se suben etiquetas (las
   `escritorio-v*` las crea en GitHub el flujo `Escritorio` al publicar).
6. **Ante la duda, rama y aviso.** Un conflicto que esta página no cubre y cuya
   resolución no sea evidente no se adivina sobre `main`.

## Estructura

- Rama `upstream`: el original tal cual en la etiqueta importada, sin
  `.github/workflows`. Su historia es propia: un commit por versión importada. No
  comparte commits con el repositorio original, así que **no** se hace
  `git merge <etiqueta>`.
- Rama `main`: `upstream` más los cambios de Digital Nexo. La lista exacta de
  ficheros del original que Digital Nexo modifica es `git diff --stat upstream main`.
  Su único flujo de GitHub, `.github/workflows/escritorio.yml`, es propio: la fusión
  no lo toca porque `upstream` no lleva flujos.

## Entorno

Hace falta Node ≥ 24.9, pnpm 11 y unos 8 GB de memoria. Si `node -v` es menor:

```sh
mkdir -p ~/node24 && (cd ~/node24 && npm init -y >/dev/null && npm install node@24)
export PATH=~/node24/node_modules/node/bin:$PATH
export NODE_USE_ENV_PROXY=1      # solo detrás de un proxy HTTPS
command -v pnpm || npm install -g pnpm@11
```

En todo lo que sigue, `ORIG=https://github.com/deepseek-ai/deepseek-harness.git`.
Las herramientas se ejecutan directamente (`node_modules/.bin/tsx`,
`node_modules/.bin/vitest`) y no con `pnpm run`, que vuelve a verificar dependencias
en cada llamada.

## Pasos

### 1. ¿Hay versión nueva?

```sh
cat digitalnexo/UPSTREAM
git ls-remote --tags $ORIG 'refs/tags/dsh-v*' | grep -v '\^{}' | grep -v -e -alpha -e -beta | sort -t/ -k3 -V | tail -3
```

Si la última etiqueta es la de `UPSTREAM`, no hay nada que hacer.

Si ya existe la rama `actualizacion/<nueva>` en `origin` y **no** está contenida en
`main` (`git merge-base --is-ancestor origin/actualizacion/<nueva> origin/main` falla),
un intento anterior no llegó a verde: no se rehace. Si está contenida en `main`, es
una actualización ya terminada y no cuenta. Se lee su `digitalnexo/PENDIENTE.md`; si lo que falló
era del entorno (red, memoria, tiempo) se reintenta sobre esa rama, y si era del
código y no se sabe arreglar, se informa de que sigue pendiente.

### 2. Revisar qué quita (reglas 3 y 4)

```sh
git fetch --depth 1 --no-tags $ORIG refs/tags/<nueva>:refs/tags/<nueva>
git diff origin/upstream <nueva> -- LICENSE
git diff --name-only --diff-filter=D origin/upstream <nueva> -- 'packages/*/*/package.json'   # paquetes eliminados
git diff --stat origin/upstream <nueva> -- packages/llm/llm-pi-ai packages/boot | tail -3
git diff --name-only --diff-filter=A origin/upstream <nueva> -- docs/upgrade-guide | grep 'guide.md$'  # leerlas
```

De cada paquete eliminado hay que saber si se renombró (`git diff -M --name-status`),
si era de DeepSeek (no importa) o si era algo que esta distribución usa o puede usar
(regla 3).

### 3. Importar en `upstream`

```sh
git checkout -B upstream origin/upstream
git read-tree -u --reset <nueva>
git rm -rqf .github/workflows
git add -A
git commit --no-verify -m "Importar DeepSeek Harness <nueva> (original <sha>)"
git diff --stat upstream <nueva> | tail -1     # solo deben diferir los ficheros de .github/workflows
```

### 4. Fusionar en una rama de trabajo

```sh
git checkout -b actualizacion/<nueva> origin/main
git merge --no-commit --no-ff upstream
```

Cómo resolver cada conflicto:

| Fichero | Resolución |
|---|---|
| `**/locales.ts`, `packages/client/locale/src/locales/*.ts` | Quedarse con el del original (`git checkout --theirs`); el paso 5 vuelve a poner la marca |
| `packages/bundle/*/package.json` | Lo del original, más `"digitalnexo.patch.yml"` en `files`, `./digitalnexo.patch.yml` al final de `dsh.bundle.patch`, y en `web-app` la dependencia `@digitalnexo/dsh-client-ui-brand` |
| `packages/bundle/*/tests/*.spec.ts` | Lo del original, y donde espere la lista de capas, añadir `./digitalnexo.patch.yml` |
| `scripts/verify-package-readme-model-experience.ts`, `scripts/product-package-policy.ts` | Lo del original, más las líneas de `packages/client/ui-brand-digitalnexo` y de los paquetes de la sección siguiente |
| `tsconfig.base.json`, `tsconfig.client.json`, `tsconfig.host.json` | Lo del original, más las entradas de `@digitalnexo/dsh-client-ui-brand` y de los paquetes de la sección siguiente |
| `packages/web/web/src/index.ts` y su prueba | Conservar `readyRequiresProvider` y `selectedProviderReady(..., requiresProvider)` sobre el código nuevo; después regenerar: `tsx scripts/gen-config-catalog.ts` y `tsx scripts/gen-cordis-catalog.ts` |
| `packages/web/web/README*.md` | Lo del original, más la fila `readyRequiresProvider` de la tabla de configuración; después `tsx scripts/verify-translation-pairing.ts --write packages/web/web/README.md` |
| `README.md`, `README.zh.md` | Lo del original, más el aviso de distribución tras la línea de idiomas; después `tsx scripts/verify-translation-pairing.ts --write README.md` |
| `*.i18n.yaml`, `docs/config-catalog*.md`, `docs/subsystems/web*.md`, `packages/extensions/tool-cordis/src/api-catalog.ts` | Son generados: lo del original y regenerar con las órdenes de arriba |
| Pruebas con guarda de la cuenta: `ui-settings-account/tests/apply.client.spec.ts`, `ui-account-notifications/tests/apply.client.spec.ts` y dos de `ui-settings-general` | Lo del original y volver a poner la guarda `skipIf` (una línea por fichero: `git diff upstream~1 main -- <fichero>` la enseña). Una prueba nueva del original que ejercite la cuenta de DeepSeek sobre la composición real lleva la misma guarda |
| `packages/client/ui-theme/tests/color-tokens.client.spec.ts` | Lo del original, más la línea de `ui-brand-digitalnexo/src/client/Brand.module.css` en `EXEMPT_FILES` (colores de la marca) |
| `packages/api/workspace-controller/src/default-*.ts` y sus pruebas | Lo del original, cambiando la carpeta `deepseek-harness` por `digitalnexo` |
| `packages/client/ui-settings-models/src/onboarding-copy.ts` | Lo del original; si el original cambió su versión del aviso, subir también la de Digital Nexo (`AAAA-MM-DD.digitalnexo.N`) para que el aviso vuelva a mostrarse |
| `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/public/*` | Lo del original, con el título `Digital Nexo` y los iconos de Digital Nexo |
| Instantáneas `*.snap` | Lo del original y regenerar con `vitest run <prueba> -u`; en el `git diff` solo debe cambiar el nombre del producto |
| `apps/desktop/src/main.ts`, `welcome-backend.ts`, `preload-app.ts`, `ipc.ts` y `packages/client/ui-settings-models/src/client/index.ts` | Lo del original y volver a poner encima las condiciones de `DESKTOP_DISTRIBUTION` (`git diff upstream~1 main -- <fichero>`). Un sitio nuevo del original que abra la bienvenida, vigile la cuenta o busque actualizaciones lleva la misma condición |
| `apps/desktop/scripts/*` (`electron-builder-config.mjs`, `package-target.ts`, `desktop-package-environment.mjs`, `desktop-build-paths.*`, `prepare-*.ts`, `smoke-packaged-runtime.ts`, `pack-local-packages.ts`, `retain-desktop-ci.ts`) y `apps/desktop/cli/dsh*` | Lo del original y volver a aplicar la identidad de Digital Nexo, el destino `linux-x64` (solo sin firmar) y el empaquetado local sin `.env` |
| `apps/desktop/src/locale.ts`, `apps/desktop/installer/locales/*.json`, cabeceras `apps/desktop/installer/*.h` | Lo del original; el paso 5 vuelve a poner la marca |
| `apps/desktop/resources/*`, `apps/desktop/installer/assets/*` | Los de Digital Nexo. Si el original cambia nombres o tamaños, regenerarlos con `node digitalnexo/brand/build-desktop-assets.mjs` |
| `apps/desktop/tests/*.spec.ts` | Lo del original; el paso 5 cambia los textos. En `main-startup`, `welcome-startup` y `preload-app` volver a poner el simulacro de `distribution.ts` y las pruebas de la distribución de Digital Nexo (`git diff upstream~1 main -- <fichero>`) |
| `apps/desktop/tests/expected/*` | Lo del original y regenerar con `vitest run <prueba> -u`; en el `git diff` solo debe cambiar el nombre del producto |
| `apps/desktop-host/package.json` | Lo del original, más las dependencias de Exa y Perplexity |
| `pnpm-lock.yaml` | Lo del original; el paso 6 lo regenera |
| `.github/dependabot.yml` | Sigue borrado |

Para un fichero que no esté en la tabla: quedarse con el del original y volver a
aplicar encima el cambio de Digital Nexo, que es lo que enseña
`git diff upstream~1 main -- <fichero>` (`upstream~1` es la versión anterior sin tocar).

### Paquetes que el original eliminó y Digital Nexo mantiene

| Paquete | Eliminado en | Registros que necesita |
|---|---|---|
| `packages/web/web-search-exa`, `packages/web/web-search-perplexity` | `dsh-v0.2.2-rc.2` | `paths` en `tsconfig.base.json`, `references` en `tsconfig.host.json`, `scripts/product-package-policy.ts`, `scripts/verify-package-readme-model-experience.ts` (solo Exa) y las dependencias de `apps/desktop-host/package.json` (para que vayan dentro de la aplicación de escritorio) |

En cada actualización: poner su `version` igual a la del resto de paquetes, y también la
de `packages/client/ui-brand-digitalnexo` (el empaquetado del escritorio instala los
paquetes desde sus tarballs y exige la misma versión que piden los demás), y
comprobar que compilan y pasan sus pruebas
(`node_modules/.bin/vitest run packages/web/web-search-exa packages/web/web-search-perplexity`).
Si la interfaz `ctx.web.registerSearchProvider` cambia, se adaptan. `smoke.mjs`
comprueba que al montarlos se ofrece `web_search`.

Para conservar un paquete que elimine una versión futura: `git checkout main -- <carpeta>`
después de la fusión, añadir sus registros, apuntarlo en esta tabla y, si tiene un
efecto que se pueda comprobar desde fuera, añadirlo a `smoke.mjs`.

### 5. Volver a aplicar la marca y revisar la composición

```sh
node digitalnexo/tools/brand-text.mjs
node digitalnexo/tools/check-composition.mjs
```

`check-composition` lista las filas que entran y salen y **falla** si una fila que
la capa desactiva ha desaparecido (el original la renombró o la quitó: actualizar el
`digitalnexo.patch.yml` que la nombra) o si aparece activa una fila nueva de
DeepSeek, cuenta, telemetría o comentarios (desactivarla en la capa; si no habla con
DeepSeek, justificarla en `tools/allowed-rows.json`). Una fila nueva que no hable con
DeepSeek se deja activa: es funcionalidad nueva.

Si una prueba falla por un texto esperado que dice `DSH` o `DeepSeek Harness`, se
cambia la expectativa a `Digital Nexo`, no el texto: se añade una regla a `LITERALS`
en `brand-text.mjs` para que la próxima vez sea automático.

El `README.md` de un paquete propio (`packages/client/ui-brand-digitalnexo`) tiene
que seguir el esqueleto que exija el original en esa versión
(`node_modules/.bin/vitest run scripts/doc-standard.spec.ts`).

### 6. Dependencias, compilación y comprobaciones

```sh
node digitalnexo/tools/xlsx-mirror.mjs on     # solo si el entorno no llega a cdn.sheetjs.com
pnpm install
node_modules/.bin/tsx scripts/clean.ts        # quita restos de paquetes que el original borró
node_modules/.bin/tsx scripts/build.ts --scope artifacts
node_modules/.bin/tsx scripts/build.ts --scope check
node digitalnexo/tools/check-composition.mjs
node digitalnexo/tools/smoke.mjs
```

Las dos fases de compilación van por separado: juntas no caben en 8 GB de memoria.

`smoke.mjs` no necesita navegador ni claves: declara como proveedor de terceros el
servidor de modelo simulado del repositorio y comprueba que el perfil `headless`
responde una tarea, que al modelo no se le ofrece nada de DeepSeek ni un `web_search`
sin buscador, que con Exa o Perplexity montados sí se ofrece, y que el perfil `web`
sirve la página con el título y el icono de Digital Nexo.

En cuanto esto pase, conviene confirmar y subir la rama de trabajo (paso 8, sin tocar
`main`) para no perder lo hecho si el resto se interrumpe. Subirla pone además en
marcha el flujo `Escritorio` en GitHub (unos 20 minutos), que se revisa en el paso 8.

### 7. Pruebas, comparadas con el original

```sh
node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/dn-tests.json   # unos 45 minutos
```

La batería del original no sale limpia fuera de su integración continua: en la
`rc.2`, sin tocar, fallan 135 pruebas de 56.066 en una máquina Linux como root,
porque dependen de IPv6, de no ser root, de macOS o de los flujos de
`.github/workflows` que aquí no existen. Por eso el criterio no es «cero fallos»
sino «ningún fallo que el original no tenga también aquí». El original se prepara
en una copia aparte de la rama `upstream` y solo se ejecutan en él los ficheros que
hayan fallado en Digital Nexo:

```sh
node digitalnexo/tools/compare-tests.mjs --failed-files /tmp/dn-tests.json > /tmp/fallidos.txt
git worktree add /tmp/original upstream
mkdir -p /tmp/original/digitalnexo/tools && cp digitalnexo/tools/xlsx-mirror.mjs /tmp/original/digitalnexo/tools/
cd /tmp/original
node digitalnexo/tools/xlsx-mirror.mjs on && pnpm install
node_modules/.bin/tsx scripts/build.ts --scope artifacts
node_modules/.bin/vitest run --reporter=json --outputFile=/tmp/original-tests.json $(while read -r f; do [ -f "$f" ] && echo "$f"; done < /tmp/fallidos.txt)
cd - && node digitalnexo/tools/compare-tests.mjs /tmp/original-tests.json /tmp/dn-tests.json
```

`compare-tests` falla si Digital Nexo tiene algún fallo que el original no tenga.
Antes de dar uno por bueno, repetir ese fichero suelto en Digital Nexo: con la
máquina cargada hay pruebas que agotan su tiempo y sueltas pasan. No ejecutar dos
baterías a la vez.

Con el original ya compilado en `/tmp/original`, y si hay Chrome, comparar también
la interfaz:

```sh
node digitalnexo/tools/compare-ui.mjs /tmp/original
```

Recorre las mismas pantallas en las dos aplicaciones y falla si Digital Nexo tiene
errores, hace peticiones fuera de la máquina, o difiere del original en algo que no
esté en `tools/ui-differences.json`. Una diferencia nueva se mira: si es un servicio
de DeepSeek que debe quedar fuera, se apunta en ese fichero (`--write`); si es una
función que el original tiene y aquí falta, se arregla la capa. Si no hay navegador
(sale con 3), se dice en el informe que este paso no se hizo.

### 8. Confirmar y publicar

```sh
node digitalnexo/tools/xlsx-mirror.mjs off    # siempre antes de git add
node digitalnexo/tools/check-composition.mjs --write
# actualizar digitalnexo/UPSTREAM (tag= y commit=) y la línea «Base» de DIGITALNEXO.md
git add -A && git commit --no-verify    # mensaje en español: versión, qué trae, qué se adaptó
git worktree remove --force /tmp/original
```

Subida la rama, esperar al flujo `Escritorio` de su último commit (empaqueta Windows y
Linux, los instala, recorre la interfaz y los desinstala):

```sh
gh api "repos/nikolidis/harnessdigitalnexo/actions/runs?branch=actualizacion/<nueva>&per_page=1" \
  --jq '.workflow_runs[0] | [.id, .head_sha, .status, .conclusion] | @tsv'
gh api repos/nikolidis/harnessdigitalnexo/actions/runs/<id>/jobs --jq '.jobs[] | [.id, .name, .conclusion] | @tsv'
gh api repos/nikolidis/harnessdigitalnexo/actions/jobs/<id>/logs > /tmp/trabajo.log    # si un trabajo falla
```

Los registros se leen así; los artefactos (capturas, instaladores) no siempre se pueden
descargar desde fuera de GitHub. Un fallo del escritorio es rojo como cualquier otro:
se arregla en la rama o se deja en `PENDIENTE.md`.

Todo en verde:

```sh
git checkout -B main origin/main && git merge --ff-only actualizacion/<nueva>
git push --no-verify origin upstream main
```

Al llegar a `main`, el mismo flujo vuelve a empaquetar y probar, y publica los
instaladores en la versión `escritorio-v<versión>`. Se comprueba que terminó en verde
y que la versión publicada existe (`gh release view escritorio-v<versión> --repo nikolidis/harnessdigitalnexo`).

Algo en rojo: escribir `digitalnexo/PENDIENTE.md` en la rama (qué falló, con qué
salida, qué se intentó), confirmarlo, `git push --no-verify origin upstream actualizacion/<nueva>`
y dejar `main` sin tocar.

`--no-verify` evita los ganchos locales del original, que repiten la compilación
entera; las comprobaciones ya se han hecho en los pasos 6 y 7.

### 9. Informe

En español y corto: de qué versión a cuál; qué trae de nuevo para quien la usa (de
las guías de `docs/upgrade-guide` y de las filas nuevas que lista `check-composition`);
qué quitaba el original y qué se hizo con ello; qué hubo que adaptar; el resultado de
cada comprobación con sus números, incluido el flujo `Escritorio` y el enlace a los
instaladores publicados; y lo que no se pudo comprobar.
