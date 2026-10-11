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
5. Revisar `reports/operational-health.md` y `reports/legacy-bridge-governance.md` antes de cambios manuales.
6. Si el cambio o incidente afecta `Censo Diario`, usar también:
   - [docs/CENSUS_OPERATIONAL_VALIDATION_CHECKLIST.md](./CENSUS_OPERATIONAL_VALIDATION_CHECKLIST.md)

## Controles Nuevos (Auth + Legacy)

- Login redirect protegido:
  - Se usa marca temporal `hhr_auth_bootstrap_pending_v1` para evitar rebote prematuro a Login durante retorno de Google redirect.
  - Timeout extendido de bootstrap auth a 45s cuando la marca está activa.
  - Heartbeat de lock multi-pestaña durante popup (`hhr_google_login_lock_v1`) para evitar colisiones en inicios largos.
  - Política unificada de errores de auth popup/COOP (`authErrorPolicy`) para decidir cuándo mostrar acceso alternativo por redirect.
- Legacy fallback con menor ruido:
  - Bloqueo persistente por sesión cuando hay `permission-denied` en legacy.
  - Cache temporal de fechas no encontradas (evita reintentos repetidos sobre rutas legacy inválidas).
  - Cache temporal por grupo de ruta denegada (evita reprobar la misma familia de rutas en la sesión).
  - Logs de repositorio legacy sólo en modo debug explícito (`VITE_DEBUG_LEGACY_FIREBASE=true`).
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

1. Confirmar conectividad real (`ONLINE` + red estable).
2. Esperar un ciclo de backoff.
3. Forzar recarga de sesión.
4. Si persiste:
   - exportar evidencia de consola.
   - revisar tipo de error dominante.

Criterio de cierre:

- `oldestPendingAgeMs` decrece sostenidamente.
- `retryingSyncTasks` retorna a 0.

## Variables de Diagnóstico (solo soporte técnico)

- `VITE_DEBUG_REPOSITORY=true`:
  - Habilita logs de trazas de repositorio (Firestore + fallback legacy).
  - Mantener desactivado en operación normal para evitar ruido.
- `VITE_DEBUG_LEGACY_FIREBASE=true`:
  - Habilita logs detallados de rutas legacy.
  - Usar sólo para diagnóstico acotado y luego desactivar.
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
npm run report:legacy-bridge
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

## Legacy bridge

- Tratar `legacy bridge` como compatibilidad administrada, no como fallback general.
- Antes de usarlo, confirmar fase actual en `reports/legacy-bridge-governance.md`.
- Si aparece uso nuevo o inesperado del bridge, abrir incidente técnico y registrar entrypoint afectada.

Parámetros opcionales para carga de cola:

```bash
SYNC_QUEUE_LOAD_VOLUME=120 SYNC_QUEUE_RETRY_VOLUME=40 SYNC_QUEUE_LOAD_MAX_MS=8000 npm run test:sync-load
```

## SLA Operacional Recomendado

- `SEV-1`: respuesta < 15 min, mitigación inicial < 60 min.
- `SEV-2`: respuesta < 60 min, mitigación < 4 h.
- `SEV-3`: respuesta mismo día hábil.
