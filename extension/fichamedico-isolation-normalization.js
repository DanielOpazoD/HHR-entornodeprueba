/** Pure isolation fields normalization for Ficha Medico census rows. */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoIsolationNormalization = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const text = value => (value == null ? '' : String(value).trim()).replace(/\s+/g, ' ');
  const record = value => value && typeof value === 'object' ? value : {};
  const isolationState = value => {
    const item = record(value);
    const rows = [item.activeIsolation, item.isolation]
      .concat(Array.isArray(item.isolations) ? item.isolations : [])
      .concat(Array.isArray(item.isolationEntries) ? item.isolationEntries : [])
      .filter(Boolean)
      .map(record);
    return { active: rows.find(row => !row.endIsolationDatetime && !row.deletedDatetime), rows };
  };
  const isolationTypeOf = isolation => {
    const type = record(isolation.isolationType);
    return text([
      isolation.isoTypeName, isolation.isolationTypeName, isolation.isolationName,
      typeof isolation.isolationType === 'string' && isolation.isolationType,
      isolation.isolationDescription, type.name, type.description,
    ].find(Boolean));
  };
  const microorganismOf = isolation => text([
    isolation.microName, isolation.microorganismName, isolation.microorganismDescription,
  ].find(Boolean));
  const toEncounterFields = value => {
    const item = record(value);
    const { active, rows } = isolationState(item);
    const explicitlyInactive = item.isIsolated === false;
    const historicalOnly = rows.length > 0 && !active;
    if (explicitlyInactive || historicalOnly) return { isIsolated: false };
    const isolation = active || item;
    const isolationType = isolationTypeOf(isolation);
    const isolationMicroorganism = microorganismOf(isolation);
    return {
      isIsolated: [item.isIsolated, active, isolationType, isolationMicroorganism].some(Boolean),
      isolationType: isolationType || undefined,
      isolationMicroorganism: isolationMicroorganism || undefined,
    };
  };
  return { toEncounterFields };
});
