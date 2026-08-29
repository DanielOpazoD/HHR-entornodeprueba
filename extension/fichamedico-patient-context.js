/**
 * Read-only patient context and active-hospitalization model for the MV3 service worker.
 *
 * Owns patient-header caching, clinical context construction, active census normalization and
 * hospitalization revalidation. Message routing and write orchestration remain in background.js.
 */
(function (root) {
  'use strict';

  const PATIENT_HEADER_CACHE_TTL_MS = 60_000;
  const PATIENT_HEADER_CACHE_MAX_ENTRIES = 60;

  const errorMessage = error =>
    String((error && error.message) || error || 'error desconocido');

  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };

  const asObject = value => value && typeof value === 'object' ? value : {};

  const firstTruthy = (...values) => {
    for (const value of values) {
      if (value) return value;
    }
    return '';
  };

  const encounterIdFromRow = row => String(firstTruthy(row && row.id, row && row.encounterId));

  const isEncounterActive = row => Boolean(
    row &&
    !Boolean(row.hasMedicalDischarge || row.medicalDischarge) &&
    !String(row.medicalDischargeDateTime || '').trim() &&
    !Boolean(row.isDead)
  );

  const normalizeHospitalizedEncounter = (rawRow, rawHeader) => {
    const row = asObject(rawRow);
    const fallback = asObject(row.patient);
    const patient = rawHeader && typeof rawHeader === 'object' ? rawHeader : fallback;
    return {
      encounterId: encounterIdFromRow(row),
      run: firstTruthy(patient.preferredIdentifierCode, fallback.identifier, row.patientIdentifier),
      firstGivenName: firstTruthy(
        patient.firstGivenName,
        patient.givenName,
        fallback.firstGivenName,
        row.patientName
      ),
      nextGivenNames: firstTruthy(patient.nextGivenNames, fallback.nextGivenNames),
      firstFamilyName: firstTruthy(
        patient.firstFamilyName,
        patient.familyName,
        fallback.firstFamilyName
      ),
      secondFamilyName: firstTruthy(patient.secondFamilyName, fallback.secondFamilyName),
      service: firstTruthy(
        row.hospitalDepartmentShortName,
        row.hospitalDepartmentName,
        row.serviceName,
        patient.hdeShortName
      ),
      room: firstTruthy(row.roomShortName, row.roomName, patient.roomShortName),
      bed: firstTruthy(row.bedShortName, row.bedName, patient.bedShortName),
      birthDate: firstTruthy(patient.birthDate, fallback.birthDate, row.birthDate),
      administrativeSexId: firstTruthy(patient.adseId, row.patientAdministrativeSexId),
      hospitalDepartmentId: firstTruthy(row.hospitalDepartmentId, patient.hospitalDepartmentId),
      nurseStationId: firstTruthy(row.nurseStationId),
      patientId: firstTruthy(patient.patID, patient.patientId, row.patientId),
      diagnosis: firstTruthy(
        patient.principalDiagName,
        patient.haoDiagName,
        row.principalDiagName,
        row.haoDiagName,
        row.diagnosisName
      ),
      hasMedicalDischarge: Boolean(firstTruthy(row.hasMedicalDischarge, row.medicalDischarge)),
      dischargeDatetime: firstTruthy(row.medicalDischargeDateTime),
      isDead: Boolean(row.isDead),
    };
  };

  const buildClinicalPatient = ({ header: rawHeader, referenceDateTime, formatAgeLabel }) => {
    const header = asObject(rawHeader);
    const calculatedAge = formatAgeLabel(firstTruthy(header.birthDate), referenceDateTime);
    const estimatedAge = Number(header.estimatedAge);
    const estimatedAgeUnit = String(header.ageUnit || '').replace(/\s+/g, ' ').trim();
    const fallbackAge = Number.isFinite(estimatedAge) && estimatedAge > 0 &&
      estimatedAgeUnit && !/^0+$/.test(estimatedAgeUnit)
      ? estimatedAge + ' ' + estimatedAgeUnit
      : '';
    return {
      name: [
        header.firstGivenName,
        header.nextGivenNames,
        header.firstFamilyName,
        header.secondFamilyName,
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
      run: firstTruthy(header.preferredIdentifierCode),
      sex: firstTruthy(header.gendName),
      birthDate: firstTruthy(header.birthDate),
      age: firstTruthy(calculatedAge, fallbackAge),
      bed: firstTruthy(header.bedShortName),
      room: firstTruthy(header.roomShortName),
      service: firstTruthy(header.hdeShortName, header.serviceName),
      diagnosis: firstTruthy(header.principalDiagName, header.haoDiagName),
    };
  };

  const create = dependencies => {
    const deps = dependencies || {};
    const cryptoApi = deps.crypto;
    const TextEncoderCtor = deps.TextEncoder;
    const resolveSession = assertFunction(deps.resolveSession, 'resolveSession');
    const fetchPatientHeader = assertFunction(deps.fetchPatientHeader, 'fetchPatientHeader');
    const fetchActiveEncounterRows = assertFunction(
      deps.fetchActiveEncounterRows,
      'fetchActiveEncounterRows'
    );
    const fetchScalesReportWithInfo = assertFunction(
      deps.fetchScalesReportWithInfo,
      'fetchScalesReportWithInfo'
    );
    const prescriptionPrint = asObject(deps.prescriptionPrint);
    const formatAgeLabel = assertFunction(prescriptionPrint.formatAgeLabel, 'formatAgeLabel');
    const formatRun = assertFunction(prescriptionPrint.formatRun, 'formatRun');
    const activeHospitalizedEncounters = assertFunction(
      prescriptionPrint.activeHospitalizedEncounters,
      'activeHospitalizedEncounters'
    );
    const now = deps.now == null ? () => Date.now() : assertFunction(deps.now, 'now');
    const warn = deps.warn == null ? () => undefined : assertFunction(deps.warn, 'warn');
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      throw new Error('Falta la dependencia crypto.subtle.digest.');
    }
    if (typeof TextEncoderCtor !== 'function') {
      throw new Error('Falta la dependencia TextEncoder.');
    }

    const patientHeaderCache = new Map();

    const mapWithConcurrency = async (items, limit, worker) => {
      const results = new Array(items.length);
      let nextIndex = 0;
      const runnerCount = Math.min(Math.max(1, limit), items.length);
      const runners = Array.from({ length: runnerCount }, async () => {
        while (nextIndex < items.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await worker(items[index], index);
        }
      });
      await Promise.all(runners);
      return results;
    };

    const fichaSessionCacheKey = async (info, sender) => {
      const material = [
        info && info.apiOrigin,
        info && info.token,
        info && info.facId,
        info && info.practitionerId,
        info && info.practitionerRoleId,
        info && info.role,
      ].map(value => String(value || '').trim()).join('\u0000');
      const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoderCtor().encode(material));
      const fingerprint = Array.from(new Uint8Array(digest).slice(0, 16))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
      const senderTabId = sender && sender.tab && sender.tab.id;
      return `${senderTabId == null ? 'fallback' : senderTabId}:${fingerprint}`;
    };

    const getClinicalReportContext = async (encId, knownInfo, referenceDateTime, sender) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const infoResult = await resolveSession({
        info: knownInfo,
        sender,
        required: ['practitionerId'],
        invalidMessage: 'La sesión de Ficha Médico no contiene los datos necesarios para imprimir.',
      });
      if (infoResult.error) return infoResult;
      const info = infoResult.info;
      try {
        const header = await fetchPatientHeader(encId, info);
        const candidate = firstTruthy(
          header && header.patID,
          header && header.patId,
          header && header.patientId,
          header && header.patient && header.patient.id
        );
        const patientId = /^\d+$/.test(String(candidate || '')) ? String(candidate) : '';
        if (!patientId) {
          return { error: 'Eloísa no informó el identificador interno del paciente.' };
        }
        return {
          info,
          patientId,
          patient: buildClinicalPatient({
            header,
            referenceDateTime: referenceDateTime || new Date(now()),
            formatAgeLabel,
          }),
        };
      } catch (error) {
        if (error && error.kind === 'http') {
          return { error: 'Eloísa respondió HTTP ' + error.status + ' al identificar al paciente.' };
        }
        return { error: 'No se pudo identificar al paciente: ' + errorMessage(error) };
      }
    };

    const fetchActiveHospitalizedPatients = async info => {
      const rowResult = await fetchActiveEncounterRows(info);
      if (rowResult.error) return rowResult;
      try {
        const normalized = await mapWithConcurrency(rowResult.rows, 6, async item => {
          const encId = encounterIdFromRow(item);
          let header = null;
          if (/^\d+$/.test(encId)) {
            try {
              header = await fetchPatientHeader(encId, info);
            } catch (error) {
              warn(
                'No se pudo leer una cabecera de paciente hospitalizado; se usará el censo activo.',
                errorMessage(error)
              );
            }
          }
          return normalizeHospitalizedEncounter(item, header);
        });
        return { patients: activeHospitalizedEncounters({ encounters: normalized }) };
      } catch (error) {
        return { error: 'No se pudo leer la lista activa: ' + errorMessage(error) };
      }
    };

    const verifyEncounterStillHospitalized = async (encId, info) => {
      if (!/^\d+$/.test(String(encId || '')) || !info || !info.token) {
        return { error: 'No se pudo verificar que el paciente siga hospitalizado.' };
      }
      try {
        const rowResult = await fetchActiveEncounterRows(info);
        if (rowResult.error) return rowResult;
        const active = rowResult.rows.find(item =>
          encounterIdFromRow(item) === String(encId) && isEncounterActive(item)
        );
        return active
          ? { ok: true, encounter: active }
          : { error: 'El paciente ya no figura hospitalizado. Actualiza el módulo antes de registrar.' };
      } catch (error) {
        return { error: 'No se pudo confirmar la hospitalización: ' + errorMessage(error) };
      }
    };

    const verifySelectedEncountersStillHospitalized = async (encIds, info) => {
      try {
        const rowResult = await fetchActiveEncounterRows(info);
        if (rowResult.error) return rowResult;
        const activeIds = new Set(rowResult.rows
          .filter(isEncounterActive)
          .map(encounterIdFromRow)
          .filter(id => /^\d+$/.test(id)));
        const unavailable = (Array.isArray(encIds) ? encIds : [])
          .map(String)
          .filter(encId => !activeIds.has(encId));
        return unavailable.length
          ? {
              error: 'La hospitalización cambió para ' + unavailable.length +
                (unavailable.length === 1 ? ' paciente seleccionado. ' : ' pacientes seleccionados. ') +
                'Actualiza el módulo antes de imprimir.',
            }
          : { ok: true };
      } catch (error) {
        return { error: 'No se pudo confirmar la hospitalización: ' + errorMessage(error) };
      }
    };

    const handlePatientHeaderRequest = async ({ encId, sender }) => {
      const infoResult = await resolveSession({ sender });
      if (infoResult.error) return infoResult;
      const encounterId = String(encId || '');
      const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
      const cacheKey = `${sessionKey}:${encounterId}`;
      const cached = patientHeaderCache.get(cacheKey);
      if (cached && now() - cached.at < PATIENT_HEADER_CACHE_TTL_MS) return cached.payload;
      const context = await getClinicalReportContext(encounterId, infoResult.info);
      if (context.error) return context;
      const patient = context.patient || {};
      const payload = {
        ok: true,
        encId: encounterId,
        patient: {
          ...patient,
          formattedRun: formatRun(patient.run) || String(patient.run || ''),
        },
      };
      patientHeaderCache.set(cacheKey, { at: now(), payload });
      if (patientHeaderCache.size > PATIENT_HEADER_CACHE_MAX_ENTRIES) {
        const oldest = patientHeaderCache.keys().next().value;
        patientHeaderCache.delete(oldest);
      }
      return payload;
    };

    const handleCensusListRequest = async ({ currentEncId, sender }) => {
      const infoResult = await resolveSession({ sender });
      if (infoResult.error) return infoResult;
      const result = await fetchActiveHospitalizedPatients(infoResult.info);
      if (result.error) return result;
      return {
        ok: true,
        patients: (result.patients || []).map(patient => ({
          encounterId: String(patient.encounterId),
          name: [patient.firstGivenName, patient.nextGivenNames, patient.firstFamilyName, patient.secondFamilyName].filter(Boolean).join(' ').trim(),
          run: formatRun(patient.run) || String(patient.run || ''),
          bed: patient.bed || patient.room || '',
          service: patient.service || '',
          isCurrent: String(patient.encounterId) === String(currentEncId || ''),
        })),
      };
    };

    const handleVitalsCensusRequest = async ({ currentEncId, sender }) => {
      const infoResult = await resolveSession({ sender });
      if (infoResult.error) return infoResult;
      const result = await fetchActiveHospitalizedPatients(infoResult.info);
      if (result.error) return result;
      const patients = await mapWithConcurrency(result.patients || [], 4, async patient => {
        const report = await fetchScalesReportWithInfo(patient.encounterId, infoResult.info);
        return {
          encounterId: String(patient.encounterId),
          name: [patient.firstGivenName, patient.nextGivenNames, patient.firstFamilyName, patient.secondFamilyName].filter(Boolean).join(' ').trim(),
          run: formatRun(patient.run) || String(patient.run || ''),
          bed: patient.bed || patient.room || '',
          service: patient.service || '',
          birthDate: patient.birthDate || '',
          isCurrent: String(patient.encounterId) === String(currentEncId || ''),
          forms: report.error ? [] : report.forms,
          unavailableReason: report.error || '',
        };
      });
      return { ok: true, patients };
    };

    return Object.freeze({
      buildClinicalPatient,
      normalizeHospitalizedEncounter,
      isEncounterActive,
      mapWithConcurrency,
      fichaSessionCacheKey,
      getClinicalReportContext,
      fetchActiveHospitalizedPatients,
      verifyEncounterStillHospitalized,
      verifySelectedEncountersStillHospitalized,
      handlePatientHeaderRequest,
      handleCensusListRequest,
      handleVitalsCensusRequest,
    });
  };

  const api = Object.freeze({ create });
  root.HhrFichaMedicoPatientContext = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
