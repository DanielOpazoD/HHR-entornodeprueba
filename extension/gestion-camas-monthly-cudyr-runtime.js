/** Read-only transport for the official monthly categorization report. */
(function (root) {
  'use strict';
  const create = ({ resolveSession, fetchWithTimeout, markSessionVerified, bufferToBase64 }) => ({
    async request({ month, censusDate }) {
      if (typeof month !== 'string' || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
        return { error: 'Mes inválido.' };
      if (censusDate !== undefined && (typeof censusDate !== 'string' ||
          !/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(censusDate) || !censusDate.startsWith(month + '-') ||
          !Number.isFinite(Date.parse(censusDate + 'T12:00:00Z')) ||
          new Date(censusDate + 'T12:00:00Z').toISOString().slice(0,10) !== censusDate))
        return { error: 'Fecha censal inválida.' };
      const session = await resolveSession();
      if (!session.record) return { error: 'Conecta Gestión de Camas para recuperar el mes.' };
      const info = session.record;
      if (String(info.facId) !== '1342') return { error: 'Establecimiento no verificado.' };
      // Parameters are those used by Gestión de Camas ExportReport, report id 1.
      const url = censusDate
        ? `${info.apiBase}/report/Censo_Diario_de_Pacientes.xls?DATE=${censusDate}&FAC_ID=${encodeURIComponent(info.facId)}`
        : `${info.apiBase}/report/Categorizacion_Riesgo_Dependencia.xls?start_Date=${month}-01&FAC_ID=${encodeURIComponent(info.facId)}`;
      try {
        const response = await fetchWithTimeout(url, {
          headers: { Authorization: info.token }, credentials: 'omit', cache: 'no-store',
        });
        if (!response.ok) return { error: `No se pudo consultar el informe (HTTP ${response.status}).` };
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
        if (bytes.length > 262144 || !signature.every((b, i) => bytes[i] === b))
          return { error: 'Eloísa no entregó un XLS válido de hasta 256 KiB.' };
        if (!(await markSessionVerified(info))) return { error: 'La sesión cambió durante la consulta.' };
        return { ok: true, month, ...(censusDate ? { censusDate } : {}), base64: bufferToBase64(buffer), capturedAt: new Date().toISOString() };
      } catch {
        return { error: 'La consulta del informe se interrumpió. Puede reintentarse.' };
      }
    },
  });
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
