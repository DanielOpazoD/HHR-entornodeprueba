# Daily-record sync concurrency model

How the app prevents one session from silently overwriting or erasing another session's
changes to a day's census record. Written after the 2026-06-25 incident in which a stale
full-save erased an admitted patient (bed H5C2). Keep this in sync with the code; the
function names below are the source of truth. Last checked against `main` on 2026-10-21
(after #923).

## The document

A day's census lives in a single Firestore document:
`hospitals/{hospitalId}/dailyRecords/{date}`. Its `lastUpdated` field is the optimistic
concurrency token; writes made by the server authority also keep `meta.revision`,
`meta.lastMutationId` and `meta.lastChangedPaths`. `beds` is a map of bed-id → patient (each
bed may also carry a nested `clinicalCrib` patient). Earlier versions go to the `history`
subcollection, but not on every path: `saveRecordAtomically` and `updateRecordPartiallyAtomically`
snapshot inside their transaction, a plain `updateDoc` snapshots just before unless
`historyPolicy: 'skip'`, the authority callables write a slim snapshot after the commit, and the
direct queue publish writes none.

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

| Path                     | Entry                                           | Direct client writer (`client_only`, no fence)                                                   | Authority writer (`enforced` or fenced)                                                         |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Full save**            | `saveDetailed` → `saveRecordToFirestore`        | `saveRecordAtomically`: `runTransaction`, full-replace `set` ✅                                  | `saveDailyRecordWithClinicalAuthority`: server transaction ✅                                   |
| **Partial update**       | `updatePartialDetailed` → `updateRecordPartial` | `updateRecordPartiallyAtomically` when `requireAtomicCas` ✅; otherwise `updateDoc` dot-paths ❌ | `patchDailyRecordWithClinicalAuthority` (clinical paths; bed-tree paths only when fenced) ✅    |
| **Sync queue**           | `syncDailyRecord` (`firestoreSyncTransport.ts`) | `runTransaction` that re-resolves the task, then `transaction.set(…, { merge: true })` ✅        | `saveDailyRecordWithClinicalAuthority` with the task's `syncContract` ✅                        |
| **Rayen clinical batch** | `applyRayenClinicalEnrichmentBatch` callable    | —                                                                                                | Server transaction, allowlisted clinical fields ✅                                              |
| **Specialist handoff**   | `updateSpecialistMedicalHandoff` callable       | —                                                                                                | Used for a `doctor_specialist` specialist-scoped patch, after a fail-closed client version read |

Other server writers (CUDYR admin adjustments, specialty policy application) also stamp
`meta.lastChangedPaths`. Client direct writes never do.

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
   (fail-closed, no tolerance) and then the `updateSpecialistMedicalHandoff` callable.
2. **Frozen Rayen run guard** (`rayenClinicalWriteGuard`) — patch callable; the server requires the
   exact base version and creates `history/rayen-{runId}` once per run.
3. **Clinical envelope or bed tree** — a clinical-envelope patch goes to the patch callable when
   the effective mode is `enforced` or the v2 fence is active; a structural bed-tree patch only
   with the fence. Either goes when the command carries `intentionalBedClear` or `specialtyIntent`.
   Mixed patches are rejected with `ConcurrencyError` instead of being split: clinical with
   structural or other fields under `enforced` or the fence, and bed-tree with other top-level
   fields under the fence.
4. **`requireAtomicCas`** (e.g. movement reclassification) — `updateRecordPartiallyAtomically`:
   exact base version, history snapshot and `update` in one transaction.
5. **Otherwise** — `assertFirestoreConcurrency` (**fail-closed**: a verification error aborts),
   a history snapshot unless `historyPolicy: 'skip'`, and `updateDoc` with dot-path fields. It
   structurally cannot erase a whole bed, but it is not atomic; on abort the change is already in
   IndexedDB and is re-checked by the sync queue.

A `not-found` on a non-specialty route recreates the document with `setDoc(…, { merge: true })`.

### Sync queue — `firestoreSyncTransport.ts`

1. **Already applied** — the remote `meta.lastMutationId` equals the task's `mutationId`: no write;
   the remote record is returned as the authoritative result.
2. **Stale task** (remote `lastUpdated` newer than the task's `expectedVersion`) —
   `assertNoSamePathRemoteMutation` blocks when the remote `meta.lastChangedPaths` overlaps the
   task's `changedPaths` (movement arrays and disjoint medical-handoff entries/specialties may
   merge). Then `resolveDailyRecordConflict` by `changedPaths`, the post-merge invariants and the
   clinical consistency check; any block → `ConcurrencyError`. Otherwise (remote not newer, or no
   `expectedVersion`) the payload's `lastUpdated` gets the strict drift check
   (`assertSyncQueueConcurrency`, drift > 0 → `ConcurrencyError`).
3. **Clinical authority** — `evaluateDailyRecordClinicalAuthority` must not block.
4. **Publish** — enforced or fenced: the save callable, whose response must carry the committed
   record. Otherwise `runTransaction` re-runs steps 1–3 against the transactional snapshot and
   writes with `{ merge: true }`, so beds absent from the payload are never dropped. With the
   deployment mode `shadow`, a dry-run callable runs first and its failure never blocks.
5. **Acknowledge** — `completeClaimedSyncTask` deletes the task and, when no other task for that
   date is unresolved, adopts the authoritative record into IndexedDB in the same Dexie
   transaction.

Step 2 only sees what the last server writer stamped in `meta.lastChangedPaths`. Client direct
writes stamp nothing, and full saves stamp `['*']`, which the overlap check compares literally; in
both cases the merge decides per field by episode (`isSameEpisodeForExplicitCensusPatch`). See the
limitations below. Conflict snapshots and their restore flow are described in
[ADR_CONFLICT_VERSION_RECOVERY.md](ADR_CONFLICT_VERSION_RECOVERY.md).

### Authority callables — `dailyRecordWriteAuthorityFunctions.js`

- Server `runTransaction` for save and patch.
- **Version** — `assertExpectedVersion` rejects a newer remote but does nothing when no base
  version is sent (unlike the client missing-base guard). Guarded Rayen patches and
  `intentionalBedClear` use `assertExactExpectedVersion`. `meta.revision` must equal
  `syncContract.baseRevision` when the contract sends one.
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

The relocation exemption compares identity tokens: the RUT reduced to digits and `K`,
`clinicalEpisodeId`, and the name only when neither exists; any shared token counts as present.
It is not the comparator of the admission-date policy (`hasSamePatientEpisodeIdentity`) nor of
the stale-edit merge (`isSameEpisodeForExplicitCensusPatch`).
`patientIdentityGuardComposition.test.ts` pins where the three diverge.

## Known limitations

- **Identity gaps in the erasure guard** (backstop false negatives, reproduced with synthetic
  fixtures; production occurrence was not investigated). A dropped occupant counts as relocated
  when any occupant of the incoming record shares a token: a newborn that carries the mother's
  administrative document, with or without episode ids; passports reduced to the same digits
  (`AB1234567` and RUT `123.456-7`, or `AB123456` and `CD123456`); a readmission with the same
  document and a new episode whose previous movement is missing. Making the check
  episode-authoritative must still allow the id rewrite seen during hydration (`legacy_ep_…` →
  `ep_…`), so it is a separate decision.
- **Stale queued edit after a relocation.** A queued edit to an explicit census field (e.g.
  `pathology`) made before another session moved the bed's occupant is not applied to the new
  occupant, because the merge compares episodes, but it does not follow the moved patient
  either. It is blocked with `ConcurrencyError` only when the last server stamp overlaps its path
  (for example `beds` or `beds.R1`). With no stamp (client direct write), a full-save stamp
  `['*']` or a stamp on other beds, the task is acknowledged and the edit is lost without a
  conflict.
- **`findPatientErasures` movement matching** uses the patient name and the bed; the
  density-regression thresholds (40% / 50 points) are coarse and tuned for a full census.
- **Partial update via plain `updateDoc` is not atomic.** It relies on field-scoped merge +
  fail-closed pre-check + the sync queue's re-check, not a transaction.
- **Authority callable** — fail-open version check when no base version is sent, and a
  one-mutation idempotency slot.
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
