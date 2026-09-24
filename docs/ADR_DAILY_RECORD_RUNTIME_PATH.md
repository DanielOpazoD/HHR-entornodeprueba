# ADR: Daily Record Runtime Path

**Estado:** Vigente

## Decision

`DailyRecord` must resolve through one canonical path:

`query or subscription -> repository facade -> persistence golden path -> local/remote reconciliation -> cache/UI`.

`null` is not a generic domain signal. Runtime must distinguish:

- `missing_confirmed`
- `missing_transient`
- `recoverable`
- `unavailable`

Realtime subscription, initial query, local recovery and sync telemetry must speak that same contract.

## Why

The most fragile boundary in the app is the intersection of TanStack Query cache, realtime Firestore, IndexedDB fallback and sync recovery. When each layer inferred “record missing” on its own, transient nulls could look like a genuinely missing day.

## Source Of Truth

- Public read/write/sync surfaces:
  - `src/services/repositories/dailyRecordRepositoryReadService.ts`
  - `src/services/repositories/dailyRecordRepositoryWriteService.ts`
  - `src/services/repositories/dailyRecordRepositorySyncService.ts`
- Read path and typed outcomes: `src/services/repositories/contracts/dailyRecordQueries.ts`
- Canonical local/remote precedence: `src/services/repositories/dailyRecordPersistenceGoldenPath.ts`
- Subscription and reconciliation: `src/services/repositories/dailyRecordRepositorySyncService.ts`
- Query/controller consumers:
  - `src/hooks/controllers/dailyRecordQueryController.ts`
  - `src/hooks/useDailyRecordQuery.ts`
  - `src/hooks/useDailyRecordSyncQuery.ts`

## Invariants

- UI must not decide by itself whether a day is really missing.
- Realtime `null` must not evict a valid local record unless repository reconciliation confirms absence.
- Recovery policy belongs in repository/query contracts, not duplicated across hooks and views.
- Remote cache hydration checks the outbox and writes IndexedDB in one transaction. It preserves the local projection while any unresolved daily write exists; only command acknowledgement/reconciliation may replace that projection. This prevents a realtime echo arriving before the command response from invalidating its own acknowledgement.
- A server-confirmed command acknowledgement is published with remote-authoritative cache semantics. An older realtime/refetch result cannot replace that acknowledgement, while a newer local outbox projection or a newer remote snapshot keeps precedence.
- The “today empty state” is a last visible fallback, not the first interpretation of a transient remote miss.
- When the specialty episode pilot is enabled, a human specialty change or acceptance of a Jev suggestion uses the existing `patchDailyRecordWithClinicalAuthority` path with `specialtyIntent`, exact episode and decision version. The repository confirms that remote transaction before local persistence and never queues a rejected acceptance. The scalar, provenance and decision audit event commit together. See [specialty episode pilot](./SPECIALTY_EPISODE_JEV.md).

## Returning to the census

- An unavailable read retains the latest confirmed data while exposing the failure. A delayed response older than that known server revision does not clear the authority failure; recovery requires a successful result at that revision or a newer one. Receiving an old response is not evidence that the current census has been revalidated.

- The daily-record query refetches on focus only when stale, using the existing five-minute cache policy; brief tab returns do not force another read.
- Reconnect retains the global forced check, including short network interruptions while the page remains visible.
- The inactivity freshness gate, its in-flight deduplication, realtime subscription and remote confirmation before clinical mutations remain unchanged. Do not replace them with another cache or coordinator.
- `useDailyRecordQuery.test.tsx` exercises the real QueryClient defaults and counts repository calls on entry, brief/stale tab returns and reconnect. These counts are not Firestore billing metrics.

## How To Change Safely

1. If the change affects read/sync semantics, update `dailyRecordQueries.ts` before changing UI consumers.
2. If the change affects precedence, update `dailyRecordPersistenceGoldenPath.ts` and `dailyRecordRepositorySyncService.ts` together.
3. If the visible empty-state behavior changes, update the controller/hook path before touching `CensusView.tsx`.
4. Any new runtime incident must emit operational telemetry and update the runbook/reporting path.

## Required Validation

- `npm run typecheck`
- `npm run check:quality`
- `npm run test:release-confidence`
- At least the suites covering:
  - `src/tests/services/repositories/dailyRecordRepositorySyncService.test.ts`
  - `src/tests/hooks/controllers/dailyRecordQueryController.test.ts`
  - `src/tests/hooks/useDailyRecordSyncQuery.test.tsx`
  - relevant census empty-state tests
