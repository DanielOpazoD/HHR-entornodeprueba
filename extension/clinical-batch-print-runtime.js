/**
 * Hospitalized clinical-document batch owner for the MV3 background worker.
 *
 * Owns option discovery and batch printing for prescriptions, indications and the integrated
 * regimen report. Active-census reads are shared with other clinical modules and remain injected
 * by background.js; this runtime owns every batch session, allowlist and print policy.
 */
(function (root) {
  'use strict';

  const PRESCRIPTION_BATCH_PREFIX = 'hhr-prescription-batch-';
  const INDICATIONS_BATCH_PREFIX = 'hhr-indications-batch-';
  const PRESCRIPTION_BATCH_LIMIT = 24;
  const INDICATIONS_BATCH_TTL_MS = 30 * 60 * 1000;
  const MAX_SELECTED_PATIENTS = 120;

  const create = dependencies => {
    const {
      chrome: chromeApi,
      crypto: cryptoApi,
      getFichaFetchInfo,
      fetchActiveHospitalizedPatients,
      handleSnapshotRequest,
      mapWithConcurrency,
      fetchPrescriptionEvents,
      fetchBradenHistoryEvents,
      fetchEvaluationForms,
      fetchNutritionOrderEntry,
      verifySelectedEncountersStillHospitalized,
      fichaSessionCacheKey,
      createCompletePrescriptionPdf,
      fetchIndicationsReportBuffer,
      openPdfPrintDialog,
      extensionRuntime,
      pdfPrint,
      prescriptionPrint,
      prescriptionPdf,
      now,
    } = dependencies || {};

    if (
      !chromeApi || !chromeApi.storage || !chromeApi.storage.session ||
      typeof chromeApi.storage.session.get !== 'function' ||
      typeof chromeApi.storage.session.set !== 'function' ||
      typeof chromeApi.storage.session.remove !== 'function' ||
      !cryptoApi || typeof cryptoApi.randomUUID !== 'function' ||
      typeof getFichaFetchInfo !== 'function' ||
      typeof fetchActiveHospitalizedPatients !== 'function' ||
      typeof handleSnapshotRequest !== 'function' || typeof mapWithConcurrency !== 'function' ||
      typeof fetchPrescriptionEvents !== 'function' ||
      typeof fetchBradenHistoryEvents !== 'function' ||
      typeof fetchEvaluationForms !== 'function' ||
      typeof fetchNutritionOrderEntry !== 'function' ||
      typeof verifySelectedEncountersStillHospitalized !== 'function' ||
      typeof fichaSessionCacheKey !== 'function' ||
      typeof createCompletePrescriptionPdf !== 'function' ||
      typeof fetchIndicationsReportBuffer !== 'function' ||
      typeof openPdfPrintDialog !== 'function' ||
      !extensionRuntime || typeof extensionRuntime.ensurePdf !== 'function' ||
      !pdfPrint || typeof pdfPrint.mergePdfBuffers !== 'function' ||
      !prescriptionPrint ||
      typeof prescriptionPrint.activeHospitalizedEncounters !== 'function' ||
      typeof prescriptionPrint.deriveLatestBraden !== 'function' ||
      typeof prescriptionPrint.deriveLatestNutritionOrder !== 'function' ||
      typeof prescriptionPrint.applyProfessionalValidationDates !== 'function' ||
      typeof prescriptionPrint.deriveProfessionalPrescriptionGroups !== 'function' ||
      typeof prescriptionPrint.buildHospitalizedPrescriptionSummary !== 'function' ||
      typeof prescriptionPrint.isPrescriptionBatchSessionValid !== 'function' ||
      typeof prescriptionPrint.buildBatchPrescriptionFilename !== 'function' ||
      typeof prescriptionPrint.buildBatchIndicationsFilename !== 'function' ||
      typeof prescriptionPrint.buildRegimenFilename !== 'function' ||
      !prescriptionPdf || typeof prescriptionPdf.generateIntegratedRegimenPdf !== 'function' ||
      typeof now !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime batch de documentos hospitalizados.');
    }

    const selectAllowedEncounterIds = (encIds, allowedEncounterIds) => {
      const allowed = new Set(
        (Array.isArray(allowedEncounterIds) ? allowedEncounterIds : []).map(String)
      );
      return Array.from(new Set(Array.isArray(encIds) ? encIds.map(String) : []))
        .filter(encId => /^\d+$/.test(encId) && allowed.has(encId));
    };

    const fetchHospitalizedRegimenSummaries = async (patients, info, currentEncId) =>
      mapWithConcurrency(patients, 4, async patient => {
        const [nutrition, history, forms] = await Promise.all([
          fetchNutritionOrderEntry(patient.encounterId, info),
          fetchBradenHistoryEvents(patient.encounterId, info),
          fetchEvaluationForms(patient.encounterId, info),
        ]);
        const bradenReadErrors = [history.error, forms.error].filter(Boolean).join(' ');
        const braden = bradenReadErrors ? null : prescriptionPrint.deriveLatestBraden(
          history.error ? [] : history.events,
          forms.error ? [] : forms.forms
        );
        return {
          ...patient,
          regimen: nutrition.error
            ? null
            : prescriptionPrint.deriveLatestNutritionOrder(nutrition.entry),
          regimenUnavailableReason: nutrition.error || '',
          braden,
          isCurrent: String(patient.encounterId) === String(currentEncId || ''),
          bradenUnavailableReason: bradenReadErrors,
        };
      });

    const getActiveHospitalizedPatientsWithFallback = async info => {
      const patientResult = await fetchActiveHospitalizedPatients(info);
      if (!patientResult.error) return patientResult;
      const snapshotResult = await handleSnapshotRequest();
      if (snapshotResult.error) return { error: patientResult.error + ' ' + snapshotResult.error };
      return {
        patients: prescriptionPrint.activeHospitalizedEncounters(snapshotResult.snapshot),
      };
    };

    const sweepPrescriptionBatches = async (timestamp = now()) => {
      const stored = await chromeApi.storage.session.get(null);
      const entries = Object.entries(stored || {})
        .filter(([key]) => key.startsWith(PRESCRIPTION_BATCH_PREFIX));
      const expiredKeys = entries
        .filter(([, batch]) => {
          const expiresAt = Number(batch && batch.expiresAt || 0);
          return !batch || !batch.sessionKey || !Number.isFinite(Number(batch.createdAt)) ||
            expiresAt > 0 && timestamp >= expiresAt;
        })
        .map(([key]) => key);
      const expired = new Set(expiredKeys);
      const overflowKeys = entries
        .filter(([key]) => !expired.has(key))
        .sort((left, right) =>
          Number(right[1].lastUsedAt || right[1].createdAt || 0) -
          Number(left[1].lastUsedAt || left[1].createdAt || 0)
        )
        .slice(Math.max(0, PRESCRIPTION_BATCH_LIMIT))
        .map(([key]) => key);
      const removable = [...expiredKeys, ...overflowKeys];
      if (removable.length) await chromeApi.storage.session.remove(removable);
    };

    const handleHospitalizedPrescriptionOptionsRequest = async ({ currentEncId, sender }) => {
      const infoResult = await getFichaFetchInfo(sender);
      if (infoResult.error) return infoResult;
      const patientResult = await getActiveHospitalizedPatientsWithFallback(infoResult.info);
      if (patientResult.error) return patientResult;
      const patients = patientResult.patients;
      if (patients.length === 0) {
        return { ok: true, batchId: '', patients: [], unavailableCount: 0 };
      }

      const summaries = await mapWithConcurrency(patients, 4, async patient => {
        const history = await fetchPrescriptionEvents(patient.encounterId, infoResult.info);
        if (history.error) {
          return {
            ...prescriptionPrint.buildHospitalizedPrescriptionSummary(patient, [], currentEncId),
            unavailableReason: history.error,
          };
        }
        const groups = prescriptionPrint.applyProfessionalValidationDates(
          prescriptionPrint.deriveProfessionalPrescriptionGroups(history.events),
          history.events,
          null
        );
        return prescriptionPrint.buildHospitalizedPrescriptionSummary(
          patient,
          groups,
          currentEncId
        );
      });

      const printableIds = summaries
        .filter(patient => patient.medicationCount > 0 && !patient.unavailableReason)
        .map(patient => patient.encounterId);
      const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
      const expiresAt = Number(infoResult.info && infoResult.info.expiresAt);
      await sweepPrescriptionBatches();
      const batchId = cryptoApi.randomUUID();
      await chromeApi.storage.session.set({
        [`${PRESCRIPTION_BATCH_PREFIX}${batchId}`]: {
          allowedEncounterIds: printableIds,
          createdAt: now(),
          sessionKey,
          expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
        },
      });
      return {
        ok: true,
        batchId,
        patients: summaries,
        unavailableCount: summaries.filter(patient => patient.unavailableReason).length,
      };
    };

    const handleHospitalizedPrescriptionPrintRequest = async ({
      batchId,
      encIds,
      printFormat,
      sender,
    }) => {
      extensionRuntime.ensurePdf();
      if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || ''))) {
        return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
      }
      const storageKey = `${PRESCRIPTION_BATCH_PREFIX}${batchId}`;
      const stored = await chromeApi.storage.session.get(storageKey);
      const batch = stored && stored[storageKey];
      if (!batch) {
        return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
      }
      const infoResult = await getFichaFetchInfo(sender);
      if (infoResult.error) return infoResult;
      const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
      if (!prescriptionPrint.isPrescriptionBatchSessionValid(batch, sessionKey, now())) {
        await chromeApi.storage.session.remove(storageKey);
        return { error: 'La sesión clínica cambió o venció. Actualiza la lista y vuelve a intentarlo.' };
      }
      const selected = selectAllowedEncounterIds(encIds, batch.allowedEncounterIds);
      if (selected.length === 0) {
        return { error: 'Selecciona al menos un paciente con receta disponible.' };
      }
      if (selected.length > MAX_SELECTED_PATIENTS) {
        return { error: 'La selección supera el máximo seguro de 120 pacientes.' };
      }

      const activeSelection = await verifySelectedEncountersStillHospitalized(
        selected,
        infoResult.info
      );
      if (activeSelection.error) return activeSelection;
      const format = printFormat === 'compact' ? 'compact' : 'standard';
      const generated = await mapWithConcurrency(selected, 2, async encId => {
        const result = await createCompletePrescriptionPdf({
          encId,
          printFormat: format,
          info: infoResult.info,
          allowOfficialFallback: format === 'compact',
        });
        return result.error
          ? { encId, error: result.error }
          : {
              encId,
              buffer: result.buffer,
              compactFallbackReason: result.compactFallbackReason || '',
            };
      });
      const completed = generated.filter(item => item.buffer);
      const skipped = generated
        .filter(item => item.error)
        .map(item => ({ encId: item.encId, error: item.error }));
      const compactFallbacks = completed
        .filter(item => item.compactFallbackReason)
        .map(item => ({ encId: item.encId, reason: item.compactFallbackReason }));
      if (completed.length === 0) {
        return { error: 'No se pudo generar ninguna de las recetas seleccionadas.', skipped };
      }

      let combinedBuffer;
      try {
        combinedBuffer = await pdfPrint.mergePdfBuffers(completed.map(item => item.buffer));
      } catch (error) {
        return {
          error: 'No se pudieron unir las recetas: ' + String((error && error.message) || error),
        };
      }
      const opened = await openPdfPrintDialog({
        buffer: combinedBuffer,
        filename: prescriptionPrint.buildBatchPrescriptionFilename(
          completed.length,
          format,
          new Date().toISOString()
        ),
      });
      if (opened.error) return opened;
      await chromeApi.storage.session.set({
        [storageKey]: { ...batch, lastUsedAt: now() },
      });
      return { ...opened, count: completed.length, skipped, compactFallbacks };
    };

    const handleHospitalizedIndicationsOptionsRequest = async ({ currentEncId }) => {
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const patientResult = await getActiveHospitalizedPatientsWithFallback(infoResult.info);
      if (patientResult.error) return patientResult;
      const patients = patientResult.patients.map(patient => ({
        ...patient,
        isCurrent: String(patient.encounterId) === String(currentEncId || ''),
      }));
      const batchId = cryptoApi.randomUUID();
      await chromeApi.storage.session.set({
        [`${INDICATIONS_BATCH_PREFIX}${batchId}`]: {
          allowedEncounterIds: patients.map(patient => patient.encounterId),
          createdAt: now(),
        },
      });
      return { ok: true, batchId, patients };
    };

    const handleHospitalizedIndicationsPrintRequest = async ({ batchId, encIds }) => {
      extensionRuntime.ensurePdf();
      if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || ''))) {
        return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
      }
      const storageKey = `${INDICATIONS_BATCH_PREFIX}${batchId}`;
      const stored = await chromeApi.storage.session.get(storageKey);
      const batch = stored && stored[storageKey];
      if (!batch || now() - Number(batch.createdAt || 0) > INDICATIONS_BATCH_TTL_MS) {
        return { error: 'La selección de pacientes expiró. Actualiza la lista y vuelve a intentarlo.' };
      }
      const selected = selectAllowedEncounterIds(encIds, batch.allowedEncounterIds);
      if (selected.length === 0) return { error: 'Selecciona al menos un paciente.' };
      if (selected.length > MAX_SELECTED_PATIENTS) {
        return { error: 'La selección supera el máximo seguro de 120 pacientes.' };
      }

      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const activeSelection = await verifySelectedEncountersStillHospitalized(
        selected,
        infoResult.info
      );
      if (activeSelection.error) return activeSelection;
      const generated = await mapWithConcurrency(selected, 2, async encId => {
        const result = await fetchIndicationsReportBuffer({ encId, info: infoResult.info });
        return result.error ? { encId, error: result.error } : { encId, buffer: result.buffer };
      });
      const completed = generated.filter(item => item.buffer);
      const skipped = generated
        .filter(item => item.error)
        .map(item => ({ encId: item.encId, error: item.error }));
      if (completed.length === 0) {
        return { error: 'No se pudo generar ninguna de las indicaciones seleccionadas.', skipped };
      }
      let combinedBuffer;
      try {
        combinedBuffer = await pdfPrint.mergePdfBuffers(completed.map(item => item.buffer));
      } catch (error) {
        return {
          error: 'No se pudieron unir las indicaciones: ' +
            String((error && error.message) || error),
        };
      }
      const opened = await openPdfPrintDialog({
        buffer: combinedBuffer,
        filename: prescriptionPrint.buildBatchIndicationsFilename(
          completed.length,
          new Date().toISOString()
        ),
      });
      if (opened.error) return opened;
      await chromeApi.storage.session.remove(storageKey);
      return { ...opened, count: completed.length, skipped };
    };

    const handleHospitalizedRegimenOptionsRequest = async ({ currentEncId }) => {
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const patientResult = await fetchActiveHospitalizedPatients(infoResult.info);
      if (patientResult.error) return patientResult;
      const patients = await fetchHospitalizedRegimenSummaries(
        patientResult.patients,
        infoResult.info,
        currentEncId
      );
      return {
        ok: true,
        patients,
        bradenCount: patients.filter(patient => patient.braden).length,
        regimenCount: patients.filter(patient => patient.regimen).length,
        regimenErrorCount: patients.filter(patient => patient.regimenUnavailableReason).length,
        unavailableCount: patients.filter(patient => patient.bradenUnavailableReason).length,
      };
    };

    const handleHospitalizedRegimenPrintRequest = async () => {
      extensionRuntime.ensurePdf();
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const patientResult = await fetchActiveHospitalizedPatients(infoResult.info);
      if (patientResult.error) return patientResult;
      if (patientResult.patients.length === 0) {
        return { error: 'No hay pacientes hospitalizados para imprimir.' };
      }

      const patients = await fetchHospitalizedRegimenSummaries(
        patientResult.patients,
        infoResult.info,
        ''
      );
      const regimenErrors = patients.filter(patient => patient.regimenUnavailableReason);
      const bradenErrors = patients.filter(patient => patient.bradenUnavailableReason);
      if (regimenErrors.length || bradenErrors.length) {
        const failures = [];
        if (regimenErrors.length) {
          failures.push(
            'el régimen de ' + regimenErrors.length +
            (regimenErrors.length === 1 ? ' paciente' : ' pacientes')
          );
        }
        if (bradenErrors.length) {
          failures.push(
            'BRADEN de ' + bradenErrors.length +
            (bradenErrors.length === 1 ? ' paciente' : ' pacientes')
          );
        }
        return {
          error: 'No se imprimió: Eloísa no permitió verificar ' + failures.join(' ni ') +
            '. Reintenta la consulta.',
        };
      }
      let integrated;
      try {
        const generatedAt = new Date();
        const localIso = new Date(
          generatedAt.getTime() - generatedAt.getTimezoneOffset() * 60 * 1000
        ).toISOString().slice(0, 19);
        integrated = prescriptionPdf.generateIntegratedRegimenPdf({ patients, generatedAt: localIso });
      } catch (error) {
        return {
          error: 'No se pudo generar el régimen integrado: ' +
            String((error && error.message) || error),
        };
      }
      const opened = await openPdfPrintDialog({
        buffer: integrated,
        filename: prescriptionPrint.buildRegimenFilename(new Date().toISOString()),
      });
      if (opened.error) return opened;
      return {
        ...opened,
        count: patients.length,
        regimenCount: patients.filter(patient => patient.regimen).length,
        bradenCount: patients.filter(patient => patient.braden).length,
      };
    };

    return Object.freeze({
      handleHospitalizedPrescriptionOptionsRequest,
      handleHospitalizedPrescriptionPrintRequest,
      handleHospitalizedIndicationsOptionsRequest,
      handleHospitalizedIndicationsPrintRequest,
      handleHospitalizedRegimenOptionsRequest,
      handleHospitalizedRegimenPrintRequest,
      sweepPrescriptionBatches,
    });
  };

  root.HhrClinicalBatchPrintRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
