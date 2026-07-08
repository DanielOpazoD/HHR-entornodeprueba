import type { DailyRecord } from '@/types/domain/dailyRecord';
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

  for (const [bedId, remoteBed] of Object.entries(remote.beds || {})) {
    const localBed = (local.beds || {})[bedId];

    // 1. Main bed occupant. If the cloud has a patient the local copy dropped and no movement on
    //    THIS bed explains it, the local session never received the admission — block the save.
    const remotePatientName = remoteBed?.patientName?.trim();
    if (
      remotePatientName &&
      !localBed?.patientName?.trim() &&
      !movementAccountsForBed(allLocalMovements, bedId, remotePatientName)
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
      !movementAccountsForBed(allLocalMovements, bedId, remoteCribName)
    ) {
      erasures.push({ bedId: `${bedId} (cuna clínica)`, remotePatientName: remoteCribName });
    }
  }

  return erasures;
};
