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

`serverConfirmed` records whether the accepted read observed the server without pending SDK
writes. Storage derives it from explicit snapshot metadata. Requesting a server read, receiving
a record or selecting a remote source does not establish that evidence. Missing metadata and
local-only producers default to false. A server-only read without that evidence fails.

Cached data remains available, but cannot confirm a missing census or complete remote
revalidation after inactivity. A metadata-only transition to a server snapshot can complete that
check without changing the census. Retaining older query data does not renew its prior
confirmation. A retained outbox projection remains local even when the server was consulted;
that observation neither acknowledges its edits nor makes its content a confirmed remote record.

`baseSource` preserves the origin of a query result before applying pending local fields.
When absent, it is the same as `sourceOfTruth`. Query precedence keeps that origin when
retaining data across a failed read, while the displayed projection remains local. This
provenance does not establish freshness or acknowledge any pending field.

An unconfirmed read cannot replace the patient/episode reference of an optimistic pending
field. Query precedence retains the previous census until confirmation or resolution of that
pending edit, including unconfirmed bed moves. The incoming read failure remains visible.
This can defer unrelated updates from the same snapshot; it does not discard the pending edit
or create another persistent copy. Compatible episode ID hydration remains allowed.

Point reads admit cache hydration against the raw local row captured before their remote
request. Joined requests inherit the issuer's base. The comparison, unresolved-write check
and cache write share the IndexedDB transaction. An unknown base permits only an absent row;
a superseded read preserves the current copy without claiming a new remote confirmation.
Initialization and explicit sync use the same admission. The fallback check is synchronous
within one tab and does not provide a cross-tab transaction.
Failed local admission aborts initialization instead of treating an existing remote day as absent.

Query callers use `createDailyRecordQueryOptions` so admission also runs at QueryClient's
actual publication, after the query promise settles. A superseded point read keeps the
intervening publication and its own evidence. It does not acknowledge edits or renew
freshness. The existing realtime ordering and clock-based field reconciliation remain separate.

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

- Query, prefetch and null-realtime recovery require `getForDateWithMeta`. The repository owns availability and provenance; consumers must not fabricate metadata from a bare record or interpret an unavailable read as confirmed absence. The production repository port already requires this method.

- UI must not decide by itself whether a day is really missing.
- A null-realtime recovery may publish only while its subscription emission and captured query instance and state remain current. Later snapshots or cache edits invalidate its result and error fallback; recovered records retain pending explicit patches. Recovery uses the same result precedence policy as query/refetch: unavailability retains the last known record and exposes the error, older confirmed data cannot roll it back, and confirmed absence still clears it. Retaining cached data is not a remote acknowledgement and must not release pending explicit edits.
- Realtime `null` must not evict a valid local record unless repository reconciliation confirms absence.
- A no-record recovery emits `confirmed_null_realtime_record` only for `confirmed_missing`; unavailable reads emit `unavailable_null_realtime_record` with blocked state. Historical blocked events using the old confirmed name do not count as confirmed absences. This classification does not change read precedence or acknowledge writes.
- Recovery policy belongs in repository/query contracts, not duplicated across hooks and views.
- A mutating authority save or patch of an existing day requires a verifiable base before changing the record or its history: a matching revision, or an exact normalized timestamp when no revision is supplied. Legacy revision zero remains explicit. Missing or unreadable bases fail as non-retryable validation; conflicting versions use the existing conflict policy and keep accepted work pending, including when the remote clock moved backwards. A fresh read alone cannot authorize the original write. A known committed mutation is acknowledged before these checks, without applying its payload again.
- Creating an absent day needs no existing base. The initializer declares that absence with an empty expected version, which the outbox preserves instead of substituting the local creation timestamp. If another writer creates the day first, the rejected attempt remains durable for review; an ordinary reconnect or remote hydration cannot manufacture its base or purge its payload.
- A full-day save cannot turn a stale specialist-note projection into a new edit. Differences in specialist notes require the writer's construction snapshot to match the stored note for the same patient and episode. A pending or retained task is not proof that its note is current. This is checked inside the existing outbox transaction and before the remote-first Rayen write. A rejected opaque save keeps existing pending work and returns a conflict; rebuilding an independent edit requires a fresh read. Bed moves and clinical cribs do not change patient identity. Removing or replacing an occupant also requires the construction base to contain the stored note; a stale snapshot cannot erase a newer note or restore one for a patient who already left. The full-save persistence adapter loads on demand after the existing freshness checks; its standalone asset remains precached for offline saves. Loading it does not acknowledge or remove pending work.
- A quarantined daily write rejected with `failed-precondition` and `base_required`, or an opaque whole-day write whose original base changed or cannot be verified, requires review of its original intent. The latter rejection keeps a stable error code through queue persistence and the pending-save panel, including a version mismatch detected inside the authority callable. The local queue refuses an unchanged manual retry and explains that the changes remain on this device for review. This retry guard neither supplies a new base nor acknowledges the task remotely. A separate, confirmed manual withdrawal is available after reviewing the shared census. Granular conflicts, network failures and authorization failures retain their existing recovery actions. Older unknown errors are not reclassified from free text. A reviewed reissue of selected changes remains a separate recovery step; this guard does not implement automatic rebasing.
- A user may review and explicitly withdraw a blocked whole-census send from the Eloísa panel. The confirmation captures the complete task and session; the IndexedDB transaction refuses a changed task or session and never withdraws an active send. It changes the existing row to `RETIRED`, preserving its payload, original base and failure for a downloadable backup scoped to that owner. Retired rows neither replay, hold a pending projection, consume the recent-active list nor count as remotely saved. Ordinary owner cleanup preserves manually retired backups; other users cannot list or download them. A fresh write gets a new task and never reuses the backup. This does not read or modify the server census or implement automatic reconciliation.
- Legacy direct outbox publication revalidates the original intent against a Firestore transaction snapshot on every SDK retry. Conflict and clinical authority checks must succeed before the write; its committed record is reconciled through the existing local acknowledgement. Enforced authority and the server write fence still select the callable path. This contract does not establish which lane is enabled in a deployed environment.
- An opaque whole-day outbox task (missing paths or `*`) cannot reconcile a changed base by choosing the newer clock. For an existing day it must supply a matching revision, including zero, or an exact valid timestamp when no revision is available. A supplied timestamp must also match when the revision matches, since legacy direct writes may preserve the revision. The transport checks this before the callable and on every direct transaction attempt; the callable also checks the supplied timestamp inside its full-save transaction using the original tokens. A mismatch retains the payload, mutation IDs, original base and local projection as a conflict; retrying the unchanged task does not reconcile it. Proven mutation acknowledgements still precede this check, and creation of an absent day keeps its existing contract. This does not add automatic reissue or infer field-level intent from a full snapshot.
- Remote cache hydration checks the outbox and writes IndexedDB in one transaction. It preserves the local projection while any unresolved daily write exists; only command acknowledgement/reconciliation may replace that projection. This prevents a realtime echo arriving before the command response from invalidating its own acknowledgement.
- A confirmed local-first full save reconciles its daily record and queue in one IndexedDB transaction. It retires only its own pending mutation with matching payload and no additional compacted mutations. Other unresolved work retains the local projection, payload, original base and status; manually withdrawn backups remain untouched. Adoption requires matching content, not just a timestamp. A failed transaction preserves the task and reports local failure even though the remote write succeeded. The result keeps the exact `confirmedRecord` separate from any retained `localProjectionRecord`. The full-save hook publishes retained work as local and preserves intervening cache edits, including those with the same timestamp, instead of attributing them to the older confirmation.
- A server-confirmed command can remove a `FAILED` or `CONFLICT` daily write only when the existing granular reconciliation proves that all its pending paths were superseded. The matching local revision and queue deletion commit atomically. Residual edits stay quarantined; processing leases, retired records and legacy whole-record writes are not cleared by this recovery. Task age and retry count are not proof of persistence.
- A server-confirmed command acknowledgement is published with remote-authoritative cache semantics. An older realtime/refetch result cannot replace that acknowledgement, while a newer local outbox projection or a newer remote snapshot keeps precedence.
- An authoritative read returned with a rejected clear or crib-creation command retains remote provenance in the query cache. A delayed local read at the same timestamp cannot restore the previous occupant. Publishing this conflict response overlays independent pending clinical edits only for the same patient episode, without acknowledging the rejected command or releasing other pending edits; the existing newer-cache guard still applies.
- The “today empty state” is a last visible fallback, not the first interpretation of a transient remote miss.
- When the specialty episode pilot is enabled, a human specialty change or acceptance of a Jev suggestion uses the existing `patchDailyRecordWithClinicalAuthority` path with `specialtyIntent`, exact episode and decision version. The repository confirms that remote transaction before local persistence and never queues a rejected acceptance. The scalar, provenance and decision audit event commit together. See [specialty episode pilot](./SPECIALTY_EPISODE_JEV.md).

- An ambiguous authority-callable response (deadline or transport/internal failure) triggers at most one server-only read within five seconds, the transport module is loaded before issuing the write. Success requires the exact `meta.lastMutationId`, date, persisted revision and timestamp; cached/pending snapshots, shadow/dry-run calls and deterministic rejections cannot confirm a write. The normal repository acknowledgement then adopts the returned server state and reconciles its queue. No clinical fields are reconstructed from the submitted payload. Missing evidence preserves the original error and existing retry policy.

## Returning to the census

- An unavailable read retains the latest confirmed data while exposing the failure. A delayed response older than that known server revision does not clear the authority failure; recovery requires a successful result at that revision or a newer one. Receiving an old response is not evidence that the current census has been revalidated.

- The daily-record query refetches on focus only when stale, using the existing five-minute cache policy; brief tab returns do not force another read.
- Reconnect keeps a forced check through the daily-record query's own `refetchOnReconnect: 'always'`, including short network interruptions while the page remains visible. The global defaults refetch only stale data on tab return and reconnect.
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

## Fallos de módulos durante desconexión

Un fallo de carga diferida no autoriza recargar automáticamente una sesión editable.
`lazyWithRetry` conserva la espera y el reintento al recuperar conectividad; si el
módulo sigue fallando, presenta un aviso dentro de esa sección. La recarga completa
requiere una acción explícita y confirmación de que puede perder cambios sin guardar.
Los errores ajenos a carga de módulos siguen llegando al error boundary existente.
Esto conserva las mutaciones pausadas y el censo durante una desconexión; no confirma
que un cambio esté persistido ni reemplaza las protecciones de escritura.
