'use strict';
(function initGestionCamasActiveBeds(root) {
  const PHYSICAL_BEDS = new Set([
    'R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2',
    'H1C1', 'H1C2', 'H2C1', 'H2C2', 'H3C1', 'H3C2',
    'H4C1', 'H4C2', 'H5C1', 'H5C2', 'H6C1', 'H6C2',
  ]);
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const bedIdFromLabel = value => {
    const normalized = normalize(value).replace(/^CMA/, '').replace(/^CAMA/, '');
    if (PHYSICAL_BEDS.has(normalized)) return normalized;
    const neo = /^N(?:EO)?([12])$/.exec(normalized);
    if (neo) return `NEO${neo[1]}`;
    const recovery = /^(?:RECUPERACION)?R?([1-4])$/.exec(normalized);
    return recovery ? `R${recovery[1]}` : null;
  };

  const buildAssignments = (payload, isClinicalCrib) => (Array.isArray(payload) ? payload : [])
    .filter(record => !isClinicalCrib(record))
    .map(record => ({
      encounterId: String(record && record.encounterId || '').trim(),
      bedId: bedIdFromLabel(record && record.shortName) || bedIdFromLabel(record && record.name),
    }))
    .filter(item => /^\d+$/.test(item.encounterId) && item.encounterId !== '0' && item.bedId);

  const fetchEvidence = async (
    gestionCamasRuntime,
    fetchWithTimeout,
    buildCribAssignments,
    isClinicalCrib
  ) => {
    try {
      const session = await gestionCamasRuntime.resolveSession();
      if (!session.record) return { cribAssignments: [], activeBedAssignments: [] };
      const record = session.record;
      const response = await fetchWithTimeout(
        `${record.apiBase}/facility/${encodeURIComponent(record.facId)}/beds`,
        {
          headers: { Authorization: record.token, Accept: 'application/json' },
          cache: 'no-store',
        }
      );
      if (!response.ok) {
        await gestionCamasRuntime.classifyRejection(response, record);
        return { cribAssignments: [], activeBedAssignments: [] };
      }
      const payload = await response.json();
      const verified = await gestionCamasRuntime.markSessionVerified(record);
      return verified
        ? {
            cribAssignments: buildCribAssignments(payload),
            activeBedAssignments: buildAssignments(payload, isClinicalCrib),
          }
        : { cribAssignments: [], activeBedAssignments: [] };
    } catch (_error) {
      return { cribAssignments: [], activeBedAssignments: [] };
    }
  };

  root.HhrGestionCamasActiveBeds = Object.freeze({ bedIdFromLabel, buildAssignments, fetchEvidence });
})(typeof self !== 'undefined' ? self : globalThis);
