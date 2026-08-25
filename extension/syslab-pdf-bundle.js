/** Validates, merges, and downloads a selection of session-bound Syslab reports. */
(function (root) {
  'use strict';

  const MAX_SELECTED_EXAMS = 24;
  const BRIDGE_TIMEOUT_MS = 35_000;
  const REPORT_TIMEOUT_MS = 90_000;
  const BUNDLE_TIMEOUT_MS = 8 * 60_000;
  const emitProgress = (onProgress, progress) =>
    Promise.resolve(typeof onProgress === 'function' ? onProgress(progress) : undefined);
  const create = dependencies => {
    const { pdfFilename, pdfLib, downloadPdfBuffer, normalizeRutBody } = dependencies || {};
    if (
      !pdfFilename || typeof pdfFilename.build !== 'function' ||
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

    const download = async ({
      batch,
      exams,
      session,
      sessionTransport,
      reportTimeoutMs,
      rutDisplay,
      onProgress,
    }) => {
      const output = await pdfLib.PDFDocument.create();
      const deadline = Date.now() + BUNDLE_TIMEOUT_MS;
      for (let index = 0; index < exams.length; index += 1) {
        const exam = exams[index];
        await emitProgress(onProgress, {
          phase: 'validating',
          completed: index,
          total: exams.length,
          pageCount: output.getPageCount(),
        });
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
          await emitProgress(onProgress, {
            phase: 'validating',
            completed: index + 1,
            total: exams.length,
            pageCount: output.getPageCount(),
          });
        } catch (_error) {
          return { error: 'Uno de los informes de Syslab no contiene un PDF válido.' };
        }
      }

      await emitProgress(onProgress, {
        phase: 'merging',
        completed: exams.length,
        total: exams.length,
        pageCount: output.getPageCount(),
      });
      const filename = pdfFilename.build({ exams, rutDisplay });
      await emitProgress(onProgress, {
        phase: 'downloading',
        completed: exams.length,
        total: exams.length,
        pageCount: output.getPageCount(),
      });
      const downloaded = await downloadPdfBuffer({
        buffer: await output.save(),
        filename,
      });
      return downloaded && downloaded.ok
        ? {
            ok: true,
            downloadId: downloaded.downloadId,
            filename,
            reportCount: exams.length,
            pageCount: output.getPageCount(),
          }
        : { error: downloaded && downloaded.error || 'No se pudo descargar el PDF combinado.' };
    };

    const createHandler = (
      readLabBatch,
      validateLabBatchSender,
      selectedLabExams,
      sessionTransport,
      notifyProgress
    ) => async ({ batchId, examIds, requestId, sender }) => {
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
        rutDisplay: batchResult.batch.rutDisplay,
        onProgress: progress => notifyProgress && notifyProgress({
          sender,
          requestId: String(requestId || ''),
          progress,
        }),
      });
    };

    return Object.freeze({ buildFilename: pdfFilename.build, createHandler, download });
  };
  const createRuntime = ({ chrome, downloadPdfBuffer, withTimeout }) =>
    root.HhrSyslabRuntime.create({
      chrome,
      labViewer: root.HhrLabViewer,
      syslabSessionTransport: root.HhrSyslabSessionTransport,
      syslabPdfBundle: create({
        pdfFilename: root.HhrSyslabPdfFilename,
        pdfLib: root.PDFLib,
        downloadPdfBuffer,
        normalizeRutBody: root.HhrLabViewer.normalizeRutBody,
      }),
      withTimeout,
    });
  root.HhrSyslabPdfBundle = Object.freeze({ create, createRuntime });
})(typeof self !== 'undefined' ? self : globalThis);
