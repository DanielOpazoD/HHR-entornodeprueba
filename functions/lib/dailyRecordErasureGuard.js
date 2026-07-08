'use strict';

/**
 * Server-side mirror of the client `findPatientErasures` guard
 * (src/services/repositories/dailyRecordRemoteWriteController.ts). Pure and framework-free so it
 * can be unit-tested without firebase. See docs/SYNC_CONCURRENCY_MODEL.md.
 *
 * A movement only accounts for an emptied bed when it concerns the SAME patient AND the SAME bed
 * (`bedId` for discharges/transfers, `originalBedId` for CMA). Matching on name alone would let a
 * same-name movement on another bed — or a different patient who reused the bed — mask a real
 * erasure, so bed identity is required.
 */
const movementAccountsForBed = (movements, bedId, patientName) =>
  movements.some(movement => {
    if (
      String(movement && movement.patientName ? movement.patientName : '').trim() !== patientName
    ) {
      return false;
    }
    if (typeof (movement && movement.bedId) === 'string') {
      return movement.bedId === bedId;
    }
    if (typeof (movement && movement.originalBedId) === 'string') {
      return movement.originalBedId === bedId;
    }
    return false;
  });

const trimmedName = patient =>
  String(patient && patient.patientName ? patient.patientName : '').trim();

/**
 * Returns the beds where the cloud copy holds a patient the incoming record dropped without a
 * movement accounting for it. Checks both the main bed occupant and the nested clinical-crib
 * occupant ("cuna clínica").
 *
 * @param {Record<string, unknown>} remote The current remote record (e.g. snapshot.data()).
 * @param {Record<string, unknown>} local The incoming record about to be written.
 * @returns {{ bedId: string, remotePatientName: string }[]}
 */
const findPatientErasures = (remote, local) => {
  const movements = [
    ...((local && local.discharges) || []),
    ...((local && local.transfers) || []),
    ...((local && local.cma) || []),
  ];

  const remoteBeds = (remote && remote.beds) || {};
  const localBeds = (local && local.beds) || {};
  const erasures = [];

  for (const [bedId, remoteBed] of Object.entries(remoteBeds)) {
    const localBed = localBeds[bedId];

    // Main bed occupant.
    const remotePatientName = trimmedName(remoteBed);
    if (
      remotePatientName &&
      !trimmedName(localBed) &&
      !movementAccountsForBed(movements, bedId, remotePatientName)
    ) {
      erasures.push({ bedId, remotePatientName });
    }

    // Nested clinical-crib occupant.
    const remoteCribName = trimmedName(remoteBed && remoteBed.clinicalCrib);
    if (
      remoteCribName &&
      !trimmedName(localBed && localBed.clinicalCrib) &&
      !movementAccountsForBed(movements, bedId, remoteCribName)
    ) {
      erasures.push({ bedId: `${bedId} (cuna clínica)`, remotePatientName: remoteCribName });
    }
  }

  return erasures;
};

module.exports = { findPatientErasures, movementAccountsForBed };
