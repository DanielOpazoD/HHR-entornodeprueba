/**
 * Pure mapping for the physical cribs exposed by Eloisa Gestion de Camas.
 *
 * The backend models them as independent beds (for example CH5C1 or C-R2),
 * while HHR models the newborn as `clinicalCrib` nested under the associated
 * principal bed. Only the installed HHR inventory is accepted here.
 */
(function (root) {
  'use strict';
  const PARENT_BEDS = new Set([
    'R1', 'R2', 'R3', 'R4',
    'H4C1', 'H4C2', 'H5C1', 'H5C2', 'H6C1', 'H6C2',
    'NEO1', 'NEO2',
  ]);
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const parentBedIdFromLabel = value => {
    const match = /^(?:CUNA|C)(H[456]C[12]|R[1-4]|NEO[12])$/.exec(normalize(value));
    if (match && PARENT_BEDS.has(match[1])) return match[1];
    return null;
  };
  const parentBedIdFromRecord = record => {
    if (!record || typeof record !== 'object') return null;
    return parentBedIdFromLabel(record.shortName) || parentBedIdFromLabel(record.name);
  };

  const buildAssignments = payload => (Array.isArray(payload) ? payload : [])
    .map(record => ({
      encounterId: String(record && record.encounterId || '').trim(),
      parentBedId: parentBedIdFromRecord(record),
      cribBedId: String(record && (record.shortName || record.name) || '').trim(),
    }))
    .filter(item => /^\d+$/.test(item.encounterId) && item.encounterId !== '0' && item.parentBedId);

  const buildActiveBedAssignments = payload => root.HhrGestionCamasActiveBeds.buildAssignments(
    payload,
    record => Boolean(parentBedIdFromRecord(record))
  );

  const enrichSnapshot = (snapshot, assignments) => {
    if (!snapshot || !Array.isArray(snapshot.encounters)) return snapshot;
    const assignmentByEncounter = new Map(
      (Array.isArray(assignments) ? assignments : [])
        .map(item => [String(item.encounterId || ''), item])
        .filter(([encounterId, item]) => /^\d+$/.test(encounterId) && PARENT_BEDS.has(item.parentBedId))
    );
    if (assignmentByEncounter.size === 0) return snapshot;
    return {
      ...snapshot,
      encounters: snapshot.encounters.map(encounter => {
        const assignment = assignmentByEncounter.get(String(encounter && encounter.encounterId || ''));
        const snapshotParent = parentBedIdFromLabel(encounter && encounter.bed) ||
          parentBedIdFromLabel(encounter && encounter.room);
        return assignment && snapshotParent === assignment.parentBedId
          ? { ...encounter, clinicalCribParentBedId: assignment.parentBedId }
          : encounter;
      }),
    };
  };

  const enrichSnapshotRequest = async (
    snapshotRequest,
    gestionCamasRuntime,
    fetchWithTimeout
  ) => {
    const response = await snapshotRequest;
    if (!response || !response.snapshot) return response;
    const evidence = await root.HhrGestionCamasActiveBeds.fetchEvidence(
      gestionCamasRuntime,
      fetchWithTimeout,
      buildAssignments,
      record => Boolean(parentBedIdFromRecord(record))
    );
    const enriched = enrichSnapshot(response.snapshot, evidence.cribAssignments);
    return {
      ...response,
      snapshot: evidence.activeBedAssignments.length > 0
        ? { ...enriched, activeBedAssignments: evidence.activeBedAssignments }
        : enriched,
    };
  };

  root.HhrGestionCamasClinicalCribs = Object.freeze({
    parentBedIdFromLabel,
    parentBedIdFromRecord,
    buildAssignments,
    buildActiveBedAssignments,
    enrichSnapshot,
    enrichSnapshotRequest,
  });
})(typeof self !== 'undefined' ? self : globalThis);
