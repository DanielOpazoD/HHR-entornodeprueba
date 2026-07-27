/**
 * Read-only Ficha Médico client for the MV3 service worker.
 *
 * Owns session validation, same-origin URL construction and authenticated JSON/PDF reads. Domain
 * orchestration and clinical writes remain in background.js and their dedicated runtimes.
 */
(function (root) {
  'use strict';

  const FORM_CODIGO_KEEP = new Set(['INSTRUMENTO', 'VITAL_SIGNS']);
  const SCALE_FORM_RE = /braden|downton/i;
  const NURSING_WORKLISTS = ['noveltyNurseList', 'uneventfulNurseList', 'incomeNurseList'];

  const errorMessage = error =>
    String((error && error.message) || error || 'error desconocido');

  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };

  const clinicalReadError = (kind, message, details = {}) => {
    const error = new Error(message);
    error.kind = kind;
    Object.assign(error, details);
    return error;
  };

  const create = dependencies => {
    const deps = dependencies || {};
    const resolveFetchInfo = assertFunction(deps.resolveFetchInfo, 'resolveFetchInfo');
    const fetchWithTimeout = assertFunction(deps.fetchWithTimeout, 'fetchWithTimeout');
    const defaultTimeoutMs = Number(deps.defaultTimeoutMs);
    if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
      throw new Error('El timeout defaultTimeoutMs no es válido.');
    }

    const resolveSession = async ({ info, sender, required = [], invalidMessage } = {}) => {
      const result = info ? { info } : await resolveFetchInfo(sender);
      if (result && result.error) return { error: result.error };
      const session = result && result.info;
      const missingBase = !session || !session.token || !session.apiOrigin;
      const missingRequired = required.some(field => !String(session && session[field] || '').trim());
      if (missingBase || missingRequired) {
        return {
          error:
            invalidMessage ||
            'Sin token de Ficha Médico. Recarga la lista de pacientes e inicia sesión.',
        };
      }
      return { info: session };
    };

    const buildUrl = ({ info, path, query }) => {
      if (!info || !info.apiOrigin) {
        throw clinicalReadError('session', 'La sesión no informó el origen de Ficha Médico.');
      }
      let base;
      try {
        base = new URL(String(info.apiOrigin));
      } catch (cause) {
        throw clinicalReadError('session', 'El origen de Ficha Médico no es válido.', { cause });
      }
      if (!/^https?:$/.test(base.protocol)) {
        throw clinicalReadError('session', 'El origen de Ficha Médico no es válido.');
      }
      const relativePath = String(path || '');
      if (!relativePath.startsWith('/') || relativePath.startsWith('//')) {
        throw clinicalReadError('url', 'La ruta clínica debe ser relativa al origen autorizado.');
      }
      let url;
      try {
        url = new URL(relativePath, base.origin);
      } catch (cause) {
        throw clinicalReadError('url', 'No se pudo construir la ruta clínica.', { cause });
      }
      if (url.origin !== base.origin) {
        throw clinicalReadError('url', 'La ruta clínica cambió el origen autorizado.');
      }
      const params = query instanceof URLSearchParams
        ? query
        : new URLSearchParams(Object.entries(query || {}).filter(([, value]) => value != null));
      for (const [key, value] of params.entries()) url.searchParams.set(key, value);
      return url.toString();
    };

    const request = async ({
      info,
      path,
      query,
      responseType,
      cache,
      timeoutMs = defaultTimeoutMs,
      timeoutMessage = 'Tiempo de espera agotado consultando Ficha Médico.',
    }) => {
      const session = await resolveSession({ info });
      if (session.error) throw clinicalReadError('session', session.error);
      const url = buildUrl({ info: session.info, path, query });
      let response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            headers: {
              Authorization: session.info.token,
              Accept: responseType === 'arrayBuffer' ? 'application/pdf' : 'application/json',
            },
            credentials: 'omit',
            ...(cache ? { cache } : {}),
          },
          timeoutMs,
          timeoutMessage
        );
      } catch (cause) {
        throw clinicalReadError('network', errorMessage(cause), { cause });
      }
      if (!response || !response.ok) {
        const status = Number(response && response.status) || 0;
        throw clinicalReadError('http', 'HTTP ' + status, { status });
      }
      if (responseType !== 'arrayBuffer' && Number(response.status) === 204) {
        return { data: null, status: 204 };
      }
      try {
        const data = responseType === 'arrayBuffer'
          ? await response.arrayBuffer()
          : await response.json();
        return { data, status: Number(response.status) || 200 };
      } catch (cause) {
        throw clinicalReadError(
          responseType === 'arrayBuffer' ? 'invalid-buffer' : 'invalid-json',
          errorMessage(cause),
          { cause }
        );
      }
    };

    const readJson = options => request({ ...options, responseType: 'json' });
    const readBuffer = options => request({ ...options, responseType: 'arrayBuffer' });

    const fetchDeviceReportBuffer = async ({ encId, fecha, info }) => {
      if (!encId || !fecha) {
        return { error: 'Faltan enc_id o fecha para el reporte de dispositivos.' };
      }
      const session = await resolveSession({
        info,
        required: ['facId'],
        invalidMessage:
          'Sin token de Ficha Médico. Recarga la lista de pacientes e inicia sesión.',
      });
      if (session.error) return session;
      try {
        const result = await readBuffer({
          info: session.info,
          path: '/api/report/Resumen_diario_paciente.pdf',
          query: { enc_id: encId, fac_id: session.info.facId, fecha },
        });
        return { buffer: result.data };
      } catch (error) {
        if (error.kind === 'http') {
          return { error: 'El servidor de Ficha Médico respondió HTTP ' + error.status + '.' };
        }
        return { error: 'Falló la descarga del PDF de dispositivos: ' + errorMessage(error) };
      }
    };

    const fetchScalesReportWithInfo = async (encId, info) => {
      if (!encId) return { error: 'Falta enc_id para las escalas de evaluación.' };
      // Share the exact nursing + medical read used by Centro HHR Scores. Otherwise the center can
      // see today's Braden while the census remains stale because it consulted only event type 1.
      const result = await fetchEvaluationForms(encId, info);
      if (result.error) return result;
      return {
        ok: true,
        forms: result.forms.filter(form =>
          FORM_CODIGO_KEEP.has(String(form && form.formCodigo || '').toUpperCase())
        ),
      };
    };

    const fetchHistoryScales = async ({ encId, info }) => {
      if (!encId) return { error: 'Falta enc_id para el historial de escalas.' };
      const session = await resolveSession({ info });
      if (session.error) return session;
      try {
        const result = await readJson({
          info: session.info,
          path:
            `/api/encounter/${encodeURIComponent(encId)}/` +
            'getPatientEncounterHistoryReportServer/false/0/0/-14',
        });
        const projection = root.HhrFichaMedicoHistoryReadModel.project(result.data);
        return { ok: true, ...projection };
      } catch (error) {
        if (error.kind === 'http' && error.status === 204) {
          return { ok: true, events: [], nursingActivity: [] };
        }
        if (error.kind === 'http') {
          return { error: 'El servidor de Ficha Médico respondió HTTP ' + error.status + '.' };
        }
        return {
          error: 'Falló la descarga del historial de escalas: ' + errorMessage(error),
        };
      }
    };

    const fetchPrescriptionEvents = async (encId, knownInfo) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const session = await resolveSession({ info: knownInfo });
      if (session.error) return session;
      try {
        const result = await readJson({
          info: session.info,
          path:
            `/api/encounter/${encodeURIComponent(encId)}/` +
            'getPatientEncounterHistoryReportServer/false/0/0/-120',
        });
        return { events: result.status === 204 ? [] : result.data };
      } catch (error) {
        if (error.kind === 'http' && error.status === 204) return { events: [] };
        if (error.kind === 'http') {
          return { error: 'Eloísa respondió HTTP ' + error.status + ' al buscar recetas.' };
        }
        return { error: 'No se pudieron leer las fechas de recetas: ' + errorMessage(error) };
      }
    };

    const fetchCurrentMedicationEntries = async (encId, knownInfo) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const session = await resolveSession({
        info: knownInfo,
        required: ['practitionerId'],
        invalidMessage:
          'La sesión no contiene los datos necesarios para consultar los fármacos activos.',
      });
      if (session.error) return session;
      const eventTypeId = /enfermer/i.test(String(session.info.role || '')) ? '2' : '1';
      try {
        const result = await readJson({
          info: session.info,
          path:
            '/api/encounter/entrySummary/medicationRequestEntry/' +
            `${encodeURIComponent(encId)}/${eventTypeId}/${encodeURIComponent(session.info.practitionerId)}`,
          cache: 'no-store',
        });
        const entries = Array.isArray(result.data)
          ? result.data
          : Array.isArray(result.data && result.data.data)
            ? result.data.data
            : [];
        return { entries };
      } catch (error) {
        if (error.kind === 'http' && error.status === 204) return { entries: [] };
        if (error.kind === 'http') {
          return {
            error:
              'Eloísa respondió HTTP ' +
              error.status +
              ' al consultar los fármacos activos.',
          };
        }
        return { error: 'No se pudieron consultar los fármacos activos: ' + errorMessage(error) };
      }
    };

    async function fetchEvaluationForms(encId, knownInfo) {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const session = await resolveSession({
        info: knownInfo,
        required: ['practitionerId'],
        invalidMessage: 'La sesión no contiene los datos necesarios para consultar BRADEN.',
      });
      if (session.error) return session;
      try {
        const eventTypes = /enfermer/i.test(String(session.info.role || '')) ? ['2'] : ['2', '1'];
        const results = await Promise.all(
          eventTypes.map(async eventType => {
            try {
              const result = await readJson({
                info: session.info,
                path:
                  '/api/encounter/entrySummary/encounterFormEntry/' +
                  `${encodeURIComponent(encId)}/${eventType}/0/${encodeURIComponent(session.info.practitionerId)}`,
                cache: 'no-store',
              });
              return { forms: Array.isArray(result.data) ? result.data : [] };
            } catch (error) {
              if (error.kind === 'http' && error.status === 204) return { forms: [] };
              if (error.kind === 'http') return { error: 'HTTP ' + error.status };
              throw error;
            }
          })
        );
        const failures = results.filter(result => result.error);
        if (failures.length) {
          return {
            error:
              'Eloísa no permitió verificar todas las fuentes de instrumentos (' +
              failures.map(result => result.error).join(', ') +
              ').',
          };
        }
        const byIdentity = new Map();
        results.flatMap(result => result.forms).forEach(form => {
          if (!form) return;
          const key = String(form.guid || form.id || form.encounterEventId || JSON.stringify(form));
          byIdentity.set(key, form);
        });
        return { forms: [...byIdentity.values()] };
      } catch (error) {
        return { error: 'No se pudieron leer los instrumentos: ' + errorMessage(error) };
      }
    }

    const fetchScaleHistoryEvents = async (encId, knownInfo, lookbackDays = 30) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const session = await resolveSession({ info: knownInfo });
      if (session.error) return session;
      const boundedLookback = Math.min(180, Math.max(1, Number(lookbackDays) || 30));
      try {
        const result = await readJson({
          info: session.info,
          path:
            `/api/encounter/${encodeURIComponent(encId)}/` +
            `getPatientEncounterHistoryReportServer/false/0/0/-${boundedLookback}`,
        });
        const events = (Array.isArray(result.data) ? result.data : []).flatMap(event => {
          const rows = (Array.isArray(event && event.evaluationInstrumentsResume)
            ? event.evaluationInstrumentsResume
            : []
          ).filter(row => row && SCALE_FORM_RE.test(String(row.FORM_NAME || '')));
          if (!rows.length) return [];
          return [
            {
              publishDatetime: event.publishDatetime || '',
              encounterEventId: event.encounterEventId || event.id || 0,
              evaluationInstrumentsResume: rows.map(row => ({
                FORM_NAME: row.FORM_NAME,
                LABEL: row.LABEL,
                VALUE: row.VALUE,
                VALUE_NAME: row.VALUE_NAME,
                ARCHIVED: row.ARCHIVED,
                MCAM_ID: row.MCAM_ID,
                PUBLISH_DATE_HCP_NAME: row.PUBLISH_DATE_HCP_NAME,
                HCP_NAME: row.HCP_NAME,
              })),
            },
          ];
        });
        return { events };
      } catch (error) {
        if (error.kind === 'http' && error.status === 204) return { events: [] };
        if (error.kind === 'http') {
          return {
            error: 'Eloísa respondió HTTP ' + error.status + ' al buscar instrumentos.',
          };
        }
        return { error: 'No se pudo leer el historial de instrumentos: ' + errorMessage(error) };
      }
    };

    const fetchNutritionOrderEntry = async (encId, knownInfo) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const session = await resolveSession({
        info: knownInfo,
        required: ['practitionerId'],
        invalidMessage: 'La sesión no informó el profesional lector.',
      });
      if (session.error) return session;
      try {
        const result = await readJson({
          info: session.info,
          path:
            '/api/encounter/entrySummary/nutritionOrderEntry/' +
            `${encodeURIComponent(encId)}/${encodeURIComponent(session.info.practitionerId)}`,
          cache: 'no-store',
        });
        return { entry: result.data };
      } catch (error) {
        if (error.kind === 'http' && error.status === 204) {
          return { entry: null };
        }
        if (error.kind === 'http') {
          return {
            error: 'Eloísa respondió HTTP ' + error.status + ' al consultar el régimen.',
          };
        }
        return { error: 'No se pudo consultar el régimen: ' + errorMessage(error) };
      }
    };

    const fetchTreatmentValidation = async (encId, knownInfo) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      if (knownInfo && (!knownInfo.token || !knownInfo.apiOrigin)) return { validation: null };
      const session = await resolveSession({ info: knownInfo });
      if (session.error) return session;
      try {
        const result = await readJson({
          info: session.info,
          path: `/api/encounter/validateTreatment/${encodeURIComponent(encId)}`,
        });
        return { validation: result.data };
      } catch (error) {
        if (error.kind === 'http' && (error.status === 204 || error.status === 404)) {
          return { validation: null };
        }
        if (error.kind === 'http') {
          return {
            error: 'Eloísa respondió HTTP ' + error.status + ' al buscar la validación.',
          };
        }
        return { error: 'No se pudo leer la última validación: ' + errorMessage(error) };
      }
    };

    const fetchPatientHeader = async (encId, info) => {
      const result = await readJson({
        info,
        path: `/api/encounter/patientHeaderData/${encodeURIComponent(encId)}/false`,
      });
      return result.data;
    };

    const fetchNursingWorklistRows = async info => {
      const session = await resolveSession({
        info,
        required: ['facId'],
        invalidMessage: 'La sesión no informó el origen clínico activo.',
      });
      if (session.error) return session;
      const results = await Promise.all(
        NURSING_WORKLISTS.map(async list => {
          try {
            const result = await readJson({
              info: session.info,
              path: `/api/encounter/${list}/${encodeURIComponent(session.info.facId)}`,
              cache: 'no-store',
            });
            return { list, rows: Array.isArray(result.data) ? result.data : [] };
          } catch (error) {
            return {
              list,
              error: error.kind === 'http' ? 'HTTP ' + error.status : errorMessage(error),
            };
          }
        })
      );
      const failures = results.filter(result => result.error);
      if (failures.length) {
        return {
          error:
            'Eloísa no permitió verificar las tres listas de hospitalizados: ' +
            failures.map(result => result.list + ' (' + result.error + ')').join(', ') +
            '.',
        };
      }
      const byEncounter = new Map();
      results.forEach(result =>
        result.rows.forEach(item => {
          if (item && item.id != null) byEncounter.set(String(item.id), item);
        })
      );
      return { rows: [...byEncounter.values()] };
    };

    const fetchActiveEncounterRows = async info => {
      const session = await resolveSession({
        info,
        invalidMessage: 'La sesión no informó el origen clínico activo.',
      });
      if (session.error) return session;
      if (session.info.listSource === 'nursing' || !session.info.listUrl) {
        return fetchNursingWorklistRows(session.info);
      }
      try {
        const listUrl = new URL(session.info.listUrl);
        const apiOrigin = new URL(session.info.apiOrigin);
        if (listUrl.origin !== apiOrigin.origin) {
          return { error: 'No se pudo leer la lista activa: el origen no es válido.' };
        }
        listUrl.searchParams.set('filterType', '3');
        const result = await readJson({
          info: session.info,
          path: listUrl.pathname,
          query: listUrl.searchParams,
          cache: 'no-store',
        });
        return { rows: Array.isArray(result.data) ? result.data : [] };
      } catch (error) {
        if (error.kind === 'http') {
          return {
            error: 'Eloísa respondió HTTP ' + error.status + ' al listar hospitalizados.',
          };
        }
        return { error: 'No se pudo leer la lista activa: ' + errorMessage(error) };
      }
    };

    return Object.freeze({
      nursingWorklists: Object.freeze([...NURSING_WORKLISTS]),
      resolveSession,
      buildUrl,
      readJson,
      readBuffer,
      fetchDeviceReportBuffer,
      fetchScalesReportWithInfo,
      fetchHistoryScales,
      fetchPrescriptionEvents,
      fetchCurrentMedicationEntries,
      fetchEvaluationForms,
      fetchScaleHistoryEvents,
      fetchNutritionOrderEntry,
      fetchTreatmentValidation,
      fetchPatientHeader,
      fetchActiveEncounterRows,
    });
  };

  const api = Object.freeze({ create });
  root.HhrFichaMedicoClinicalClient = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
