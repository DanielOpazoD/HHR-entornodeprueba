/** Select and code Rayen diagnoses without inferring clinical meaning from similar text. */
(function (root) {
  'use strict';

  const text = value => value == null ? '' : String(value).trim();
  const flag = value => value === true || value === 1 ||
    ['true', '1', 's', 'si', 'sí'].includes(text(value).toLowerCase());
  const classificationId = value => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const comparableName = value => text(value)
    .replace(/\s*\((?:ingreso|solicitud hospitalizaci[oó]n)\)/gi, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const active = row => row && !flag(row.archived) && !flag(row.deleted) &&
    text(row.status).toLowerCase() !== 'inactivo';
  const firstText = (...values) => values.map(text).find(Boolean) || '';
  const admissionClassificationId = (header, item, admissionName, listName) =>
    classificationId(header.haoDiagId) ||
    (admissionName && comparableName(admissionName) === comparableName(listName)
      ? classificationId(item.diagnosisId) : null);

  const selectPrincipalDiagnosis = (rows, header, listItem) => {
    // Encounter events are monotonic; response array order and the principal flag are not recency.
    const principal = (Array.isArray(rows) ? rows : [])
      .filter(row => active(row) && firstText(row.diagnosisName, row.name, row.description, row.freeTextDiagnosis))
      .sort((a, b) => (Number(b.encounterEventId) || Number(b.id) || 0) -
        (Number(a.encounterEventId) || Number(a.id) || 0))[0];
    const h = header || {};
    const item = listItem || {};
    const principalName = text(h.principalDiagName);
    const admissionName = text(h.haoDiagName);
    const listName = text(item.diagnosisName);
    const listId = classificationId(item.diagnosisId);
    const admissionId = admissionClassificationId(h, item, admissionName, listName);

    if (principal) return {
      name: firstText(principal.diagnosisName, principal.name, principal.description,
        principal.freeTextDiagnosis, principalName, admissionName, listName),
      code: text(principal.internalCode),
      classificationId: classificationId(principal.diagnosisClassifyId),
      source: 'principal-entry',
    };
    if (principalName) return {
      name: principalName,
      code: '',
      classificationId: classificationId(h.principalDiagId),
      source: 'principal-header',
    };
    return {
      name: admissionName || listName,
      code: '',
      classificationId: admissionName ? admissionId : listId,
      source: 'admission',
    };
  };

  const PERSISTED_CATALOG_VERSION = 1;
  const MAX_PERSISTED_ENTRIES = 50000;
  const MAX_TTL_DRIFT_MS = 60 * 1000;

  const cie10Code = value => {
    const code = text(value).toUpperCase();
    return /^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?$/.test(code) ? code : '';
  };
  const indexDiagnosisCatalog = rows => {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Eloísa no entregó el catálogo de diagnósticos.');
    }
    const codes = new Map();
    for (const row of rows) {
      const id = classificationId(row && row.id);
      const code = cie10Code(row && row.internalCode) || cie10Code(row && row.standarCode);
      if (id && code) codes.set(id, code);
    }
    return codes;
  };

  const serializeDiagnosisCatalog = (codes, origin, now, ttlMs) => {
    if (!(codes instanceof Map) || !codes.size || typeof origin !== 'string' ||
        !origin.startsWith('https://') || !Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      return null;
    }
    const entries = [];
    for (const [rawId, rawCode] of codes) {
      const id = classificationId(rawId);
      const code = cie10Code(rawCode);
      if (!id || !code) continue;
      entries.push([id, code]);
      if (entries.length >= MAX_PERSISTED_ENTRIES) break;
    }
    return entries.length
      ? { version: PERSISTED_CATALOG_VERSION, origin, savedAt: now, expiresAt: now + ttlMs, entries }
      : null;
  };

  const hasValidPersistedEnvelope = (raw, expectedOrigin, now, ttlMs) => Boolean(
    raw && typeof raw === 'object' && raw.version === PERSISTED_CATALOG_VERSION &&
    typeof raw.origin === 'string' && raw.origin === expectedOrigin &&
    Number.isFinite(raw.savedAt) && Number.isFinite(raw.expiresAt) &&
    raw.expiresAt > now && raw.savedAt <= now + MAX_TTL_DRIFT_MS &&
    raw.expiresAt - raw.savedAt <= ttlMs + MAX_TTL_DRIFT_MS &&
    Array.isArray(raw.entries) && raw.entries.length > 0 && raw.entries.length <= MAX_PERSISTED_ENTRIES
  );

  const parsePersistedDiagnosisCatalog = (raw, expectedOrigin, now, ttlMs) => {
    if (!hasValidPersistedEnvelope(raw, expectedOrigin, now, ttlMs)) return null;
    const codes = new Map();
    for (const entry of raw.entries) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const id = classificationId(entry[0]);
      const code = cie10Code(entry[1]);
      if (!id || !code) return null;
      codes.set(id, code);
    }
    return codes.size ? { codes, savedAt: raw.savedAt, expiresAt: raw.expiresAt } : null;
  };

  const unwrapCatalog = value => (value instanceof Map ? { codes: value, fromPersisted: false } : value);

  const createEnricher = (readCatalog, refreshCatalog) => {
    const pending = [];
    let catalogPromise = null;
    const catalog = () => {
      if (!catalogPromise) catalogPromise = Promise.resolve().then(readCatalog).catch(() => null);
      return catalogPromise;
    };
    const maybeRefresh = async loaded => {
      let codes = loaded && loaded.codes instanceof Map ? loaded.codes : null;
      if (!codes || !loaded.fromPersisted || typeof refreshCatalog !== 'function') return codes;
      if (!pending.some(({ diagnosis }) => !codes.has(diagnosis.classificationId))) return codes;
      const refreshed = await Promise.resolve().then(refreshCatalog).catch(() => null);
      return refreshed instanceof Map && refreshed.size > 0 ? refreshed : codes;
    };
    return {
      queue(index, diagnosis) {
        if (diagnosis.code || !diagnosis.classificationId) return;
        pending.push({ index, diagnosis });
        void catalog();
      },
      async apply(encounters) {
        if (!pending.length) return;
        const codes = await maybeRefresh(unwrapCatalog(await catalog()));
        if (!codes) return;
        for (const { index, diagnosis } of pending) {
          const code = codes.get(diagnosis.classificationId);
          if (!code || !encounters[index]) continue;
          encounters[index].diagnosisCode = code;
          encounters[index].diagnosisDescription = diagnosis.name;
        }
      },
    };
  };

  root.HhrFichaMedicoDiagnosisCoding = Object.freeze({
    selectPrincipalDiagnosis, indexDiagnosisCatalog, serializeDiagnosisCatalog,
    parsePersistedDiagnosisCatalog, createEnricher,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
