/**
 * Clinical handoff owner for the MV3 background worker.
 *
 * Owns Turno option discovery, batch authorization, verified writes, recovery reads and the
 * official nursing report. Shared census, identity, claims and write-protection primitives stay
 * injected by background.js so this owner does not duplicate cross-cutting clinical policy.
 */
(function (root) {
  'use strict';

  const HANDOFF_BATCH_PREFIX = 'hhr-handoff-batch-';
  const HANDOFF_BATCH_TTL_MS = 30 * 60 * 1000;

  const create = dependencies => {
    const {
      chrome: chromeApi,
      crypto: cryptoApi,
      fetchWithTimeout,
      getFichaFetchInfo,
      resolveSessionHandoffKind,
      fetchFichaClaims,
      hasFichaClaim,
      fetchActiveHospitalizedPatients,
      mapWithConcurrency,
      serializeClinicalWriteProtection,
      withClinicalWriteLock,
      verifyEncounterStillHospitalized,
      clinicalRecordKey,
      collectClinicalTimestampBaseline,
      hasNewClinicalTimestamp,
      fetchOfficialPdf,
      openPdfPrintDialog,
      prescriptionPrint,
      now,
      wait,
    } = dependencies || {};

    if (
      !chromeApi || !chromeApi.storage || !chromeApi.storage.session ||
      typeof chromeApi.storage.session.get !== 'function' ||
      typeof chromeApi.storage.session.set !== 'function' ||
      !cryptoApi || typeof cryptoApi.randomUUID !== 'function' ||
      typeof fetchWithTimeout !== 'function' ||
      typeof getFichaFetchInfo !== 'function' ||
      typeof resolveSessionHandoffKind !== 'function' ||
      typeof fetchFichaClaims !== 'function' || typeof hasFichaClaim !== 'function' ||
      typeof fetchActiveHospitalizedPatients !== 'function' ||
      typeof mapWithConcurrency !== 'function' ||
      typeof serializeClinicalWriteProtection !== 'function' ||
      typeof withClinicalWriteLock !== 'function' ||
      typeof verifyEncounterStillHospitalized !== 'function' ||
      typeof clinicalRecordKey !== 'function' ||
      typeof collectClinicalTimestampBaseline !== 'function' ||
      typeof hasNewClinicalTimestamp !== 'function' ||
      typeof fetchOfficialPdf !== 'function' || typeof openPdfPrintDialog !== 'function' ||
      !prescriptionPrint ||
      typeof prescriptionPrint.handoffEncounterEventTypeId !== 'function' ||
      typeof prescriptionPrint.deriveLatestShiftChange !== 'function' ||
      typeof prescriptionPrint.entryMatchesHandoffKind !== 'function' ||
      typeof now !== 'function' || typeof wait !== 'function'
    ) {
      throw new Error('No se pudo inicializar el runtime clínico de entrega de turno.');
    }

    const fetchShiftChangeEntries = async (encId, info) => {
      if (!/^\d+$/.test(String(encId || '')) || !info || !info.practitionerId) {
        return { error: 'Faltan datos para leer la entrega de turno.' };
      }
      try {
        const response = await fetchWithTimeout(
          `${info.apiOrigin}/api/encounter/entrySummary/shiftChangeObservationEntry/` +
            `${encodeURIComponent(encId)}/${encodeURIComponent(info.practitionerId)}`,
          {
            headers: { Authorization: info.token, Accept: 'application/json' },
            credentials: 'omit',
            cache: 'no-store',
          }
        );
        if (response.status === 204) return { entries: [] };
        if (!response.ok) {
          return { error: 'Eloísa respondió HTTP ' + response.status + ' al leer la entrega.' };
        }
        const payload = await response.json();
        return { entries: Array.isArray(payload) ? payload : payload ? [payload] : [] };
      } catch (error) {
        return {
          error: 'No se pudo leer la entrega de turno: ' +
            String((error && error.message) || error),
        };
      }
    };

    const fetchNurseStations = async info => {
      try {
        const url = new URL('/api/bedManagement/nurseStation', info.apiOrigin);
        url.searchParams.set('facilityId', info.facId);
        url.searchParams.set('tid', '0');
        const response = await fetchWithTimeout(url.toString(), {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok) return [];
        const rows = await response.json();
        return (Array.isArray(rows) ? rows : []).map(row => ({
          id: String(row && row.id || ''),
          name: String(row && (row.name || row.shortName) || '').trim(),
        })).filter(row => /^\d+$/.test(row.id) && row.name);
      } catch (_error) {
        return [];
      }
    };

    const handoffPresentation = kind => kind === 'medical'
      ? { label: 'Entrega de turno médica', role: 'Médico' }
      : { label: 'Entrega de turno de enfermería', role: 'Enfermería' };

    const handoffClinicalWriteKey = (kind, encId) => kind === 'medical'
      ? 'handoff:medical:' + String(encId || '')
      : 'handoff:' + String(encId || '');

    const handleOptionsRequest = async ({ currentEncId }) => {
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      const handoffKind = resolveSessionHandoffKind(info);
      const handoffEventTypeId = prescriptionPrint.handoffEncounterEventTypeId(handoffKind);
      const identityReady = Boolean(
        info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
          /^\d+$/.test(String(info.practitionerRoleId || '')) && handoffKind && handoffEventTypeId
      );
      if (!identityReady) {
        return { error: 'No se pudo verificar un rol médico o de enfermería en la sesión.' };
      }
      const claimsResult = await fetchFichaClaims(info);
      if (claimsResult.error) return claimsResult;
      const canViewHandoff = hasFichaClaim(claimsResult, 'Ver_Cambio_Turno');
      if (!canViewHandoff) {
        return { error: 'El perfil no tiene permiso para ver entregas de turno.' };
      }
      const patientResult = await fetchActiveHospitalizedPatients(info);
      if (patientResult.error) return patientResult;
      const [nurseStations, summaries] = await Promise.all([
        handoffKind === 'nursing' ? fetchNurseStations(info) : Promise.resolve([]),
        mapWithConcurrency(patientResult.patients, 4, async patient => {
          const [result, clinicalWriteProtection] = await Promise.all([
            fetchShiftChangeEntries(patient.encounterId, info),
            serializeClinicalWriteProtection(
              handoffClinicalWriteKey(handoffKind, patient.encounterId)
            ),
          ]);
          return {
            ...patient,
            isCurrent: String(patient.encounterId) === String(currentEncId || ''),
            latestHandoff: result.error
              ? null
              : prescriptionPrint.deriveLatestShiftChange(
                  result.entries,
                  { kind: handoffKind }
                ),
            // Both lanes are shared reading: every profile sees the latest medical AND nursing
            // handoff; writing stays restricted to the session's own lane.
            latestMedical: result.error
              ? null
              : prescriptionPrint.deriveLatestShiftChange(result.entries, { kind: 'medical' }),
            latestNursing: result.error
              ? null
              : prescriptionPrint.deriveLatestShiftChange(result.entries, { kind: 'nursing' }),
            handoffUnavailableReason: result.error || '',
            clinicalWriteProtection,
          };
        }),
      ]);
      const canWrite = hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno');
      const batchId = cryptoApi.randomUUID();
      await chromeApi.storage.session.set({
        [`${HANDOFF_BATCH_PREFIX}${batchId}`]: {
          allowedEncounterIds: summaries.map(patient => patient.encounterId),
          createdAt: now(),
          handoffKind,
          practitionerRoleId: String(info.practitionerRoleId),
        },
      });
      const presentation = handoffPresentation(handoffKind);
      return {
        ok: true,
        batchId,
        patients: summaries,
        nurseStations,
        canWrite,
        canPrint: handoffKind === 'nursing',
        handoffKind,
        handoffLabel: presentation.label,
        currentProfessional: info.fullName || '',
        currentProfessionalRole: presentation.role,
        writeBlockedReason: canWrite
          ? ''
          : 'El perfil no tiene permiso para ingresar entregas de turno.',
      };
    };

    const readBatch = async (batchId, encId) => {
      if (!/^[a-f0-9-]{20,}$/i.test(String(batchId || '')) ||
          !/^\d+$/.test(String(encId || ''))) {
        return { error: 'La sesión de entrega de turno no es válida.' };
      }
      const storageKey = `${HANDOFF_BATCH_PREFIX}${batchId}`;
      const stored = await chromeApi.storage.session.get(storageKey);
      const batch = stored && stored[storageKey];
      if (!batch || now() - Number(batch.createdAt || 0) > HANDOFF_BATCH_TTL_MS) {
        return { error: 'La sesión de entrega expiró. Actualiza el módulo y vuelve a intentarlo.' };
      }
      if (!(Array.isArray(batch.allowedEncounterIds) ? batch.allowedEncounterIds : [])
        .map(String).includes(String(encId))) {
        return { error: 'El paciente no pertenece a esta lista de hospitalizados.' };
      }
      return { ok: true, batch };
    };

    const readFinishRegisterEvent = async (encId, info) => {
      const url =
        `${info.apiOrigin}/api/encounter/${encodeURIComponent(encId)}/` +
        'encounterEvent/0/getFinishRegister';
      try {
        const response = await fetchWithTimeout(url, {
          headers: { Authorization: info.token, Accept: 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
        });
        if (response.status === 204) return { event: null };
        if (!response.ok) {
          return {
            error: 'Eloísa respondió HTTP ' + response.status +
              ' al preparar la confirmación final.',
          };
        }
        const raw = (await response.text()).trim();
        if (!raw || raw === 'false' || raw === 'null') return { event: null };
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_error) {
          return { error: 'Eloísa devolvió una confirmación final con formato no reconocido.' };
        }
        const event = parsed && parsed.data && typeof parsed.data === 'object'
          ? parsed.data
          : parsed;
        if (!event || typeof event !== 'object' || Array.isArray(event)) {
          return { error: 'Eloísa no devolvió el evento pendiente que debe finalizarse.' };
        }
        if (!/^\d+$/.test(String(event.id || '')) ||
            String(event.encounterId || '') !== String(encId) ||
            String(event.facilityId || '') !== String(info.facId) ||
            String(event.healthCarePractitionerRoleId || '') !==
              String(info.practitionerRoleId)) {
          return {
            error: 'El evento pendiente no coincide con este episodio, establecimiento o rol clínico.',
          };
        }
        const legalId = String(event.healthCarePractitionerLegalId || '');
        if (legalId && legalId !== String(info.practitionerId)) {
          return { error: 'El evento pendiente pertenece a otro profesional y no se confirmó.' };
        }
        return { event };
      } catch (error) {
        return {
          error: 'No se pudo preparar la confirmación final en Eloísa: ' +
            String((error && error.message) || error),
        };
      }
    };

    const confirmFinishRegisterEvent = async (encId, info, event) => {
      const url = new URL(
        `/api/encounter/${encodeURIComponent(encId)}/encounterEvent/` +
          `${encodeURIComponent(event.id)}/confirmedEncounterEvent`,
        info.apiOrigin
      );
      url.searchParams.set('healthCarePractitionerRoleId', String(info.practitionerRoleId));
      url.searchParams.set('facilityId', String(info.facId));
      try {
        const response = await fetchWithTimeout(url.toString(), {
          method: 'PUT',
          headers: {
            Authorization: info.token,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          credentials: 'omit',
          cache: 'no-store',
          body: JSON.stringify(event),
        });
        if (!response.ok) {
          return {
            error: 'Eloísa respondió HTTP ' + response.status +
              ' al finalizar los cambios ingresados.',
          };
        }
        return { ok: true };
      } catch (error) {
        return {
          error: 'Se perdió la confirmación del paso Terminar: ' +
            String((error && error.message) || error),
        };
      }
    };

    const performSaveRequest = async ({ batchId, encId, observation }, writeGuard) => {
      const batch = await readBatch(batchId, encId);
      if (batch.error) return batch;
      const safeObservation = String(observation || '').replace(/\r\n?/g, '\n').trim();
      const normalizedObservation = safeObservation.replace(/\s+/g, ' ').trim();
      if (!safeObservation || safeObservation.length > 255) {
        return { error: 'La entrega debe contener entre 1 y 255 caracteres.' };
      }
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      const handoffKind = resolveSessionHandoffKind(info);
      const handoffEventTypeId = prescriptionPrint.handoffEncounterEventTypeId(handoffKind);
      const identityReady = Boolean(
        info.identityVerified && /^\d+$/.test(String(info.practitionerId || '')) &&
          /^\d+$/.test(String(info.practitionerRoleId || '')) && handoffKind && handoffEventTypeId
      );
      if (!identityReady) return { error: 'No se pudo verificar el rol clínico. Recarga Eloísa.' };
      if (batch.batch.handoffKind !== handoffKind ||
          String(batch.batch.practitionerRoleId) !== String(info.practitionerRoleId)) {
        return {
          error: 'El rol de la sesión cambió. Actualiza la entrega de turno antes de guardar.',
        };
      }
      const activeEncounter = await verifyEncounterStillHospitalized(encId, info);
      if (activeEncounter.error) return activeEncounter;
      const claimsResult = await fetchFichaClaims(info);
      if (claimsResult.error) return claimsResult;
      const canWriteHandoff = (
        hasFichaClaim(claimsResult, 'Ver_Cambio_Turno') &&
        hasFichaClaim(claimsResult, 'Ingresar_Cambio_Turno')
      );
      if (!canWriteHandoff) {
        return { error: 'El perfil no tiene permiso para ingresar entregas de turno.' };
      }

      const baselineResult = await fetchShiftChangeEntries(encId, info);
      if (baselineResult.error) {
        return {
          error: 'No se pudo establecer el estado previo de la entrega; no se guardó. ' +
            baselineResult.error,
        };
      }
      const baselineEntries = baselineResult.entries.filter(entry =>
        entry && prescriptionPrint.entryMatchesHandoffKind(entry, handoffKind)
      );
      const handoffEntryKey = entry => clinicalRecordKey(
        'handoff',
        entry,
        entry && (entry.startDateTime || entry.createDateTime || ''),
        [
          String(entry && entry.observation || '').replace(/\s+/g, ' ').trim(),
          entry && (entry.authorHealthCarePractitionerId || entry.healthCarePractitionerId),
        ]
      );
      const baselineKeys = new Set(baselineEntries.map(handoffEntryKey));
      const timestampBaseline = collectClinicalTimestampBaseline(
        baselineEntries,
        entry => entry && (entry.startDateTime || entry.createDateTime || '')
      );
      const startedAt = now();
      let created = null;
      let postAcknowledged = false;
      let uncertainPostError = '';
      const begun = await writeGuard.beginWrite();
      if (begun.error) return begun;
      try {
        const response = await fetchWithTimeout(
          `${info.apiOrigin}/api/encounter/entrySummary/shiftChangeObservationEntry`,
          {
            method: 'POST',
            headers: {
              Authorization: info.token,
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            credentials: 'omit',
            body: JSON.stringify({
              archived: false,
              authorHealthCarePractitionerId: Number(info.practitionerId),
              authorHealthCarePractitionerRoleId: Number(info.practitionerRoleId),
              confidentialityLevelId: 4,
              encounterEventId: 0,
              encounterId: Number(encId),
              healthCarePractitionerId: Number(info.practitionerId),
              healthCarePractitionerRoleId: Number(info.practitionerRoleId),
              observation: safeObservation,
              encounterEventTypeId: handoffEventTypeId,
            }),
          }
        );
        if (!response.ok) {
          const message = 'Eloísa respondió HTTP ' + response.status + ' al guardar la entrega.';
          if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            return { error: message, definitelyNotApplied: true };
          }
          uncertainPostError = message;
        } else {
          postAcknowledged = true;
          const raw = await response.text();
          if (raw) {
            try { created = JSON.parse(raw); } catch (_error) { created = null; }
          }
        }
      } catch (error) {
        uncertainPostError = 'Se perdió la confirmación al guardar: ' +
          String((error && error.message) || error);
      }

      const createdId = String(created && (created.id || created.data && created.data.id) || '');
      const createdGuid = String(
        created && (created.guid || created.data && created.data.guid) || ''
      );
      let verifiedRecord = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt) await wait(250 * attempt);
        const refreshed = await fetchShiftChangeEntries(encId, info);
        if (refreshed.error) continue;
        const matches = refreshed.entries.filter(entry => {
          if (!postAcknowledged) return false;
          if (!entry) return false;
          if (!prescriptionPrint.entryMatchesHandoffKind(entry, handoffKind)) return false;
          if (createdId && String(entry.id || '') !== createdId) return false;
          if (createdGuid && String(entry.guid || '') !== createdGuid) return false;
          if (baselineKeys.has(handoffEntryKey(entry))) return false;
          const entryDateTime = entry.startDateTime || entry.createDateTime || '';
          if (!hasNewClinicalTimestamp(entryDateTime, timestampBaseline, startedAt)) return false;
          const authorId = String(
            entry.authorHealthCarePractitionerId || entry.healthCarePractitionerId || ''
          );
          const authorMatches = authorId
            ? authorId === String(info.practitionerId)
            : Boolean(createdId || createdGuid);
          return String(entry.observation || '').replace(/\s+/g, ' ').trim() ===
            normalizedObservation && authorMatches;
        });
        if (matches.length === 1) {
          verifiedRecord = prescriptionPrint.deriveLatestShiftChange(
            matches,
            { kind: handoffKind }
          );
          break;
        }
      }
      if (verifiedRecord) {
        const finishRegister = await readFinishRegisterEvent(encId, info);
        if (finishRegister.error) {
          return {
            error: 'La entrega quedó registrada, pero no se completó el paso Terminar. ' +
              finishRegister.error,
            writeMayHaveSucceeded: true,
          };
        }
        if (!finishRegister.event) {
          return {
            error: 'La entrega quedó registrada, pero Eloísa no expuso el evento necesario para completar Terminar.',
            writeMayHaveSucceeded: true,
          };
        }
        const finished = await confirmFinishRegisterEvent(encId, info, finishRegister.event);
        if (finished.error) {
          return {
            error: 'La entrega quedó registrada, pero no se completó el paso Terminar. ' +
              finished.error,
            writeMayHaveSucceeded: true,
          };
        }
        return {
          ok: true,
          verified: true,
          finishConfirmed: true,
          record: { ...verifiedRecord, isSigned: true, requiresValidation: false },
        };
      }
      return {
        error: (uncertainPostError ? uncertainPostError + ' ' : '') +
          'La entrega pudo haberse guardado, pero Eloísa aún no permitió verificarla. Actualiza antes de reintentar.',
        writeMayHaveSucceeded: true,
      };
    };

    const handleSaveRequest = async args => {
      const request = args || {};
      const batch = await readBatch(request.batchId, request.encId);
      if (batch.error) return batch;
      return withClinicalWriteLock(
        handoffClinicalWriteKey(batch.batch.handoffKind, request.encId),
        writeGuard => performSaveRequest(request, writeGuard)
      );
    };

    const readRecoveryReview = async ({ encId, info }) => {
      const handoffKind = resolveSessionHandoffKind(info);
      if (!handoffKind) {
        return { error: 'No se pudo verificar un rol médico o de enfermería en la sesión.' };
      }
      const refreshed = await fetchShiftChangeEntries(encId, info);
      if (refreshed.error) return refreshed;
      const latest = prescriptionPrint.deriveLatestShiftChange(
        refreshed.entries,
        { kind: handoffKind }
      );
      return {
        review: {
          kind: 'handoff',
          handoffKind,
          present: Boolean(latest),
          value: String(latest && latest.observation || ''),
          dateTime: String(latest && latest.dateTime || ''),
          author: String(latest && latest.author || ''),
        },
      };
    };

    const handleReportRequest = async ({ nurseStationId }) => {
      const infoResult = await getFichaFetchInfo();
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      if (!info.identityVerified || !/^\d+$/.test(String(info.practitionerRoleId || '')) ||
          resolveSessionHandoffKind(info) !== 'nursing') {
        return {
          error: 'No se pudo verificar la identidad necesaria para el reporte de turno.',
        };
      }
      const claimsResult = await fetchFichaClaims(info);
      if (claimsResult.error) return claimsResult;
      if (!hasFichaClaim(claimsResult, 'Ver_Cambio_Turno')) {
        return { error: 'El perfil no tiene permiso para imprimir entregas de turno.' };
      }
      const station = /^\d+$/.test(String(nurseStationId || ''))
        ? String(nurseStationId)
        : '0';
      const url = new URL('/api/report/Reporte_Entrega_Turno_Enfermera.pdf', info.apiOrigin);
      url.searchParams.set('fac_id', info.facId);
      url.searchParams.set('hcp_id', info.practitionerId);
      url.searchParams.set('nus_id', station);
      url.searchParams.set('hcpr_id', info.practitionerRoleId);
      const { token } = info;
      const report = await fetchOfficialPdf({
        url: url.toString(),
        token,
        label: 'la entrega de turno',
      });
      if (report.error) return report;
      return openPdfPrintDialog({
        buffer: report.buffer,
        filename: 'Entrega_turno_enfermeria_' +
          new Date(now()).toISOString().slice(0, 10) + '.pdf',
      });
    };

    return Object.freeze({
      handleOptionsRequest,
      handleSaveRequest,
      handleReportRequest,
      readRecoveryReview,
      readBatch,
    });
  };

  root.HhrClinicalHandoffRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
