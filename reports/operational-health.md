# Operational Health Snapshot

- Generated: 2026-10-21T01:51:11.193Z
- Git SHA: be28603dd
- Schema current: v1
- Schema legacy: v0

## Sync Queue

La lectura de envíos recientes distingue fallo y lista vacía. Ante
`sync_queue_recent_operations_unavailable`, Eloísa indica «por comprobar» y el
reporte conserva los contadores disponibles y el evento de error. Este contrato
no modifica los umbrales del snapshot generado a continuación.

- Batch size: 25
- Max retries: 5
- Base retry delay (ms): 1
- Max retry delay (ms): 30
- Warning queue age (ms): 300
- Critical queue age (ms): 900
- Warning retrying tasks: 1
- Critical retrying tasks: 3

## System Health Budgets

- Warning queue age (ms): 300
- Critical queue age (ms): 900
- Warning retrying tasks: 1
- Critical retrying tasks: 3
- Warning slow repository op (ms): 350
- Critical slow repository op (ms): 800
- Prolonged offline user age (ms): 900000

## Sync Domain Recovery Profiles

| Profile | Retry budget | Delay multiplier | Conflict action |
| --- | ---: | ---: | --- |
| `metadata_remote_priority` | 3 | 1.8 | Revisar metadata remota antes de reintentar o reabrir el registro. |
| `movements_priority` | 4 | 1.2 | Revisar movimientos y altas/traslados antes de reconciliar el conflicto. |
| `staffing_handoff_priority` | 4 | 1.35 | Revisar staffing/handoff local antes de confirmar la resolución del conflicto. |
| `default_domain_retry` | 4 | 1.5 | Revisar contexto del conflicto antes de reintentar manualmente. |

## Conflict Context Runbook Actions

| Context | Action |
| --- | --- |
| `clinical` | Validar que el merge preserve camas y pacientes antes de reintentar. |
| `staffing` | Confirmar staffing y turnos antes de aplicar la resolución sugerida. |
| `movements` | Corroborar altas, traslados y CMA contra el registro remoto. |
| `handoff` | Revisar notas de entrega y responsables del turno antes de confirmar. |
| `metadata` | Alinear timestamps, schemaVersion y campos de control antes de reabrir. |
| `unknown` | Inspeccionar paths afectados y escalar si el contexto no se puede clasificar. |

## Legacy Bridge Governance

- Policy version: 2026-03-v2
- Allowed modes: explicit_bridge, disabled
- Hot path policy: disabled

## Compatibility Governance

- Policy version: 2026-04-v1
- Tracked entries: 4
- Missing entries: none
- Restricted import surfaces: 0
- Unauthorized importers: 0

## Local Persistence Recovery Budgets

- IndexedDB open timeout (ms): 12
- IndexedDB delete timeout (ms): 5
- Max background recovery attempts: 6
- Recovery retry delays (ms): 500

## Auth Access Snapshot

- Login general roles: admin, nurse_hospital, doctor_urgency, doctor_specialist, viewer, editor
- Roles asignables: admin, nurse_hospital, doctor_urgency, doctor_specialist, viewer, unauthorized
- Puentes de rol legacy: none
- Modelo canónico: `docs/AUTH_ACCESS_MODEL.md`
- Runbook auth: `docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md`

## Auth Bootstrap Budgets

- Pending TTL (ms): 90
- Timeouts (ms): recent logout 1 · offline 5 · default 15 · redirect pending 45

## Operational Runtime Taxonomy

- Contrato: `src/services/observability/operationalRuntimeState.ts`
- Estados canónicos: `retryable`, `recoverable`, `degraded`, `blocked`, `unauthorized`

## Frontend Startup Health

- Status: ok
- Preview gate: ok
- Preview tests: 60
- Preview unexpected: 0
- Preview flaky: 0
- Preview skipped: 0
- Preview duration (ms): 718224.507
- Bootstrap signals: `bootstrap_recovery_reload`, `bootstrap_chunk_load_failed`, `bootstrap_runtime_failed`, `bootstrap_window_error`, `bootstrap_unhandled_rejection`
- Startup issues: none

| Critical startup asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
| `dist/assets/index-2SU_gsUT.js` | 24392 | 700000 | - | - | ok |
| `dist/assets/app-authenticated-shell-BixI3TdI.js` | 629387 | 631000 | 99.7% | app-authenticated-shell | near-limit |

## Incident Signals To Watch

- Realtime null recuperado: `recovered_null_realtime_record`
- Realtime null confirmado: `confirmed_null_realtime_record`
- Telemetría sync no disponible: `sync_queue_telemetry_unavailable`, `sync_queue_stats_unavailable`, `sync_queue_recent_operations_unavailable`, `sync_queue_domain_metrics_unavailable`
- Fallback IndexedDB: `indexeddb_fallback_mode`
- Timeout bootstrap auth: `bootstrap_timeout`
- Bootstrap frontend: `bootstrap_recovery_reload`, `bootstrap_chunk_load_failed`, `bootstrap_runtime_failed`, `bootstrap_window_error`, `bootstrap_unhandled_rejection`

## Flow Performance Budgets

- Status: passing
- Blocking flows: 0
- Target misses: 0
- Near-limit flows: 0

| Flow | Actual (ms) | Target (ms) | Enforced (ms) | Status |
| --- | ---: | ---: | ---: | --- |
| `loginVisibleMs` | 374.9 | 4000 | 4000 | ok |
| `authFeedbackMs` | 234.7 | 2500 | 2500 | ok |
| `censoVisibleMs` | 879.4 | 1500 | 2000 | ok |
| `censoRecordReadyMs` | 55.3 | 2500 | 5000 | ok |
| `clinicalDocumentsVisibleMs` | 420.2 | 4500 | 6000 | ok |
| `backupFilesVisibleMs` | 630.8 | 4500 | 4500 | ok |
| `logoutToLoginVisibleMs` | 37.7 | 1500 | 2500 | ok |

## Critical Coverage

- Status: passing
- Mode: dual-gated

| Zone | Lines | Functions | Branches | Status |
| --- | ---: | ---: | ---: | --- |
| `src/features/census/controllers` | 91.8 | 95 | 79 | PASS |
| `src/features/clinical-documents` | 86.1 | 85 | 74.6 | PASS |
| `src/services/transfers` | 89.4 | 89.3 | 75.7 | PASS |
| `src/services/storage/firestore` | 89.8 | 92.5 | 86.6 | PASS |
| `src/services/auth` | 82 | 81.6 | 68.9 | PASS |
| `src/services/auth/bootstrap` | 92.2 | 100 | 77.8 | PASS |
| `src/services/backup` | 82.2 | 83.9 | 67.3 | PASS |
| `src/features/reminders/admin` | 98.3 | 97.6 | 91.2 | PASS |
| `src/app-shell` | 78.2 | 81.3 | 66 | PASS |
| `src/services/patient-history` | 87.6 | 85.7 | 75.9 | PASS |
| `src/services/export-manager` | 99.4 | 97.8 | 98 | PASS |
| `src/shared/census/upc-critical` | 71.4 | 53.2 | 67.7 | PASS |
| `src/services/storage/sync-critical` | 99 | 96.3 | 100 | PASS |
| `src/services/storage/indexeddb-recovery` | 100 | 100 | 86.7 | PASS |
| `src/features/rayen-import/discharge-replan-critical` | 91.4 | 92.9 | 86.9 | PASS |
| `src/features/handoff` | 83.7 | 78.3 | 75.5 | PASS |

## Largest Build Assets

- Chunk budget max (bytes): 1250000

| Asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
| `dist/assets/vendor-heic2any-BjDsP1gW.js` | 1352091 | 1450000 | 93.2% | vendor-heic2any | near-limit |
| `dist/assets/vendor-dicom-vtk-CVp3UI09.js` | 1078816 | 1250000 | 86.3% | chunkMaxBytes | near-limit |
| `dist/assets/app-authenticated-shell-BixI3TdI.js` | 629387 | 631000 | 99.7% | app-authenticated-shell | near-limit |
| `dist/assets/vendor-pdfjs-BGyLORnz.js` | 460525 | 520000 | 88.6% | vendor-pdfjs | near-limit |
| `dist/assets/vendor-firebase-firestore-Bjg3nDcb.js` | 397577 | 500000 | 79.5% | vendor-firebase-firestore | ok |
| `dist/assets/vendor-pdf-lib-DewrExaK.js` | 390824 | 430000 | 90.9% | vendor-pdf | near-limit |
| `dist/assets/vendor-pdf-core-CZkusByf.js` | 364662 | 430000 | 84.8% | vendor-pdf | ok |
| `dist/assets/cudyrSupplement.worker-33MR3KSE.js` | 364090 | 1250000 | 29.1% | chunkMaxBytes | ok |

## Repository Performance Thresholds

- Monitored operations: 8
- Min threshold (ms): 120
- Max threshold (ms): 400

| File | Threshold (ms) | Context |
| --- | ---: | --- |
| `src/services/repositories/dailyRecordRepositoryReadService.ts` | 220 | - |
| `src/services/repositories/dailyRecordRepositoryReadService.ts` | 120 | - |
| `src/services/repositories/dailyRecordRepositoryInitializationService.ts` | 180 | - |
| `src/services/repositories/dailyRecordRepositorySyncService.ts` | 200 | - |
| `src/services/repositories/monthIntegrity.ts` | 250 | - |
| `src/services/repositories/legacyRecordBridgeService.ts` | 220 | - |
| `src/services/repositories/legacyRecordBridgeService.ts` | 400 | - |
| `src/services/repositories/dailyRecordRemoteLoader.ts` | 220 | - |

## Runbooks

- `docs/RUNBOOK_SYNC_RESILIENCE.md`
- `docs/RUNBOOK_SUPPORT_OPERATIONS.md`
- `docs/RUNBOOK_OPERATIONAL_BUDGETS.md`
- `docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md`
- `docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md`
- `docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md`
- `docs/SERVERLESS_SENSITIVE_CONTRACTS.md`

