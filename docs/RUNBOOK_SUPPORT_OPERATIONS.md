# Runbook Técnico de Soporte Operacional

## Objetivo

Estandarizar respuesta de soporte ante incidentes de datos, sincronización y permisos.

Este runbook complementa `docs/RUNBOOK_SYNC_RESILIENCE.md` con una pauta más operativa (triage + decisión + cierre).

## Alcance

- Sincronización Firestore/IndexedDB.
- Cola de sincronización (outbox).
- Conflictos de concurrencia.
- Permisos Firestore/Storage.
- Incidentes de degradación local (IndexedDB fallback).

## Checklist Diario (Soporte)

1. Revisar en `Admin > System Health` usuarios con:
   - `failedSyncTasks > 0`
   - `conflictSyncTasks > 0`
   - `oldestPendingAgeMs > 300000`
2. Validar que no existan usuarios con estado crítico por más de 15 minutos.
3. Confirmar que no hay alertas repetidas de `permission-denied` en consola.
4. Registrar incidentes abiertos/cerrados del día.
5. Revisar `reports/operational-health.md` antes de cambios manuales.
6. Si el cambio o incidente afecta `Censo Diario`, usar también:
   - [docs/CENSUS_OPERATIONAL_VALIDATION_CHECKLIST.md](./CENSUS_OPERATIONAL_VALIDATION_CHECKLIST.md)

## Controles Nuevos (Auth)

- Login redirect protegido:
  - Se usa marca temporal `hhr_auth_bootstrap_pending_v1` para evitar rebote prematuro a Login durante retorno de Google redirect.
  - Timeout extendido de bootstrap auth a 45s cuando la marca está activa.
  - Heartbeat de lock multi-pestaña durante popup (`hhr_google_login_lock_v1`) para evitar colisiones en inicios largos.
  - Política unificada de errores de auth popup/COOP (`authErrorPolicy`) para decidir cuándo mostrar acceso alternativo por redirect.
- Backups Storage (contrato de fecha):
  - Servicios de respaldo (`censo`, `CUDYR`, `PDF`) validan fecha de entrada con formato `YYYY-MM-DD` y calendario válido.
  - Entradas inválidas se degradan de forma segura (sin romper UI ni cola).
  - En operaciones de consulta/borrado, una fecha inválida responde `false/null/no-op` (sin excepción operativa).
  - En operaciones de subida, si Storage no está inicializado se emite error explícito de inicialización.
  - Clasificación unificada de errores Storage:
    - `not_found` / `permission_denied` / `unauthenticated` se tratan como no fatales en checks de existencia.
    - `unknown` se mantiene visible en logs para investigación.

## Matriz de Severidad

- `SEV-1`:
  - > 3 usuarios críticos por >30 minutos.
  - Pérdida/corrupción de datos clínicos.
- `SEV-2`:
  - 1-3 usuarios con cola atascada >15 minutos.
  - Conflictos persistentes sin resolución automática.
- `SEV-3`:
  - Incidente individual recuperable (retry/reload).

## Árbol de Decisión Rápido

1. ¿Hay `permission-denied`?
   - Sí: ir a "Caso A".
   - No: continuar.
2. ¿Hay `ConcurrencyError` o `conflictSyncTasks > 0`?
   - Sí: ir a "Caso B".
   - No: continuar.
3. ¿Hay banner de resiliencia / fallback IndexedDB?
   - Sí: ir a "Caso C".
   - No: continuar.
4. ¿`oldestPendingAgeMs` sigue creciendo?
   - Sí: ir a "Caso D".
   - No: monitoreo normal.

## Caso A: Permisos (`permission-denied`)

1. Confirmar email y rol del usuario.
2. Identificar recurso afectado:
   - Firestore (ruta exacta).
   - Storage (ruta exacta).
3. Verificar reglas desplegadas (`firestore.rules`, `storage.rules`).
4. Corregir claim/rol o regla y redeploy.
5. Solicitar al usuario repetir acción.
6. Si el error es en fuentes legacy:
   - Confirmar que el bloqueo de lectura legacy quedó activo para la sesión (sin spam de consola).
   - No forzar reintentos manuales sobre rutas legacy si ya hay bloqueo.

Criterio de cierre:

- Nuevo intento exitoso.
- Sin `FAILED` nuevos en outbox.

## Caso B: Conflicto de concurrencia

1. Confirmar que el sistema ejecutó merge automático.
2. Validar registro final:
   - Campos clínicos locales preservados.
   - Campos administrativos remotos preservados.
3. Confirmar log de auditoría de auto-merge.
4. Confirmar que cola vuelve a `pending=0`.

Criterio de cierre:

- `conflictSyncTasks=0`.
- Registro consistente en UI y backend.

## Caso C: IndexedDB bloqueado / fallback

1. Pedir cerrar pestañas duplicadas de la app.
2. Usar `Reintentar`.
3. Si persiste, ejecutar `Limpieza Dura`.
4. Recargar y validar fin de banner.

Criterio de cierre:

- Sin banner de resiliencia.
- Persistencia local y sync funcionando.

## Caso D: Cola atascada (`pending` crece)

1. Abrir **Eloísa → Guardado local** y revisar fecha y motivo del bloqueo. «Sin permisos» no significa falta de conexión; reenviar sin resolver el permiso puede volver a fallar.
   Si el envío antiguo no aparece, usar **Ver más envíos** hasta llegar a su fecha.
   La lista amplía de doce en doce y vuelve a consultar la misma cola de esta sesión;
   consultar más no reintenta ni retira nada. Los envíos reintentando ya están incluidos
   en el total pendiente y no se suman una segunda vez.
2. «Sesión no validada» significa que el servidor no pudo validar la sesión de ese envío; comprobar la sesión actual. Para ambos rechazos, **Revisar reintento** explica el bloqueo y **Ya revisé, reintentar** reenvía sólo por decisión de la persona. Abrir el detalle no inicia un envío. Para un envío transitorio, comprobar la conexión y esperar un ciclo de backoff. Una escritura sin versión de origen exige revisión; no se reintenta sin cambios.
3. Si el censo compartido ya está correcto y ese envío no hace falta, elegir **Descartar envío**, revisar o descargar su copia y confirmar que esos cambios no se necesitan. Cancelar conserva el pendiente.
4. El envío retirado deja el contador y no se reintenta. En **Envíos descartados → Descargar respaldo** queda su contenido original, base y motivo del rechazo. El respaldo puede contener datos clínicos: mantenerlo en un destino autorizado. No es una confirmación del servidor ni se reenvía automáticamente.
5. Si el envío cambió en otra pestaña o no se pudo persistir el retiro, permanece pendiente: volver a revisar. No borrar IndexedDB ni cerrar sesión para ocultar el indicador.

Criterio de cierre:

- `oldestPendingAgeMs` decrece sostenidamente.
- `retryingSyncTasks` retorna a 0.

## Variables de Diagnóstico (solo soporte técnico)

- `VITE_DEBUG_REPOSITORY=true`:
  - Habilita logs de trazas de repositorio (Firestore).
  - Mantener desactivado en operación normal para evitar ruido.
- Trazas `[StoragePerf]`:
  - Se emiten automáticamente como advertencia cuando una operación Storage supera el umbral de latencia.
  - No requieren activar flags adicionales en operación normal.
- `E2E_BUDGET_LOGIN_VISIBLE_MS`, `E2E_BUDGET_AUTH_FEEDBACK_MS`, `E2E_BUDGET_CENSO_VISIBLE_MS`:
  - Umbrales del test de performance de arranque en CI.
  - Ajustar sólo con evidencia de hardware/red del entorno objetivo.
- `E2E_CRITICAL_BROWSERS`:
  - Define navegadores del gate E2E crítico (`chromium` por defecto).
  - En CI se recomienda `chromium,firefox` para cubrir compatibilidad multi-browser sin duplicar suites.
- Diagnóstico local de consola del runtime:
  - Por defecto la app mantiene la consola en modo silencioso (`warn`/`error`).
  - Para una sesión puntual de soporte se puede subir el detalle con `?logLevel=debug` o `?logLevel=info` en la URL.
  - Alternativamente, en DevTools:
    - `localStorage.setItem('hhr_log_level', 'debug')`
    - recargar la app
    - al terminar: `localStorage.removeItem('hhr_log_level')`
  - Niveles válidos: `debug`, `info`, `warn`, `error`, `none`.
  - Usar este modo solo mientras se diagnostica; no dejarlo persistido para operación normal.
- Reporte operativo E2E en CI:
  - Se genera `reports/e2e/critical-operational-metrics.json` y `reports/e2e/critical-operational-summary.md`.
  - `durationMs` suma los intentos; `wallDurationMs` mide el tiempo total de Playwright. No son intercambiables cuando hay paralelismo. `slowestTests` (máximo 10) y `files` localizan el coste sin cambiar umbrales.
  - Revisar `flaky`, `retriesUsed` y `durationMs` antes de aprobar release si hubo incidentes de estabilidad.
  - Umbrales operativos definidos en `scripts/config/e2e-operational-thresholds.json`.
  - El gate operativo con `--enforce` bloquea evidencia ausente, inválida, vacía o no limpia y `maxFlaky`; duración y reintentos siguen como advertencia operativa. Los informes JSON y Markdown se conservan incluso ante un fallo.
  - El baseline compara sólo ejecuciones completas, sin fallos ni flakiness y de la misma cohorte (archivo, ruta del título, proyecto y resultado final, incluyendo omisiones). Historial legacy sin `suiteFingerprint` se conserva pero no se usa para inferir regresiones; un baseline explícito incompatible genera una advertencia y usa únicamente historial comparable.
  - Artefacto en GitHub Actions: `e2e-critical-emulator-artifacts`.

## Evidencia Mínima para Escalar a Ingeniería

- Email usuario, hospital, fecha/hora.
- Captura `System Health` (métricas clave).
- Error completo de consola (stack + code).
- Acción exacta que gatilla el problema.
- Estado final tras pasos del runbook.

## Comandos de Diagnóstico Técnico

```bash
npm run report:operational-health
npm run check:operational-runbooks
npm run typecheck
npm run check:quality
npm run test:resilience
npm run test:risk:admin-health
npm run test:risk:auth
npm run test:risk:platform
npm run test:sync-load
npm run test:rules:ci
npm run test:emulator:sync:ci
npm run test:e2e:critical:ci
npm run test:e2e -- e2e/auth-multi-tab-lock.spec.ts
npm run test -- src/tests/security/netlifyHeadersStatic.test.ts
```

Parámetros opcionales para carga de cola:

```bash
SYNC_QUEUE_LOAD_VOLUME=120 SYNC_QUEUE_RETRY_VOLUME=40 SYNC_QUEUE_LOAD_MAX_MS=8000 npm run test:sync-load
```

## SLA Operacional Recomendado

- `SEV-1`: respuesta < 15 min, mitigación inicial < 60 min.
- `SEV-2`: respuesta < 60 min, mitigación < 4 h.
- `SEV-3`: respuesta mismo día hábil.

## Fallas visibles en la aplicación

### Exportación detenida antes de generar el archivo

La espera conserva su límite de 2,5 s y devuelve un resultado explícito. Si el
censo sigue guardándose, falló el guardado o cambió el día, la acción termina con
un aviso recuperable; repetirla cuando el estado esté resuelto. No aumentar el
límite ni exportar el registro anterior para ocultar el incidente. Esta barrera
coordina mutaciones locales y no certifica que la copia remota esté actualizada;
los controles de Storage y sus resultados parciales conservan sus contratos.

Regresiones: `useAppContentRuntime.test.tsx`, `useExportManager.test.ts` y
`exportReadinessController.test.ts`. El controlador cubre la espera y la segunda
comprobación; el hook cubre PDF, Excel, impresión y respaldo confirmado. Aplicar
`ci:merge-gate` y el pack blocking de `test:release-confidence`, reutilizando sólo
controles ya aprobados sobre el mismo código y configuración.

### Detalle de signos o scores no disponible

El censo mantiene sus valores aunque falle la carga del módulo de detalle.
El cuadro informa el fallo y permite cerrarlo; no recarga automáticamente una
edición activa ni inventa resultados. Recargar la aplicación cuando sea seguro
si un despliegue dejó un módulo anterior no disponible. Los chunks de detalle
siguen incluidos en el precache de producción para conservar su uso sin conexión.

`ClinicalDetailLoading.test.tsx` comprueba importación bajo demanda, cancelación,
respuesta tardía y aislamiento del fallo. Las pruebas de `VitalsCell` y
`ScoresCell` verifican el contenido clínico tras la carga. La medición de Rollup
del 01-10-2026 redujo el chunk del censo de 330.905 a 318.340 bytes y su unión
estática con el shell de 2.238.015 a 2.225.451 bytes (misma configuración local).
Es una reducción de JavaScript inicial, no una medición de latencia de usuarios.

### Historial de movimientos: lectura completa y cancelación

La búsqueda global consulta todo el historial remoto con páginas de 20 censos,
orden descendente por `date` y cursor del último documento, incluido su desempate
por ID. No usa offsets ni limita la antigüedad. El contador indica censos revisados;
la cronología derivada se publica sólo al terminar todas las páginas. Mientras
se lee, permanece disponible la cronología del maestro de pacientes.

Volver a resultados, cerrar el cuadro, cambiar paciente o versión de su maestro
cancela el avance. Firestore no cancela la solicitud ya en vuelo; su respuesta
se descarta y no se inicia otra página. Un fallo posterior descarta el prefijo
remoto y muestra el historial local como parcial, sin cachearlo como completo.
La búsqueda no escribe en la caché editable del censo. Los snapshots retenidos
para armar movimientos excluyen notas, signos y documentos clínicos.

Diagnóstico de sólo lectura del 01-10-2026 en `hhr-pruebas`: 305 documentos
representaron 31.225.956 bytes serializados; una página de 20, 5.327.028 bytes.
Estas cifras justifican limitar el trabajo abandonado; no demuestran menor tiempo
de completar toda la historia. Varias consultas añaden viajes de red y no forman
un snapshot atómico entre páginas. No usar esta vista de lectura para autorizar
escrituras. Cursor documentado por [Firebase](https://firebase.google.com/docs/firestore/query-data/query-cursors).

Regresiones: `patientHistoryPages`, `firestoreRecordQueries` y
`usePatientSelectionCancellation`, además de paridad de historia, RN y rangos.
Verificar cierre/desmontaje, versiones del mismo RUT, empate de fechas, fallo de
una página y respuesta tardía. Aplicar merge gate y controles blocking de release.

## Acceso por RUT

### Cuentas RUT: primer ingreso y recuperación

La entrega se valida con `test:accounts:emulator:ci` (Auth/Firestore/Storage y UI
sintéticos) y los gates de runtime crítico. El correo se sustituye en emuladores;
no acredita entrega real. Ver [operación y publicación](RUT_PASSWORD_RECOVERY.md).

### Acceso RUT aceptado seguido de cierre inmediato

Comprobar por separado el monitor y las reglas efectivamente publicadas. El
monitor consulta al servidor y admite todos los roles administrables; no exige
el rol de enfermería a un administrador. `nursingSessionMonitor.test.ts` verifica
roles, denegación, vencimiento, interrupción de transporte y desmontaje.

Si las lecturas básicas devuelven `permission-denied`, comparar el ruleset activo
del proyecto autorizado con Firestore/Storage del SHA validado. La aceptación de
la contraseña y de `checkUserRole` no acredita permisos en las reglas. Conservar
la guarda que cierra sesiones sin permisos; alinear reglas y cliente antes de
repetir ingreso y recarga con una cuenta sintética, sin modificar datos clínicos.

### Cierre de sesión con canal entre pestañas interrumpido · 22-10-2026

Si BroadcastChannel.postMessage falla al salir, la notificación es best-effort:
no debe impedir signOut de Firebase ni limpieza del propietario y generación.
La regresión `useAuthStateSessionSupport.logout-broadcast.test.ts` ejecuta el
handler real con canal fallido en cierres manual y automático; conserva el
pendiente de enfermería y no elimina su cola. Ejecutar también
`authBroadcastChannel.test.ts` y `useAuthState.crossTabLogout.test.ts`.
Los mensajes SYNC_COMPLETED y el helper getAuthBootstrapTimeoutMs se retiraron
tras comprobar que no tenían consumidores de ejecución. No se cambia la política
de revocación ni se ignoran fallos de Firebase como si fueran éxitos.

### Ruta regional de acceso RUT

Si falla el ingreso después de cambiar de región, comprobar primero el proyecto
del cliente y su `VITE_ACCOUNT_FUNCTIONS_REGION`. Sin flag o con valor vacío,
sólo `VITE_FIREBASE_PROJECT_ID=hhr-pruebas` selecciona Santiago. Otros proyectos
usan US. Los valores válidos son `us-central1`, `southamerica-east1` y
`southamerica-west1`; un valor inválido usa US y nunca se interpreta como URL.

Verificar disponibilidad y configuración de `signInWithRutSantiago` en
`southamerica-west1`: Gen2, cuenta de servicio Appspot del proyecto explícita,
256 MiB, CPU equivalente Gen1, concurrencia 1, mínimo 0, máximo 10 instancias y
60 segundos. El endpoint conserva el protocolo del callable Gen1, incluidos
CORS/preflight, autorización, rechazo de input y errores públicos. Un error de
invocación del transporte no se arregla omitiendo la validación de cuenta ni
ampliando IAM de proyecto. Conservar `signInWithRut` US/São Paulo y las rutas de
administración, activación y recuperación.

Si Santiago o São Paulo no entregan respuesta utilizable (`internal`,
`unavailable` o `deadline-exceeded`), el cliente repite el ingreso una vez en US
y registra `auth`/`rut_sign_in_region_fallback` con región y código. Varios
eventos seguidos en el registro de la función `operational-telemetry` de Netlify
indican una caída regional; son `degraded` y no envían correo. En el navegador
puede verse como un error de CORS, porque un 500 de la plataforma no trae
cabeceras CORS. Probar el preflight; sano responde 204 con
`Access-Control-Allow-Origin`:

```sh
curl -si -X OPTIONS -H 'Origin: https://hhr-hospitalizados.app' \
  -H 'Access-Control-Request-Method: POST' \
  https://southamerica-west1-hhr-pruebas.cloudfunctions.net/signInWithRutSantiago
```

Si la plataforma no inicia instancias, redesplegar sólo esa función con el código
de main. Los rechazos de credenciales, límite o entrada nunca se repiten y las
demás operaciones de cuentas no cambian de región. Para usar sólo US en el
cliente de pruebas, fijar explícitamente `VITE_ACCOUNT_FUNCTIONS_REGION=us-central1`
y reconstruir/reiniciar ese cliente; quitar el flag vuelve al default Santiago.
No borrar sesión, cachés, colas ni datos para diagnosticar disponibilidad.

Feedback focalizado:

```sh
npx vitest run --maxWorkers=1 \
  src/tests/functions/accountFunctionsRegions.test.ts \
  src/tests/functions/accountSantiagoFunction.test.ts \
  src/tests/services/auth/nursingAccountRegion.test.ts
```

Mantener cobertura sensible, ciclo de vida de cuentas y emuladores;
estos tests no sustituyen los gates de runtime crítico ni la prueba desplegada.
Comparar ingresos intercalados sin descartar accesos lentos; la evidencia de cinco
pares no convierte el primer acceso observado en arranque frío ni acredita p95.

### Lecturas agrupadas del ingreso por RUT

Si falla un ingreso después de cambiar sus lecturas, comprobar por separado el
commit de límites, la verificación del proveedor y la lectura final de acceso.
Un resultado del callback transaccional no acredita un commit: no autenticar con
el índice de un intento abandonado. Mantener 100 intentos/IP y 10/cuenta por cinco
minutos, incluido el consumo de IP ante rechazo de cuenta. Un fallo de Firestore
no permite saltar los límites ni reutilizar permisos anteriores.

Feedback focalizado, sin sustituir los gates de autenticación:

```sh
npx vitest run src/tests/functions/accountRateLimit.test.ts src/tests/functions/accountSignInReads.test.ts src/tests/functions/nursingAccountTransport.test.ts src/tests/services/auth/nursingAccountSession.test.ts --maxWorkers=1
```

Estas pruebas cubren snapshot tras commit/reintento, rechazo y expiración de
límites, revocación durante la verificación y sustitución de sesión mientras
espera el lock del navegador. Conservar además ciclo de vida, recuperación y
`test:accounts:emulator:ci`; para cierre, `ci:merge-gate`,
`test:release-confidence`, revisión independiente y CI del head definitivo.
Los dobles transaccionales no sustituyen la comprobación del SDK y emuladores.
Una menor cantidad de viajes remotos no prueba menor latencia inicial: comparar
primer ingreso observado y siguientes sin llamar «frío» a un inicio no controlado.
