# Operational Health Snapshot

- Generated: 2026-11-10T15:35:17.858Z
- Git SHA: 6b9530fa8
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

## Compatibility Governance

- Policy version: 2026-04-v1
- Tracked entries: 4
- Missing entries: none

## Local Persistence Recovery Budgets

- IndexedDB open timeout (ms): 12
- IndexedDB delete timeout (ms): unknown
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

- Status: degraded
- Preview gate: unknown
- Preview tests: 0
- Preview unexpected: 0
- Preview flaky: 0
- Preview skipped: 0
- Preview duration (ms): 0
- Bootstrap signals: `bootstrap_recovery_reload`, `bootstrap_chunk_load_failed`, `bootstrap_runtime_failed`, `bootstrap_window_error`, `bootstrap_unhandled_rejection`
- Startup issues: No hay artefacto reciente del smoke de preview para validar el arranque real.

| Critical startup asset | Size (bytes) | Max (bytes) | Utilization | Budget | Status |
| --- | ---: | ---: | ---: | --- | --- |
| `unavailable` | - | - | - | - | missing |

## Incident Signals To Watch

- Realtime null recuperado: `recovered_null_realtime_record`
- Realtime null confirmado: `confirmed_null_realtime_record`
- Telemetría sync no disponible: `sync_queue_telemetry_unavailable`, `sync_queue_stats_unavailable`, `sync_queue_recent_operations_unavailable`, `sync_queue_domain_metrics_unavailable`
- Fallback IndexedDB: `indexeddb_fallback_mode`
- Timeout bootstrap auth: `bootstrap_timeout`
- Bootstrap frontend: `bootstrap_recovery_reload`, `bootstrap_chunk_load_failed`, `bootstrap_runtime_failed`, `bootstrap_window_error`, `bootstrap_unhandled_rejection`

## Flow Performance Budgets

- Status: unknown
- Blocking flows: unknown
- Target misses: unknown
- Near-limit flows: unknown

| Flow | Actual (ms) | Target (ms) | Enforced (ms) | Status |
| --- | ---: | ---: | ---: | --- |
| `unavailable` | - | - | - | missing |

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
| `unavailable` | - | - | - | - | missing |

## Repository Performance Thresholds

- Monitored operations: 6
- Min threshold (ms): 120
- Max threshold (ms): 250

| File | Threshold (ms) | Context |
| --- | ---: | --- |
| `src/services/repositories/dailyRecordRepositoryReadService.ts` | 220 | - |
| `src/services/repositories/dailyRecordRepositoryReadService.ts` | 120 | - |
| `src/services/repositories/dailyRecordRepositoryInitializationService.ts` | 180 | - |
| `src/services/repositories/dailyRecordRepositorySyncService.ts` | 200 | - |
| `src/services/repositories/monthIntegrity.ts` | 250 | - |
| `src/services/repositories/dailyRecordRemoteLoader.ts` | 220 | - |

## Runbooks

- `docs/RUNBOOK_SYNC_RESILIENCE.md`
- `docs/RUNBOOK_SUPPORT_OPERATIONS.md`
- `docs/RUNBOOK_OPERATIONAL_BUDGETS.md`
- `docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md`
- `docs/RUNBOOK_NETLIFY_SERVERLESS_DEPLOY.md`
- `docs/RUNBOOK_AI_PROVIDER_OPERATIONS.md`
- `docs/SERVERLESS_SENSITIVE_CONTRACTS.md`

