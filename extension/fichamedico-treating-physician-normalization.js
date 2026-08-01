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

  const toEncounterFields = (item, physicianById) => {
    const safeItem = record(item);
    const treatingPhysicianId = text(safeItem.healthCarePractitionerAssignedId);
    const treatingPhysician = record(record(physicianById)[treatingPhysicianId]);
    return {
      treatingPhysicianId: treatingPhysicianId || undefined,
      treatingPhysicianName: treatingPhysicianId
        ? text(treatingPhysician.displayName) ||
          text(safeItem.healthCarePractitionerAssignedName) ||
          undefined
        : undefined,
    };
  };

  return { ...sources, toEncounterFields };
});
