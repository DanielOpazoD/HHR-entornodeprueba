# Strict Local-Firebase Sync Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform local-Firebase synchronization into an explicitly guaranteed system: verifiable local persistence, transactional outbox, multitab leasing, remote revision writes, mutation-aware conflict handling, and race-condition tests.

**Architecture:** Improve the existing IndexedDB, sync queue, Firestore callable, and repository contracts instead of adding a parallel sync stack. Each block must preserve existing public APIs where possible, add stricter APIs for critical paths, and prove behavior with focused unit/integration tests before broad gates.

**Tech Stack:** TypeScript, React, Dexie/IndexedDB, Firebase Firestore/callable functions, Vitest, fake-indexeddb, Playwright/emulator tests where appropriate.

## Execution Summary

Status: completed on branch `codex/strict-local-persistence-sync-foundations`.

The implementation preserved the existing local-Firebase sync stack and added strict write guarantees, transactional daily-record outbox enqueue, durable queue leases, remote revision metadata, mutation-aware conflict checks, cross-tab store-change broadcasts, and regression coverage for race-prone sync paths. Final closure added guardrails for legacy queue usage, strict JSON import persistence, malformed BroadcastChannel payloads, and a browser-like cross-tab event test.

---

## Branch Scope

This branch is allowed to contain multiple commits. Each commit should close one guarantee or one testable support contract. It should not add new product features, screens, or workflow concepts beyond making existing sync states explicit.

The branch should avoid a single large rewrite. The desired final state is a strengthened version of the current architecture:

- local record writes report a typed result and cannot silently fail on critical write paths;
- record persistence and sync queue enqueue can be committed atomically for offline retry;
- sync workers claim tasks with a durable lease before transport execution;
- remote writes carry mutation identity, changed paths, client/tab IDs, and revision expectations;
- conflict handling preserves non-conflicting mutation intent and surfaces true conflicts;
- tests cover local failure, fallback mode, transaction aborts, duplicate multitab processing, lease expiry, revision mismatch, and patch conflict semantics.

## Execution Blocks

### Task 1: Baseline And Current Contract

**Files:**

- Create: `docs/superpowers/plans/2026-05-24-strict-local-firebase-sync-foundations.md`

- [x] Run focused baseline checks:

```bash
npm run typecheck
vitest run src/tests/services/repositories/dailyRecordRemotePersistenceController.test.ts src/tests/services/storage/syncQueueService.test.ts src/tests/services/storage/indexedDBService.test.ts
```

- [x] Commit the plan and any baseline notes.

```bash
git add docs/superpowers/plans/2026-05-24-strict-local-firebase-sync-foundations.md
git commit -m "docs: plan strict local firebase sync foundations"
```

### Task 2: Verifiable Local Persistence

**Files:**

- Modify: `src/services/storage/indexeddb/indexedDbRecordService.ts`
- Modify: `src/services/storage/indexedDBService.ts`
- Modify: `src/services/repositories/dailyRecordRemotePersistenceController.ts`
- Modify: `src/services/repositories/dailyRecordWriteState.ts`
- Test: `src/tests/services/storage/indexedDBService.test.ts`
- Test: `src/tests/services/repositories/dailyRecordRemotePersistenceController.test.ts`

- [x] Add typed local write result APIs: `saveRecordStrict`, `saveRecordsStrict`, and `deleteRecordStrict`.
- [x] Keep legacy `saveRecord`, `saveRecords`, and `deleteRecord` wrappers behavior-compatible.
- [x] Make critical repository persistence call the strict API and return/block when local persistence fails.
- [x] Add tests proving local write failure prevents remote write and fallback mode is reported as fallback, not silently treated as IndexedDB.
- [x] Commit after focused tests pass.

### Task 3: Transactional Outbox

**Files:**

- Modify: `src/services/storage/syncQueueTypes.ts`
- Modify: `src/services/storage/sync/syncQueuePorts.ts`
- Modify: `src/services/storage/sync/dexieSyncQueueStore.ts`
- Modify: `src/services/storage/sync/syncQueueEngine.ts`
- Modify: `src/services/repositories/dailyRecordRemoteWriteController.ts`
- Test: `src/tests/services/storage/syncQueueService.test.ts`
- Test: `src/tests/services/repositories/dailyRecordRepositoryWriteService.test.ts`

- [x] Add a store method that persists daily record and sync task in one Dexie transaction.
- [x] Use it for retryable critical daily-record writes where the remote write is not the source of truth.
- [x] Preserve queue backpressure and existing task reuse semantics.
- [x] Add tests for transaction abort when either record write or queue enqueue fails.
- [x] Commit after focused tests pass.

### Task 4: Multitab Claim And Lease

**Files:**

- Modify: `src/services/storage/syncQueueTypes.ts`
- Modify: `src/services/storage/sync/syncQueuePorts.ts`
- Modify: `src/services/storage/sync/dexieSyncQueueStore.ts`
- Modify: `src/services/storage/sync/syncQueueEngine.ts`
- Test: `src/tests/services/storage/syncQueueService.test.ts`

- [x] Add lease fields: `leaseOwner`, `leaseUntil`, `attemptId`, and `processingStartedAt`.
- [x] Replace read-then-mark processing with a transactional `claimReadyPending` method.
- [x] Make expired `PROCESSING` leases reclaimable.
- [x] Add tests proving concurrent claims are disjoint and expired leases are reclaimed.
- [x] Commit after focused tests pass.

### Task 5: Revision-Aware Remote Writes

**Files:**

- Modify: `src/services/storage/syncQueueTypes.ts`
- Modify: `src/services/storage/firestore/firestoreRecordWrites.ts`
- Modify: `src/services/storage/firestore/dailyRecordAuthorityCallableClient.ts`
- Modify: `functions/lib/dailyRecordWriteAuthorityFunctions.js`
- Test: `src/tests/functions/dailyRecordWriteAuthorityFunctions.test.ts`
- Test: `src/tests/services/storage/firestoreRecordWritesAuthorityPatch.test.ts`
- Test: `src/tests/emulator/sync-concurrency.emulator.test.ts`

- [x] Promote `baseRevision` into the sync task contract while preserving `expectedVersion`.
- [x] Ensure callable writes reject stale base revision deterministically.
- [x] Return conflict details that can be classified as revision mismatch.
- [x] Add tests for two clients writing from the same revision: first succeeds, second conflicts.
- [x] Commit after focused function and Firestore tests pass.

### Task 6: Mutation-Aware Conflict Handling

**Files:**

- Modify: `src/services/storage/sync/syncTaskContractPolicy.ts`
- Modify: `src/services/storage/sync/firestoreSyncTransport.ts`
- Modify: `src/services/repositories/conflictResolutionMatrix.ts`
- Modify: `src/services/repositories/conflictResolutionUtils.ts`
- Test: `src/tests/services/repositories/conflictResolutionMatrix.test.ts`
- Test: `src/tests/services/storage/syncQueueService.test.ts`

- [x] Treat queued daily-record writes as mutations with `changedPaths`, not only as snapshots.
- [x] Allow safe merge for non-overlapping changed paths.
- [x] Classify same-path divergence as deterministic conflict.
- [x] Add tests for non-conflicting patches surviving and same-path edits becoming conflicts.
- [x] Commit after focused tests pass.

### Task 7: Cross-Tab And Operational Evidence

**Files:**

- Create: `src/services/storage/sync/syncBroadcastChannel.ts`
- Modify: `src/services/storage/indexeddb/indexedDbRecordEvents.ts`
- Modify: `src/services/storage/sync/publicSyncQueue.ts`
- Test: `src/tests/services/storage/syncBroadcastChannel.test.ts`
- Test: `src/tests/integration/multiTabRegression.test.ts`

- [x] Add record/sync BroadcastChannel events with safe no-op fallback.
- [x] Keep existing same-tab custom event behavior.
- [x] Invalidate/read refresh where existing query controllers already listen to store changes.
- [x] Add tests for no BroadcastChannel support and cross-tab event delivery.
- [x] Commit after focused tests pass.

### Task 8: Final Gates

**Files:**

- Modify docs only if implementation changes require operational notes.

- [x] Run targeted sync suite:

```bash
vitest run src/tests/services/repositories/dailyRecordRemotePersistenceController.test.ts src/tests/services/repositories/dailyRecordRepositoryWriteService.test.ts src/tests/services/storage/indexedDBService.test.ts src/tests/services/storage/syncQueueService.test.ts src/tests/services/storage/firestoreRecordWritesAuthorityPatch.test.ts src/tests/functions/dailyRecordWriteAuthorityFunctions.test.ts
```

- [x] Run broader quality gate:

```bash
npm run typecheck
npm run lint -- --max-warnings 0
npm run check:quality
```

- [x] Run emulator sync gate if local emulator tooling is healthy:

```bash
npm run test:emulator:sync:ci
```

- [x] Produce final branch summary with commits, tests, known residual watchlist, and PR recommendation.

## Post-Review Hardening 2026-05-24

Critical review after the first closure identified five small, high-value hardening items that fit the same plan objective without adding product scope.

- [x] Prevent a non-expired `PROCESSING` outbox task from being reused by a newer mutation with the same key.
- [x] Make worker completion/failure conditional on the claimed `leaseOwner` and `attemptId`, so stale workers cannot delete or mutate refreshed tasks.
- [x] Add a release gate for daily-record authority mode: release writes that claim revision guarantees must run with `VITE_DAILY_RECORD_AUTHORITY_MODE=enforced` or `VITE_DAILY_RECORD_AUTHORITY_CALLABLE=true`.
- [x] Add a repository guardrail that keeps critical daily-record repository flows off void local persistence wrappers.
- [x] Extend the sync resilience runbook with concrete `PENDING`/`PROCESSING`/`FAILED`/`CONFLICT` triage actions.
