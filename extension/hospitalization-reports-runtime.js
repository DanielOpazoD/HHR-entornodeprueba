/** Discover hospitalization episodes and build official Eloisa report navigation. */
(function (root) {
  'use strict';
  const normalizeRun = value => String(value || '').toUpperCase().replace(/[^0-9K]/g, '');
  const normalizeDate = value => {
    const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/);
    return match ? match[1] : '';
  };
  const isEncounter = value => /^\d+$/.test(String(value || ''));
  const isValidRun = value => /^[0-9]{6,8}[0-9K]$/.test(normalizeRun(value));

  const buildSearchUrl = (info, patientRun) => {
    const url = new URL('/api/inpatientReport/getEncounterHistoryReport', info.apiOrigin);
    url.searchParams.set('prefferedPeridentId', '2');
    url.searchParams.set('prefferedIdentifierCode', normalizeRun(patientRun));
    url.searchParams.set('facilityId', String(info.facId));
    url.searchParams.set('dateFrom', '');
    url.searchParams.set('dateTo', '');
    return url.toString();
  };

  const fetchRows = async ({ info, patientRun, fetchWithTimeout }) => {
    try {
      const response = await fetchWithTimeout(buildSearchUrl(info, patientRun), {
        headers: { Authorization: info.token, Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) {
        return { error: 'Eloísa no autorizó la búsqueda de informes para la sesión actual.' };
      }
      if (!response.ok) {
        return { error: 'Eloísa respondió HTTP ' + response.status + ' al buscar los informes.' };
      }
      const payload = await response.json();
      return { rows: Array.isArray(payload) ? payload : [] };
    } catch (error) {
      return {
        error: 'No se pudieron buscar los informes en Eloísa: ' +
          String((error && error.message) || error),
      };
    }
  };

  const matchingRows = (rows, patientRun) => {
    const expectedRun = normalizeRun(patientRun);
    return rows.filter(row =>
      isEncounter(row && row.encounterId) &&
      normalizeRun(row && row.patientIdentifier) === expectedRun
    );
  };
  const sortRowsNewestFirst = rows => [...rows].sort((left, right) =>
    normalizeDate(right && (right.startPeriod || right.endPeriod))
      .localeCompare(normalizeDate(left && (left.startPeriod || left.endPeriod)))
  );
  const sortDischargesNewestFirst = rows => [...rows].sort((left, right) =>
    normalizeDate(right && right.endPeriod).localeCompare(normalizeDate(left && left.endPeriod))
  );
  const toEpisode = row => ({
    encId: String(row.encounterId),
    startDate: normalizeDate(row.startPeriod),
    endDate: normalizeDate(row.endPeriod),
    active: !normalizeDate(row.endPeriod),
  });
  const listEpisodes = ({ rows, patientRun }) => ({ ok: true,
    episodes: sortRowsNewestFirst(matchingRows(rows, patientRun)).map(toEpisode) });

  const selectEncounter = ({ rows, patientRun, encId, censusDate }) => {
    const candidates = matchingRows(rows, patientRun);
    const requested = isEncounter(encId) ? String(encId) : '';
    if (requested) {
      const selected = candidates.find(row => String(row.encounterId) === requested);
      return selected ? { encId: requested, row: selected } : {
        error: 'El episodio seleccionado no aparece entre los informes de este RUN. ' +
          'Actualiza el censo y vuelve a intentarlo.',
      };
    }
    const cutoff = normalizeDate(censusDate);
    const eligible = cutoff ? candidates.filter(row => {
      const endDate = normalizeDate(row && row.endPeriod);
      return endDate && endDate <= cutoff;
    }) : candidates;
    const selected = sortDischargesNewestFirst(eligible)[0];
    if (selected) return { encId: String(selected.encounterId), row: selected };
    return { error: cutoff
      ? 'No se encontró un informe del paciente hasta la fecha de este censo.'
      : 'No se encontraron hospitalizaciones para este RUN.' };
  };

  const resolveRows = async request => {
    const { info, patientRun, fetchWithTimeout } = request;
    if (!info || !info.apiOrigin || !info.token || !/^\d+$/.test(String(info.facId || ''))) {
      return { error: 'La sesión no permite consultar informes de hospitalización.' };
    }
    return fetchRows({ info, patientRun, fetchWithTimeout });
  };

  const buildHistoryReportUrl = ({ encId, startPeriod, endPeriod, now }) => {
    const encounterId = isEncounter(encId) ? String(encId) : '';
    const startDate = String(startPeriod || '').trim();
    if (!encounterId || !startDate) return '';
    const params = JSON.stringify({
      enc_id: encounterId,
      start_date: startDate,
      end_date: String(endPeriod || '').trim() || String(now || '').trim(),
    });
    const url = new URL('https://fichamedico.rayensalud.cl/dashboard/reports');
    url.searchParams.set('isReportServer', 'true');
    url.searchParams.set('report', 'GetHospitalizedEncounterHistory');
    url.searchParams.set('params', params);
    return url.toString();
  };

  const openHistoryReport = async ({ chrome, now, resolved }) => {
    const url = buildHistoryReportUrl({
      encId: resolved.encId,
      startPeriod: resolved.row && resolved.row.startPeriod,
      endPeriod: resolved.row && resolved.row.endPeriod,
      now: new Date(now()).toISOString(),
    });
    if (!url) return { error: 'El episodio no contiene fechas válidas para abrir la ficha completa.' };
    try {
      const tab = await chrome.tabs.create({ url, active: true });
      if (tab && tab.windowId != null) {
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_error) {}
      }
      return { ok: true, opened: true, encId: resolved.encId };
    } catch (error) {
      return { error: 'No se pudo abrir la ficha clínica completa: ' +
        String((error && error.message) || error) };
    }
  };

  root.HhrHospitalizationReportsRuntime = {
    buildHistoryReportUrl,
    isValidRun,
    listEpisodes,
    normalizeRun,
    openHistoryReport,
    resolveRows,
    selectEncounter,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
