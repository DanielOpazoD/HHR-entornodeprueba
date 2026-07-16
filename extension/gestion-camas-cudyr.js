/** Pure normalizer for the official CUDYR history exposed by Gestión de Camas. */
(function (root) {
  'use strict';

  const cleanText = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

  const roleLabel = roleId => {
    if (Number(roleId) === 1) return 'Médico';
    if (Number(roleId) === 2) return 'Enfermería';
    return '';
  };

  const validCategory = value => {
    const category = cleanText(value).toUpperCase();
    return category && !/^S\/?C$/.test(category) ? category : '';
  };

  const timestampValue = value => {
    const epoch = Date.parse(cleanText(value));
    return Number.isNaN(epoch) ? 0 : epoch;
  };

  const definitionMap = rows => {
    const result = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const formId = String(row && row.formId || '');
      const fieldId = String(row && (row.formFieldId || row.fieldFormId) || '');
      if (!formId || !fieldId) continue;
      const key = formId + ':' + fieldId;
      if (!result.has(key)) {
        result.set(key, {
          label: cleanText(row.formFieldLabel || row.fieldFormLabel || row.label),
          typeId: Number(row.typeId || 0),
        });
      }
    }
    return result;
  };

  const practitionerMap = rows => {
    const result = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row && row.id || '');
      if (id) result.set(id, cleanText(row.fullName || row.name));
    }
    return result;
  };

  const fallbackTypeId = (formId, fieldId) => {
    const numeric = Number(fieldId);
    if (Number(formId) === 1) return numeric >= 1 && numeric <= 6 ? 1 : numeric >= 7 && numeric <= 14 ? 2 : 0;
    if (Number(formId) === 2) return numeric >= 15 && numeric <= 20 ? 1 : numeric >= 21 && numeric <= 28 ? 2 : 0;
    return 0;
  };

  const normalizeHistoryEntry = (summary, definitions, practitioners) => {
    const category = validCategory(summary && summary.value);
    const recordedAt = cleanText(summary && summary.creationDate);
    if (!category || !timestampValue(recordedAt)) return null;
    const formId = String(summary.formId || '');
    const dependencyValues = new Map();
    const riskValues = new Map();
    const items = (Array.isArray(summary.formRegistrationDetailList)
      ? summary.formRegistrationDetailList
      : []).map(detail => {
      const fieldId = String(detail && (detail.fieldFormId || detail.formFieldId) || '');
      const definition = definitions.get(formId + ':' + fieldId) || {};
      const typeId = Number(definition.typeId || fallbackTypeId(formId, fieldId));
      const rawValue = cleanText(detail && detail.value);
      const numericValue = rawValue ? Number(rawValue) : Number.NaN;
      if (Number.isFinite(numericValue)) {
        if (typeId === 1) dependencyValues.set(fieldId, numericValue);
        if (typeId === 2) riskValues.set(fieldId, numericValue);
      }
      return {
        fieldId,
        label: cleanText(definition.label),
        typeId,
        value: rawValue,
      };
    }).filter(item => item.fieldId && item.value);
    const dependencyScore = dependencyValues.size === 6
      ? [...dependencyValues.values()].reduce((total, value) => total + value, 0)
      : null;
    const riskScore = riskValues.size === 8
      ? [...riskValues.values()].reduce((total, value) => total + value, 0)
      : null;
    const practitionerId = String(summary.healthCarePractitionerId || '');
    const practitionerRoleId = String(summary.healthCarePractitionerRoleId || '');
    return {
      id: String(summary.id || ''),
      category,
      recordedAt,
      author: practitioners.get(practitionerId) || '',
      authorRole: roleLabel(practitionerRoleId),
      dependencyScore,
      riskScore,
      items,
    };
  };

  const extractEncounter = bed => bed && bed.bedEncounterMapping &&
    bed.bedEncounterMapping.encounterMapping && bed.bedEncounterMapping.encounterMapping.encounter;

  const buildSnapshot = ({ beds, practitioners, definitions }) => {
    const definitionById = definitionMap(definitions);
    const practitionerById = practitionerMap(practitioners);
    const items = [];
    for (const bed of Array.isArray(beds) ? beds : []) {
      const encounter = extractEncounter(bed);
      const encId = String(encounter && encounter.id || '');
      if (!encId) continue;
      const seen = new Set();
      const history = (Array.isArray(encounter.formRegistrationSummaryList)
        ? encounter.formRegistrationSummaryList
        : [])
        .filter(summary => summary && [1, 2].includes(Number(summary.formId)) && !summary.deleted)
        .map(summary => normalizeHistoryEntry(summary, definitionById, practitionerById))
        .filter(Boolean)
        .sort((a, b) => timestampValue(b.recordedAt) - timestampValue(a.recordedAt))
        .filter(entry => {
          const key = entry.id || [entry.recordedAt, entry.category, entry.author].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const latest = history[0];
      if (!latest) continue;
      items.push({
        encId,
        crdValue: latest.category,
        crdDateTime: latest.recordedAt,
        author: latest.author,
        authorRole: latest.authorRole,
        source: 'gestion_camas',
        history,
      });
    }
    return items;
  };

  const mergeEncounterSnapshots = (officialItems, fallbackItems) => {
    const official = Array.isArray(officialItems) ? officialItems : [];
    const fallback = Array.isArray(fallbackItems) ? fallbackItems : [];
    const officialEncounterIds = new Set(
      official.map(item => String(item && item.encId || '')).filter(Boolean)
    );
    return official.concat(
      fallback.filter(item => {
        const encId = String(item && item.encId || '');
        return encId && !officialEncounterIds.has(encId);
      })
    );
  };

  root.HhrGestionCamasCudyr = { buildSnapshot, mergeEncounterSnapshots, roleLabel };
})(typeof self !== 'undefined' ? self : globalThis);
