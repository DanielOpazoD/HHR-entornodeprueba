# Runbook Netlify Serverless Deploy

## Objetivo

Diagnosticar rápido fallos de build, bundling y runtime en `netlify/functions`.

## Fuente canónica

- `package.json`
- `.nvmrc`
- `netlify.toml`
- `reports/serverless-runtime-governance.md`
- `docs/SERVERLESS_SENSITIVE_CONTRACTS.md`

## Checklist de pre-deploy

1. Confirmar que `.nvmrc`, `package.json > engines.node` y `netlify.toml > NODE_VERSION` estén alineados.
2. Ejecutar `npm run check:serverless-runtime-governance`.
3. Ejecutar `npm run check:netlify-functions-bundle`.
4. Ejecutar `npm run build`.
5. Confirmar variables de entorno obligatorias del endpoint afectado.

## Fallos típicos

### 1. Build local funciona y Netlify falla

1. Revisar `reports/serverless-runtime-governance.md`.
2. Confirmar versión de Node usada por Netlify.
3. Revisar warnings `EBADENGINE` en el log de instalación.
4. Repetir `npm run check:netlify-functions-bundle` localmente.

### 2. Netlify no puede resolver una dependencia

1. Identificar el archivo exacto reportado por Netlify.
2. Verificar si importa runtime de Firebase Functions desde `netlify/functions`.
3. Si el helper es puro, moverlo fuera del adapter de runtime.
4. Si el módulo debe quedar externo, agregarlo explícitamente en `netlify.toml > external_node_modules`.

### 3. Build del frontend pasa, pero falla el empaquetado de Functions

1. Ejecutar `npm run check:netlify-functions-bundle`.
2. Revisar imports cruzados desde `functions/lib/**` hacia `netlify/functions/**`.
3. Confirmar que los helpers compartidos no dependan de `firebase-functions/v1`.

### 4. Falla instalación de dependencias en `/.netlify/plugins` (`ENOTFOUND`)

Síntoma típico en log:

- `Error while installing dependencies in /opt/build/repo/.netlify/plugins/`
- `npm error code ENOTFOUND`
- `request to https://<host>.netlify.app/packages/<plugin>.tgz failed`

Diagnóstico:

1. Este error ocurre **antes** del build de la app y normalmente no está causado por cambios en `src/**`.
2. Netlify está intentando instalar un Build Plugin remoto (generalmente configurado a nivel de sitio/UI), y el host del paquete no resuelve DNS.
3. Si `netlify.toml` no tiene `[[plugins]]`, el origen probable es la configuración del sitio en Netlify (no del repositorio).

Acciones:

1. Ir a **Site configuration → Build & deploy → Build plugins** y quitar/desactivar el plugin que apunta a `https://<host>.netlify.app/packages/*.tgz`.
2. Si ese plugin es requerido, publicar su paquete en un host estable (npm registry o URL interna válida) y actualizar la referencia.
3. Reintentar deploy con **Clear cache and deploy site**.
4. Si persiste, validar resolución DNS del host del plugin desde un entorno externo y revisar estado de Netlify.

## Artefactos de correo y rendimiento

`npm run check:netlify-functions-bundle` compila cada función una sola vez. Para
`send-census-email`, `send-fuga-notification`, `operational-telemetry` y
`operational-telemetry-retry`, reutiliza los mismos bundles para:

1. Aplicar los límites de JavaScript y gzip de
   `scripts/config/netlify-mail-budgets.json` y exigir que Gmail sea la única API
   de Google incluida. Los techos tienen margen sobre la medición del primer
   head de PR #927; un aumento exige medir y explicar la causa.
2. Medir cinco cargas por función en procesos Node nuevos, intercalando las
   funciones, y registrar mediana, rango y RSS antes/después. Estos tiempos son
   informativos; la carga medida empieza al importar el artefacto y excluye el
   arranque de Node. La RSS observada no representa un pico de memoria.
3. Ejecutar preflight, método rechazado y origen rechazado en los tres endpoints
   HTTP empaquetados. Del cron se comprueban su exportación y horario, sin
   ejecutar el drenaje de la cola. Los procesos usan un entorno sintético y
   bloquean red, incluidos DNS y sockets.

El resultado queda en `reports/netlify-mail-runtime.json` y `.md`, con hashes,
versión de Node/esbuild, configuración, carga del equipo y errores. CI ejecuta
este control dentro de `build-budget` y publica el artefacto `netlify-mail-runtime`.
Tamaño, carga correcta y smoke bloquean el gate; las variaciones de tiempo no.
Los bytes corresponden al JavaScript generado. Las dependencias externas,
listadas en el informe, también forman parte del paquete desplegado; medir el
ZIP y la latencia de Netlify requiere evidencia propia del despliegue.

El endpoint de censo carga el exportador Excel después de validar autorización y
datos, y el cifrador después de validar el archivo y su nombre. Las pruebas de
inicialización conservan esos límites y el flujo válido comprueba bytes,
contraseña, adjunto cifrado y metadatos. Para revertir la carga diferida, restaurar
los imports estáticos conservando el resto del handler.

## Variables y contratos

- El cliente compartido de correo importa `googleapis/build/src/apis/gmail`, que
  incluye Gmail v1 y OAuth2. Importar la raíz `googleapis` incorpora también los
  clientes de otras APIs al bundle de las funciones de correo. Al actualizar esa
  dependencia, comprobar la resolución del subpath, los tests de correo y
  `check:netlify-functions-bundle`. Para revertir esta optimización, restaurar la
  importación raíz y sus llamadas; no cambia la configuración de credenciales.
- Variables de runtime Netlify: revisar `docs/SERVERLESS_SENSITIVE_CONTRACTS.md`.
- Providers AI: revisar `docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md`.
- Módulos externos actuales: `xlsx-populate`, `exceljs`.

## Comandos

```bash
npm run check:serverless-runtime-governance
npm run check:netlify-functions-bundle
npm run report:serverless-runtime-governance
npm run build
```
