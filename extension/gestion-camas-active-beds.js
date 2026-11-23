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

  const bedsSessionKey = record => {
    if (!record || typeof record !== 'object') return '';
    return JSON.stringify([
      String(record.apiBase || ''),
      String(record.facId || ''),
      String(record.token || ''),
      Number(record.sourceTabId),
      String(record.connectionAttemptId || ''),
      String(record.verificationEpoch || ''),
    ]);
  };

  /** Single-use short-lived handoff so snapshot enrichment and CUDYR capture share one fresh /beds read. */
  const createRecentBedsSlot = ({ ttlMs = 10_000, now = () => Date.now() } = {}) => {
    let slot = null;
    const store = (record, payload) => {
      const key = bedsSessionKey(record);
      if (!key || !Array.isArray(payload)) return;
      slot = { key, capturedAt: now(), payload };
    };
    const consume = record => {
      if (!slot) return null;
      const current = slot;
      const age = now() - current.capturedAt;
      if (age < 0 || age > ttlMs) {
        slot = null;
        return null;
      }
      if (current.key !== bedsSessionKey(record)) return null;
      slot = null;
      return current.payload;
    };
    const clear = () => {
      slot = null;
    };
    return Object.freeze({ store, consume, clear });
  };

  const fetchEvidence = async (
    gestionCamasRuntime,
    fetchWithTimeout,
    buildCribAssignments,
    isClinicalCrib,
    onBedsCaptured
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
      if (verified && Array.isArray(payload) && typeof onBedsCaptured === 'function') {
        onBedsCaptured(record, payload);
      }
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

  root.HhrGestionCamasActiveBeds = Object.freeze({
    bedIdFromLabel,
    buildAssignments,
    createRecentBedsSlot,
    fetchEvidence,
  });
})(typeof self !== 'undefined' ? self : globalThis);
