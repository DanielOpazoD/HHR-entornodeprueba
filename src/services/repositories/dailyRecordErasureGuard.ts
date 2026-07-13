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

const normalizeRut = (rut: unknown): string =>
  String(rut ?? '')
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();

/**
 * Identity tokens for a patient, strongest first: RUT and clinical-episode id uniquely identify a
 * person across beds. Name is used ONLY when neither strong id exists (e.g. a manually-added
 * patient) — matching by name alone would let a same-name coincidence mask a real erasure, so it is
 * never used when a strong id is available.
 */
const identityTokens = (patient: PatientData | undefined): string[] => {
  if (!patient?.patientName?.trim()) return [];
  const tokens: string[] = [];
  const rut = normalizeRut(patient.rut);
  const episode = String(patient.clinicalEpisodeId ?? '').trim();
  if (rut) tokens.push(`rut:${rut}`);
  if (episode) tokens.push(`ep:${episode}`);
  if (!rut && !episode) tokens.push(`name:${patient.patientName.trim()}`);
  return tokens;
};

/**
 * Every patient identity (main occupant + nested clinical crib) present ANYWHERE in the incoming
 * record. A bed a patient vacated is not an erasure when that same patient still occupies another
 * bed here — an internal bed move (relocation) leaves NO discharge/transfer/CMA to account for the
 * emptied bed, so without this it would look like the patient was dropped and block the save.
 */
const collectLocalPatientIdentities = (local: DailyRecord): Set<string> => {
  const present = new Set<string>();
  for (const bed of Object.values(local.beds || {})) {
    for (const token of identityTokens(bed)) present.add(token);
    for (const token of identityTokens(bed?.clinicalCrib)) present.add(token);
  }
  return present;
};

/**
 * Returns the beds where the cloud copy holds a patient the incoming record dropped without a
 * movement accounting for it. Checks both the main bed occupant and the nested clinical-crib
 * occupant ("cuna clínica").
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
  const localPatientIdentities = collectLocalPatientIdentities(local);
  const stillPresentLocally = (patient: PatientData | undefined): boolean =>
    identityTokens(patient).some(token => localPatientIdentities.has(token));

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

    // 2. Nested clinical-crib occupant ("cuna clínica" — e.g. a sick newborn whose record is
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
      erasures.push({ bedId: `${bedId} (cuna clínica)`, remotePatientName: remoteCribName });
    }
  }

  return erasures;
};
