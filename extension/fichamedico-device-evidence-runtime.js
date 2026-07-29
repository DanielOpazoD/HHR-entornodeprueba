/** Direct device evidence with a date-aware PDF compatibility fallback. */
(function (root) {
  'use strict';
  const create = dependencies => {
    const { resolveSession, readJson, fetchDeviceReportBuffer, clinicalDayAt } = dependencies || {};
    for (const [name, dependency] of Object.entries({
      resolveSession,
      readJson,
      fetchDeviceReportBuffer,
      clinicalDayAt,
    })) {
      if (typeof dependency !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    }

    const fetchDeviceEvidence = async ({ encId, fecha, info, acceptEntries }) => {
      if (!encId || !fecha) {
        return { error: 'Faltan enc_id o fecha para consultar dispositivos.' };
      }
      if (clinicalDayAt(new Date()) !== fecha || acceptEntries !== true) {
        const historicalReport = await fetchDeviceReportBuffer({ encId, fecha, info });
        return historicalReport.error ? historicalReport : { buffer: historicalReport.buffer, source: 'pdf' };
      }
      const session = await resolveSession({
        info,
        required: ['practitionerId'],
        invalidMessage: 'La sesión de Ficha Médico no contiene los datos necesarios para consultar dispositivos.',
      });
      if (!session.error) {
        const role = String(session.info.role || '');
        const eventTypeId = /enfermer/i.test(role) ? '2' : /^m[eé]dic/i.test(role) ? '1' : null;
        if (!eventTypeId) return fetchDeviceReportBuffer({ encId, fecha, info }).then(
          fallback => fallback.error ? fallback : { buffer: fallback.buffer, source: 'pdf' });
        try {
          const result = await readJson({
            info: session.info,
            path:
              `/api/encounter/entrySummary/invasiveDeviceEntry/${encodeURIComponent(encId)}/` +
              `${eventTypeId}/${encodeURIComponent(session.info.practitionerId)}`,
          });
          if (!Array.isArray(result.data)) throw new TypeError('Respuesta JSON inválida.');
          const entries = result.data
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => ({
              name: String(entry.name || ''),
              location: entry.location == null ? null : String(entry.location),
              measuredNumber: entry.measuredNumber == null ? null : entry.measuredNumber,
              installationDatetime:
                entry.installationDatetime == null ? null : String(entry.installationDatetime),
              expirationDatetime:
                entry.expirationDatetime == null ? null : String(entry.expirationDatetime),
              removedDatetime:
                entry.removedDatetime == null ? null : String(entry.removedDatetime),
              archived: entry.archived === true,
              deleted: entry.deleted === true,
            }));
          return { entries, source: 'json' };
        } catch (_jsonError) {
          // Current builds expose JSON, but PDF remains the compatibility fallback during rollout.
        }
      }
      const fallback = await fetchDeviceReportBuffer({ encId, fecha, info });
      return fallback.error ? fallback : { buffer: fallback.buffer, source: 'pdf' };
    };

    return Object.freeze({ fetchDeviceEvidence });
  };

  root.HhrFichaMedicoDeviceEvidenceRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
