import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';

type AnyMovement = DischargeData | TransferData | CMAData;

/**
 * A local movement only accounts for an emptied bed when it concerns the SAME patient AND the
 * SAME bed. Discharges/transfers carry the vacated bed in `bedId`; CMA carries it in
 * `originalBedId`. Matching on name alone would let a same-name movement on another bed — or a
 * different patient who reused the bed — mask a real erasure, so bed identity is required.
 */
export const movementAccountsForBed = (
  movements: AnyMovement[],
  bedId: string,
  patientName: string
): boolean =>
  movements.some(m => {
    if (m.patientName.trim() !== patientName) return false;
    if ('bedId' in m) return m.bedId === bedId;
    if ('originalBedId' in m) return m.originalBedId === bedId;
    return false;
  });

const scalar = (value: unknown): string => String(value ?? '').trim();

const documentIdentity = (patient: PatientData): string =>
  scalar(patient.rut)
    .replace(/[.\s-]/g, '')
    .toUpperCase();

const patientNameIdentity = (patient: PatientData): string =>
  scalar(patient.patientName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();

/**
 * Persisted episode ids identify an admission, not just a person. Legacy ids are derived from
 * document/admission data and may collide for mother and newborn, so they need the tuple too.
 * Without two stable ids, accept hydration only with concordant person and admission evidence.
 */
const sameRelocatedEpisode = (left: PatientData, right: PatientData): boolean => {
  const leftEpisode = scalar(left.clinicalEpisodeId);
  const rightEpisode = scalar(right.clinicalEpisodeId);
  if (
    leftEpisode &&
    rightEpisode &&
    !leftEpisode.startsWith('legacy_ep_') &&
    !rightEpisode.startsWith('legacy_ep_')
  )
    return leftEpisode === rightEpisode;

  if (left.documentType && right.documentType && left.documentType !== right.documentType)
    return false;
  return (
    documentIdentity(left) === documentIdentity(right) &&
    patientNameIdentity(left) === patientNameIdentity(right) &&
    scalar(left.firstSeenDate || left.admissionDate) ===
      scalar(right.firstSeenDate || right.admissionDate) &&
    scalar(left.admissionTime) === scalar(right.admissionTime)
  );
};

/**
 * Include main occupants and nested cribs so a verified episode may move between either slot.
 */
const collectPatients = (record: DailyRecord): PatientData[] =>
  Object.values(record.beds || {})
    .flatMap(bed => [bed, bed?.clinicalCrib])
    .filter((patient): patient is PatientData => Boolean(scalar(patient?.patientName)));

/**
 * Returns the beds where the cloud copy holds a patient the incoming record dropped without a
 * movement accounting for it. Checks both the main bed occupant and the nested clinical-crib
 * occupant (cuna RN anidada).
 *
 * IMPORTANT: this is mirrored on the server in `functions/lib/dailyRecordErasureGuard.js`. Keep
 * the two in sync — `src/tests/functions/dailyRecordErasureGuardParity.test.ts` enforces it.
 * See `docs/SYNC_CONCURRENCY_MODEL.md`.
 */
export const findPatientErasures = (
  remote: DailyRecord,
  local: DailyRecord
): { bedId: string; remotePatientName: string }[] => {
  const allLocalMovements: AnyMovement[] = [
    ...(local.discharges || []),
    ...(local.transfers || []),
    ...(local.cma || []),
  ];

  const erasures: { bedId: string; remotePatientName: string }[] = [];
  const localPatients = collectPatients(local);
  const remotePatients = collectPatients(remote);
  const stillPresentLocally = (patient: PatientData | undefined): boolean => {
    if (!patient) return false;
    const matches = localPatients.filter(candidate => sameRelocatedEpisode(patient, candidate));
    // One surviving occupant must not account for two remote people with ambiguous legacy data.
    return (
      matches.length === 1 &&
      remotePatients.filter(candidate => sameRelocatedEpisode(candidate, matches[0])).length === 1
    );
  };

  for (const [bedId, remoteBed] of Object.entries(remote.beds || {})) {
    const localBed = (local.beds || {})[bedId];

    // 1. Main bed occupant. If the cloud has a patient the local copy dropped and no movement on
    //    THIS bed explains it, the local session never received the admission — block the save.
    //    Exception: the patient still occupies another bed here (an internal relocation carries no
    //    movement record), so the emptied bed is accounted for and it is NOT an erasure.
    const remotePatientName = remoteBed?.patientName?.trim();
    if (
      remotePatientName &&
      !localBed?.patientName?.trim() &&
      !movementAccountsForBed(allLocalMovements, bedId, remotePatientName) &&
      !stillPresentLocally(remoteBed)
    ) {
      erasures.push({ bedId, remotePatientName });
    }

    // 2. Nested RN-crib occupant (e.g. a newborn whose record is
    //    attached to the bed independently of the main occupant). It can be erased on its own. A
    //    crib discharge records the host bed in `bedId`, so the same patient+bed check applies and
    //    a discharge of the main occupant (different name) cannot mask an erased crib baby.
    const remoteCribName = remoteBed?.clinicalCrib?.patientName?.trim();
    if (
      remoteCribName &&
      !localBed?.clinicalCrib?.patientName?.trim() &&
      !movementAccountsForBed(allLocalMovements, bedId, remoteCribName) &&
      !stillPresentLocally(remoteBed?.clinicalCrib)
    ) {
      erasures.push({ bedId: `${bedId} (cuna RN)`, remotePatientName: remoteCribName });
    }
  }

  return erasures;
};
