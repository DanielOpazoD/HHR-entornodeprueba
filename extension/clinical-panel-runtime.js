/** Read-only clinical panel orchestration; message routing and shared session readers stay in background.js. */
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

  const CARE_PLAN_BODY_FIELDS = [
    'entryGuid',
    'activityId',
    'activity',
    'title',
    'tag',
    'hoursRange',
    'hoursRangeActi',
    'administrationDate',
    'timestamp',
    'user',
    'isPerformed',
    'isPerformedOutSidePlanning',
    'isFinished',
    'isSuspended',
    'doNotExecute',
  ];

  const MEDICATION_STATE_FIELDS = [
    'id',
    'suspended',
    'archived',
    'finalized',
    'programmingEndDatetime',
    'programmingEndDateTime',
    'endDateTime',
    'deletedDateTime',
  ];

  const pickFields = (list, fields) =>
    Array.isArray(list)
      ? list.map(item => {
          const out = {};
          for (const field of fields) out[field] = item ? item[field] : undefined;
          return out;
        })
      : [];

  const slimCarePlanHeaders = payload =>
    Array.isArray(payload && payload.carePlanHeader)
      ? payload.carePlanHeader.map(header => ({
          label: header && header.label,
          labelDate: header && header.labelDate,
          scheduledDate: header && header.scheduledDate,
          isSuspended: header && header.isSuspended,
          carePlanBody: pickFields(header && header.carePlanBody, CARE_PLAN_BODY_FIELDS),
        }))
      : [];

  const slimMedicationStates = rows => pickFields(rows, MEDICATION_STATE_FIELDS);

  const create = dependencies => {
    const {
      fetchClinicalJson,
      fetchMedicationPages,
      unwrapRequiredSources,
      resolveSession,
      fetchCurrentValidation,
      timeoutMs,
    } = dependencies || {};

    if (
      typeof fetchClinicalJson !== 'function' ||
      typeof fetchMedicationPages !== 'function' ||
      typeof unwrapRequiredSources !== 'function' ||
      typeof resolveSession !== 'function' ||
      typeof fetchCurrentValidation !== 'function' ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0
    ) {
      throw new Error('No se pudo inicializar el runtime de lectura del panel clínico.');
    }

    const fetchFichaJson = (info, path, query) =>
      fetchClinicalJson({ info, path, query, timeoutMs });

    const fetchMedicationStates = async (info, path, isSuspended) => {
      const rows = await fetchMedicationPages({
        fetchPage: (page, limit) =>
          fetchFichaJson(info, path, { page, limit, isSuspended }),
      });
      return slimMedicationStates(rows);
    };

    const handleRequest = async ({ encId }) => {
      if (!encId) return { error: 'Falta enc_id para el panel clínico.' };

      const infoResp = await resolveSession();
      if (infoResp.error) return { error: infoResp.error };
      const info = infoResp.info;
      if (!info || !info.token || !info.apiOrigin) {
        return { error: 'Sin token de Ficha Médico. Recarga la lista de pacientes e inicia sesión.' };
      }

      const encodedEncounter = encodeURIComponent(encId);
      const historyPath =
        `/api/encounter/${encodedEncounter}/` +
        'getPatientEncounterHistoryReportServer/false/0/0/-14';
      const carePath = `/api/carePlanAssignedCare/${encodedEncounter}`;
      const medicationPath = `/api/carePlanMedication/${encodedEncounter}`;

      const settledSources = await Promise.allSettled([
        fetchFichaJson(info, historyPath),
        fetchFichaJson(info, carePath, { page: 0, limit: 100, showAll: false }),
        fetchMedicationStates(info, medicationPath, false),
        fetchMedicationStates(info, medicationPath, true),
        fetchCurrentValidation(encId, info),
      ]);

      let sources;
      try {
        sources = unwrapRequiredSources([
          { label: 'historial clínico', result: settledSources[0] },
          { label: 'plan de cuidados', result: settledSources[1] },
          { label: 'medicamentos activos', result: settledSources[2] },
          { label: 'medicamentos inactivos', result: settledSources[3] },
          { label: 'validación diaria del tratamiento', result: settledSources[4] },
        ]);
        const validationSource = sources[4];
        if (validationSource && validationSource.error) {
          throw new Error('validación diaria del tratamiento: ' + validationSource.error);
        }
      } catch (error) {
        return {
          error:
            'Falló la descarga del panel clínico: ' +
            String((error && error.message) || error),
        };
      }

      const [
        rawHistory,
        carePayload,
        activeMedicationStates,
        suspendedMedicationStates,
        validationSource,
      ] = sources;

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

      const currentValidation = validationSource && validationSource.validation || null;
      const currentValidationDatetime =
        currentValidation && typeof currentValidation === 'object'
          ? currentValidation.creationDatetime
            || currentValidation.stringTimestamp
            || currentValidation.timestamp
            || ''
          : '';
      if (
        currentValidationDatetime &&
        !events.some(event => event.validationDatetime === currentValidationDatetime)
      ) {
        events.push({
          publishDatetime: currentValidationDatetime,
          validationDatetime: currentValidationDatetime,
          ...Object.fromEntries(Object.keys(CLINICAL_PANEL_RESUMES).map(resume => [resume, []])),
        });
      }

      return {
        ok: true,
        events,
        carePlan: {
          carePlanHeaders: slimCarePlanHeaders(carePayload),
          medicationStates: [...activeMedicationStates, ...suspendedMedicationStates],
        },
      };
    };

    return { handleRequest };
  };

  root.HhrClinicalPanelRuntime = { create };
})(typeof globalThis !== 'undefined' ? globalThis : self);
