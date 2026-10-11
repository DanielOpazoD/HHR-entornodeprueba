/** Captured CUDYR source versions and optional metadata; no clinical writes. */
(function (root) {
  'use strict';
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
      .map(versions => versions[0]).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  };

  const prepareHistory = (encounter, normalize) => {
    const summaries = (Array.isArray(encounter.formRegistrationSummaryList) ? encounter.formRegistrationSummaryList : [])
      .filter(summary => summary && [1, 2].includes(Number(summary.formId)));
    const normalized = summaries.map(normalize);
    const observations = [...new Map(normalized.filter(Boolean).map(entry => [JSON.stringify(entry), entry])).values()]
      .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
    return {
      observations,
      history: projectHistory(observations),
      metadataComplete: observations.every(entry => entry.id && entry.authorId && entry.author && entry.authorRoleId && entry.sourceVersion && entry.items.length === 14) &&
        summaries.every((summary, index) => !String(summary.value || '').trim() || /^S\/?C$/i.test(String(summary.value).trim()) || normalized[index]),
    };
  };

  root.HhrCudyrCaptureSupport = { readMetadata, prepareHistory, encountersFromBeds };
})(typeof self !== 'undefined' ? self : globalThis);
