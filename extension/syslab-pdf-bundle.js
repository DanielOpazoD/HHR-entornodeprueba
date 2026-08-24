/** Validates, merges, and downloads a selection of session-bound Syslab reports. */
(function (root) {
  'use strict';

  const MAX_SELECTED_EXAMS = 24;
  const BRIDGE_TIMEOUT_MS = 35_000;
  const REPORT_TIMEOUT_MS = 90_000;
  const BUNDLE_TIMEOUT_MS = 8 * 60_000;
  const create = dependencies => {
    const { pdfLib, downloadPdfBuffer, normalizeRutBody } = dependencies || {};
    if (
      !pdfLib || !pdfLib.PDFDocument ||
      typeof downloadPdfBuffer !== 'function' ||
      typeof normalizeRutBody !== 'function'
    ) {
      throw new Error('No se pudo inicializar la descarga PDF de Syslab.');
    }

    const base64ToBytes = value => {
      const encoded = String(value || '').replace(/\s/g, '');
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error('Syslab devolvió un PDF no válido.');
      }
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    };

    const download = async ({ batch, exams, session, sessionTransport, reportTimeoutMs }) => {
      const output = await pdfLib.PDFDocument.create();
      const deadline = Date.now() + BUNDLE_TIMEOUT_MS;
      for (const exam of exams) {
        const remainingMs = Math.max(1_000, deadline - Date.now());
        const link = batch.linksByExamId && batch.linksByExamId[exam.id];
        if (!link) return { error: 'La búsqueda vigente no contiene todos los informes requeridos.' };
        let validation;
        try {
          validation = await sessionTransport.sendWithVisibleFallback(
            session,
            {
              type: 'RAYEN_SYSLAB_VALIDATE_REPORT',
              rutBody: batch.rutBody,
              examId: exam.id,
              link,
            },
            Math.min(reportTimeoutMs, remainingMs)
          );
        } catch (error) {
          return {
            error: 'No se pudo validar uno de los informes en Syslab: ' +
              String((error && error.message) || error),
          };
        }
        if (
          !validation || validation.error ||
          normalizeRutBody(validation.rutBody) !== batch.rutBody ||
          !String(validation.pdfBase64 || '')
        ) {
          return {
            error: validation && validation.error ||
              'Uno de los informes no corresponde al RUN solicitado.',
          };
        }
        try {
          const source = await pdfLib.PDFDocument.load(base64ToBytes(validation.pdfBase64));
          const pages = await output.copyPages(source, source.getPageIndices());
          pages.forEach(page => output.addPage(page));
        } catch (_error) {
          return { error: 'Uno de los informes de Syslab no contiene un PDF válido.' };
        }
      }

      const downloaded = await downloadPdfBuffer({
        buffer: await output.save(),
        filename: 'Examenes_Syslab_seleccionados.pdf',
      });
      return downloaded && downloaded.ok
        ? { ok: true, downloadId: downloaded.downloadId }
        : { error: downloaded && downloaded.error || 'No se pudo descargar el PDF combinado.' };
    };

    const createHandler = (
      readLabBatch,
      validateLabBatchSender,
      selectedLabExams,
      sessionTransport
    ) => async ({ batchId, examIds, sender }) => {
      const batchResult = await readLabBatch(batchId);
      if (batchResult.error) return batchResult;
      const senderError = await validateLabBatchSender(batchResult.batch, sender);
      if (senderError) return senderError;
      const requestedIds = [
        ...new Set((Array.isArray(examIds) ? examIds : []).map(String).filter(Boolean)),
      ];
      if (requestedIds.length > MAX_SELECTED_EXAMS) {
        return { error: 'Puedes descargar como máximo 24 informes por operación.' };
      }
      const exams = selectedLabExams(batchResult.batch, requestedIds);
      if (!exams.length) {
        return { error: 'Selecciona uno o más informes vigentes de esta búsqueda.' };
      }

      let session;
      try {
        session = await sessionTransport.resolve({
          offscreenTimeoutMs: BRIDGE_TIMEOUT_MS,
        });
      } catch (_error) {
        return { error: 'La sesión de Syslab venció. Inicia sesión desde la extensión.' };
      }
      if (session.status.loginRequired) return { error: 'Syslab requiere iniciar sesión.' };

      return download({
        batch: batchResult.batch,
        exams,
        session,
        sessionTransport,
        reportTimeoutMs: REPORT_TIMEOUT_MS,
      });
    };

    return Object.freeze({ createHandler, download });
  };
  const createRuntime = ({ chrome, downloadPdfBuffer, withTimeout }) =>
    root.HhrSyslabRuntime.create({
      chrome,
      labViewer: root.HhrLabViewer,
      syslabSessionTransport: root.HhrSyslabSessionTransport,
      syslabPdfBundle: create({
        pdfLib: root.PDFLib,
        downloadPdfBuffer,
        normalizeRutBody: root.HhrLabViewer.normalizeRutBody,
      }),
      withTimeout,
    });
  root.HhrSyslabPdfBundle = Object.freeze({ create, createRuntime });
})(typeof self !== 'undefined' ? self : globalThis);
