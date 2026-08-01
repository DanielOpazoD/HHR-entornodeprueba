/** Resilient treating-physician sources for the MAIN-world Ficha Medico reader. */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoTreatingPhysicianSources = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const text = value => (value == null ? '' : String(value).trim());
  const record = value => (value && typeof value === 'object' ? value : {});
  const label = value =>
    text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const flag = value =>
    value === true ||
    value === 1 ||
    ['true', '1', 's', 'si', 'sí'].includes(text(value).toLowerCase());

  const rowsFromResponse = value => {
    if (Array.isArray(value)) return value;
    const response = record(value);
    for (const key of ['data', 'items', 'content', 'result']) {
      if (Array.isArray(response[key])) return response[key];
    }
    return [];
  };

  const isActive = row =>
    !flag(row.deleted) && row.active !== false && text(row.status).toLowerCase() !== 'inactivo';

  const displayNameOf = (row, practitioner) =>
    (text(
      row.displayName ||
        row.fullName ||
        row.healthCarePractitionerName ||
        practitioner.displayName ||
        practitioner.fullName
    ) ||
      [
        row.firstGivenName || practitioner.firstGivenName,
        row.nextGivenNames || practitioner.nextGivenNames,
        row.firstFamilyName || practitioner.firstFamilyName,
        row.secondFamilyName || practitioner.secondFamilyName,
      ]
        .map(text)
        .filter(Boolean)
        .join(' '))
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeRow = raw => {
    const row = record(raw);
    if (!isActive(row)) return null;
    const practitioner = record(row.healthCarePractitioner);
    const practitionerId = text(
      row.practitionerId || practitioner.id || row.healthCarePractitionerId || row.id
    );
    const displayName = displayNameOf(row, practitioner);
    return practitionerId && displayName ? { practitionerId, displayName } : null;
  };

  const normalize = value => {
    const unique = new Map();
    for (const raw of rowsFromResponse(value)) {
      const physician = normalizeRow(raw);
      if (physician && !unique.has(physician.practitionerId)) {
        unique.set(physician.practitionerId, physician);
      }
    }
    return [...unique.values()];
  };

  const merge = (...sources) => {
    const unique = new Map();
    for (const source of sources) {
      for (const physician of normalize(source)) {
        if (!unique.has(physician.practitionerId)) {
          unique.set(physician.practitionerId, physician);
        }
      }
    }
    return [...unique.values()];
  };

  const assignmentColumnIndex = table => {
    const header = [...table.querySelectorAll('th')].find(
      candidate => label(candidate.textContent) === 'asignacion'
    );
    return header ? header.cellIndex : -1;
  };

  const physicianFromCell = container => {
    if (!container) return null;
    const combobox = container.querySelector('[role="combobox"]');
    const input = container.querySelector('input[value]');
    const practitionerId = text(input && input.value);
    const displayName = text(combobox && combobox.textContent).replace(/\s+/g, ' ');
    return /^\d+$/.test(practitionerId) && practitionerId !== '0' && displayName
      ? { practitionerId, displayName }
      : null;
  };

  const assignedFromTable = table => {
    const columnIndex = assignmentColumnIndex(table);
    if (columnIndex < 0) return [];
    const rows = [];
    for (const row of table.querySelectorAll('tr')) {
      const physician = physicianFromCell(row.cells && row.cells[columnIndex]);
      if (physician) rows.push(physician);
    }
    return rows;
  };

  /** Reads id + name pairs already rendered by Ficha Medico in the current census rows. */
  const assignedFromDocument = root => {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    return merge(...[...root.querySelectorAll('table')].map(assignedFromTable));
  };

  const catalogUrl = (apiOrigin, facilityId) => {
    const url = new URL('/api/core/healthCarePractitioner/healthCarePractitionerRole', apiOrigin);
    url.searchParams.set('facilityId', facilityId);
    url.searchParams.set('healthCarePratitionerRole', '1');
    url.searchParams.set('tid', '0');
    return url.toString();
  };

  const capture = async ({ apiGet, apiOrigin, facilityId, auth, assignedPhysicians }) => {
    const rows = await apiGet(catalogUrl(apiOrigin, facilityId), auth).catch(() => []);
    // The visible assignment is stronger evidence than a potentially stale facility catalog.
    const physicians = merge(assignedPhysicians, rows);
    return {
      physicians,
      physicianById: Object.fromEntries(
        physicians.map(physician => [physician.practitionerId, physician])
      ),
    };
  };

  const captureFromDocument = async options =>
    capture({ ...options, assignedPhysicians: assignedFromDocument(options.root) });

  return { assignedFromDocument, capture, captureFromDocument, merge, normalize };
});
