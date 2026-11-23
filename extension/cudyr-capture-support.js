/** Captured CUDYR source versions and optional metadata; no clinical writes. */
(function (root) {
  'use strict';
  const KNOWN_CUDYR_FORM_IDS = new Set([1, 2]);
  const CUDYR_CATEGORY_PATTERN = /^[A-D][1-3]$/i;
  const DEFAULT_DEFINITIONS_TTL_MS = 30 * 60 * 1000;
  const DEFAULT_PRACTITIONERS_TTL_MS = 5 * 60 * 1000;

  const compareIdDesc = (leftRaw, rightRaw) => {
    const left = String(leftRaw == null ? '' : leftRaw).trim();
    const right = String(rightRaw == null ? '' : rightRaw).trim();
    if (left === right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const normLeft = left.replace(/^0+/, '') || '0';
      const normRight = right.replace(/^0+/, '') || '0';
      if (normLeft.length !== normRight.length) return normRight.length - normLeft.length;
      if (normLeft !== normRight) return normRight > normLeft ? 1 : -1;
    }
    return right > left ? 1 : -1;
  };

  const compareStringsAsc = (leftRaw, rightRaw) => {
    const left = String(leftRaw == null ? '' : leftRaw);
    const right = String(rightRaw == null ? '' : rightRaw);
    return left === right ? 0 : left < right ? -1 : 1;
  };

  const compareNullableDesc = (leftRaw, rightRaw) => {
    const left = typeof leftRaw === 'number' && Number.isFinite(leftRaw) ? leftRaw : -Infinity;
    const right = typeof rightRaw === 'number' && Number.isFinite(rightRaw) ? rightRaw : -Infinity;
    return left === right ? 0 : right > left ? 1 : -1;
  };

  const compareCudyrEntries = (a, b) =>
    Date.parse(b.recordedAt) - Date.parse(a.recordedAt) ||
    compareIdDesc(a.id, b.id) ||
    compareStringsAsc(a.recordedAt, b.recordedAt) ||
    compareStringsAsc(a.category, b.category) ||
    compareStringsAsc(a.author, b.author) ||
    compareNullableDesc(a.dependencyScore, b.dependencyScore) ||
    compareNullableDesc(a.riskScore, b.riskScore);

  const readMetadata = async (result, label, warnings) => {
    if (result.status === 'rejected') {
      warnings.push(`No se pudo consultar ${label}; el historial se conserva sin esos metadatos.`);
      return [];
    }
    if (!result.value.ok) {
      warnings.push(
        `Gestión de Camas respondió HTTP ${result.value.status} al consultar ${label}; ` +
        'el historial se conserva sin esos metadatos.'
      );
      return [];
    }
    try {
      const rows = await result.value.json();
      if (!Array.isArray(rows)) throw new Error('Invalid metadata response');
      return rows;
    } catch (_error) {
      warnings.push(`Gestión de Camas entregó ${label} inválidos; el historial se conserva sin esos metadatos.`);
      return [];
    }
  };

  const createMetadataCache = ({
    definitionsTtlMs = DEFAULT_DEFINITIONS_TTL_MS,
    practitionersTtlMs = DEFAULT_PRACTITIONERS_TTL_MS,
    now = () => Date.now(),
  } = {}) => {
    const scopes = new Map();
    const ttlFor = kind => (kind === 'definitions' ? definitionsTtlMs : practitionersTtlMs);
    const entryFor = (scopeKey, kind) => {
      const bucket = scopes.get(scopeKey);
      return bucket ? bucket[kind] || null : null;
    };
    const getFresh = (scopeKey, kind) => {
      const entry = entryFor(scopeKey, kind);
      if (!entry || !Array.isArray(entry.rows) || !entry.rows.length) return null;
      const age = now() - entry.fetchedAt;
      return age >= 0 && age < ttlFor(kind) ? entry.rows : null;
    };
    const getFallback = (scopeKey, kind) => {
      const entry = entryFor(scopeKey, kind);
      return entry && Array.isArray(entry.rows) && entry.rows.length ? entry.rows : null;
    };
    const remember = (scopeKey, kind, rows) => {
      if (!scopeKey || !Array.isArray(rows) || !rows.length) return;
      const bucket = scopes.get(scopeKey) || {};
      bucket[kind] = { rows, fetchedAt: now() };
      scopes.set(scopeKey, bucket);
    };
    const clear = scopeKey => {
      if (scopeKey) scopes.delete(scopeKey);
      else scopes.clear();
    };
    return Object.freeze({ getFresh, getFallback, remember, clear });
  };

  const encountersFromBeds = beds => {
    const byId = new Map();
    for (const bed of Array.isArray(beds) ? beds : []) {
      const encounter = bed && bed.bedEncounterMapping && bed.bedEncounterMapping.encounterMapping && bed.bedEncounterMapping.encounterMapping.encounter;
      if (!encounter || !encounter.id) continue;
      const id = String(encounter.id);
      const existing = byId.get(id) || { id, formRegistrationSummaryList: [] };
      if (Array.isArray(encounter.formRegistrationSummaryList)) existing.formRegistrationSummaryList.push(...encounter.formRegistrationSummaryList);
      byId.set(id, existing);
    }
    return [...byId.values()];
  };

  const hasMissingPractitioner = (beds, practitioners) => {
    if (!Array.isArray(practitioners) || !practitioners.length) return false;
    const knownIds = new Set(
      practitioners.map(row => String(row && row.id || '')).filter(Boolean)
    );
    for (const encounter of encountersFromBeds(beds)) {
      for (const summary of encounter.formRegistrationSummaryList) {
        if (!summary || !KNOWN_CUDYR_FORM_IDS.has(Number(summary.formId))) continue;
        const practitionerId = String(summary.healthCarePractitionerId || '').trim();
        if (practitionerId && !knownIds.has(practitionerId)) return true;
      }
    }
    return false;
  };

  const projectHistory = observations => {
    const byId = new Map();
    for (const entry of observations) {
      const versions = byId.get(entry.id) || [];
      versions.push(entry);
      byId.set(entry.id, versions);
    }
    // timeStamp is opaque and creationDate is not a revision timestamp. Never guess a winning
    // version: conflicting source versions (including any tombstone) stay in the archive only.
    return [...byId.values()].filter(versions => versions.length === 1 && !versions[0].isDeleted)
      .map(versions => versions[0]).sort(compareCudyrEntries);
  };

  const collectUnexpectedFormIds = rawSummaries => {
    const unexpected = new Set();
    for (const summary of rawSummaries) {
      if (!summary || summary.isDeleted === true || summary.deleted === true) continue;
      const formId = Number(summary.formId);
      if (KNOWN_CUDYR_FORM_IDS.has(formId)) continue;
      const value = String(summary.value == null ? '' : summary.value).trim();
      if (CUDYR_CATEGORY_PATTERN.test(value)) {
        unexpected.add(String(summary.formId == null || summary.formId === '' ? 'desconocido' : summary.formId));
      }
    }
    return [...unexpected].sort(compareStringsAsc);
  };

  const prepareHistory = (encounter, normalize) => {
    const rawSummaries = Array.isArray(encounter.formRegistrationSummaryList) ? encounter.formRegistrationSummaryList : [];
    const summaries = rawSummaries.filter(summary => summary && KNOWN_CUDYR_FORM_IDS.has(Number(summary.formId)));
    const unexpectedFormIds = collectUnexpectedFormIds(rawSummaries);
    const normalized = summaries.map(normalize);
    const observations = [...new Map(normalized.filter(Boolean).map(entry => [JSON.stringify(entry), entry])).values()]
      .sort(compareCudyrEntries);
    return {
      observations,
      history: projectHistory(observations),
      unexpectedFormIds,
      metadataComplete: observations.every(entry => entry.id && entry.authorId && entry.author && entry.authorRoleId && entry.sourceVersion && entry.items.length === 14) &&
        summaries.every((summary, index) => !String(summary.value || '').trim() || /^S\/?C$/i.test(String(summary.value).trim()) || normalized[index]),
    };
  };

  root.HhrCudyrCaptureSupport = {
    readMetadata,
    createMetadataCache,
    hasMissingPractitioner,
    compareCudyrEntries,
    prepareHistory,
    encountersFromBeds,
  };
})(typeof self !== 'undefined' ? self : globalThis);
