/**
 * Clinical PDF/report owner for the MV3 background worker.
 *
 * Owns official PDF validation, prescription/indications report retrieval, browser print/download
 * transport and epicrisis correction. Message routing and shared clinical session resolution remain
 * in background.js.
 */
(function (root) {
  'use strict';

  const MEDICAL_EPICRISIS_REPORT_CANDIDATES = [
    'Reporte_Alta_Medica.pdf',
    'Reporte_Epicrisis.pdf',
    'Reporte_Epicrisis_Medica.pdf',
    'Epicrisis.pdf',
  ];

  const create = dependencies => {
    const {
      chrome: chromeApi,
      crypto: cryptoApi,
      TextDecoder: TextDecoderApi,
      fetchWithTimeout,
      getClinicalReportContext,
      getFichaFetchInfo,
      mapWithConcurrency,
      bufferToBase64,
      base64ToArrayBuffer,
      extensionRuntime,
      pdfPrint,
      prescriptionPrint,
      prescriptionPdf,
      epicrisisPdf,
      pdfLib,
      now,
    } = dependencies || {};

    if (
      !chromeApi || !cryptoApi || typeof cryptoApi.randomUUID !== 'function' ||
      typeof TextDecoderApi !== 'function' || typeof fetchWithTimeout !== 'function' ||
      typeof getClinicalReportContext !== 'function' || typeof getFichaFetchInfo !== 'function' ||
      typeof mapWithConcurrency !== 'function' || typeof bufferToBase64 !== 'function' ||
      typeof base64ToArrayBuffer !== 'function' ||
      !extensionRuntime || typeof extensionRuntime.ensurePdf !== 'function' ||
      !pdfPrint || typeof pdfPrint.preparePdfForBrowserPrint !== 'function' ||
      !prescriptionPrint ||
      typeof prescriptionPrint.buildPrescriptionReportUrl !== 'function' ||
      typeof prescriptionPrint.buildIndicationsReportUrl !== 'function' ||
      typeof prescriptionPrint.buildRegimenReportUrl !== 'function' ||
      typeof prescriptionPrint.buildClinicalReportUrl !== 'function' ||
      typeof prescriptionPrint.buildPrescriptionFilename !== 'function' ||
      typeof prescriptionPrint.extractOfficialPrescriptionContent !== 'function' ||
      !prescriptionPdf ||
      typeof prescriptionPdf.generateProfessionalPrescriptionPdf !== 'function' ||
      typeof now !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime de informes clínicos.');
    }
    const normalizeRun = root.HhrHospitalizationReportsRuntime.normalizeRun;

    const fetchOfficialPdf = async ({ url, token, label }) => {
      try {
        const res = await fetchWithTimeout(url, {
          headers: { Authorization: token, Accept: 'application/pdf' },
          credentials: 'omit',
        });
        if (res.status === 401 || res.status === 403) {
          return {
            fatal: true,
            status: res.status,
            error: 'Eloísa no autorizó ' + label + ' para la sesión actual.',
          };
        }
        if (!res.ok) {
          let detail = '';
          try {
            const contentType = res.headers.get('content-type') || '';
            if (/text|json/i.test(contentType)) {
              detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 180);
            }
          } catch (_error) {}
          return { status: res.status, error: 'HTTP ' + res.status + (detail ? ': ' + detail : '') };
        }
        const buffer = await res.arrayBuffer();
        const signature = String.fromCharCode.apply(null, new Uint8Array(buffer).slice(0, 4));
        if (signature !== '%PDF') {
          return { status: res.status, error: 'La respuesta no es un PDF válido.' };
        }
        return { buffer };
      } catch (error) {
        return {
          error: 'Falló la conexión con Eloísa: ' + String((error && error.message) || error),
        };
      }
    };

    const fetchPrescriptionReportBuffer = async ({ encId, info: knownInfo }) => {
      const context = await getClinicalReportContext(encId, knownInfo);
      if (context.error) return context;
      const { info, patientId } = context;
      const url = prescriptionPrint.buildPrescriptionReportUrl(
        info.apiOrigin,
        encId,
        info.practitionerId,
        patientId
      );
      if (!url) return { error: 'No se pudo construir la solicitud de receta.' };
      const result = await fetchOfficialPdf({
        url,
        token: info.token,
        label: 'la impresión de la receta',
      });
      return result.buffer ? { buffer: result.buffer } : { error: result.error };
    };

    const fetchIndicationsReportBuffer = async ({ encId, info: knownInfo }) => {
      const context = await getClinicalReportContext(encId, knownInfo);
      if (context.error) return context;
      const { info, patientId } = context;
      const url = prescriptionPrint.buildIndicationsReportUrl(
        info.apiOrigin,
        encId,
        info.practitionerId,
        patientId
      );
      if (!url) return { error: 'No se pudo construir la solicitud de indicaciones.' };
      const result = await fetchOfficialPdf({
        url,
        token: info.token,
        label: 'el reporte de indicaciones',
      });
      return result.buffer ? { buffer: result.buffer } : { error: result.error };
    };

    const fetchRegimenReportBuffer = async ({ info: knownInfo }) => {
      const infoResult = knownInfo ? { info: knownInfo } : await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      const url = prescriptionPrint.buildRegimenReportUrl(info.apiOrigin, info.facId);
      if (!url) return { error: 'No se pudo construir la solicitud del reporte de regímenes.' };
      const result = await fetchOfficialPdf({
        url,
        token: info.token,
        label: 'el reporte de regímenes para Nutrición',
      });
      return result.buffer ? { buffer: result.buffer } : { error: result.error };
    };

    const downloadPdfBuffer = async ({ buffer, filename }) => {
      try {
        const id = await chromeApi.downloads.download({
          url: 'data:application/pdf;base64,' + bufferToBase64(buffer),
          filename,
          saveAs: false,
          conflictAction: 'uniquify',
        });
        return { ok: true, downloadId: id };
      } catch (error) {
        return {
          error: 'No se pudo descargar el PDF: ' + String((error && error.message) || error),
        };
      }
    };

    const openPdfPrintDialog = async ({ buffer, filename }) => {
      try {
        extensionRuntime.ensurePdf();
        const printableBuffer = await pdfPrint.preparePdfForBrowserPrint(buffer);
        const jobId = cryptoApi.randomUUID();
        const storageKey = `hhr-pdf-print-${jobId}`;
        await chromeApi.storage.session.set({
          [storageKey]: {
            base64: bufferToBase64(printableBuffer),
            filename,
            createdAt: now(),
          },
        });
        const tab = await chromeApi.tabs.create({
          url: chromeApi.runtime.getURL(`print-pdf.html?job=${encodeURIComponent(jobId)}`),
          active: true,
        });
        return { ok: true, printTabId: tab && tab.id };
      } catch (error) {
        return {
          error: 'No se pudo abrir el diálogo de impresión: ' +
            String((error && error.message) || error),
        };
      }
    };

    const handleCorrectedEpicrisisPrintRequest = async ({ pdfBase64, patientRun }) => {
      try {
        const normalizedPatientRun = String(patientRun || '')
          .toUpperCase()
          .replace(/[^0-9K]/g, '');
        if (!/^[0-9]{6,8}[0-9K]$/.test(normalizedPatientRun)) {
          return { error: 'No se pudo validar el RUN del paciente seleccionado.' };
        }
        if (String(pdfBase64 || '').length > 20 * 1024 * 1024) {
          return { error: 'El PDF de alta es demasiado grande para corregirlo en la extensión.' };
        }
        const source = base64ToArrayBuffer(pdfBase64);
        const signature = new TextDecoderApi('latin1').decode(new Uint8Array(source).slice(0, 5));
        if (signature !== '%PDF-') return { error: 'Eloísa no entregó un PDF de alta válido.' };
        if (!epicrisisPdf || typeof epicrisisPdf.correctEpicrisisPrescriptionPages !== 'function') {
          return { error: 'El corrector de receta de alta no está disponible. Recarga la extensión.' };
        }
        const corrected = await epicrisisPdf.correctEpicrisisPrescriptionPages(
          source,
          prescriptionPrint,
          pdfLib,
          { expectedPatientRun: normalizedPatientRun }
        );
        return openPdfPrintDialog({
          buffer: corrected,
          filename: 'Alta_medica_receta_separada.pdf',
        });
      } catch (error) {
        return {
          error: 'No se pudo corregir el formato de la receta de alta: ' +
            String((error && error.message) || error),
        };
      }
    };

    const resolveDischargedEncounterIdByRun = async (info, patientRun) => {
      const expectedRun = normalizeRun(patientRun);
      if (!info || !info.apiOrigin || !info.token || !/^\d+$/.test(String(info.facId || ''))) {
        return { error: 'La sesión no permite consultar los pacientes egresados.' };
      }
      const url = new URL('/encounter/list/filter', info.apiOrigin);
      url.searchParams.set('facilityId', String(info.facId));
      url.searchParams.set('healthCarePractitionerId', String(info.practitionerId || ''));
      url.searchParams.set('healthCarePractitionerRoleId', String(info.practitionerRoleId || ''));
      url.searchParams.set('filterType', '2');
      let rows;
      try {
        const response = await fetchWithTimeout(url.toString(), {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) {
          return {
            error: 'Eloísa respondió HTTP ' + response.status +
              ' al consultar pacientes egresados.',
          };
        }
        const payload = await response.json();
        rows = Array.isArray(payload) ? payload : [];
      } catch (error) {
        return {
          error: 'No se pudo consultar la lista de egresados: ' +
            String((error && error.message) || error),
        };
      }

      const rowRun = row => normalizeRun(
        row && (row.patientIdentifier || row.preferredIdentifierCode || row.identifier ||
          row.patient && (row.patient.identifier || row.patient.preferredIdentifierCode))
      );
      const directMatches = rows.filter(row =>
        /^\d+$/.test(String(row && row.id || '')) && rowRun(row) === expectedRun
      );
      if (directMatches.length === 1) return { encId: String(directMatches[0].id) };
      if (directMatches.length > 1) {
        return {
          error: 'Eloísa devolvió más de un episodio egresado para este RUN. ' +
            'Abre el episodio exacto y reintenta.',
        };
      }

      // Some Eloísa list variants omit the RUN but retain the encounter id. Verify every row that
      // actually lacks a RUN, with bounded concurrency, so long discharged lists remain searchable.
      const candidates = rows.filter(row =>
        /^\d+$/.test(String(row && row.id || '')) && !rowRun(row)
      );
      const verified = await mapWithConcurrency(candidates, 5, async row => {
        try {
          const response = await fetchWithTimeout(
            `${info.apiOrigin}/api/encounter/patientHeaderData/${encodeURIComponent(row.id)}/false`,
            {
              headers: { Authorization: info.token, Accept: 'application/json' },
              credentials: 'omit',
              cache: 'no-store',
            }
          );
          if (!response.ok) return '';
          const header = await response.json();
          return normalizeRun(header && header.preferredIdentifierCode) === expectedRun
            ? String(row.id)
            : '';
        } catch (_error) {
          return '';
        }
      });
      const encounterIds = [...new Set(verified.filter(Boolean))];
      if (encounterIds.length === 1) return { encId: encounterIds[0] };
      if (encounterIds.length > 1) {
        return {
          error: 'Eloísa devolvió más de un episodio egresado para este RUN. ' +
            'Abre el episodio exacto y reintenta.',
        };
      }
      return { error: 'No se encontró la epicrisis médica del paciente en la lista de egresados.' };
    };

    const handleNursingMedicalEpicrisisPrintRequest = async ({ encId, patientRun, sender }) => {
      const normalizedPatientRun = normalizeRun(patientRun);
      if (!/^[0-9]{6,8}[0-9K]$/.test(normalizedPatientRun)) {
        return { error: 'No se pudo validar el RUN del paciente seleccionado.' };
      }
      const infoResult = await getFichaFetchInfo(sender);
      if (infoResult.error) return infoResult;
      let resolvedEncounterId = /^\d+$/.test(String(encId || '')) ? String(encId) : '';
      let context = resolvedEncounterId
        ? await getClinicalReportContext(resolvedEncounterId, infoResult.info, null, sender)
        : null;
      const initialContextRun = normalizeRun(context && context.patient && context.patient.run);
      if (!resolvedEncounterId || context && (
        context.error || initialContextRun !== normalizedPatientRun
      )) {
        const resolved = await resolveDischargedEncounterIdByRun(
          infoResult.info,
          normalizedPatientRun
        );
        if (resolved.error) return resolved;
        resolvedEncounterId = resolved.encId;
        context = null;
      }
      if (!context) {
        context = await getClinicalReportContext(
          resolvedEncounterId,
          infoResult.info,
          null,
          sender
        );
      }
      if (context.error) return context;
      const contextRun = normalizeRun(context.patient && context.patient.run);
      if (!contextRun || contextRun !== normalizedPatientRun) {
        return {
          error: 'El episodio ya no corresponde al RUN seleccionado. ' +
            'Actualiza la lista antes de imprimir.',
        };
      }
      if (!epicrisisPdf || typeof epicrisisPdf.correctEpicrisisPrescriptionPages !== 'function') {
        return { error: 'El corrector de epicrisis no está disponible. Recarga la extensión.' };
      }
      let lastError = '';
      for (const reportName of MEDICAL_EPICRISIS_REPORT_CANDIDATES) {
        const url = prescriptionPrint.buildClinicalReportUrl(
          context.info.apiOrigin,
          reportName,
          resolvedEncounterId,
          context.info.practitionerId,
          context.patientId,
          ''
        );
        if (!url) continue;
        const report = await fetchOfficialPdf({
          url,
          token: context.info.token,
          label: 'la epicrisis médica',
        });
        if (report.fatal) return { error: report.error };
        if (report.error) {
          lastError = report.error;
          continue;
        }
        try {
          const corrected = await epicrisisPdf.correctEpicrisisPrescriptionPages(
            report.buffer,
            prescriptionPrint,
            pdfLib,
            { expectedPatientRun: normalizedPatientRun }
          );
          return openPdfPrintDialog({
            buffer: corrected,
            filename: 'Epicrisis_medica_corregida_' + String(resolvedEncounterId) + '.pdf',
          });
        } catch (error) {
          lastError = String((error && error.message) || error);
        }
      }
      return {
        error: 'Eloísa no entregó una epicrisis médica imprimible para este episodio.' +
          (lastError ? ' Detalle: ' + lastError : ''),
      };
    };

    const routeNursingMedicalEpicrisisRequest = request =>
      root.HhrEpicrisisDownloadRuntime.handleRequest({
        ...request, fetchWithTimeout, getFichaFetchInfo, fetchOfficialPdf, downloadPdfBuffer,
        chrome: chromeApi, now, printFallback: handleNursingMedicalEpicrisisPrintRequest,
      });

    const createCompletePrescriptionPdf = async ({
      encId,
      printFormat,
      info,
      allowOfficialFallback = false,
    }) => {
      const format = printFormat === 'compact' ? 'compact' : 'standard';
      const officialResult = await fetchPrescriptionReportBuffer({ encId, info });
      if (officialResult.error) return officialResult;
      if (format === 'standard') {
        return {
          buffer: officialResult.buffer,
          filename: prescriptionPrint.buildPrescriptionFilename(encId),
        };
      }

      extensionRuntime.ensurePdf();
      const compactFailure = message => allowOfficialFallback
        ? { buffer: officialResult.buffer, compactFallbackReason: message }
        : { error: message };

      let officialContent;
      try {
        officialContent = await prescriptionPrint.extractOfficialPrescriptionContent(
          // Keep the fetched PDF untouched for the official fallback. A PDF parser may
          // transfer/detach the ArrayBuffer it receives while loading the document.
          officialResult.buffer.slice(0)
        );
      } catch (error) {
        return compactFailure(
          'No se pudo compactar la receta oficial: ' +
            String((error && error.message) || error)
        );
      }
      if (!officialContent || !officialContent.folio || !officialContent.emissionDateTime) {
        return compactFailure(
          'La receta oficial no informó todo el contenido necesario para su versión compacta.'
        );
      }
      if (!officialContent.medications.length) {
        return compactFailure('La receta oficial no contiene fármacos para compactar.');
      }

      try {
        return {
          buffer: prescriptionPdf.generateProfessionalPrescriptionPdf({
            patient: officialContent.patient,
            professional: officialContent.professional,
            professionalRun: officialContent.professionalRun,
            medications: officialContent.medications,
            validationDate: officialContent.prescriptionDate,
            emissionDateTime: officialContent.emissionDateTime,
            folio: officialContent.folio,
            printedBy: officialContent.printedBy,
            address: officialContent.address,
            officialEquivalent: true,
            printFormat: format,
          }),
          filename: prescriptionPrint.buildPrescriptionFilename(
            encId,
            officialContent.professional || 'vigente',
            format
          ),
        };
      } catch (error) {
        return compactFailure(
          'No se pudo generar la receta compacta: ' +
            String((error && error.message) || error)
        );
      }
    };

    return {
      fetchOfficialPdf,
      fetchPrescriptionReportBuffer,
      fetchIndicationsReportBuffer,
      fetchRegimenReportBuffer,
      downloadPdfBuffer,
      openPdfPrintDialog,
      handleCorrectedEpicrisisPrintRequest,
      handleNursingMedicalEpicrisisPrintRequest: routeNursingMedicalEpicrisisRequest,
      createCompletePrescriptionPdf,
    };
  };

  root.HhrClinicalReportRuntime = { create };
})(typeof globalThis !== 'undefined' ? globalThis : self);
