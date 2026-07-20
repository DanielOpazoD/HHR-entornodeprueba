/** Pure selection policy for Gestión de Camas discharge lookups. */
(function (root, factory) {
  'use strict';
  root.HhrGestionCamasEgresoLookup = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const METADATA_FIELDS = Object.freeze([
    'id',
    'encounterId',
    'endPeriod',
    'dateDischarge',
    'isDead',
    'hasMedicalDischarge',
    'hasNurseDischarge',
    'hasNursingDischarge',
    'hasAdministrativeDischarge',
    'dischargeDestination',
    'dischargeDestinationName',
    'destinationSystemName',
    'dischargeReasonName',
    'dischargeTypeName',
    'bedDestination',
    'destinationBed',
  ]);
  const normalizeTargets = (runs, targets) => {
    const source = Array.isArray(targets) && targets.length ? targets : runs;
    return (Array.isArray(source) ? source : [])
      .map(value => {
        const target = value && typeof value === 'object' ? value : { run: value };
        return {
          run: String(target.run || '').replace(/[^0-9kK]/g, ''),
          encounterId: String(target.encounterId || '').trim(),
        };
      })
      .filter(target => target.run);
  };

  const selectEncounter = (payload, encounterId) => {
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    if (!encounterId) return rows[0] || null;
    return (
      rows.find(
        row => String((row && (row.id ?? row.encounterId)) || '') === encounterId
      ) || null
    );
  };

  const pickMetadata = value => {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    for (const key of METADATA_FIELDS) {
      const field = value[key];
      if (
        field !== undefined &&
        field !== null &&
        typeof field !== 'object' &&
        typeof field !== 'function'
      ) {
        result[key] = field;
      }
    }
    return result;
  };

  return Object.freeze({ normalizeTargets, pickMetadata, selectEncounter });
});
