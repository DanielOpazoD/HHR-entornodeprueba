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

const scalar = value => String(value ?? '').trim();

const documentIdentity = patient =>
  scalar(patient.rut)
    .replace(/[.\s-]/g, '')
    .toUpperCase();

const patientNameIdentity = patient =>
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
const sameRelocatedEpisode = (left, right) => {
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
const collectPatients = record =>
  Object.values(record.beds || {})
    .flatMap(bed => [bed, bed?.clinicalCrib])
    .filter(patient => Boolean(scalar(patient?.patientName)));

/**
 * Returns the beds where the cloud copy holds a patient the incoming record dropped without a
 * movement accounting for it. Checks both the main bed occupant and the nested clinical-crib
 * occupant (cuna RN anidada).
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
  const localPatients = collectPatients(local);
  const remotePatients = collectPatients(remote);
  const stillPresentLocally = patient => {
    if (!patient) return false;
    const matches = localPatients.filter(candidate => sameRelocatedEpisode(patient, candidate));
    // One surviving occupant must not account for two remote people with ambiguous legacy data.
    return (
      matches.length === 1 &&
      remotePatients.filter(candidate => sameRelocatedEpisode(candidate, matches[0])).length === 1
    );
  };

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
      erasures.push({ bedId: `${bedId} (cuna RN)`, remotePatientName: remoteCribName });
    }
  }

  return erasures;
};

module.exports = { findPatientErasures, movementAccountsForBed };
