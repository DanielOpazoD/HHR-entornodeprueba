(function (root) {
  'use strict';
  const create = dependencies => {
    const {
      resolveSession,
      fetchActiveEncounterRows,
      fetchPatientHeader,
      fetchDeviceEvidence,
      normalizePatient,
      clinicalDayAt,
      codeContract,
      cryptoApi,
      now,
    } = dependencies;
    return async ({ encId, sender }) => {
      const session = await resolveSession({ sender });
      if (session.error) return session;
      const encounterId = String(encId || '');
      const activeRows = await fetchActiveEncounterRows(session.info);
      if (activeRows.error) return activeRows;
      const row = activeRows.rows.find(item =>
        String(item && (item.id ?? item.encounterId)) === encounterId
      );
      if (!row) return { error: 'El paciente ya no figura en las listas activas de Eloísa.' };
      try {
        const header = await fetchPatientHeader(encounterId, session.info);
        const patient = {
          ...normalizePatient(row, header),
          admissionDatetime: header.encStartPeriod || row.startDatetime || '',
          administrativeSex: header.adseName || row.patientAdministrativeSex || '',
          gender: header.gendName || row.gender || '',
        };
        const deviceResult = await fetchDeviceEvidence({
          encId: encounterId,
          fecha: clinicalDayAt(new Date(now())),
          info: session.info,
          acceptEntries: true,
        });
        if (deviceResult.error) return deviceResult;
        const payload = codeContract.buildPayload({
          patient,
          deviceEntries: Array.isArray(deviceResult.entries) ? deviceResult.entries : [],
          capturedAt: now(),
        });
        return {
          ok: true,
          code: await codeContract.createCode({ payload, cryptoApi }),
          formatVersion: payload.version,
        };
      } catch (error) {
        return {
          error: error instanceof Error
            ? error.message
            : 'No se pudo preparar el código del paciente.',
        };
      }
    };
  };
  const api = Object.freeze({ create });
  root.HhrFichaMedicoManualPatientCodeRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
