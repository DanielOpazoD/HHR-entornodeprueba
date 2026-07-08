# Sync Convergence Evidence

- Generated: 2026-07-05T21:29:38.314Z
- Git SHA: `97df59fb`
- Worktree: `clean`
- Status: `ready`
- Checks: `18/18` passing

## Sections

| Section | Status | Checks |
| --- | --- | ---: |
| Post-merge convergence | OK | 5/5 |
| Authority replay traceability | OK | 4/4 |
| Conservative recovery readiness | OK | 5/5 |
| Clinical sync simulator | OK | 4/4 |

## Post-merge convergence

- OK `diagnostic-status-contract`: The convergence diagnostic exposes the four operational states used by support.
  - Evidence: `src/services/observability/syncConvergenceDiagnosticTypes.ts`, `src/services/observability/syncConvergenceDiagnostics.ts`
- OK `clinical-divergence-findings`: The diagnostic detects duplicate active patients, missing movements and divergent handoff.
  - Evidence: `src/services/observability/syncConvergenceDiagnosticTypes.ts`, `src/services/observability/syncConvergenceHandoffDiagnostics.ts`
- OK `handoff-module-classification`: Nursing and medical handoff divergences are classified with clinical module semantics.
  - Evidence: `src/services/observability/syncConvergenceDiagnosticTypes.ts`, `src/services/observability/syncConvergenceHandoffDiagnostics.ts`
- OK `diagnostic-tests`: The diagnostic has focused tests for unsafe and recoverable divergence scenarios.
  - Evidence: `src/tests/services/observability/syncConvergenceDiagnostics.test.ts`
- OK `operational-panel`: System Health summarizes convergence state without requiring raw log expansion.
  - Evidence: `src/tests/features/admin/systemHealthSyncConvergencePanel.test.ts`

## Authority replay traceability

- OK `truth-selection-telemetry`: Sync writes emit an explicit truth-selection telemetry event.
  - Evidence: `src/services/storage/sync/syncQueueTelemetryController.ts`
- OK `anonymous-actor-context`: Operational snapshots preserve accepted versions and resolution while anonymizing client/tab identifiers.
  - Evidence: `src/services/storage/sync/syncQueueTaskFactory.ts`
- OK `transport-resolution-paths`: Remote sync transport classifies accepted, merged, blocked and already-applied outcomes.
  - Evidence: `src/services/storage/sync/firestoreSyncTransport.ts`
- OK `telemetry-tests`: Telemetry tests guard traceability and privacy posture.
  - Evidence: `src/tests/services/storage/syncQueueTelemetryController.test.ts`

## Conservative recovery readiness

- OK `planner-action-contract`: The recovery planner exposes explicit support actions without performing writes.
  - Evidence: `src/services/observability/syncRecoveryPlanner.ts`
- OK `planner-no-aggressive-writes`: The recovery planner remains a pure recommender and does not mutate Firestore or outbox state.
  - Evidence: `src/services/observability/syncRecoveryPlanner.ts`
- OK `auto-merge-invariant-gate`: Auto-merge evaluates post-merge invariants before queueing/auditing a recovered record.
  - Evidence: `src/services/repositories/dailyRecordConflictAutoMergeController.ts`
- OK `three-client-replay-coverage`: Replay tests cover stale restart convergence for movements, discharge/CMA and handoff data.
  - Evidence: `src/tests/services/storage/syncQueueMutationConflict.test.ts`
- OK `planner-tests`: Recovery planner tests cover retry, manual block and already-applied acknowledgement decisions.
  - Evidence: `src/tests/services/observability/syncRecoveryPlanner.test.ts`

## Clinical sync simulator

- OK `multi-client-simulator-coverage`: The simulator models logical clients, stale outbox, restart/replay, invariant-blocked writes, incompatible field edits and idempotent retry.
  - Evidence: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts`, `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.test.ts`
- OK `auditable-clinical-context`: Simulator events preserve clinical context for observability: record date, mutation, client/tab, changed paths, bed, patient and RUT when available.
  - Evidence: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.ts`, `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts`
- OK `census-replay-scenarios`: Census scenarios cover admission, bed moves, discharge/transfer/CMA and DMI replay after stale clients.
  - Evidence: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.census.test.ts`
- OK `handoff-replay-scenarios`: Nursing and medical handoff scenarios cover stale replay, parallel specialties and entry-level merge semantics.
  - Evidence: `src/tests/support/clinicalSyncSimulator/clinicalSyncSimulator.handoff.test.ts`

## Validation Commands

- `npx vitest run src/tests/support/clinicalSyncSimulator`
- `npx vitest run src/tests/services/observability/syncConvergenceDiagnostics.test.ts src/tests/services/observability/syncRecoveryPlanner.test.ts`
- `npx vitest run src/tests/services/storage/syncQueueTelemetryController.test.ts src/tests/services/storage/syncQueueMutationConflict.test.ts`
- `npx vitest run src/tests/features/admin/systemHealthSyncConvergencePanel.test.ts src/tests/hooks/controllers/systemHealthReporterController.test.ts`
- `npm run check:sync-convergence-evidence`

