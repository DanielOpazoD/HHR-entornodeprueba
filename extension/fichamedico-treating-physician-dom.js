/** Reads treating-physician assignments already rendered in Ficha Medico census rows. */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoTreatingPhysicianDom = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const text = value => (value == null ? '' : String(value).trim());
  const label = value =>
    text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const assignmentLabels = new Set(['asignacion', 'medico tratante']);

  const assignmentColumnIndex = table => {
    const header = [...table.querySelectorAll('th')].find(
      candidate => assignmentLabels.has(label(candidate.textContent))
    );
    return header ? header.cellIndex : -1;
  };

  const physicianFromCell = container => {
    if (!container) return undefined;
    const combobox = container.querySelector('[role="combobox"]');
    const input = container.querySelector('input[value]') || container.querySelector('input');
    const practitionerId = text(input && input.value);
    const displayName = text(combobox && combobox.textContent).replace(/\s+/g, ' ');
    if (practitionerId === '0') return null;
    return /^\d+$/.test(practitionerId) && displayName
      ? { practitionerId, displayName }
      : undefined;
  };

  const encounterIdFromRow = row => {
    const link = row && row.querySelector('a[href*="/dashboard/encounter-list/"]');
    const href = text(link && link.getAttribute('href'));
    const match = href.match(/\/dashboard\/encounter-list\/(\d+)(?:[/?#]|$)/);
    return match ? match[1] : '';
  };

  const rowsFromTable = table => {
    const columnIndex = assignmentColumnIndex(table);
    if (columnIndex < 0) return [];
    return [...table.querySelectorAll('tr')].map(row => ({
      encounterId: encounterIdFromRow(row),
      physician: physicianFromCell(row.cells && row.cells[columnIndex]),
    }));
  };

  const rowsFromDocument = root => {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    return [...root.querySelectorAll('table')].flatMap(rowsFromTable);
  };

  const assignedFromDocument = root =>
    rowsFromDocument(root).map(row => row.physician).filter(Boolean);

  const assignedByEncounterFromDocument = root =>
    Object.fromEntries(
      rowsFromDocument(root)
        .filter(row => row.encounterId && row.physician !== undefined)
        .map(row => [row.encounterId, row.physician])
    );
  return { assignedByEncounterFromDocument, assignedFromDocument };
});
