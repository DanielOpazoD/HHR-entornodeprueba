/** Treating-physician catalog helpers for the MAIN-world Ficha Medico reader. */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoTreatingPhysicianNormalization = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const text = value => (value == null ? '' : String(value).trim());
  const record = value => (value && typeof value === 'object' ? value : {});
  const flag = value =>
    value === true ||
    value === 1 ||
    ['true', '1', 's', 'si', 'sí'].includes(text(value).toLowerCase());

  const normalize = rows => {
    const unique = new Map();
    (Array.isArray(rows) ? rows : []).forEach(raw => {
      const row = record(raw);
      if (
        flag(row.deleted) ||
        row.active === false ||
        text(row.status).toLowerCase() === 'inactivo'
      ) {
        return;
      }
      const practitionerId = text(row.id || row.healthCarePractitionerId);
      const displayName = [
        row.firstGivenName,
        row.nextGivenNames,
        row.firstFamilyName,
        row.secondFamilyName,
      ]
        .map(text)
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (practitionerId && displayName && !unique.has(practitionerId)) {
        unique.set(practitionerId, { practitionerId, displayName });
      }
    });
    return [...unique.values()];
  };

  const catalogUrl = (apiOrigin, facilityId) => {
    const url = new URL('/api/core/healthCarePractitioner/healthCarePractitionerRole', apiOrigin);
    url.searchParams.set('facilityId', facilityId);
    url.searchParams.set('healthCarePratitionerRole', '1');
    url.searchParams.set('tid', '0');
    return url.toString();
  };

  const capture = async ({ apiGet, apiOrigin, facilityId, auth }) => {
    const rows = await apiGet(catalogUrl(apiOrigin, facilityId), auth).catch(() => []);
    const physicians = normalize(rows);
    return {
      physicians,
      physicianById: Object.fromEntries(
        physicians.map(physician => [physician.practitionerId, physician])
      ),
    };
  };

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

  return { capture, normalize, toEncounterFields };
});
