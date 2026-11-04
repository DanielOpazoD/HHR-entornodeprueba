/** Read-only «Alertas» of one episode for the census clinical bundle. Classic UMD for the MV3 worker. */
(function (root) {
  'use strict';

  // Only what HHR keeps or needs to tell an active note apart (measured in Ficha Médico 2026-11-03).
  const ALERT_FIELDS = [
    'guid', 'id', 'observation', 'startDateTime', 'endDateTime', 'archived', 'deleted', 'deletedDateTime',
    'isSigned', 'visitor', 'authorHealthCarePractitionerName', 'authorHealthCarePractitionerRoleName',
  ];
  const pick = entry => Object.fromEntries(ALERT_FIELDS.filter(key => key in entry).map(key => [key, entry[key]]));

  const create = dependencies => {
    const { authorize, resolveSession, readJson, clinicalDayAt, classify } = dependencies || {};
    for (const [name, dependency] of Object.entries({ authorize, resolveSession, readJson, clinicalDayAt, classify })) {
      if (typeof dependency !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    }

    const fetchAlertEntries = async ({ encId, fecha, sender }) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.', errorCode: 'invalid_request' };
      }
      // Eloísa answers with the alerts active now, which describe only the clinical day in progress.
      if (clinicalDayAt(new Date()) !== fecha) return { ok: true, skipped: true, alerts: [] };
      if (!(await authorize(sender, encId))) {
        return { error: 'Las alertas no fueron autorizadas para el episodio de esta pestaña.', errorCode: 'episode_not_authorized' };
      }
      const session = await resolveSession({
        sender,
        required: ['practitionerId'],
        invalidMessage: 'La sesión no contiene los datos necesarios para consultar las alertas.',
      });
      if (session.error) return { error: session.error, errorCode: 'session_required' };
      // Same reader event type as Ficha Médico's own panel and the medication read.
      const eventTypeId = /enfermer/i.test(String(session.info.role || '')) ? '2' : '1';
      try {
        const result = await readJson({
          info: session.info,
          path:
            '/api/encounter/entrySummary/alertEntry/' +
            `${encodeURIComponent(encId)}/${eventTypeId}/${encodeURIComponent(session.info.practitionerId)}`,
          cache: 'no-store',
        });
        if (result.status === 204) return { ok: true, alerts: [] };
        if (!Array.isArray(result.data)) {
          return { error: 'Eloísa entregó alertas no verificables.', errorCode: 'invalid_response' };
        }
        return { ok: true, alerts: result.data.filter(entry => entry && typeof entry === 'object').map(pick) };
      } catch (error) {
        return {
          error: error && error.kind === 'http'
            ? 'Eloísa respondió HTTP ' + error.status + ' al leer las alertas.'
            : 'No se pudieron leer las alertas: ' + String((error && error.message) || error),
          errorCode: classify(error),
        };
      }
    };

    return Object.freeze({ fetchAlertEntries });
  };

  const api = Object.freeze({ create });
  root.HhrFichaMedicoAlertEntryRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
