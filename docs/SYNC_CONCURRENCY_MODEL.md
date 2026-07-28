# Daily-record sync concurrency model

How the app prevents one session from silently overwriting or erasing another session's
changes to a day's census record. Written after the 2026-06-25 incident in which a stale
full-save erased an admitted patient (bed H5C2). Keep this in sync with the code; the
function names below are the source of truth.

## The document

A day's census lives in a single Firestore document:
`hospitals/{hospitalId}/dailyRecords/{date}`. Its `lastUpdated` field is the optimistic
concurrency token (a server `Timestamp`); `beds` is a map of bed-id → patient (each bed may
also carry a nested `clinicalCrib` patient). History snapshots are written to the
`history/{iso}` subcollection before every overwrite.

## Write paths

There are five governed ways that document is written. Three are client-side.

| Path                          | Entry                                                             | Mechanism                                            | Atomic?                        |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| **Full save**                 | `saveDetailed` → `saveRecordToFirestore` → `saveRecordAtomically` | `runTransaction`, full-replace `set`                 | ✅ yes                         |
| **Partial update**            | `updatePartialDetailed` → `updateRecordPartial`                   | `updateDoc` with dot-path fields                     | ❌ no (field-scoped merge)     |
| **Sync queue**                | `syncDailyRecord` (outbox)                                        | `setDoc(..., { merge: true })`                       | ❌ no (read→write, but merges) |
| **Callable** (off by default) | `saveDailyRecordWithClinicalAuthority` Cloud Function             | server `runTransaction`, full-replace                | ✅ yes                         |
| **Rayen clinical batch**      | `applyRayenClinicalEnrichmentBatch` Cloud Function                | server `runTransaction`, allowlisted clinical fields | ✅ yes                         |

## Guards, by path

### Full save — `saveRecordAtomically` (`firestoreWriteSupport.ts`)

The transaction body runs these checks, in order, against the freshly-read remote snapshot:

1. **Missing-base guard** — `snap.exists() && !expectedLastUpdated` → `ConcurrencyError`.
   We refuse to full-replace an existing doc with no base version, because the CAS below
   cannot run and we cannot prove we are not clobbering a newer remote.
2. **CAS (optimistic lock)** — remote `lastUpdated` newer than `expectedLastUpdated` →
   `ConcurrencyError`. Strict: any positive drift is a conflict (no tolerance window).
3. **Erasure backstop** — `assertSafeOverwrite(remoteData)` runs `assertNoPatientErasures`
   against the in-transaction remote. Catches a _content_ erasure (the local record dropped
   a bed/crib the remote still has, with no movement accounting for it) even when the version
   is current — i.e. local data loss, not just stale-version. Throws `DataRegressionError`.
4. **History snapshot**, then the record `set`.

A **pre-write** check also runs in `saveDetailed` (`assertRemoteSaveCompatibility`): schema
version, mass density regression, and the same erasure check. It produces the good
user-facing UX (block + auto-merge recovery). The in-transaction guard #3 is the _atomic_
backstop that closes the TOCTOU window between that pre-check and the commit.

`ConcurrencyError` and `DataRegressionError` are excluded from `withRetry` — a blocked write
must not be retried.

### Partial update — `updateRecordPartial`

Field-scoped `updateDoc` (dot-path), so it structurally cannot erase a whole bed. Guards:
`assertFirestoreConcurrency` (**fail-closed**: a verification error aborts rather than
proceeding) plus a field-shrinkage guard in the orchestrator. On abort the change is already
in IndexedDB and is re-checked by the sync queue.

### Sync queue — `firestoreSyncTransport.ts`

`assertSyncQueueConcurrency` (drift > 0 → `ConcurrencyError`), a `changedPaths`-aware conflict
merge when the remote moved, and `mutationId` idempotency. Writes with `{ merge: true }`, so
beds absent from the payload are never dropped.

### Callable — `dailyRecordWriteAuthorityFunctions.js`

Server `runTransaction` with `assertExpectedVersion` (CAS), revision check, `mutationId`
idempotency, a history snapshot, and the same patient-erasure guard
(`functions/lib/dailyRecordErasureGuard.js`, a server mirror of `findPatientErasures`, throwing
`failed-precondition`). **Disabled by default** (`resolveDailyRecordAuthorityMode` → `client_only`).

### Rayen clinical batch — `rayenClinicalEnrichmentFunctions.js`

One transaction reads the current census once and verifies exact `lastUpdated`, optional
`meta.revision`, bed/cuna location and `clinicalEpisodeId` for every target. Only devices, scales,
vital signs, their histories and `clinicalSyncCheckpoint` are accepted. The transaction writes one
deterministic history snapshot per `runId`, the enriched record and a bounded idempotency receipt.
`shadow` is always dry-run; `enforced` retries availability failures with the same `mutationId` and
falls back to the established per-patient path only for infrastructure failures, never for authority
or concurrency rejections.

## Known limitations

- **Internal bed move ⇒ false-positive block.** Relocating a patient to another bed without a
  discharge/transfer/CMA record looks like an erasure to `findPatientErasures` and is blocked
  (fail-safe direction — blocks rather than erases).
- **The erasure guard is duplicated.** `findPatientErasures` lives in both the client
  (`src/services/repositories/dailyRecordErasureGuard.ts`) and the server
  (`functions/lib/dailyRecordErasureGuard.js`). A parity test
  (`src/tests/functions/dailyRecordErasureGuardParity.test.ts`) runs a shared battery through both
  and fails on any drift.
- **`findPatientErasures` is a heuristic.** It matches a movement by same patient name **and**
  same bed (`bedId`, or `originalBedId` for CMA); the density-regression thresholds (40% / 50
  points) are coarse and tuned for a full census.
- **Partial update is not atomic.** It relies on field-scoped merge + fail-closed pre-check +
  the sync queue's re-check, not a transaction.

## Tests

- Unit: `firestoreWriteSupport.test.ts` (CAS, missing-base, erasure backstop, strict tolerance),
  `dailyRecordRemoteWriteController.test.ts` (`findPatientErasures` cases), `networkUtils.test.ts`.
- Server guard: `src/tests/functions/dailyRecordErasureGuard.test.ts` (pure helper) and
  `dailyRecordWriteAuthorityErasure.test.ts` (handler blocks the write); client/server parity is
  enforced by `dailyRecordErasureGuardParity.test.ts`.
- Rayen batch: `rayenClinicalEnrichmentFunctions.test.ts` covers one-read atomic persistence,
  allowlist, episode/cuna identity, revisions, idempotency and shadow; the client rollout/fallback is
  covered by `applyClinicalEnrichmentBatch.test.ts`.
- Real engine: `src/tests/emulator/atomic-write-guards.emulator.test.ts` runs against the Firestore
  emulator — two concurrent saves on the same base (one wins, one `ConcurrencyError`) and the
  in-transaction erasure backstop. Run via `npm run test:emulator:sync:ci`.
