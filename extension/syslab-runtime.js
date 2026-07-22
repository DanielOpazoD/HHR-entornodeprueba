/**
 * Syslab/Laboratorio runtime for the MV3 background worker.
 *
 * Orchestrates an authenticated Syslab session and the encounter-bound, expiring batches used
 * by the laboratory viewer. Message routing remains in background.js.
 */
(function (root) {
  'use strict';

  const SYSLAB_OFFSCREEN_PATH = 'syslab-offscreen.html';
  const SYSLAB_OFFSCREEN_TARGET = 'hhr-syslab-offscreen';
  const LAB_BATCH_PREFIX = 'hhr-lab-batch-';
  const LAB_BATCH_TTL_MS = 15 * 60 * 1000;
  const LAB_MAX_SELECTED_EXAMS = 24;
  const LAB_BRIDGE_TIMEOUT_MS = 35_000;
  const LAB_REPORT_TIMEOUT_MS = 90_000;
  const LAB_DETAILS_TIMEOUT_MS = 600_000;
  const CENSUS_ALLOWLIST_TTL_MS = 5 * 60_000;

  const create = dependencies => {
    const {
      chrome: chromeApi,
      labViewer,
      syslabSessionTransport,
      withTimeout,
      getClinicalReportContext,
      getFichaFetchInfo,
      fichaSessionCacheKey,
      fetchActiveEncounterRows,
      resolveFichaEncounterId,
    } = dependencies || {};

    if (
      !chromeApi || !labViewer || !syslabSessionTransport ||
      typeof syslabSessionTransport.create !== 'function' ||
      typeof withTimeout !== 'function' ||
      typeof getClinicalReportContext !== 'function' ||
      typeof getFichaFetchInfo !== 'function' ||
      typeof fichaSessionCacheKey !== 'function' ||
      typeof fetchActiveEncounterRows !== 'function' ||
      typeof resolveFichaEncounterId !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime de Syslab.');
    }

    const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const censusAllowlistCache = new Map();
    let syslabOffscreenCreation = null;

    const readOffscreenContexts = async () => {
      if (typeof chromeApi.runtime.getContexts !== 'function') return [];
      const contexts = await chromeApi.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return Array.isArray(contexts) ? contexts : [];
    };

    const ensureSyslabOffscreen = async () => {
      const offscreenUrl = chromeApi.runtime.getURL(SYSLAB_OFFSCREEN_PATH);
      const contexts = await readOffscreenContexts();
      if (contexts.some(context => context.documentUrl === offscreenUrl)) return;
      if (contexts.length) {
        throw new Error('Otra función de la extensión está usando el documento interno. Recarga la extensión para conectar Syslab.');
      }
      if (!syslabOffscreenCreation) {
        syslabOffscreenCreation = chromeApi.offscreen.createDocument({
          url: SYSLAB_OFFSCREEN_PATH,
          reasons: ['IFRAME_SCRIPTING'],
          justification: 'Mantener la sesión local de Syslab sin abrir una pestaña visible.',
        }).catch(async error => {
          if (/single offscreen|already exists/i.test(String((error && error.message) || error))) {
            const current = await readOffscreenContexts();
            if (current.some(context => context.documentUrl === offscreenUrl)) return;
          }
          throw error;
        }).finally(() => {
          syslabOffscreenCreation = null;
        });
      }
      await syslabOffscreenCreation;
    };

    const sendToSyslabOffscreen = async (message, timeoutMs = LAB_BRIDGE_TIMEOUT_MS) => {
      await ensureSyslabOffscreen();
      return withTimeout(
        chromeApi.runtime.sendMessage({
          target: SYSLAB_OFFSCREEN_TARGET,
          request: message,
          timeoutMs,
        }),
        timeoutMs + 1_000,
        'Syslab demoró demasiado en responder.'
      );
    };

    const sessionTransport = syslabSessionTransport.create({
      chrome: chromeApi,
      withTimeout,
      sendToOffscreen: sendToSyslabOffscreen,
      delay,
    });

    const currentSession = () => sessionTransport.currentSession();

    const requireBridgeResponse = (response, fallback) => {
      if (!response || response.error) throw new Error(response && response.error || fallback);
      return response;
    };

    const login = async ({ username, password }) => {
      const safeUsername = String(username || '').trim();
      const safePassword = String(password || '');
      if (!safeUsername || !safePassword || safeUsername.length > 120 || safePassword.length > 256) {
        return { error: 'Ingresa usuario y contraseña para conectar Syslab.' };
      }
      let session;
      try {
        session = await sessionTransport.resolveOffscreen({ timeoutMs: LAB_BRIDGE_TIMEOUT_MS });
      } catch (error) {
        return { error: 'No se pudo conectar con Syslab en la red local: ' + String((error && error.message) || error) };
      }
      if (!session.status.loginRequired) {
        return { ok: true, connected: true, status: 'ready', message: 'Syslab ya estaba conectado.' };
      }
      const submitted = await sendToSyslabOffscreen({
        type: 'RAYEN_SYSLAB_LOGIN',
        username: safeUsername,
        password: safePassword,
      });
      if (!submitted || submitted.error) {
        return { error: String(submitted && submitted.error || 'Syslab no aceptó el inicio de sesión.') };
      }
      if (submitted.navigated) {
        try {
          session = await sessionTransport.waitAfterNavigation(
            session, submitted.bridgeId, LAB_BRIDGE_TIMEOUT_MS
          );
          if (!session.status.loginRequired) {
            return { ok: true, connected: true, status: 'ready', message: 'Syslab quedó conectado.' };
          }
        } catch (_error) {}
      }
      const refreshedStatus = await currentSession();
      return refreshedStatus.connected
        ? refreshedStatus
        : { error: 'Syslab no confirmó el acceso. Revisa el usuario y la contraseña.' };
    };

    const runSyslabSearch = async (session, rutBody) => {
      if (session.status.loginRequired) {
        throw new Error('Inicia sesión en el cuadro de Syslab de la extensión y vuelve a pulsar Actualizar.');
      }
      const prepare = requireBridgeResponse(
        await sessionTransport.send(session, { type: 'RAYEN_SYSLAB_PREPARE_SEARCH' }, LAB_BRIDGE_TIMEOUT_MS),
        'No se pudo abrir la búsqueda por RUT.'
      );
      if (prepare.navigated) {
        session = await sessionTransport.waitAfterNavigation(
          session,
          prepare.bridgeId,
          LAB_BRIDGE_TIMEOUT_MS
        );
      }
      const submit = requireBridgeResponse(
        await sessionTransport.send(session, { type: 'RAYEN_SYSLAB_SUBMIT_SEARCH', rutBody }, LAB_BRIDGE_TIMEOUT_MS),
        'No se pudo consultar el RUN en Syslab.'
      );
      if (submit.navigated) {
        session = await sessionTransport.waitAfterNavigation(
          session,
          submit.bridgeId,
          LAB_BRIDGE_TIMEOUT_MS
        );
      }
      const result = requireBridgeResponse(
        await sessionTransport.send(session, { type: 'RAYEN_SYSLAB_READ_RESULTS', rutBody }, LAB_BRIDGE_TIMEOUT_MS),
        'Syslab no entregó resultados interpretables.'
      );
      return { payload: result };
    };

    const searchSyslabDirectly = async rutBody => {
      let session;
      try {
        session = await sessionTransport.resolve({ offscreenTimeoutMs: LAB_BRIDGE_TIMEOUT_MS });
        return await sessionTransport.withVisibleFallback(
          session,
          current => runSyslabSearch(current, rutBody),
          { timeoutMs: LAB_BRIDGE_TIMEOUT_MS }
        );
      } catch (error) {
        throw new Error(
          'No se pudo acceder a Syslab en la red local: ' + String((error && error.message) || error)
        );
      }
    };

    const sweepExpiredLabBatches = async () => {
      const stored = await chromeApi.storage.session.get(null);
      const now = Date.now();
      const expiredKeys = Object.entries(stored || {})
        .filter(([key, value]) => key.startsWith(LAB_BATCH_PREFIX) && (
          !value || !Number.isFinite(value.createdAt) || now - value.createdAt > LAB_BATCH_TTL_MS
        ))
        .map(([key]) => key);
      if (expiredKeys.length) await chromeApi.storage.session.remove(expiredKeys);
    };

    // The shared picker may consult the sender tab's encounter or another active census encounter.
    // The RUN returned by Syslab is cross-checked downstream before patient data is exposed.
    const encounterInActiveCensus = async (encId, sender) => {
      const id = String(encId || '');
      if (!/^\d+$/.test(id)) return false;
      const infoResult = await getFichaFetchInfo(sender);
      if (infoResult.error) return false;
      const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
      const cached = censusAllowlistCache.get(sessionKey);
      if (cached && Date.now() - cached.at < CENSUS_ALLOWLIST_TTL_MS && cached.ids.has(id)) {
        return true;
      }
      const rowResult = await fetchActiveEncounterRows(infoResult.info);
      if (rowResult.error) return false;
      const ids = new Set((rowResult.rows || []).map(row => String(row && row.id || '')));
      censusAllowlistCache.set(sessionKey, { at: Date.now(), ids });
      if (censusAllowlistCache.size > 12) {
        const oldest = censusAllowlistCache.keys().next().value;
        censusAllowlistCache.delete(oldest);
      }
      return ids.has(id);
    };

    const validateLabSenderEncounter = async (sender, expectedEncounterId) => {
      const senderEncounterId = resolveFichaEncounterId(
        sender && sender.tab && sender.tab.url || sender && sender.url
      );
      if (senderEncounterId && senderEncounterId === String(expectedEncounterId || '')) return null;
      if (await encounterInActiveCensus(expectedEncounterId, sender)) return null;
      return { error: 'El episodio solicitado no está en el censo de hospitalizados activo.' };
    };

    const search = async ({ encId, sender }) => {
      const senderError = await validateLabSenderEncounter(sender, encId);
      if (senderError) return senderError;
      const context = await getClinicalReportContext(encId, null, null, sender);
      if (context.error) return context;
      const rutBody = labViewer.normalizePatientRutBody(context.patient && context.patient.run);
      if (!/^\d{5,9}$/.test(rutBody)) {
        return { error: 'Eloísa no informó un RUN válido para consultar laboratorio.' };
      }

      let directSearch;
      try {
        directSearch = await searchSyslabDirectly(rutBody);
      } catch (error) {
        return { error: String((error && error.message) || error) };
      }
      const payload = directSearch.payload;
      if (
        labViewer.normalizeRutBody(payload.rutBody) !== rutBody ||
        !labViewer.examRowsMatchRut(payload.exams, rutBody)
      ) {
        return { error: 'Syslab no confirmó que los informes correspondan al RUN solicitado. No se mostrarán datos.' };
      }
      const rawExams = Array.isArray(payload.exams) ? payload.exams : [];
      const exams = labViewer.sanitizeExamList(rawExams);
      const linksByExamId = Object.fromEntries(rawExams.map(exam => [String(exam.id), String(exam.link || '')]));
      if (exams.some(exam => !linksByExamId[exam.id])) {
        return { error: 'Syslab entregó uno o más informes sin una ruta interna válida.' };
      }
      const batchId = crypto.randomUUID();
      await sweepExpiredLabBatches();
      await chromeApi.storage.session.set({
        [LAB_BATCH_PREFIX + batchId]: {
          encounterId: String(encId),
          rutBody,
          createdAt: Date.now(),
          exams,
          linksByExamId,
        },
      });
      return {
        ok: true,
        batchId,
        patient: context.patient,
        exams: exams.map(exam => ({
          id: exam.id,
          date: exam.date,
          time: exam.time,
          patientName: exam.patientName,
          origin: exam.origin,
          exams: exam.exams,
          hasReport: true,
        })),
      };
    };

    const readLabBatch = async batchId => {
      if (!/^[0-9a-f-]{36}$/i.test(String(batchId || ''))) {
        return { error: 'La búsqueda de laboratorio no es válida. Actualiza el visor.' };
      }
      const key = LAB_BATCH_PREFIX + batchId;
      const stored = await chromeApi.storage.session.get(key);
      const batch = stored && stored[key];
      if (!batch || !Array.isArray(batch.exams)) {
        return { error: 'La búsqueda de laboratorio ya no está disponible. Actualiza el visor.' };
      }
      if (!Number.isFinite(batch.createdAt) || Date.now() - batch.createdAt > LAB_BATCH_TTL_MS) {
        await chromeApi.storage.session.remove(key);
        return { error: 'La búsqueda de laboratorio caducó. Actualiza el visor para proteger al paciente.' };
      }
      return { batch };
    };

    const selectedLabExams = (batch, examIds) => {
      const ids = [...new Set((Array.isArray(examIds) ? examIds : []).map(String))].filter(Boolean);
      if (ids.length > LAB_MAX_SELECTED_EXAMS) return [];
      const allowedById = new Map(batch.exams.map(exam => [String(exam.id), exam]));
      const exams = ids.map(id => allowedById.get(id)).filter(Boolean);
      return exams.length === ids.length && exams.length > 0 ? exams : [];
    };

    const details = async ({ batchId, examIds, sender }) => {
      const batchResult = await readLabBatch(batchId);
      if (batchResult.error) return batchResult;
      const senderError = await validateLabSenderEncounter(sender, batchResult.batch.encounterId);
      if (senderError) return senderError;
      const requestedIds = [...new Set((Array.isArray(examIds) ? examIds : []).map(String).filter(Boolean))];
      if (requestedIds.length > LAB_MAX_SELECTED_EXAMS) {
        return { error: 'Puedes analizar como máximo 24 informes por operación.' };
      }
      const exams = selectedLabExams(batchResult.batch, requestedIds);
      if (!exams.length) return { error: 'Selecciona uno o más informes vigentes de esta búsqueda.' };

      let session;
      try {
        session = await sessionTransport.resolve({ offscreenTimeoutMs: LAB_BRIDGE_TIMEOUT_MS });
      } catch (_error) {
        return { error: 'La sesión de Syslab venció. Inicia sesión desde la extensión.' };
      }
      if (session.status.loginRequired) return { error: 'Syslab requiere iniciar sesión.' };
      const reportRequests = exams.map(exam => ({
        id: exam.id,
        link: batchResult.batch.linksByExamId && batchResult.batch.linksByExamId[exam.id],
      }));
      if (reportRequests.some(exam => !exam.link)) {
        return { error: 'La búsqueda vigente no contiene todas las rutas de informe requeridas.' };
      }
      let payload;
      try {
        payload = await sessionTransport.sendWithVisibleFallback(
          session,
          {
            type: 'RAYEN_SYSLAB_READ_DETAILS',
            rutBody: batchResult.batch.rutBody,
            exams: reportRequests,
          },
          LAB_DETAILS_TIMEOUT_MS
        );
      } catch (error) {
        return { error: 'No se pudieron interpretar los informes en Syslab: ' + String((error && error.message) || error) };
      }
      const normalizedDetails = payload && !payload.error &&
        labViewer.normalizeRutBody(payload.rutBody) === batchResult.batch.rutBody
        ? labViewer.validateDetailBatch(
            payload.details,
            exams.map(exam => exam.id),
            batchResult.batch.rutBody
          )
        : null;
      if (!normalizedDetails) {
        return {
          error: payload && payload.error ||
            'Syslab devolvió un lote incompleto o inconsistente. No se mostrará un análisis parcial.',
        };
      }
      return { ok: true, analysis: labViewer.buildAnalysis(normalizedDetails, exams) };
    };

    const openPdf = async ({ batchId, examId, sender }) => {
      const batchResult = await readLabBatch(batchId);
      if (batchResult.error) return batchResult;
      const senderError = await validateLabSenderEncounter(sender, batchResult.batch.encounterId);
      if (senderError) return senderError;
      const exams = selectedLabExams(batchResult.batch, [examId]);
      if (exams.length !== 1) {
        return { error: 'El informe no pertenece a la búsqueda vigente de este paciente.' };
      }
      const link = batchResult.batch.linksByExamId && batchResult.batch.linksByExamId[exams[0].id];
      if (!link) return { error: 'La ruta interna del informe ya no está disponible.' };
      let session;
      try {
        session = await sessionTransport.resolve({ offscreenTimeoutMs: LAB_BRIDGE_TIMEOUT_MS });
      } catch (_error) {
        return { error: 'La sesión de Syslab venció. Inicia sesión desde la extensión.' };
      }
      if (session.status.loginRequired) return { error: 'Syslab requiere iniciar sesión.' };
      let validation;
      try {
        validation = await sessionTransport.sendWithVisibleFallback(
          session,
          {
            type: 'RAYEN_SYSLAB_VALIDATE_REPORT',
            rutBody: batchResult.batch.rutBody,
            examId: exams[0].id,
            link,
          },
          LAB_REPORT_TIMEOUT_MS
        );
      } catch (error) {
        return { error: 'No se pudo validar el informe en Syslab: ' + String((error && error.message) || error) };
      }
      if (
        !validation || validation.error ||
        labViewer.normalizeRutBody(validation.rutBody) !== batchResult.batch.rutBody ||
        !String(validation.pdfBase64 || '')
      ) {
        return { error: validation && validation.error || 'El informe no corresponde al RUN solicitado.' };
      }
      const jobId = crypto.randomUUID();
      await chromeApi.storage.session.set({
        [`hhr-pdf-print-${jobId}`]: {
          base64: validation.pdfBase64,
          filename: `Laboratorio_${exams[0].id}.pdf`,
          createdAt: Date.now(),
        },
      });
      const tab = await chromeApi.tabs.create({
        url: chromeApi.runtime.getURL(`print-pdf.html?job=${encodeURIComponent(jobId)}`),
        active: true,
      });
      return { ok: true, viewerTabId: tab && tab.id };
    };

    return Object.freeze({ currentSession, login, search, details, openPdf });
  };

  root.HhrSyslabRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
