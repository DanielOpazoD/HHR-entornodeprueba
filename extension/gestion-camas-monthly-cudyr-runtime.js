/** Read-only transport for the official monthly categorization report. */
(function (root) {
  'use strict';
  const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isTransientStatus = status => status === 408 || status === 429 || status >= 500;
  const isTransientError = error =>
    error instanceof TypeError || /fetch|network|tiempo de espera|timeout/i.test(String(error && error.message || error));
  const defaultRetryDelay = () => 500 + Math.floor(Math.random() * 500);
  const resolveSleep = wait =>
    typeof wait === 'function'
      ? wait
      : typeof setTimeout === 'function'
        ? delay => new Promise(resolve => setTimeout(resolve, delay))
        : () => Promise.resolve();
  const isValidMonth = month => typeof month === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
  const isValidCensusDate = (month, censusDate) => {
    if (censusDate === undefined) return true;
    if (typeof censusDate !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(censusDate)) return false;
    if (!censusDate.startsWith(month + '-')) return false;
    const epoch = Date.parse(censusDate + 'T12:00:00Z');
    return Number.isFinite(epoch) && new Date(epoch).toISOString().slice(0, 10) === censusDate;
  };
  const fetchReportOnceWithRetry = async (fetchWithTimeout, url, options, sleep, retryDelay) => {
    try {
      const response = await fetchWithTimeout(url, options);
      if (!isTransientStatus(response.status)) return response;
    } catch (error) {
      if (!isTransientError(error)) throw error;
    }
    const delay = Number(retryDelay());
    if (Number.isFinite(delay) && delay > 0) await sleep(delay);
    return fetchWithTimeout(url, options);
  };
  const create = ({ resolveSession, fetchWithTimeout, markSessionVerified, bufferToBase64, wait, retryDelayMs }) => {
    const sleep = resolveSleep(wait);
    const retryDelay = typeof retryDelayMs === 'function' ? retryDelayMs : defaultRetryDelay;
    return {
      async request({ month, censusDate }) {
        if (!isValidMonth(month)) return { error: 'Mes inválido.' };
        if (!isValidCensusDate(month, censusDate)) return { error: 'Fecha censal inválida.' };
        const session = await resolveSession();
        if (!session.record) return { error: 'Conecta Gestión de Camas para recuperar el mes.' };
        const info = session.record;
        if (String(info.facId) !== '1342') return { error: 'Establecimiento no verificado.' };
        // Parameters are those used by Gestión de Camas ExportReport, report id 1.
        const url = censusDate
          ? `${info.apiBase}/report/Censo_Diario_de_Pacientes.xls?DATE=${censusDate}&FAC_ID=${encodeURIComponent(info.facId)}`
          : `${info.apiBase}/report/Categorizacion_Riesgo_Dependencia.xls?start_Date=${month}-01&FAC_ID=${encodeURIComponent(info.facId)}`;
        try {
          const response = await fetchReportOnceWithRetry(
            fetchWithTimeout,
            url,
            { headers: { Authorization: info.token }, credentials: 'omit', cache: 'no-store' },
            sleep,
            retryDelay
          );
          if (!response.ok) return { error: `No se pudo consultar el informe (HTTP ${response.status}).` };
          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          if (bytes.length > 262144 || !XLS_SIGNATURE.every((b, i) => bytes[i] === b))
            return { error: 'Eloísa no entregó un XLS válido de hasta 256 KiB.' };
          if (!(await markSessionVerified(info))) return { error: 'La sesión cambió durante la consulta.' };
          return { ok: true, month, ...(censusDate ? { censusDate } : {}), base64: bufferToBase64(buffer), capturedAt: new Date().toISOString() };
        } catch {
          return { error: 'La consulta del informe se interrumpió. Puede reintentarse.' };
        }
      },
    };
  };
  const routes = ({ types, route, monthly, readDischarges, saveDischarges }) => ({
    [types.MONTHLY_CUDYR_REPORT_REQUEST]: route(
      message => monthly.request({ month: message.month, censusDate: message.censusDate }),
      'No se pudo recuperar el informe mensual CUDYR.'
    ),
    [types.EGRESO_REPORT_REQUEST]: route(
      message => readDischarges({ dateStart: message.dateStart, dateEnd: message.dateEnd }),
      'No se pudo leer el reporte de egresos.'
    ),
    [types.EGRESO_REPORT_SAVE]: route(
      message => saveDischarges({ dateStart: message.dateStart, dateEnd: message.dateEnd }),
      'No se pudo guardar el reporte de egresos.'
    ),
  });
  root.HhrGestionCamasMonthlyCudyrRuntime = Object.freeze({ create, routes });
})(typeof self !== 'undefined' ? self : globalThis);
