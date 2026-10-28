# Daily-record sync concurrency model

How the app prevents one session from silently overwriting or erasing another session's
changes to a day's census record. Written after the 2026-06-25 incident in which a stale
full-save erased an admitted patient (bed H5C2). Keep this in sync with the code; the
function names below are the source of truth. Last checked against `main` on 2026-10-23
(after #923).

## The document

A day's census lives in a single Firestore document:
`hospitals/{hospitalId}/dailyRecords/{date}`. Its `lastUpdated` field is the optimistic
concurrency token; writes made by the server authority also keep `meta.revision`,
`meta.lastMutationId` and `meta.lastChangedPaths`. `beds` is a map of bed-id → patient (each
bed may also carry a nested `clinicalCrib` patient). Earlier versions go to the `history`
subcollection, but not on every path. Client writes copy at most once per hour per document and
device (`historySnapshotCadence`): `saveRecordAtomically` and `updateRecordPartiallyAtomically`
inside their transaction, a plain `updateDoc` just before. `historyPolicy: 'snapshot'` always
copies (version restores, backup restores, structural Rayen imports, the admission-date backfill
and the first write of an automated run) and `'skip'` never does. A copy the rules deny (roles
without history access) also waits an hour instead of re-reading the day on every save. The authority callables write a slim snapshot after the commit, and the direct queue
publish writes none.

## Who writes: authority routing

A client write is either published directly to Firestore or handed to a server callable:

- **Deployment mode** — `resolveDailyRecordAuthorityMode`: `VITE_DAILY_RECORD_AUTHORITY_MODE`
  (`client_only` | `shadow` | `enforced`), else `VITE_DAILY_RECORD_AUTHORITY_CALLABLE=true` →
  `enforced`, else `client_only`. `.env.example` uses `client_only` and notes that a release must
  use `enforced`; the value each Netlify environment actually sets is not in the repo, so check it
  before extrapolating a test to an environment.
- **Server policy** — `resolveEffectiveDailyRecordAuthorityMode` uses the stronger of the
  deployment mode and `settings/rayenImportPolicy` (`schemaVersion: 2`, `clinicalBatchMode`). The
  policy can promote a client, never weaken it.
- **Write fence** — `isServerClinicalWriteFenceActive`: the schema-v2 policy exists. Firestore
  rules (`isRayenClinicalWriteFenceActive`, and `isSpecialtyDecisionFenceActive` for
  `specialtyPolicies/active` v1) then deny direct client creates of `dailyRecords/{date}` and any
  direct update that touches `beds` or `bedTypeOverrides`. The rules treat the v2 boundary as
  irreversible. The client read is advisory: a failed read counts as no fence, and it does not
  look at the specialty fence. The rules stay the final boundary; a bed patch they reject is
  retried once through the authority callable (`runPartialUpdatePersistWithPermissionFallbacks`).

"Callable off by default" therefore describes only a `client_only` deployment without the v2
policy. With the fence, full saves, queue publishes and bed-tree patches go through the authority
callables even when the deployment mode is `client_only`; they are sent as `mode: 'shadow'`,
which the server commits like `enforced` (only `dryRun: true` skips the write). Without the
fence, `enforced` routes full saves, queue publishes and clinical patches, but structural bed
patches stay direct: the server rejects them unless the fence is active.

## Write paths

| Path                     | Entry                                           | Direct client writer (`client_only`, no fence)                                                   | Authority writer (`enforced` or fenced)                                                      |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Full save**            | `saveDetailed` → `saveRecordToFirestore`        | `saveRecordAtomically`: `runTransaction`, full-replace `set` ✅                                  | `saveDailyRecordWithClinicalAuthority`: server transaction ✅                                |
| **Partial update**       | `updatePartialDetailed` → `updateRecordPartial` | `updateRecordPartiallyAtomically` when `requireAtomicCas` ✅; otherwise `updateDoc` dot-paths ❌ | `patchDailyRecordWithClinicalAuthority` (clinical paths; bed-tree paths only when fenced) ✅ |
| **Sync queue**           | `syncDailyRecord` (`firestoreSyncTransport.ts`) | `runTransaction` that re-resolves the task, then `transaction.set(…, { merge: true })` ✅        | `saveDailyRecordWithClinicalAuthority` with the task's `syncContract` ✅                     |
| **Rayen clinical batch** | `applyRayenClinicalEnrichmentBatch` callable    | —                                                                                                | Server transaction, allowlisted clinical fields ✅                                           |
| **Specialist handoff**   | `updateSpecialistMedicalHandoff` callable       | —                                                                                                | Patient/episode-bound server transaction for a `doctor_specialist` specialist-scoped patch   |

Other server writers (CUDYR admin adjustments, specialty policy application, specialist notes)
also stamp `meta.lastChangedPaths`. Client direct writes never do.

## Guards, by path

### Full save — direct: `saveRecordAtomically` (`firestoreWriteSupport.ts`)

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

A **pre-write** check also runs in `saveDetailed` (`runRemoteSaveIntegrityCheck` →
`assertRemoteSaveCompatibility`): schema version, mass density regression, and the same erasure
check. It produces the good user-facing UX (block + auto-merge recovery), but proceeds if the read
itself fails. The in-transaction guard #3 is the _atomic_ backstop that closes the TOCTOU window
between that pre-check and the commit.

`ConcurrencyError` and `DataRegressionError` are excluded from `withRetry` — a blocked write
must not be retried.

### Partial update — `updateRecordPartial` (`firestoreRecordWrites.ts`)

The first matching route wins:

1. **Specialist-scoped patch by a `doctor_specialist`** — `assertFirestoreConcurrency`
   (fail-closed, no tolerance) and then the `updateSpecialistMedicalHandoff` callable, loaded on
   demand (`specialistMedicalHandoffClient.ts`). The payload carries `expectedOccupants`, frozen
   from the edited record for the bed and its clinical crib separately. Every attempt re-reads
   them; the server checks them and writes in one transaction, and a mismatch is a
   `failed-precondition` editing conflict. Stored patients without episode metadata use the same
   deterministic legacy ID as client hydration (identity and admission, never the bed alone).

   Each target also carries `handoffBases`: the stored note text (the note plus each entry's id
   and text) the edit started from, and the texts this device already sent for that note. In the
   same transaction the server refuses any other stored text, unless the stored note already holds
   this write's text, so a queued or lost-answer replay never replaces a note saved after the edit
   began; the specialist's text stays as a draft. The request carries the write's `mutationId`.
   Every write records in `meta` its paths, its id and `lastMutationDigest`, a SHA-256 of the
   operation (date, exact paths and values, and each target's patient and episode); a write
   without an id records `null` for both, so no earlier id outlives it. The server answers
   without writing only a replay whose id and digest both match the write the record last took
   while the record still holds the values it wrote. That id with any other text, path, patient
   or episode (logged as `specialist_handoff_write_id_reused`, with date and bed only), or over
   values another write changed since, is a `failed-precondition` conflict, and the text stays as
   a draft. Only whole note fields are accepted (`medicalHandoffEntries`,
   `medicalHandoffNote`, `medicalHandoffAudit`, `clinicalEvents`, and the same under
   `clinicalCrib`): a nested or array-index path would escape the text check, and Firestore would
   turn the entries array into a map. No client sends one.

   On a network failure the note becomes its own `UPDATE_SPECIALIST_HANDOFF` task, keyed by date,
   bed, bed or crib, and patient plus episode, whose payload is the callable request. It never
   joins the day's `UPDATE_DAILY_RECORD` task, so its conflict cannot hold another edit of the
   day. A later edit of the same note folds into the task and keeps its earlier bases and sent
   texts. Replay uses the same callable. A refused note (other occupant, or the clinical day closed)
   stays in the queue as that task's `CONFLICT`; the local sync panel names it by patient and date
   and offers a confirmed discard, never a retry that always fails.

   Typed text is kept from the first keystroke as a draft: one localStorage key per draft and
   editing session, for the signed-in user, clinical date, patient, episode and entry. A session
   writes only its own key; deletes are conditional on the exact text. Only a server confirmation
   of that exact text for that identity clears a draft (callable success online or on replay, a
   remote success with the expected targets, or a day-task ACK record); a matching local copy never
   does. The editor owns its text while focused, while a debounce or a send is pending, and while
   its draft is unconfirmed; a stored value that is neither its base nor a text it sent shows both
   texts and holds sending until the user chooses. Text typed without a signed-in user stays in
   memory and goes back only to the user last signed in on that tab; another user gets a notice
   without patient data. Any owner change clears this page's unsaved copies and editing sessions.

   **Deploy transition:** requests that omit `expectedOccupants` entirely keep the old allowlisted
   semantics inside the transaction; malformed or empty supplied metadata still fails closed.
   Requests without `handoffBases` or `mutationId` skip those two checks.
   `specialist_handoff_legacy_client` telemetry identifies this temporary path. Remove it in a
   separate release only after supported tabs have refreshed and legacy traffic has reached zero.
   Old tabs retain their original occupant-binding limitation until refreshed.

2. **Frozen Rayen run guard** (`rayenClinicalWriteGuard`) — patch callable; the server requires the
   exact base version and creates `history/rayen-{runId}` once per run.
3. **Clinical envelope or bed tree** — a clinical-envelope patch goes to the patch callable when
   the effective mode is `enforced` or the v2 fence is active; a structural bed-tree patch only
   with the fence. Either goes when the command carries `intentionalBedClear` or `specialtyIntent`.
   Mixed patches are rejected with `ConcurrencyError` instead of being split: clinical with
   structural or other fields under `enforced` or the fence, and bed-tree with other top-level
   fields under the fence.
4. **`requireAtomicCas`** (e.g. movement reclassification) — `updateRecordPartiallyAtomically`:
   exact base version, history snapshot (hourly cadence and `historyPolicy`) and `update` in one
   transaction. A command that needs a confirmed record (`requireConfirmedRecord`, passed down as
   `returnCommittedRecord`) gets the committed record back. It does not depend on a server
   readback, which an attached census listener can answer with the pre-commit version. After the
   commit, the payload is projected onto the base the committing attempt read
   (`firestoreUpdateProjection`); a value it cannot reproduce exactly gets no receipt. The
   projection refuses `FieldValue` sentinels and class instances for direct callers; on this path
   `sanitizeForFirestore` has already turned them into plain maps, which are stored as they are.
   Without a receipt, the controller's readback rejects a copy still at the base version, retries
   twice (about 250 and 750 ms) and then fails closed. It rejects only that exact version, because
   a client-clock `lastUpdated` cannot be ordered safely: a listener view older than the base still
   passes.
5. **Otherwise** — `assertFirestoreConcurrency` (**fail-closed**: a verification error aborts),
   a history snapshot (hourly cadence; `'snapshot'` forces it, `'skip'` omits it), and `updateDoc`
   with dot-path fields. It
   structurally cannot erase a whole bed, but it is not atomic; on abort the change is already in
   IndexedDB and is re-checked by the sync queue.

A `not-found` on a non-specialty route recreates the document with `setDoc(…, { merge: true })`.

### Local outbox — `saveDailyRecordWithTask` (`dexieSyncQueueStore.ts`)

The day's projection in IndexedDB and the unresolved task that holds it as its payload are the
single local record of what is pending. One Dexie transaction writes both. Equal timestamps do
not prove equal content; patches compare normalized values and patient-plus-episode identity
against the stored projection even after its previous task has been published. When a write was
computed from another base (a second tab, or a read that showed an older copy), it lands on top of
that projection instead of replacing it, and compacting an unresolved task keeps its original
`expectedVersion` and `baseRevision` even for ordinary sequential edits:

- a new patch (`buildPatchRebase` in `dexieDailyRecordOutbox.ts`) is prepared again over the projection. A path that
  both writes changed follows the same-path policy, not last-write-wins: movement logs merge by
  id, anything else is rejected with `ConcurrencyError`. So is a field edit whose bed or crib now
  holds another patient or episode; a RUT never matches a passport;
- a record queued again without its base, such as a retry or an auto-merge
  (`buildRecordOverlayRebase`), keeps the values of its own changed paths, and every other
  pending path keeps the projection's value. Movement arrays always merge by id and identity checks
  run even when every pending path overlaps;
- whole-record writes (`*`) replace the projection only after checking their construction
  base and preserving accepted pending edits. A stale opaque replay keeps its original
  base and payload for review instead of choosing the newer clock;
- a specialist note task (`UPDATE_SPECIALIST_HANDOFF`) lands its projection with the same patch
  rebase, but never changes a projection that a pending day task still holds. The projection
  publishes nothing, so the day keeps the `lastUpdated` it was read at: a later day write starts
  from that version, and a read still prefers a newer server day. The task records the values the
  projection replaced; once the note can no longer publish (`CONFLICT`, `FAILED` or discarded),
  the stored day and any day write folded on top get them back wherever they still show the
  note's values, a later note projected over it now replaces those values, and the view is told
  to refresh the day. Quarantine or explicit discard and restoration commit in one IndexedDB
  transaction: a storage failure keeps the task and its projection metadata for retry. Every queue
  pass repairs any unreleased quarantined projection; a repair failure stops the pass before any
  task is dispatched. A note queued before this rule recorded nothing: the same repair releases
  such notes once, so the day counts as older than any server version
  (`UNKNOWN_SERVER_VERSION`) and its day writes merge by changed paths. That may hold an edit as a
  conflict when the last writer before this device's read changed the same path. The cached version
  is invalidated even while a day task is held, without changing that task's payload. Its ACK can
  adopt the committed day only if every cached value besides that invalidated version still
  matches the claimed payload; a different local edit continues to block adoption. Each task of a
  claimed batch replays as stored when it is dispatched, so a release earlier in the batch reaches
  it. On a successful note publish, its local ACK replaces any still-matching older projection in
  the stored day and queued day payloads with the published note values before removing the note
  task, in the same transaction. This leaves the day version unchanged and preserves unrelated
  pending edits. If a day task already owned the projection when the note was created, the note
  records those existing field values for the same ACK step without changing the day up front.
  Refusal marks the projection as released while retaining both its before and projected values.
  An explicit retry can then settle either the restored value or a stale pre-refusal copy to the
  confirmed note. It never replaces a newer, different local value or another occupant's note.
  Releasing the same projection again does nothing.
  If the ACK fails, its projection metadata remains available for retry. Retired notes do not
  participate in projection repair. Restoration and confirmation also require the note's original
  patient and episode in the affected bed or crib; identical text on another occupant is untouched.

  Known pre-existing limit: explicit discard deletes the note task after restoring the stored
  day and tasks already queued. A stale tab can later create a new whole-record save containing
  the discarded text. With no remaining note task, the replay guard cannot identify that text's
  origin, and it may publish it. This also reproduces on main before this change, in client-only
  and enforced modes. Preventing it requires a separate durable provenance or whole-save ownership
  contract; this change does not retain discarded-note tombstones or claim to close that gap.

  A legacy whole-record task (`*` or absent changed paths) whose base became unknown stays in
  `CONFLICT` for review, including after an explicit retry or when the remote day is missing.
  Its payload is retained: without field-level intent or a trustworthy base, replay cannot prove
  that it would not undo a subsequently confirmed note. A matching server mutation receipt can
  still acknowledge an already committed write. Tasks with explicit changed paths keep the usual
  reconciliation and authority checks.

Cache hydration keeps a projection that still has unresolved writes. The read, the realtime
snapshot and the manual sync then publish that projection (`local_authoritative` or `local_kept`)
instead of the remote copy, so the next edit starts from the pending work. This snapshot is read
after remote selection, including when no hydration is needed, timestamps match, or the remote
record is absent. A manual sync with a missing remote record still reports `missing_remote`;
read results retain their separate `local_authoritative` consistency contract.

A direct-write ACK only deletes a task containing that write alone. If compaction added other
mutations, it releases the hold and leaves the aggregate for queue publication. The confirmed
latest mutation marker does not by itself acknowledge the other mutations.

### Sync queue — `firestoreSyncTransport.ts`

1. **Already applied** — the remote `meta.lastMutationId` equals the task's `mutationId`: no write
   for a single mutation. A compacted task additionally requires all its granular changed values
   to be present remotely; otherwise the remaining work is merged and published;
   the remote record is returned as the authoritative result. A task still queued after its
   write landed (its ACK rolled back) rebuilds its held conflicts (step 2) on this path too, so
   completing it never drops them.
2. **Departed occupant** — a bed or crib whose field edits were written for a patient or episode
   it no longer holds: none of those edits are written to the new occupant, whatever the server
   stamped. They leave the task as one `CONFLICT` bound to the original patient
   (`dayTaskOccupantDetach.ts`), the other beds go on to step 3 (always merged against the remote),
   and step 6 writes that conflict in the same transaction that completes the task. A task that
   itself changed the occupant (admission, discharge, identity correction) is not detached. The
   held conflict has its own mutation id; retried while its patient is still gone it stays that
   conflict, and once the same patient and episode are back it publishes and completes.
3. **Stale task** (remote `lastUpdated` newer than the task's `expectedVersion`) —
   `assertNoSamePathRemoteMutation` blocks when the remote `meta.lastChangedPaths` overlaps the
   task's `changedPaths` (movement arrays and disjoint medical-handoff entries/specialties may
   merge). Then `resolveDailyRecordConflict` by `changedPaths`, the post-merge invariants and the
   clinical consistency check; any block → `ConcurrencyError`. A task whose copy holds another
   patient or episode than the stored day in a slot it did not touch is merged the same way: its
   version cannot be that day's. The bed's patient and the crib's newborn are separate slots, so
   an edit of one never writes the other from the stale copy; a touched slot whose patient left is
   step 2's conflict. Otherwise (remote not newer, or no `expectedVersion`) the payload's
   `lastUpdated` gets the strict drift check (`assertSyncQueueConcurrency`, drift > 0 →
   `ConcurrencyError`). Before either acceptance or merging, note fields (`medicalHandoffEntries`,
   `medicalHandoffNote`, `medicalHandoffAudit`, `clinicalEvents`, bed and crib) keep the stored day's
   values outside the task's changed paths, or, for a whole-record write, wherever they hold what
   a specialist note still queued for the day wants there. A recreated day uses absent stored
   values for the same check: a day write never publishes a note it did not write.
4. **Clinical authority** — `evaluateDailyRecordClinicalAuthority` must not block.
5. **Publish** — enforced or fenced: the save callable, whose response must carry the committed
   record. A merged task still sends its own base, so the callable refuses it while the stored day
   is newer and the task stays queued (a known limit: it is held, not lost). Otherwise `runTransaction` re-runs steps 1–4 against the transactional snapshot and
   writes with `{ merge: true }`, so beds absent from the payload are never dropped. With the
   deployment mode `shadow`, a dry-run callable runs first and its failure never blocks.
6. **Acknowledge** — `completeClaimedSyncTask` writes any detached conflict, deletes the task and,
   when no other task for that date is unresolved, adopts the authoritative record into IndexedDB,
   all in the same Dexie transaction.

Step 3 only sees what the last server writer stamped in `meta.lastChangedPaths`. Client direct
writes stamp nothing, and full saves stamp `['*']`, which the overlap check compares literally; in
both cases the merge decides per field by episode (`isSameEpisodeForExplicitCensusPatch`), and a
bed whose occupant changed was already set aside in step 2. See the limitations below. Conflict
snapshots and their restore flow are described in
[ADR_CONFLICT_VERSION_RECOVERY.md](ADR_CONFLICT_VERSION_RECOVERY.md).

### Authority callables — `dailyRecordWriteAuthorityFunctions.js`

- Server `runTransaction` for save and patch.
- **Version** — an existing day requires a verifiable base inside the transaction.
  `meta.revision` must equal `syncContract.baseRevision` when supplied; without a revision,
  the timestamp must match exactly. A full save also checks any supplied timestamp even
  when its revision matches. Guarded Rayen patches and `intentionalBedClear` keep their
  exact-version checks. A known committed mutation is acknowledged before the base checks.
- **Idempotency** — a single slot, `meta.lastMutationId`: a replay is recognised only while no
  other mutation has landed since.
- **Erasure guard** — `assertNoPatientErasures` (server mirror) on save and patch; the patch
  exempts its declared `intentionalBedClear` target.
- **History** — slim snapshot after the commit, best effort; guarded Rayen patches create
  `history/rayen-{runId}` inside the transaction if it does not exist. The server parses
  `historyPolicy` but does not use it.
- **Mode** — `normalizeMode` treats anything other than `shadow` as `enforced`; only
  `dryRun: true` skips the commit.
- **Admission dates** — there is no server mirror of `assertAdmissionDatePersistencePolicy`
  (`dailyRecordAdmissionDateWritePolicy.ts`); it runs on the client only.

### Rayen clinical batch — `rayenClinicalEnrichmentFunctions.js`

One transaction reads the current census once. It verifies bed/cuna location and
`clinicalEpisodeId` for every target and, in `enforced`, the exact `lastUpdated` and optional
`meta.revision`. Only devices (`devices`, `deviceDetails`, `deviceInstanceHistory`),
`evaluationScores`, vital signs and their history, `clinicalSyncCheckpoint` and
`clinicalCarryover` are accepted; historical targets accept only `evaluationScores.cudyr`. The
transaction creates one deterministic `rayen-clinical-…` history snapshot per `runId` when the
batch carries clinical patches, the enriched record and a bounded receipt list
(`meta.clinicalEnrichmentReceipts`, 16 entries).
`shadow` is always dry-run.

The client (`applyClinicalEnrichmentBatch`) chooses one writer per run from the saved policy:
`off` writes per patient; `shadow` writes per patient and adds a dry-run batch for parity;
`enforced` sends one batch per census day (the day itself and, for historical CUDYR, a second
bounded batch to D−1) and retries once with the same `mutationId`: after a version conflict it
rebuilds the operations, after a transient error it resends them. It never changes writer in the
middle of a run.

## Erasure guard and patient identity

`findPatientErasures` (client `src/services/repositories/dailyRecordErasureGuard.ts`, server
`functions/lib/dailyRecordErasureGuard.js`) reports a bed or crib whose remote occupant the
incoming record dropped when both hold:

1. no discharge/transfer/CMA with the same patient name accounts for that bed (`bedId`, or
   `originalBedId` for CMA); and
2. the patient is not present anywhere else in the incoming record. This relocation exemption
   lets an internal bed move, which leaves no movement record, persist.

The relocation exemption requires a unique matching occupant in each record. Two persisted
non-legacy episode ids must agree, even if the document matches. If an id is missing or starts
with `legacy_ep_`, the fallback compares the complete document (letters preserved), compatible
explicit document types, normalized name, `firstSeenDate || admissionDate`, and admission time.
It permits legacy-to-canonical hydration without treating a shared maternal document or a legacy
hash as a unique person. One remaining occupant cannot account for two remote occupants.

It is not the comparator of the admission-date policy (`hasSamePatientEpisodeIdentity`) nor of
explicit-field merging (`isSameEpisodeForExplicitCensusPatch`): their purposes differ.
`patientIdentityGuardComposition.test.ts` pins those differences. Missing evidence on one side
blocks relocation; two equally minimal legacy rows can still match by name when neither has
a document or admission details. This preserves legacy moves but cannot establish identities
that the records never contained. Correcting a name during a move requires a stable episode id.

## Known limitations

- **Legacy identity ambiguity.** The guard blocks non-unique matches. A unique pair of equally
  incomplete legacy rows remains indistinguishable without additional identity/admission data.
  The guard checks emptied slots, not replacements of one occupied slot by another patient.
- **Stale queued edit after a relocation.** A queued field edit (e.g. `pathology`) made before
  another session moved the bed's occupant is never applied to the new occupant: step 2 keeps it
  as a conflict bound to the original patient. It does not follow the moved patient to the new
  bed; the user reviews or discards it from the local sync panel.
- **`findPatientErasures` movement matching** uses the patient name and the bed; the
  density-regression thresholds (40% / 50 points) are coarse and tuned for a full census.
- **Partial update via plain `updateDoc` is not atomic.** It relies on field-scoped merge +
  fail-closed pre-check + the sync queue's re-check, not a transaction.
- **Authority callable** — a one-mutation idempotency slot. A missing or changed base
  blocks publication; an opaque queued copy requires review before reissue.
- **The erasure guard is duplicated** on client and server. The parity test runs a shared battery
  through both and fails on any drift.

## Tests

- Unit: `firestoreWriteSupport.test.ts` (CAS, missing-base, erasure backstop, strict tolerance),
  `dailyRecordRemoteWriteController.test.ts` (erasure cases through `assertRemoteSaveCompatibility`
  and `assertNoPatientErasures`), `networkUtils.test.ts`.
- Routing: `dailyRecordAuthorityMode.test.ts` (deployment flag) and
  `firestoreRayenClinicalAuthorityMode.test.ts` (server policy and fence). Queue publish inside a
  transaction and its callable route: `syncQueueAtomicPublish.test.ts` and, against the emulator,
  `sync-atomic-publish.emulator.test.ts`.
- Server guard: `src/tests/functions/dailyRecordErasureGuard.test.ts` (pure helper, including
  relocation) and `dailyRecordWriteAuthorityErasure.test.ts` (handler blocks the write);
  client/server parity is enforced by `dailyRecordErasureGuardParity.test.ts`. The schema-v2
  fence is covered by `dailyRecordWriteAuthorityClinicalFence.test.ts` and the rules suites
  (`src/tests/security/firestoreRulesAccessGroups.ts`).
- Combined scenarios (synthetic): `syncQueueBedSwapComposition.test.ts` runs an A↔B swap with a
  mother and her newborn through the admission-date, erasure, consistency and authority checks
  and replays a stale queued edit through the real queue transport;
  `patientIdentityGuardComposition.test.ts` compares the three identity comparators.
- Rayen batch: `rayenClinicalEnrichmentFunctions.test.ts` covers one-read atomic persistence,
  allowlist, episode/cuna identity, revisions, idempotency and shadow; the client writer choice and
  retries are covered by `applyClinicalEnrichmentBatch.test.ts`.
- Real engine: `src/tests/emulator/atomic-write-guards.emulator.test.ts` runs against the Firestore
  emulator — two concurrent saves on the same base (one wins, one `ConcurrencyError`) and the
  in-transaction erasure backstop. Run via `npm run test:emulator:sync:ci`.

## Flow contracts

### Manual specialty confirmation

The identity chip, clinical editor and optional specialty column await the existing
bed command result. Specialty is not part of the diagnosis debounce. With the
episode pilot enabled, a primary selection is one scalar `specialtyIntent` bound
to its episode and expected decision; the clinical editor sends other edited
fields separately and does not reconfirm an untouched specialty. A pending control
cannot submit twice, and completion from an old date or occupant must not affect
the current editor. A rejection remains visible instead of closing as if saved.

The authoritative transaction clears the dependent secondary classification, and
clears obstetric fields when a manual primary selection leaves Ginecobstetricia.
It persists those derived changes with the specialty and audit decision. Clients
must not send a second cleanup patch that could arrive after a new occupant or a
new decision. The scalar-only request guard and the legacy rollout stay intact.

The patch mutation does not replay the whole command through TanStack's global
retry default; the repository and callable own bounded recovery. A rejected
specialty intent cannot fall back to a legacy patch or create a missing document,
because either would lose the decision and episode guards.

This preserves ID-02, SAVE-01 and SAVE-02 in `DOMAIN_RULES.md`. Verification uses
the component/input regression suites, `specialtyManualClassification.test.ts`,
the local specialty/clinical concurrency emulator suite, and
`e2e/census-specialty-save.spec.ts`. The browser suite controls when actual UI
requests complete, using the authority handler against a local Firestore emulator.
It checks server revisions and episode decisions as well as browser persistence
after reload. Roll back the change as one PR, preserving the existing authority
and queue contracts.

### Egreso histórico arrastrado al copiar un censo

Cuando un paciente copiado a D egresó oficialmente en D-1, el movimiento pertenece sólo a D-1.
La persistencia estructural de D conserva temporalmente esa cama y excluye el episodio egresado
(y su cuna asociada) del enriquecimiento clínico. Tras confirmar el movimiento en el registro
histórico, `finalizeRayenHistoricalDischarges` libera la cama de D con el comando existente
`intentionalBedClear`, ligado a la versión y al ocupante revisado. No crea un alta en D.

Si el movimiento histórico está pendiente, falta o la cama/cuna cambió, conserva la cama y
clasifica el seguimiento histórico como pendiente o necesitado de nueva captura; el censo
confirmado permite continuar la información clínica de los otros episodios. El guard de
regresión de un guardado estructural Rayen nunca debe encolar el plan rechazado mediante
el auto-merge genérico. Una respuesta perdida después del vaciado se resuelve por lectura
autoritativa, sin repetir el movimiento histórico ni borrar al siguiente ocupante.

Si D-1 ya contiene el alta y conserva al mismo episodio en una cama, la propuesta sigue
incluyendo D-1 como corrección que requiere revisión. Después de comprobar el movimiento,
el finalizador libera primero esa ocupación histórica y luego la copia de D mediante dos
comandos de cama independientes. Conserva las altas y cualquier nuevo ocupante; vuelve a
comprobar firma, identidad y cuna. Así el lote CUDYR de los otros pacientes no se bloquea por
la contradicción entre un episodio cerrado y su antigua cama. Si D-1 ya está conciliado,
la limpieza de D se ejecuta aunque no haya más escrituras históricas que confirmar.

Prueba de regresión: `src/tests/rayen-import/rayenHistoricalDischargePersistence.test.ts`.

Los formularios de cuna vacíos copiados entre días no constituyen un RN pendiente de alta.
La conciliación exige evidencia independiente cuando la cuna tiene nombre, RUN o episodio;
si sólo existe el formulario vacío, el comando conserva la guarda de presencia y revisión
exacta. Una cuna que recibe identidad concurrentemente sigue bloqueando la retirada. La
propuesta distingue un movimiento histórico ya registrado de una nueva alta: retirar la
ocupación residual no añade otro egreso en ninguno de los días.

### Egreso único del RN asociado

Si el reporte hospitalario identifica el episodio exacto del RN, su movimiento propio prevalece
sobre la inferencia de alta asociada al egreso de la madre. La aplicación comprueba tanto los
movimientos ya guardados como los creados en la misma corrida, también si el RN se egresó
mientras la vista previa estaba abierta. Nunca deduplica sólo por nombre o RUN compartido.
Conserva cama canónica, ingreso, hora oficial y snapshot del RN para deshacer el movimiento;
la madre no conserva otra copia del RN en su snapshot. El RN asociado sigue con `isNested`
y no suma otro egreso estadístico. Un diagnóstico vacío del reporte conserva el conocido.
Los reportes de otro día no suprimen el snapshot reversible de este día.

Para duplicados existentes del día seleccionado, la vista previa propone conservar el egreso
RN canónico con ingreso y snapshot completo y archivar sólo la copia mínima con cama
`Cuna ...`, del mismo episodio, RUN, hora, estado y diagnóstico compatible. Exige origen
Gestión de Camas y movimientos asociados, nunca deduplica altas estadísticas independientes,
manuales, datos IEEH, snapshots enriquecidos ni identidades ambiguas. Se aplica únicamente al
confirmar; conserva la copia íntegra como tombstone con operador, fecha y referencia al egreso
conservado. Un cambio concurrente exige nueva revisión. No cambia otros días ni suma egresos.
La elegibilidad histórica lee los snapshots únicamente en `censusDischargeHistory`, la frontera
gobernada existente; el aplicador recibe la propuesta sin interpretar esos datos clínicos.
Sin operador identificado la corrección se omite y permanece pendiente.
Los tombstones existentes evitan que una fusión con otra pestaña resucite la copia.

Regresiones: `newbornDischargeIdempotency.test.ts`, `newbornDischargeReportPrecedence.test.ts`,
`clinicalCribDischargeRepairs.test.ts`, `RayenImportPreviewModal.newbornRepair.test.tsx` y
`dischargePlanInvariants.test.ts` bajo `src/tests/rayen-import/`.

### Recuperación de especialidad manual

Con el piloto por episodio activo, el repositorio adquiere el turno de escritura
existente de la fecha antes de leer la base autoritativa del servidor. Conserva la
intención original: episodio, destino cama/cuna, decisión previa y valor mostrado.
Un cambio de cualquiera de esas condiciones exige revisar el censo. No se reemplaza
`expectedDecisionId` por el encontrado al refrescar y una lectura local no acredita
que el servidor conserve al paciente.

Un conflicto exclusivamente de revisión admite un solo reintento, tras comprobar
que la misma especialidad y decisión siguen vigentes. Conserva `mutationId`,
`clientId` y `tabId`; los rechazos semánticos o de permisos no se reintentan.
Si la respuesta se pierde, sólo se confirma por una lectura autoritativa que
contenga el mismo `decisionId` de esa mutación, episodio, valor, fecha y origen.
Coincidir únicamente en el texto de la especialidad no prueba que se guardó esa
operación. Una recuperación confirmada conserva las otras ediciones locales
pendientes mediante el adoptador existente. Sin evidencia suficiente se informa
el fallo, sin encolar una decisión rechazada ni inventar confirmación.

La adopción local protege la especialidad, su decisión y los campos dependientes
confirmados por el servidor, aunque la cola contenga un objeto completo de cama o
cuna anterior. Sólo conserva borradores del mismo episodio. Los campos ya durables
se retiran del conjunto pendiente; el reemplazo conserva la identidad y el historial
de mutaciones de la tarea. Esta protección local no amplía el comando remoto escalar.

La cola ordena las escrituras de una pestaña por fecha; las transacciones y sus
versiones protegen frente a otras pestañas o usuarios. No hay una cola global ni
un temporizador que cancele una transacción remota. Se mantienen los modos legacy
sin activar flags ni modificar reglas de especialidad. Reversión: revertir el PR
de recuperación conservando los controles de autoridad, CAS y episodio.

Regresiones: `dailyRecordSpecialtyRecovery.test.ts` comprueba diez cambios rápidos,
cama/cuna, conflictos técnicos y semánticos, desconexión, respuesta perdida y
conservación de proyecciones locales; `dailyRecordAuthorityCallableClient.test.ts`
verifica la clasificación de errores del servidor.

### Datos clínicos por episodio (fase 1a)

`hospitals/{hospitalId}/dailyRecords/{date}/clinicalDerived/{clinicalEpisodeId}` guarda
`clinicalSyncCheckpoint` y `vitalSignsHistory` de cada episodio de un día marcado con
`clinicalDerivedLayout`. Es una subcolección que sólo escribe el servidor, como
`specialtyDecisions`: las reglas niegan toda escritura de clientes y ninguna actualización del día
puede agregar, cambiar ni quitar el marcador o bajar `meta.revision` de un día marcado (ni dejarla
fuera de un entero). Escriben y marcan solo los callables de autoridad y el lote clínico
(`functions/lib/clinicalDerivedStore.js`), desde la fecha de `HHR_CLINICAL_DERIVED_SPLIT_FROM`.
El cliente lee la vista combinada con el contrato gemelo (`clinicalDerivedContract`), el lector
`clinicalDerivedEpisodeReader.ts` y `dailyRecordClinicalDerivedReadService.ts` en el relleno de
Rayen, la ventana de signos vitales, la creación del día, la herramienta de personal y los respaldos
JSON. La activación y la vuelta atrás están en `DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md`.

El esquema del día guarda el marcador tal como viene, sea cual sea su forma, y la recuperación de
un día con una cama dañada conserva el marcador y `meta`: el contrato decide si el día está
marcado, sin marcar o con un marcador no soportado, y un día recuperado no parece atrasado frente
a sus documentos. El lector sólo valida los documentos de la generación vigente (los restos de un
día borrado se ignoran sin leerlos) y dice cuándo respondió la caché sin conexión; la lectura
`bestEffort` lo informa como `cache_only`, así que una exportación o la herramienta de personal
deben leer con `source: 'server'`.

Higiene de escritura del cliente (P4, D9): ningún cliente escribe desde su copia local los campos
movidos de un día marcado ni crea un día con marcador. El auto-merge de conflicto
(`conflictResolutionMatrix.ts`, también en la base estructural de Rayen), la publicación directa de
la cola (`firestoreSyncTransport.ts`, `merge: true`) y el guardado directo completo
(`saveRecordAtomically`, que también usa la restauración de versiones) pasan el registro por
`adoptStoredClinicalDerivedState` (`clinicalDerivedWriteHygiene.ts`) con el día remoto leído en la
misma transacción:

- el marcador sale siempre del remoto; al crear o recrear un día (desde la cola, IndexedDB o un
  JSON) se quita, porque la regla de creación lo niega y la cola nunca se purga. Como en las
  reglas, un marcador presente cuenta aunque sea `null`;
- en un día marcado también salen del remoto `meta` (una escritura directa no baja la revisión) y,
  por episodio, `clinicalSyncCheckpoint` y `vitalSignsHistory`: la copia embebida de un episodio
  aún no dividido se conserva y una copia local nunca la reemplaza. El episodio es
  `clinicalEpisodeId` o, si falta, el id heredado que le da cada guardado del cliente; una cama
  bloqueada no cuenta como episodio activo;
- como `merge: true` conserva lo que el payload omite, la publicación de la cola borra
  (`deleteField()`) los campos movidos que otro episodio dejó en esa cama: si el remoto no los
  tiene para ese episodio, el resultado tampoco;
- sin marcador en ningún lado el registro y el payload pasan igual que antes.

El recibo del guardado directo refleja lo confirmado. La importación JSON local y la de respaldos
del administrador no reemplazan un día local marcado por una copia sin marcador, o con el de otra
generación, que no sea más nueva; si el día local no se puede leer, tampoco. La importación JSON
omite esa fecha y la de respaldos la cuenta como fallida. La recuperación de una cama dañada de un
día marcado conserva `clinicalEpisodeId` para que la superposición y la higiene la encuentren.

Los callables de autoridad (guardado, parche y lote) mandan `clientRuntimeContractVersion` como
campo raíz aparte, fuera de `syncContract`, digests y recibos. Vale
`CLIENT_RUNTIME_CONTRACT_VERSION`, que es 3 desde que el relleno de Rayen lee la vista combinada
(D10, P4b): D7 solo acepta campos movidos de la versión 3, y el cliente la declaró en ese mismo
cambio. Una prueba (`clinicalAuthorityClientVersion.test.ts`) exige las dos cosas juntas.
