/** Read-only clinical panel orchestration; message routing and shared session readers stay in background.js. */
(function (root) {
  'use strict';

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
      fetchCurrentValidation, fetchAuditForms,
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

    const readAuditForms = async (encId, info) => {
      try {
        const result = await fetchAuditForms(encId, info);
        if (result?.error) return { formError: result.error };
        if (!Array.isArray(result?.forms)) throw new Error('invalid forms');
        return { forms: result.forms.filter(form => String(form?.formCodigo || '').toUpperCase() === 'VITAL_SIGNS') };
      } catch (_) {
        return { formError: 'No se pudo verificar la lectura histórica de signos vitales.' };
      }
    };

    const handleRequest = async ({ encId, historyFrom }) => {
      const window = root.HhrClinicalPanelHistory.windowFor(historyFrom);
      if (window.error) return { error: window.error };
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
        `getPatientEncounterHistoryReportServer/false/0/0/-${window.lookback}`;
      const carePath = `/api/carePlanAssignedCare/${encodedEncounter}`;
      const medicationPath = `/api/carePlanMedication/${encodedEncounter}`;

      const sourceReads = historyFrom ? [
        ['history', 'historial clínico', () => fetchFichaJson(info, historyPath)],
      ] : [
        ['history', 'historial clínico', () => fetchFichaJson(info, historyPath)],
        ['care', 'plan de cuidados', () => fetchFichaJson(info, carePath, { page: 0, limit: 100, showAll: false })],
        ['medications_active', 'medicamentos activos', () => fetchMedicationStates(info, medicationPath, false)],
        ['medications_inactive', 'medicamentos inactivos', () => fetchMedicationStates(info, medicationPath, true)],
        ['validation', 'validación diaria del tratamiento', () => fetchCurrentValidation(encId, info)],
      ];
      const durations = [];
      const settledSources = await Promise.allSettled(sourceReads.map(async ([,, read], index) => {
        const started = performance.now();
        try { return await read(); }
        finally { durations[index] = Math.max(0, Math.round(performance.now() - started)); }
      }));

      let sources;
      try {
        sources = unwrapRequiredSources(sourceReads.map(([, label], index) => ({ label, result: settledSources[index] })));
        if (sources[4]?.error) throw new Error('validación diaria del tratamiento: ' + sources[4].error);
      } catch (error) {
        // Fixed categories and timings only: never include an episode, URL or clinical payload.
        const diagnostic = settledSources.map((result, index) => {
          const failed = result.status === 'rejected'
            || (index === 4 && result.value && result.value.error);
          return `${sourceReads[index][0]}:${failed ? 'failed' : 'ok'}:${durations[index]}ms`;
        }).join(';');
        const message = String((error && error.message) || error);
        return { error: `Falló la descarga del panel clínico: ${message} [HHR_PANEL_V1;${diagnostic}]` };
      }

      const [
        rawHistory,
        carePayload,
        activeMedicationStates = [],
        suspendedMedicationStates = [],
        validationSource,
      ] = sources;

      if (historyFrom && !Array.isArray(rawHistory)) return { error: 'El historial de auditoría no tiene un formato verificable.' };
      const events = root.HhrClinicalPanelHistory.project(rawHistory);

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
          ...root.HhrClinicalPanelHistory.emptyResumes(),
        });
      }

      return {
        ok: true,
        ...window.confirmation,
        ...(historyFrom ? await readAuditForms(encId, info) : {}),
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
