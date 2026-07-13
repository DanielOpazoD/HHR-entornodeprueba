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

const normalizeRut = rut =>
  String(rut === null || rut === undefined ? '' : rut)
    .replace(/[^0-9kK]/g, '')
    .toUpperCase();

/**
 * Identity tokens for a patient, strongest first: RUT and clinical-episode id uniquely identify a
 * person across beds. Name is used ONLY when neither strong id exists — matching by name alone
 * would let a same-name coincidence mask a real erasure, so it is never used alongside a strong id.
 */
const identityTokens = patient => {
  if (!trimmedName(patient)) return [];
  const tokens = [];
  const rut = normalizeRut(patient && patient.rut);
  const episode = String(
    patient && patient.clinicalEpisodeId ? patient.clinicalEpisodeId : ''
  ).trim();
  if (rut) tokens.push(`rut:${rut}`);
  if (episode) tokens.push(`ep:${episode}`);
  if (!rut && !episode) tokens.push(`name:${trimmedName(patient)}`);
  return tokens;
};

/**
 * Every patient identity (main occupant + nested clinical crib) present ANYWHERE in the incoming
 * record. A bed a patient vacated is not an erasure when that same patient still occupies another
 * bed here — an internal bed move (relocation) leaves no discharge/transfer/CMA to account for the
 * emptied bed, so without this it would look like the patient was dropped and block the save.
 */
const collectLocalPatientIdentities = local => {
  const present = new Set();
  const beds = (local && local.beds) || {};
  for (const bed of Object.values(beds)) {
    for (const token of identityTokens(bed)) present.add(token);
    for (const token of identityTokens(bed && bed.clinicalCrib)) present.add(token);
  }
  return present;
};

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
  const localPatientIdentities = collectLocalPatientIdentities(local);
  const stillPresentLocally = patient =>
    identityTokens(patient).some(token => localPatientIdentities.has(token));

  for (const [bedId, remoteBed] of Object.entries(remoteBeds)) {
    const localBed = localBeds[bedId];

    // Main bed occupant. Exception: the patient still occupies another bed here (an internal
    // relocation carries no movement record), so the emptied bed is accounted for — not an erasure.
    const remotePatientName = trimmedName(remoteBed);
    if (
      remotePatientName &&
      !trimmedName(localBed) &&
      !movementAccountsForBed(movements, bedId, remotePatientName) &&
      !stillPresentLocally(remoteBed)
    ) {
      erasures.push({ bedId, remotePatientName });
    }

    // Nested clinical-crib occupant.
    const remoteCribName = trimmedName(remoteBed && remoteBed.clinicalCrib);
    if (
      remoteCribName &&
      !trimmedName(localBed && localBed.clinicalCrib) &&
      !movementAccountsForBed(movements, bedId, remoteCribName) &&
      !stillPresentLocally(remoteBed && remoteBed.clinicalCrib)
    ) {
      erasures.push({ bedId: `${bedId} (cuna clínica)`, remotePatientName: remoteCribName });
    }
  }

  return erasures;
};

module.exports = { findPatientErasures, movementAccountsForBed };
