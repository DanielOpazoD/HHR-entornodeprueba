(function (root) {
  'use strict';

  const LAB_BATCH_PREFIX = 'hhr-lab-batch-';
  const LAB_BATCH_TTL_MS = 15 * 60 * 1000;
  const LAB_MAX_SELECTED_EXAMS = 24;
  const LAB_BRIDGE_TIMEOUT_MS = 35_000;
  const LAB_REPORT_TIMEOUT_MS = 90_000;
  const LAB_DETAILS_TIMEOUT_MS = 600_000;

  const create = dependencies => {
    const {
      chrome: chromeApi,
      offscreenCoordinator,
      labViewer,
      syslabSessionTransport,
      syslabPdfBundle,
      withTimeout,
    } = dependencies || {};

    if (
      !chromeApi || !offscreenCoordinator || typeof offscreenCoordinator.request !== 'function' ||
      !labViewer || !syslabSessionTransport ||
      typeof syslabSessionTransport.create !== 'function' ||
      !syslabPdfBundle || typeof syslabPdfBundle.download !== 'function' ||
      typeof syslabPdfBundle.buildFilename !== 'function' ||
      typeof withTimeout !== 'function' ||
      typeof labViewer.normalizeRutBody !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime de Syslab.');
    }

    const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    const sendToSyslabOffscreen = (message, timeoutMs = LAB_BRIDGE_TIMEOUT_MS) =>
      offscreenCoordinator.request('syslab', message, { timeoutMs });

    const sessionTransport = syslabSessionTransport.create({
      chrome: chromeApi,
      withTimeout,
      sendToOffscreen: sendToSyslabOffscreen,
      delay,
    });

    const currentSession = async () => ({
      ...await sessionTransport.currentSession(),
      pdfBundleSupported: true,
    });

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

    const search = async ({ rutBody: requestedRutBody, rutDisplay, sender }) => {
      const rutBody = labViewer.normalizeRutBody(requestedRutBody);
      if (!/^\d{5,9}$/.test(rutBody) || rutBody !== String(requestedRutBody || '')) {
        return { error: 'HHR no informó un RUT válido, sin dígito verificador, para Syslab.' };
      }
      const safeRutDisplay = String(rutDisplay || rutBody).trim();
      if (labViewer.normalizeRutBody(safeRutDisplay) !== rutBody) {
        return { error: 'HHR no informó un RUT completo coherente para nombrar los informes.' };
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
          senderTabId: sender && sender.tab && sender.tab.id,
          rutBody,
          rutDisplay: safeRutDisplay,
          createdAt: Date.now(),
          exams,
          linksByExamId,
        },
      });
      return {
        ok: true,
        batchId,
        rutBody,
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

    const validateLabBatchSender = async (batch, sender) => {
      const senderTabId = sender && sender.tab && sender.tab.id;
      return batch.senderTabId != null && batch.senderTabId === senderTabId
        ? null
        : { error: 'La búsqueda de laboratorio no pertenece a esta pestaña HHR.' };
    };

    const details = async ({ batchId, examIds, sender }) => {
      const batchResult = await readLabBatch(batchId);
      if (batchResult.error) return batchResult;
      const senderError = await validateLabBatchSender(batchResult.batch, sender);
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
      const senderError = await validateLabBatchSender(batchResult.batch, sender);
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
          filename: syslabPdfBundle.buildFilename({
            exams,
            rutDisplay: batchResult.batch.rutDisplay,
          }),
          createdAt: Date.now(),
        },
      });
      const tab = await chromeApi.tabs.create({
        url: chromeApi.runtime.getURL(`print-pdf.html?job=${encodeURIComponent(jobId)}`),
        active: true,
      });
      return { ok: true, viewerTabId: tab && tab.id };
    };

    const downloadPdfBundle = syslabPdfBundle.createHandler(
      readLabBatch,
      validateLabBatchSender,
      selectedLabExams,
      sessionTransport,
      async ({ sender, requestId, progress }) => {
        const senderTabId = sender && sender.tab && sender.tab.id;
        if (senderTabId == null || !requestId) return;
        try {
          await chromeApi.tabs.sendMessage(senderTabId, {
            type: 'RAYEN_LAB_PDF_BUNDLE_PROGRESS',
            requestId,
            progress,
          });
        } catch (_error) {
          // The final request still reports success or failure if the page stops listening.
        }
      }
    );

    return Object.freeze({ currentSession, login, search, details, openPdf, downloadPdfBundle });
  };

  root.HhrSyslabRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
