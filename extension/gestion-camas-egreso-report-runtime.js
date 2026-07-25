/** Bulk administrative-discharge report transport and parser. */
(function (root) {
  'use strict';

  const create = dependencies => {
    const {
      downloads,
      reportFile,
      resolveSession,
      classifyRejection,
      markSessionVerified,
      fetchWithTimeout,
      ensureSpreadsheet,
      parseWorkbook,
      spreadsheet,
      bufferToBase64,
    } = dependencies;

    const fetchBuffer = async ({ dateStart, dateEnd }) => {
      if (!dateStart || !dateEnd) return { error: 'Faltan fechas para el reporte.' };
      const session = await resolveSession();
      if (!session.record) {
        return { error: session.error || 'Conecta Gestión de Camas y reintenta.' };
      }
      const info = session.record;
      const url =
        `${info.apiBase}/report/${reportFile}` +
        `?fac_id=${encodeURIComponent(info.facId)}` +
        `&start_datetime=${encodeURIComponent(dateStart)}` +
        `&end_datetime=${encodeURIComponent(dateEnd)}`;
      try {
        const response = await fetchWithTimeout(url, {
          headers: { Authorization: info.token },
        });
        if (!response.ok) {
          const rejection = await classifyRejection(response, info);
          return {
            error:
              rejection === 'changed'
                ? 'La sesión cambió durante la descarga. Reintenta la operación.'
                : rejection === 'expired'
                  ? 'La sesión de Gestión de Camas venció. Vuelve a conectarla.'
                  : rejection === 'forbidden'
                    ? 'La sesión es válida, pero no tiene permiso para descargar este reporte.'
                    : `El servidor de reportes respondió HTTP ${response.status}.`,
          };
        }
        const buffer = await response.arrayBuffer();
        if (!(await markSessionVerified(info))) {
          return { error: 'La sesión cambió durante la descarga. Reintenta la operación.' };
        }
        return {
          buffer,
          facilityId: Number(info.facId),
          capturedAt: new Date().toISOString(),
        };
      } catch (error) {
        return {
          error: `Falló la descarga del reporte: ${String(error?.message || error)}`,
        };
      }
    };

    const request = async args => {
      const result = await fetchBuffer(args);
      if (result.error) return { error: result.error };
      try {
        ensureSpreadsheet();
        const rows = parseWorkbook(spreadsheet, new Uint8Array(result.buffer));
        return {
          ok: true,
          rows,
          count: rows.length,
          facilityId: result.facilityId,
          capturedAt: result.capturedAt,
        };
      } catch (error) {
        return { error: `No se pudo parsear el reporte: ${String(error?.message || error)}` };
      }
    };

    const save = async args => {
      const result = await fetchBuffer(args);
      if (result.error) return { error: result.error };
      const dataUrl =
        'data:application/vnd.ms-excel;base64,' + bufferToBase64(result.buffer);
      const filename = `Alta_Administrativa_${args.dateStart}_${args.dateEnd}.xls`;
      try {
        const id = await downloads.download({
          url: dataUrl,
          filename,
          saveAs: false,
          conflictAction: 'overwrite',
        });
        const savedPath = await new Promise(resolve => {
          const poll = () =>
            downloads.search({ id }, items => {
              const item = items?.[0];
              if (item && (item.state === 'complete' || item.state === 'interrupted')) {
                resolve(item.filename);
              } else setTimeout(poll, 200);
            });
          poll();
        });
        return { ok: true, id, path: savedPath, length: result.buffer.byteLength };
      } catch (error) {
        return { error: `No se pudo guardar el reporte: ${String(error?.message || error)}` };
      }
    };

    return Object.freeze({ request, save });
  };

  root.HhrGestionCamasEgresoReportRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
