/** Treating-physician catalog helpers for the MAIN-world Ficha Medico reader. */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoTreatingPhysicianNormalization = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const sources = globalThis.HhrFichaMedicoTreatingPhysicianSources;
  const text = value => (value == null ? '' : String(value).trim());
  const record = value => (value && typeof value === 'object' ? value : {});

  const toEncounterFields = (item, physicianById, physicianByEncounterId) => {
    const safeItem = record(item);
    const renderedAssignments = record(physicianByEncounterId);
    const encounterId = text(safeItem.id);
    const encounterWasRendered = Object.prototype.hasOwnProperty.call(
      renderedAssignments,
      encounterId
    );
    const renderedAssignment = record(renderedAssignments[encounterId]);
    // The rendered row is tied to the encounter id and reflects the current visible assignment.
    // Older list responses may omit this id even though Eloísa renders it in the census table.
    const treatingPhysicianId = encounterWasRendered
      ? text(renderedAssignment.practitionerId)
      : text(safeItem.healthCarePractitionerAssignedId);
    const treatingPhysician = record(record(physicianById)[treatingPhysicianId]);
    return {
      treatingPhysicianId: treatingPhysicianId || undefined,
      treatingPhysicianName: treatingPhysicianId
        ? text(renderedAssignment.displayName) ||
          text(treatingPhysician.displayName) ||
          text(safeItem.healthCarePractitionerAssignedName) ||
          undefined
        : undefined,
    };
  };

  return { ...sources, toEncounterFields };
});
