# Operational Health Snapshot

- Generated: 2026-07-05T06:20:04.606Z
- Git SHA: 126d4b82
- Schema current: v1
- Schema legacy: v0

## Sync Queue

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
- Preview tests: 3
- Preview unexpected: 0
- Preview flaky: 0
- Preview skipped: 0
- Preview duration (ms): 7994.147
- Bootstrap signals: `bootstrap_recovery_reload`, `bootstrap_chunk_load_failed`, `bootstrap_runtime_failed`, `bootstrap_window_error`, `bootstrap_unhandled_rejection`
- Startup issues: none

| Critical startup asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
| `dist/assets/index-zjqg-fR6.js` | 19469 | 700000 | - | - | ok |
| `dist/assets/app-authenticated-shell-BM1LNf9O.js` | 537942 | 600000 | 89.7% | app-authenticated-shell | near-limit |

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
| `loginVisibleMs` | 164.6 | 4000 | 4000 | ok |
| `authFeedbackMs` | 110.6 | 2500 | 2500 | ok |
| `censoVisibleMs` | 1280.3 | 1500 | 2000 | ok |
| `censoRecordReadyMs` | 51.7 | 2500 | 5000 | ok |
| `clinicalDocumentsVisibleMs` | 388.7 | 4500 | 6000 | ok |
| `backupFilesVisibleMs` | 478.1 | 4500 | 4500 | ok |

## Critical Coverage

- Status: passing
- Mode: dual-gated

| Zone | Lines | Functions | Branches | Status |
| --- | ---: | ---: | ---: | --- |
| `src/features/census/controllers` | 96.1 | 99.1 | 87.9 | PASS |
| `src/features/clinical-documents` | 85.8 | 84.8 | 74.5 | PASS |
| `src/services/transfers` | 85.5 | 84 | 74.9 | PASS |
| `src/services/storage/firestore` | 89.7 | 94.5 | 81.8 | PASS |
| `src/services/auth` | 84.9 | 86.3 | 71.1 | PASS |
| `src/services/auth/bootstrap` | 91.9 | 100 | 81.7 | PASS |
| `src/services/backup` | 81.1 | 82 | 64.9 | PASS |
| `src/features/reminders/admin` | 98.3 | 97.6 | 91.2 | PASS |
| `src/app-shell` | 92.6 | 93.3 | 81.3 | PASS |
| `src/services/patient-history` | 96 | 100 | 78.4 | PASS |
| `src/services/export-manager` | 96 | 96.6 | 92.5 | PASS |
| `src/shared/census/upc-critical` | 98.3 | 97.9 | 84.7 | PASS |
| `src/services/storage/sync-critical` | 99 | 96.3 | 100 | PASS |
| `src/services/storage/indexeddb-recovery` | 100 | 100 | 86.7 | PASS |
| `src/features/handoff` | 85.6 | 78.2 | 79.3 | PASS |

## Largest Build Assets

- Chunk budget max (bytes): 1250000

| Asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
| `dist/assets/vendor-heic2any-ClJ2fQYX.js` | 1352091 | 1450000 | 93.2% | vendor-heic2any | near-limit |
| `dist/assets/app-authenticated-shell-BM1LNf9O.js` | 537942 | 600000 | 89.7% | app-authenticated-shell | near-limit |
| `dist/assets/vendor-pdfjs-C4G2Lk1-.js` | 465976 | 520000 | 89.6% | vendor-pdfjs | near-limit |
| `dist/assets/vendor-firebase-firestore-CSGvoZjH.js` | 393147 | 500000 | 78.6% | vendor-firebase-firestore | ok |
| `dist/assets/vendor-pdf-lib-BrVFzLGn.js` | 390824 | 430000 | 90.9% | vendor-pdf | near-limit |
| `dist/assets/vendor-pdf-core-U3n4h3fn.js` | 364662 | 430000 | 84.8% | vendor-pdf | ok |
| `dist/assets/documentFallbacks-BpNioYEc.js` | 344643 | 1250000 | 27.6% | chunkMaxBytes | ok |
| `dist/assets/LineChart-tAm3U9fu.js` | 331288 | 1250000 | 26.5% | chunkMaxBytes | ok |

## Repository Performance Thresholds

- Monitored operations: 7
- Min threshold (ms): 120
- Max threshold (ms): 400

| File | Threshold (ms) | Context |
| --- | ---: | --- |
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

