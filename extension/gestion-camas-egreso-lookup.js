/** Pure selection policy for Gestión de Camas discharge lookups. */
(function (root, factory) {
  'use strict';
  root.HhrGestionCamasEgresoLookup = factory(root.HhrClinicalDayRuntime);
})(typeof self !== 'undefined' ? self : globalThis, function (clinicalDayRuntime) {
  'use strict';
  const METADATA_FIELDS = Object.freeze([
    'id', 'encounterId', 'endPeriod', 'dateDischarge', 'isDead',
    'hasMedicalDischarge', 'hasNurseDischarge', 'hasNursingDischarge',
    'hasAdministrativeDischarge', 'dischargeDestination', 'dischargeDestinationName',
    'destinationSystemName', 'dischargeReasonName', 'dischargeTypeName',
    'bedDestination', 'destinationBed',
  ]);
  const normalizeTargets = (runs, targets) => {
    const source = Array.isArray(targets) && targets.length ? targets : runs;
    return (Array.isArray(source) ? source : [])
      .map(value => {
        const target = value && typeof value === 'object' ? value : { run: value };
        return {
          run: String(target.run || '').replace(/[^0-9kK]/g, ''),
          encounterId: String(target.encounterId || '').trim(),
          ...(target.dischargeDay ? { dischargeDay: String(target.dischargeDay).trim() } : {}),
        };
      })
      .filter(target => target.run);
  };
  const dischargeDayOf = value => {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw))
      return clinicalDayRuntime?.calendarDayAt(new Date(raw)) || '';
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
    if (iso) return iso[1];
    const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(raw);
    return dmy
      ? `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`
      : '';
  };
  const encounterIdOf = (item, fallback) => item
    ? String(item.id ?? item.encounterId ?? '').trim()
    : fallback;
  const selectEncounter = (payload, encounterId, dischargeDay) => {
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    if (!encounterId) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dischargeDay || '')) return null;
      const matches = rows.filter(row =>
        dischargeDayOf(row && (row.dateDischarge ?? row.endPeriod)) === dischargeDay
      );
      return matches.length === 1 ? matches[0] : null;
    }
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
      if (field !== undefined && field !== null &&
          typeof field !== 'object' && typeof field !== 'function') result[key] = field;
    }
    return result;
  };
  return Object.freeze({ encounterIdOf, normalizeTargets, pickMetadata, selectEncounter });
});
