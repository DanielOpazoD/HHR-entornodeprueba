/** Read-only hydric entries; contract from Eloísa's public modules 21622 and 55326. */
(function (root) {
  'use strict';
  const FIELDS = ['id', 'guid', 'encounterEventId', 'regDatetime', 'hydBalName', 'hydBalType',
    'inputQuantity', 'outputQuantity', 'archived', 'deleted', 'deletedDateTime'];
  const shiftDay = (day, offset) => {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    // Calendar arithmetic only: this is not a clinical instant.
    return date.toISOString().slice(0, 10);
  };
  const create = ({ authorize, resolveSession, readJson, classify }) => ({
    fetchFluidBalance: async ({ encId, fecha, sender }) => {
      if (!/^\d+$/.test(String(encId || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ||
          !Number.isFinite(Date.parse(`${fecha}T12:00:00Z`)) || shiftDay(fecha, 0) !== fecha) {
        return { error: 'El episodio o día del balance no es válido.', errorCode: 'invalid_request' };
      }
      if (!(await authorize(sender, encId))) {
        return { error: 'El balance no fue autorizado para este episodio.', errorCode: 'episode_not_authorized' };
      }
      const session = await resolveSession({ sender, required: ['practitionerId'],
        invalidMessage: 'La sesión no permite consultar el balance.' });
      if (session.error) return { error: session.error, errorCode: 'session_required' };
      // The reader event type controls access, not authorship. No author/role filter is applied.
      const eventType = /enfermer/i.test(String(session.info.role || '')) ? '2' : '1';
      // Eloísa's date filters are wall-clock strings. Read a padded window, then classify the
      // returned offset-bearing instants in Pacific/Easter rather than trusting server locality.
      const query = new URLSearchParams({ dateTimeFrom: `${shiftDay(fecha, -1)}T00:00:00`,
        dateTimeTo: `${shiftDay(fecha, 1)}T23:59:59`, type: '', itemId: '' });
      try {
        const result = await readJson({ info: session.info, cache: 'no-store',
          path: '/api/encounter/entrySummary/inputOutputHydricBalanceEntry/' +
            `${encId}/${eventType}/${encodeURIComponent(session.info.practitionerId)}?${query}` });
        if (result.status === 204) return { entries: [], censusDate: fecha };
        if (!Array.isArray(result.data) || result.data.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
          return { error: 'Eloísa entregó un balance no verificable.', errorCode: 'invalid_response' };
        }
        return { censusDate: fecha, entries: result.data.map(entry =>
          Object.fromEntries(FIELDS.filter(key => key in entry).map(key => [key, entry[key]]))) };
      } catch (error) {
        return { error: 'No se pudo leer el balance de Eloísa.', errorCode: classify(error) };
      }
    },
  });
  root.HhrFichaMedicoFluidBalanceRuntime = Object.freeze({ create });
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof self !== 'undefined' ? self : globalThis);
