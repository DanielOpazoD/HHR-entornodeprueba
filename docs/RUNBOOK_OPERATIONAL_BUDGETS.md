# Runbook de Budgets Operativos

## Objetivo

Centralizar los thresholds monitorables y los reportes base para soporte e ingeniería.

Fuentes obligatorias:

- `reports/operational-health.md`
- `reports/legacy-bridge-governance.md`
- `docs/RUNBOOK_SYNC_RESILIENCE.md`
- `docs/RUNBOOK_SUPPORT_OPERATIONS.md`

## System Health

Estos budgets se derivan desde `src/services/admin/systemHealthOperationalBudgets.ts`.

| Threshold                           |  Valor |
| ----------------------------------- | -----: |
| `warningOldestPendingAgeMs`         | 300000 |
| `criticalOldestPendingAgeMs`        | 900000 |
| `warningRetryingSyncTasks`          |      1 |
| `criticalRetryingSyncTasks`         |      3 |
| `warningPendingMutations`           |      1 |
| `criticalPendingMutations`          |      8 |
| `warningLocalErrorCount`            |      1 |
| `criticalLocalErrorCount`           |     15 |
| `warningRepositoryWarningCount`     |      1 |
| `criticalRepositoryWarningCount`    |      5 |
| `warningSlowRepositoryOperationMs`  |    350 |
| `criticalSlowRepositoryOperationMs` |    800 |

Budget complementario:

- `PROLONGED_OFFLINE_USER_AGE_MS = 900000`

## Sync Queue

Budgets monitoreables desde `reports/operational-health.md`:

- tamaño de batch
- retries máximos
- delays base y máximos
- warning/critical para edad de cola pendiente
- warning/critical para tareas reintentando
- perfiles de recovery por contexto
- `readState = unavailable` cuando la cola no puede leerse desde runtime local

Regla operativa:

- si `getSyncQueueTelemetry()` devuelve `readState = unavailable`, tratar el estado de sync como
  `blocked` aunque los contadores aparezcan en `0`; primero revisar `IndexedDB` y telemetría de sync.

Si estos valores cambian:

1. regenerar `reports/operational-health.md`
2. revisar `docs/RUNBOOK_SYNC_RESILIENCE.md`
3. correr `npm run check:operational-runbooks`

## Conflictos por Contexto

La clasificación vive en `conflictResolutionDomainPolicy.ts`.

Contextos que soporte debe reconocer:

- `clinical`
- `staffing`
- `movements`
- `handoff`
- `metadata`
- `unknown`

Cada contexto tiene acción asociada en `reports/operational-health.md`.

## Legacy Bridge

La política vigente se resume en `reports/legacy-bridge-governance.md`.

Controles mínimos:

1. no volver a habilitar hot path legacy
2. mantener entrypoints explícitas
3. observar fase de retiro antes de cualquier cambio operativo

## Runtime Asset Margin

La evidencia de margen de assets pesados vive en `reports/runtime-asset-margin.md`.

Superficies gobernadas:

- `vendor-heic2any`: conversión HEIC/HEIF de recetas, dueño `prescriptions/runtime`.
- `vendor-pdfjs`: lectura/extracción de texto PDF, dueño `clinical-documents/PDF runtime`.
- `pdfjs-worker`: worker async de PDF.js, dueño `clinical-documents/PDF runtime`.
- `vendor-pdf-lib`: generación/manipulación PDF, dueño `clinical-documents/PDF generation`.
- `app-authenticated-shell`: shell autenticado post-login, dueño `app-shell/census runtime`.

Regla operativa:

- `ok`: observar; no ampliar presupuesto sin cambio de dependencia o evidencia de uso.
- `near-limit` o `target-miss`: mantener merge posible, pero exigir owner, razón de carga y acción
  explícita en el PR.
- `blocking` o `missing`: intervenir antes de merge; volver a separar la frontera lazy o ajustar el
  presupuesto solo con justificación y baseline nuevo.

Si una superficie cruza `near-limit`:

1. correr `npm run build`
2. correr `npm run report:runtime-asset-margin`
3. revisar que la dependencia siga detrás de su loader (`loadHeicConverter`,
   `loadPdfJsTextRuntime`, `loadPdfLibGenerationRuntime`)
4. correr `npm run check:runtime-asset-margin`
5. actualizar este runbook solo si cambia el criterio operativo, no por drift normal de bytes

## Local Persistence

Los budgets de degradación local se derivan desde `src/services/storage/indexeddb/indexedDbRecoveryBudgets.ts` y aparecen en `reports/operational-health.md`:

- open timeout
- delete timeout
- max background recovery attempts
- recovery retry delays

Snapshot operativo canónico:

- `getLocalPersistenceRuntimeSnapshot()`
- `runtimeState = ok | recoverable | blocked`
- `stickyFallbackMode = true` debe tratarse como persistencia local bloqueada para la sesión

## Auth Bootstrap

Los budgets de bootstrap de autenticación viven en `src/services/auth/authBootstrapBudgets.ts`.

Estados monitoreables:

- `recent_manual_logout`
- `offline`
- `default`
- `redirect_pending`

Cada timeout de bootstrap debe quedar clasificado con perfil y `pendingAgeMs` en telemetría auth.

Snapshot operativo canónico:

- `buildAuthRuntimeSnapshot()`
- `runtimeState = ok | degraded | recoverable | retryable | blocked | unauthorized`
- `budgetProfile` y `pendingAgeMs` deben viajar juntos para interpretar el bootstrap

## Taxonomía Operativa Unificada

El contrato canónico vive en `src/services/observability/operationalRuntimeState.ts`.

Estados obligatorios para incidentes operativos:

- `retryable`: el flujo falló, pero el sistema puede reintentar sin intervención mayor.
- `recoverable`: el flujo falló, pero existe camino alternativo o recuperación guiada para el usuario.
- `degraded`: el flujo sigue operativo, pero con capacidad reducida o señal de riesgo.
- `blocked`: el flujo quedó detenido y requiere intervención técnica o corrección de datos/configuración.
- `unauthorized`: el bloqueo viene de permisos, roles o contexto de autenticación no válido.

Regla práctica:

1. no usar `failed` como lenguaje de negocio o soporte; ese estado queda como compatibilidad de telemetría
2. clasificar auth, sync, storage y repositorios con uno de los estados anteriores
3. si un incidente llega a `blocked` o `unauthorized`, debe tener runbook o owner claro

## Comandos

```bash
npm run report:legacy-bridge
npm run report:operational-health
npm run report:runtime-asset-margin
npm run check:docs-drift
npm run check:operational-runbooks
```
