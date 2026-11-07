/** Minimal history projection and explicit admission-window validation for the clinical panel. */
(function (root) {
  'use strict';
  const CLINICAL_PANEL_RESUMES = {
    evolutionResume: [
      'OBE_NOTES', 'OBE_PUBLISH_DATETIME', 'OBE_START_DATETIME',
      'HCPR_NAME', 'HCP_FGN', 'HCP_NGN', 'HCP_FFN', 'HCP_SFN',
      'HCP_LEGAL', 'ARCHIVED', 'IS_CROSSED_OUT', 'OBE_AMENDED', 'id',
    ],
    shiftChangeResume: [
      'OBSERVATION', 'HCPR_NAME', 'HCP_FGN', 'HCP_NGN', 'HCP_FFN', 'HCP_SFN',
      'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED', 'ID',
    ],
    patientPharmaIndicationResume: [
      'DESCRIPTOR', 'VIRTUAL_MEDICAL_PRODUCT', 'POSOLOGY', 'ROUTE_ADMINISTRATION',
      'MRE_ADMINISTRATION_NOTE', 'SUSPENDED', 'FINALIZED', 'IS_NEW', 'IS_DISCHARGE',
      'HCP_NAME', 'HCP_ROLE', 'PUBLISH_DATETIME', 'MRE_ID', 'ARCHIVED',
      'IS_EXTERNAL', 'is_external', 'ALL_MEDICATION', 'allMedication',
    ],
    patientFreeIndicationResume: [
      'INDICATION', 'HCP_NAME', 'HCP_ROLE', 'PUBLISH_DATETIME',
      'SUSPENDED', 'IS_NEW', 'IS_DISCHARGE', 'AMRE_ID', 'ARCHIVED',
    ],
    nutritionOrderResume: [
      'DIET_type', 'OBSERVATION', 'HCPR_NAME', 'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED',
    ],
    restResume: [
      'rest_type', 'OBSERVATION', 'HCPR_NAME', 'HCP_LEGAL', 'PUBLISH_DATETIME', 'ARCHIVED',
    ],
  };

  const pickFields = (list, fields) => Array.isArray(list) ? list.map(item => Object.fromEntries(fields.map(field => [field, item ? item[field] : undefined]))) : [];
  const project = rawHistory => {
      const events = [];
      for (const event of Array.isArray(rawHistory) ? rawHistory : []) {
        if (!event) continue;
        const slim = { publishDatetime: event.publishDatetime || '' };
        const validator = event.healthCarePractitionerValidator;
        if (validator && typeof validator === 'object') {
          slim.validationDatetime =
            validator.creationDatetime || validator.stringTimestamp || validator.timestamp || '';
        } else if (typeof validator === 'string' && validator.trim()) {
          slim.validationDatetime = event.publishDatetime || '';
        }
        let hasContent = Boolean(slim.validationDatetime);
        for (const [resume, fields] of Object.entries(CLINICAL_PANEL_RESUMES)) {
          const picked = pickFields(event[resume], fields);
          slim[resume] = picked;
          if (picked.length > 0) hasContent = true;
        }
        if (hasContent) events.push(slim);
      }

    return events;
  };
  const windowFor = historyFrom => {
      let lookback = 14;
      if (historyFrom !== undefined) {
        const start = typeof historyFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(historyFrom) ? Date.parse(historyFrom + 'T00:00:00Z') : NaN;
        // clinical-clock-allow instant-calendar-slice: Validate a calendar date encoded at UTC midnight; no instant is displayed.
        if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== historyFrom) return { error: 'Fecha inicial de auditoría inválida.' };
        lookback = Math.max(14, Math.ceil((Date.now() - start) / 86400000) + 2);
        if (lookback > 4000) return { error: 'El ingreso supera la ventana histórica de auditoría de 4000 días.' };
      }
    return { lookback, confirmation: historyFrom ? { historyFrom } : {} };
  };
  const emptyResumes = () => Object.fromEntries(Object.keys(CLINICAL_PANEL_RESUMES).map(resume => [resume, []]));
  root.HhrClinicalPanelHistory = { project, windowFor, emptyResumes };
})(typeof globalThis !== 'undefined' ? globalThis : self);
