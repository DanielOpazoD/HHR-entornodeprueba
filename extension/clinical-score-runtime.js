/**
 * Clinical Scores read/schema owner for the MV3 background worker.
 *
 * Owns CUDYR source reconciliation, clinical-form discovery/normalization, Scores option batches
 * and score-form reads. Clinical writes and recovery remain in background.js.
 */
(function (root) {
  'use strict';

  const CLINICAL_FORMS_ORIGIN = 'https://formulariosclinicosback.rayensalud.cl';
  const CUDYR_MENTAL_DEPARTMENT_IDS = new Set(['45', '46', '47', '49', '50', '51']);
  const resolveCudyrFormId = departmentId =>
    CUDYR_MENTAL_DEPARTMENT_IDS.has(String(departmentId || '')) ? '2' : '1';

  const create = dependencies => {
    const {
      chrome: chromeApi,
      crypto: cryptoApi,
      fetchWithTimeout,
      getFichaFetchInfo,
      resolveGestionCamasSession,
      classifyGestionCamasRejection,
      nursingWorklists,
      resolveSessionHandoffKind,
      fetchFichaClaims,
      hasFichaClaim,
      fetchActiveHospitalizedPatients,
      mapWithConcurrency,
      fetchScaleHistoryEvents,
      fetchEvaluationForms,
      serializeClinicalWriteProtection,
      verifyEncounterStillHospitalized,
      prescriptionPrint,
      gestionCamasCudyr,
      now,
    } = dependencies || {};

    if (
      !chromeApi || !chromeApi.storage || !chromeApi.storage.session ||
      !cryptoApi || typeof cryptoApi.randomUUID !== 'function' ||
      typeof fetchWithTimeout !== 'function' || typeof getFichaFetchInfo !== 'function' ||
      typeof resolveGestionCamasSession !== 'function' ||
      typeof classifyGestionCamasRejection !== 'function' ||
      !Array.isArray(nursingWorklists) || nursingWorklists.length !== 3 ||
      typeof resolveSessionHandoffKind !== 'function' || typeof fetchFichaClaims !== 'function' ||
      typeof hasFichaClaim !== 'function' ||
      typeof fetchActiveHospitalizedPatients !== 'function' ||
      typeof mapWithConcurrency !== 'function' || typeof fetchScaleHistoryEvents !== 'function' ||
      typeof fetchEvaluationForms !== 'function' ||
      typeof serializeClinicalWriteProtection !== 'function' ||
      typeof verifyEncounterStillHospitalized !== 'function' ||
      !prescriptionPrint || typeof prescriptionPrint.deriveScaleHistory !== 'function' ||
      !gestionCamasCudyr || typeof gestionCamasCudyr.buildSnapshot !== 'function' ||
      typeof gestionCamasCudyr.mergeEncounterSnapshots !== 'function' ||
      typeof now !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime de lectura de Scores.');
    }

    const fetchCudyrCategories = async info => {
      if (!/^\d+$/.test(String(info && info.facId || ''))) {
        return { error: 'La sesión no informó un establecimiento verificable para consultar CUDYR.' };
      }
      const byEnc = new Map();
      let successfulLists = 0;
      for (const list of nursingWorklists) {
        try {
          const response = await fetchWithTimeout(
            `${info.apiOrigin}/api/encounter/${list}/${encodeURIComponent(info.facId)}`,
            {
              headers: { Authorization: info.token, Accept: 'application/json' },
              credentials: 'omit',
              cache: 'no-store',
            }
          );
          if (!response.ok) continue;
          successfulLists += 1;
          const rows = await response.json();
          for (const row of Array.isArray(rows) ? rows : []) {
            if (!row || row.id == null) continue;
            byEnc.set(String(row.id), {
              encId: String(row.id),
              crdValue: String(row.crdValue || '').trim(),
              crdDateTime: String(row.crdDateTime || '').trim(),
              author: '',
              authorRole: '',
              source: 'ficha_medico',
              history: row.crdValue && row.crdDateTime ? [{
                id: '',
                category: String(row.crdValue || '').trim(),
                recordedAt: String(row.crdDateTime || '').trim(),
                author: '',
                authorRole: '',
                dependencyScore: null,
                riskScore: null,
                items: [],
              }] : [],
            });
          }
        } catch (_error) {}
      }
      if (successfulLists !== nursingWorklists.length) {
        return { error: 'Eloísa no permitió verificar las tres listas CUDYR; los valores podrían estar incompletos.' };
      }
      return { items: [...byEnc.values()] };
    };

    const fetchGestionCamasCudyrCategories = async () => {
      const session = await resolveGestionCamasSession();
      if (!session.record) {
        return { error: session.error || 'Conecta Gestión de Camas para consultar el historial CUDYR.' };
      }
      const info = session.record;
      if (!/^\d+$/.test(String(info.facId || ''))) {
        return { error: 'Gestión de Camas no informó el establecimiento para consultar CUDYR.' };
      }
      const requestUrls = [
        `${info.apiBase}/facility/${encodeURIComponent(info.facId)}/beds`,
        `${info.apiBase}/facility/${encodeURIComponent(info.facId)}/healthCarePractitioners?tid=${now()}`,
        `${info.apiBase}/formCategorizationOfRisk?tid=${now()}`,
      ];
      const requests = requestUrls.map(url => fetchWithTimeout(url, {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      }));
      try {
        const [bedsResult, practitionersResult, definitionsResult] = await Promise.allSettled(requests);
        if (bedsResult.status === 'rejected') {
          throw bedsResult.reason;
        }
        if (!bedsResult.value.ok) {
          const rejection = await classifyGestionCamasRejection(bedsResult.value, info);
          return {
            error: rejection === 'changed'
              ? 'La sesión de Gestión de Camas cambió durante la consulta. Reintenta la operación.'
              : rejection === 'expired'
                ? 'La sesión de Gestión de Camas venció. Vuelve a conectarla.'
                : rejection === 'forbidden'
                  ? 'Gestión de Camas rechazó la consulta CUDYR por permisos.'
                  : 'Gestión de Camas respondió HTTP ' + bedsResult.value.status + ' al consultar CUDYR.',
          };
        }
        const beds = await bedsResult.value.json();
        const warnings = [];
        const readOptionalMetadata = async (result, label) => {
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
            return await result.value.json();
          } catch (_error) {
            warnings.push(`Gestión de Camas entregó ${label} inválidos; el historial se conserva sin esos metadatos.`);
            return [];
          }
        };
        const [practitioners, definitions] = await Promise.all([
          readOptionalMetadata(practitionersResult, 'los autores CUDYR'),
          readOptionalMetadata(definitionsResult, 'las definiciones CUDYR'),
        ]);
        const items = gestionCamasCudyr.buildSnapshot({ beds, practitioners, definitions });
        return {
          items,
          source: 'gestion_camas',
          historyAvailable: true,
          warning: warnings.join(' '),
        };
      } catch (error) {
        return { error: 'No se pudo leer el historial CUDYR de Gestión de Camas: ' +
          String((error && error.message) || error) };
      }
    };

    const resolveCudyrCategories = async info => {
      const [official, fallback] = await Promise.all([
        fetchGestionCamasCudyrCategories(),
        info ? fetchCudyrCategories(info) : Promise.resolve({ error: '' }),
      ]);
      if (official.error) {
        if (!info || fallback.error) {
          return { error: [official.error, fallback.error].filter(Boolean).join(' ') };
        }
        return {
          ...fallback,
          source: 'ficha_medico',
          historyAvailable: false,
          warning: official.error,
        };
      }
      if (!info || fallback.error) {
        return {
          ...official,
          warning: [official.warning, fallback.error].filter(Boolean).join(' '),
        };
      }
      const mergedItems = gestionCamasCudyr.mergeEncounterSnapshots(
        official.items,
        fallback.items
      );
      const fallbackCount = mergedItems.length - official.items.length;
      return {
        ...official,
        items: mergedItems,
        source: fallbackCount > 0 ? 'gestion_camas+ficha_medico' : 'gestion_camas',
      };
    };

    const fetchCudyrDefinitions = async info => {
      try {
        const response = await fetchWithTimeout(
          `${info.apiOrigin}/api/categorizationForm/getAllCategorizationForm`,
          {
            headers: { Authorization: info.token, Accept: 'application/json' },
            credentials: 'omit',
            cache: 'no-store',
          }
        );
        if (!response.ok) return { error: 'Eloísa respondió HTTP ' + response.status + ' al leer CUDYR.' };
        const rows = await response.json();
        return { rows: Array.isArray(rows) ? rows : [] };
      } catch (error) {
        return { error: 'No se pudo leer el formulario CUDYR: ' + String((error && error.message) || error) };
      }
    };

    const normalizeApiArray = payload => {
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.data)) return payload.data;
      if (payload && Array.isArray(payload.content)) return payload.content;
      return [];
    };

    const fetchClinicalFormsCatalog = async info => {
      try {
        const url = new URL('/api/Form', CLINICAL_FORMS_ORIGIN);
        url.searchParams.set('hcpr_id', info.practitionerRoleId);
        url.searchParams.set('fac_id', info.facId);
        const response = await fetchWithTimeout(url.toString(), {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) return { error: 'Formularios Clínicos respondió HTTP ' + response.status + '.' };
        return { forms: normalizeApiArray(await response.json()) };
      } catch (error) {
        return { error: 'No se pudo leer el catálogo de instrumentos: ' + String((error && error.message) || error) };
      }
    };

    const fetchClinicalFormSchema = async (formId, info) => {
      if (!/^\d+$/.test(String(formId || ''))) return { error: 'El instrumento seleccionado no es válido.' };
      try {
        const response = await fetchWithTimeout(`${CLINICAL_FORMS_ORIGIN}/api/Form/${encodeURIComponent(formId)}`, {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) return { error: 'Formularios Clínicos respondió HTTP ' + response.status + '.' };
        const payload = await response.json();
        return { schema: payload && payload.data ? payload.data : payload };
      } catch (error) {
        return { error: 'No se pudo leer el instrumento: ' + String((error && error.message) || error) };
      }
    };

    const flattenClinicalFormFields = sections => {
      const fields = [];
      const visit = section => {
        if (!section || typeof section !== 'object') return;
        const direct = Array.isArray(section.fields) ? section.fields : [];
        direct.forEach(field => fields.push(field));
        const children = [
          ...(Array.isArray(section.subSections) ? section.subSections : []),
          ...(Array.isArray(section.sections) ? section.sections : []),
        ];
        children.forEach(visit);
      };
      (Array.isArray(sections) ? sections : []).forEach(visit);
      return fields;
    };

    const resolveClinicalFieldRequired = (field, meta) => {
      const requirementFlags = [
        field && field.required,
        field && field.isRequired,
        field && field.mandatory,
        field && field.isMandatory,
        meta && meta.required,
        meta && meta.isRequired,
        meta && meta.mandatory,
        meta && meta.isMandatory,
      ];
      const explicitRequirement = requirementFlags.find(value =>
        value !== undefined && value !== null && String(value).trim() !== ''
      );
      if (explicitRequirement !== undefined) {
        return !['false', '0', 'no', 'n'].includes(String(explicitRequirement).trim().toLowerCase());
      }
      const explicitlyOptional = [
        field && field.optional,
        field && field.allowNull,
        field && field.nullable,
        meta && meta.optional,
        meta && meta.allowNull,
        meta && meta.nullable,
      ].some(value => ['true', '1', 'yes', 'y', 'si', 'sí'].includes(String(value).trim().toLowerCase()));
      if (explicitlyOptional || Number(field && field.minOccurs) === 0 || Number(meta && meta.minOccurs) === 0) {
        return false;
      }
      return true;
    };

    const normalizeScaleDefinition = (instrument, catalogEntry, rawSchema) => {
      let schema = rawSchema && rawSchema.formJson ? rawSchema.formJson : rawSchema;
      if (typeof schema === 'string') {
        try { schema = JSON.parse(schema); } catch (_error) { return { error: 'El esquema del instrumento no es JSON válido.' }; }
      }
      if (!schema || typeof schema !== 'object') return { error: 'El instrumento no informó su esquema.' };
      const metaFormCode = String(schema.metaFormCode || '').trim();
      const fields = flattenClinicalFormFields(schema.sections).map(field => {
        const meta = field && field.metaField || {};
        const scores = new Map((Array.isArray(field && field.listValueScore) ? field.listValueScore : [])
          .map(item => [String(item && item.listValueId || ''), Number(item && item.score)]));
        return {
          id: String(meta.metaFieldName || field && field.id || '').trim(),
          label: String(meta.label || meta.metaFieldName || '').replace(/\s+/g, ' ').trim(),
          explanation: String(meta.explanation || '').replace(/\s+/g, ' ').trim(),
          type: Number(meta.metaDataType),
          required: resolveClinicalFieldRequired(field, meta),
          options: (Array.isArray(meta.listValues) ? meta.listValues : [])
            .filter(option => option && option.active !== false)
            .map(option => ({
              id: String(option.id),
              description: String(option.description || option.name || option.id).replace(/\s+/g, ' ').trim(),
              score: scores.has(String(option.id)) ? scores.get(String(option.id)) : null,
            })),
        };
      }).filter(field => field.id);
      const scoreField = fields.find(field => /_puntaje$/i.test(field.id));
      const resultField = fields.find(field => /_resultadoscore$/i.test(field.id));
      const results = (Array.isArray(schema.results) ? schema.results : []).map(result => ({
        minScore: Number(result && result.minScore),
        maxScore: Number(result && result.maxScore),
        valueId: String(result && result.listValueResult && result.listValueResult.id || ''),
        valueName: String(
          result && result.listValueResult &&
            (result.listValueResult.description || result.listValueResult.name || result.listValueResult.valueName) || ''
        ).replace(/\s+/g, ' ').trim(),
      })).filter(result => Number.isFinite(result.minScore) && Number.isFinite(result.maxScore) && result.valueId);
      if (!scoreField || !resultField || !results.length) {
        return { error: 'El instrumento no informó campos de puntaje y clasificación verificables.' };
      }
      return {
        instrument,
        formId: String(catalogEntry.id || catalogEntry.formId || ''),
        metaFormId: String(schema.metaFormId || catalogEntry.metaFormId || ''),
        metaFormCode,
        name: String(catalogEntry.name || catalogEntry.formName || instrument).replace(/\s+/g, ' ').trim(),
        fields: fields.filter(field => field.id !== scoreField.id && field.id !== resultField.id),
        scoreFieldId: scoreField.id,
        resultFieldId: resultField.id,
        results,
      };
    };

    const getScaleDefinition = async (instrument, info) => {
      const pattern = instrument === 'DOWNTON' ? /downton/i : /braden/i;
      const catalog = await fetchClinicalFormsCatalog(info);
      if (catalog.error) return catalog;
      const candidates = catalog.forms.filter(form => pattern.test(String(form && (form.name || form.formName) || '')));
      for (const candidate of candidates) {
        const schemaResult = await fetchClinicalFormSchema(candidate.id || candidate.formId, info);
        if (schemaResult.error) continue;
        const definition = normalizeScaleDefinition(instrument, candidate, schemaResult.schema);
        if (!definition.error) return { definition };
      }
      return { error: 'Eloísa no informó un formulario vigente para ' + instrument + '.' };
    };

    const handleScoresOptionsRequest = async ({ currentEncId }) => {
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      const clinicalRoleKind = resolveSessionHandoffKind(info);
      const identityReady = Boolean(
        info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
          /^\d+$/.test(String(info.practitionerRoleId || '')) && clinicalRoleKind
      );
      if (!identityReady) return { error: 'No se pudo verificar una sesión médica o de enfermería.' };
      const claimsResult = clinicalRoleKind === 'medical' ? { claims: [] } : await fetchFichaClaims(info);
      if (claimsResult.error) return claimsResult;
      if (clinicalRoleKind !== 'medical' && !hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
        return { error: 'El perfil no tiene permiso para ver instrumentos de evaluación.' };
      }
      const patientResult = await fetchActiveHospitalizedPatients(info);
      if (patientResult.error) return patientResult;
      const cudyrResult = await resolveCudyrCategories(info);
      const cudyrByEncounter = new Map((cudyrResult.error ? [] : cudyrResult.items)
        .map(item => [String(item.encId), item]));
      const patients = await mapWithConcurrency(patientResult.patients, 3, async patient => {
        const [history, forms, protectionEntries] = await Promise.all([
          fetchScaleHistoryEvents(patient.encounterId, info, 120),
          fetchEvaluationForms(patient.encounterId, info),
          Promise.all(['CUDYR', 'BRADEN', 'DOWNTON'].map(async instrument => [
            instrument,
            await serializeClinicalWriteProtection(
              'score:' + String(patient.encounterId) + ':' + instrument
            ),
          ])),
        ]);
        const bradenHistory = prescriptionPrint.deriveScaleHistory(
          history.error ? [] : history.events,
          forms.error ? [] : forms.forms,
          'BRADEN'
        );
        const downtonHistory = prescriptionPrint.deriveScaleHistory(
          history.error ? [] : history.events,
          forms.error ? [] : forms.forms,
          'DOWNTON'
        );
        const evaluationReadErrors = [history.error, forms.error].filter(Boolean).join(' ');
        return {
          ...patient,
          isCurrent: String(patient.encounterId) === String(currentEncId || ''),
          scores: {
            CUDYR: cudyrByEncounter.get(String(patient.encounterId)) || null,
            BRADEN: evaluationReadErrors ? [] : bradenHistory.slice(0, 8),
            DOWNTON: evaluationReadErrors ? [] : downtonHistory.slice(0, 8),
          },
          scoreUnavailableReasons: {
            CUDYR: cudyrResult.error || '',
            BRADEN: evaluationReadErrors,
            DOWNTON: evaluationReadErrors,
          },
          scoreProtections: Object.fromEntries(protectionEntries),
        };
      });
      const canWriteEvaluation = clinicalRoleKind === 'nursing' &&
        hasFichaClaim(claimsResult, 'Ingresar_Instrumento_Evaluacion');
      const batchId = cryptoApi.randomUUID();
      await chromeApi.storage.session.set({
        [`hhr-scores-batch-${batchId}`]: {
          createdAt: now(),
          patients: patients.map(patient => ({
            encounterId: patient.encounterId,
            birthDate: patient.birthDate,
            administrativeSexId: patient.administrativeSexId,
            hospitalDepartmentId: patient.hospitalDepartmentId,
          })),
        },
      });
      return {
        ok: true,
        batchId,
        patients,
        canWrite: canWriteEvaluation,
        canWriteByInstrument: {
          CUDYR: canWriteEvaluation,
          BRADEN: canWriteEvaluation,
          DOWNTON: canWriteEvaluation,
        },
        currentProfessional: info.fullName || '',
        writeBlockedReason: canWriteEvaluation ? '' : 'El perfil no tiene permiso para ingresar instrumentos de evaluación.',
        cudyrHistoryAvailable: Boolean(cudyrResult.historyAvailable),
        cudyrSource: cudyrResult.source || '',
        cudyrWarning: cudyrResult.warning || '',
        cudyrUnavailableReason: cudyrResult.error || '',
      };
    };

    const readScoresBatch = async (batchId, encId) => {
      if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || '')) || !/^\d+$/.test(String(encId || ''))) {
        return { error: 'La sesión de Scores no es válida.' };
      }
      const key = `hhr-scores-batch-${batchId}`;
      const stored = await chromeApi.storage.session.get(key);
      const batch = stored && stored[key];
      if (!batch || now() - Number(batch.createdAt || 0) > 30 * 60 * 1000) {
        return { error: 'La sesión de Scores expiró. Actualiza el módulo.' };
      }
      const patient = (Array.isArray(batch.patients) ? batch.patients : [])
        .find(item => String(item.encounterId) === String(encId));
      return patient
        ? { patient, storageKey: key, batch }
        : { error: 'El paciente no pertenece a esta lista activa.' };
    };

    const handleScoreFormRequest = async ({ batchId, encId, instrument }) => {
      const normalizedInstrument = ['CUDYR', 'BRADEN', 'DOWNTON'].includes(String(instrument || '').toUpperCase())
        ? String(instrument).toUpperCase()
        : '';
      if (!normalizedInstrument) return { error: 'El instrumento no es válido.' };
      const batch = await readScoresBatch(batchId, encId);
      if (batch.error) return batch;
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      if (!info.identityVerified || !/enfermer/i.test(String(info.role || ''))) {
        return { error: 'No se pudo verificar la sesión de enfermería.' };
      }
      const claimsResult = await fetchFichaClaims(info);
      if (claimsResult.error) return claimsResult;
      if (!hasFichaClaim(claimsResult, 'Ver_Instrumento_Evaluacion')) {
        return { error: 'El perfil no tiene permiso para ver instrumentos de evaluación.' };
      }
      const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
      if (activeEncounter.error) return activeEncounter;
      if (normalizedInstrument === 'CUDYR') {
        const result = await fetchCudyrDefinitions(info);
        if (result.error) return result;
        const departmentId = String(activeEncounter.encounter && activeEncounter.encounter.hospitalDepartmentId || '');
        if (!/^\d+$/.test(departmentId)) {
          return { error: 'Eloísa no informó el servicio clínico; no se puede elegir el formulario CUDYR con seguridad.' };
        }
        batch.patient.hospitalDepartmentId = departmentId;
        await chromeApi.storage.session.set({ [batch.storageKey]: batch.batch });
        const formId = resolveCudyrFormId(departmentId);
        const fields = result.rows.filter(row => String(row.formId) === formId).map(row => ({
          id: String(row.id),
          typeId: Number(row.typeId),
          label: String(row.label || '').replace(/\s+/g, ' ').trim(),
          options: (Array.isArray(row.categorizationFormOptionList) ? row.categorizationFormOptionList : [])
            .map(option => ({
              id: String(option.id),
              value: Number(option.value),
              description: String(option.description || '').replace(/\s+/g, ' ').trim(),
            })),
        }));
        if (fields.length !== 14) return { error: 'El formulario CUDYR vigente no contiene sus 14 ítems.' };
        return { ok: true, definition: { instrument: 'CUDYR', formId, name: 'CUDYR', fields } };
      }
      const scale = await getScaleDefinition(normalizedInstrument, info);
      return scale.error ? scale : { ok: true, definition: scale.definition };
    };

    const handleCudyrCategoriesRequest = async () => {
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) {
        const official = await fetchGestionCamasCudyrCategories();
        return official.error
          ? { error: official.error + ' ' + infoResult.error }
          : {
              ok: true,
              ...official,
              warning: [official.warning, infoResult.error].filter(Boolean).join(' '),
            };
      }
      const result = await resolveCudyrCategories(infoResult.info);
      return result.error ? result : { ok: true, ...result };
    };

    return Object.freeze({
      fetchCudyrCategories,
      fetchCudyrDefinitions,
      getScaleDefinition,
      resolveCudyrFormId,
      readScoresBatch,
      handleOptionsRequest: handleScoresOptionsRequest,
      handleFormRequest: handleScoreFormRequest,
      handleCudyrCategoriesRequest,
    });
  };

  root.HhrClinicalScoreRuntime = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : self);
