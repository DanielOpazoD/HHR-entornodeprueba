/**
 * audit-history-reconstruction.js (extension — importScripts in the SW, require() in tests)
 *
 * Builds the history of a stay that crosses a day Eloísa's report server cannot generate. In time
 * order it joins: each official segment around that day, the official «Resumen diario del
 * paciente» of the day (served by another report engine), and an HHR annex that reproduces the
 * day's records from Ficha Médico's clinical history JSON. What could not be obtained is reported.
 */
(function (root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  /*
   * Measured 2026-11-03: two stays across Sept 6 lost their whole history, run after run, because
   * Eloísa dropped the connection on one of its segments. A segment Eloísa does not serve is asked
   * for in halves, down to single days, and a day it still does not serve is rebuilt like the
   * skipped one. These limits keep an Eloísa that fails everything from multiplying the requests.
   */
  const MAX_SEGMENT_REQUESTS = 20;
  const MAX_UNSERVED_DAYS = 3;
  const unserved = result =>
    !result.buffer && !result.fatal && !result.permanent && (result.status == null || result.status >= 500);

  const create = dependencies => {
    const { fetchOfficialPdf, fetchWithTimeout, pdfLib, getJsPDF, dayAnnex, historySegments } = dependencies || {};
    if (
      typeof fetchOfficialPdf !== 'function' || typeof fetchWithTimeout !== 'function' ||
      !pdfLib || !pdfLib.PDFDocument || typeof getJsPDF !== 'function' ||
      !dayAnnex || typeof dayAnnex.buildModel !== 'function' || typeof dayAnnex.render !== 'function' ||
      !historySegments || typeof historySegments.halves !== 'function' || typeof historySegments.dayOf !== 'function'
    ) {
      throw new Error('No se pudo inicializar la reconstrucción del historial.');
    }

    const mergePdfs = async buffers => {
      const merged = await pdfLib.PDFDocument.create();
      for (const buffer of buffers) {
        const source = await pdfLib.PDFDocument.load(buffer, { ignoreEncryption: true });
        (await merged.copyPages(source, source.getPageIndices())).forEach(page => merged.addPage(page));
      }
      const bytes = await merged.save();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };

    const officialPdf = (info, path, params, label) => {
      const url = new URL(path, info.apiOrigin);
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
      return fetchOfficialPdf({ url: url.toString(), token: info.token, label });
    };

    /** The clinical history JSON looks back a number of days from today. */
    const readHistory = async ({ info, encId, earliestDay, nowMs }) => {
      const [y, m, d] = earliestDay.split('-').map(Number);
      const days = Math.max(1, Math.ceil((nowMs - Date.UTC(y, m - 1, d)) / DAY_MS) + 2);
      const url = new URL(
        `/api/encounter/${encodeURIComponent(encId)}/getPatientEncounterHistoryReportServer/false/0/0/-${days}`,
        info.apiOrigin
      );
      try {
        const response = await fetchWithTimeout(url.toString(), {
          headers: { Authorization: info.token, Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
        });
        if (response.status === 204) return { events: [] };
        if (!response.ok) return { error: 'Ficha Médico respondió HTTP ' + response.status + ' al leer los registros.' };
        const events = await response.json();
        return Array.isArray(events) ? { events } : { error: 'Ficha Médico entregó registros no válidos.' };
      } catch (error) {
        return { error: 'No se pudieron leer los registros de Ficha Médico: ' + String((error && error.message) || error) };
      }
    };

    const buildAnnex = ({ history, day, patient, nowMs }) => {
      if (history.error) return { error: history.error };
      try {
        const model = dayAnnex.buildModel({ events: history.events, day });
        const records = model.sections.reduce((sum, section) => sum + section.entries.length, 0);
        const JsPDF = getJsPDF();
        if (typeof JsPDF !== 'function') return { error: 'No se pudo cargar el generador de PDF.' };
        return { buffer: dayAnnex.render({ JsPDF, model, patient, generatedAt: nowMs }), records };
      } catch (error) {
        return { error: 'No se pudo armar el anexo: ' + String((error && error.message) || error) };
      }
    };

    /** The official daily summary and the HHR annex of one skipped day; each may be missing. */
    const reconstructDay = async ({ info, item, day, history, patient, nowMs }) => {
      const summary = await officialPdf(info, '/api/report/Resumen_diario_paciente.pdf', {
        enc_id: item.encId, fecha: day, fac_id: item.facilityId,
      }, 'el resumen diario del paciente');
      if (summary.fatal) return { fatal: true, error: summary.error };
      const annex = buildAnnex({ history, day, patient, nowMs });
      return {
        buffers: [summary.buffer, annex.buffer].filter(Boolean),
        status: {
          day,
          dailySummary: Boolean(summary.buffer),
          ...(summary.buffer ? {} : { dailySummaryError: summary.error || 'Falló la descarga.' }),
          annex: Boolean(annex.buffer),
          ...(annex.buffer ? { annexRecords: annex.records } : { annexError: annex.error }),
        },
      };
    };

    const segmentPdf = (info, item, segment) => officialPdf(info, '/api/reportServer/GetHospitalizedEncounterHistory', {
      enc_id: item.encId, start_date: segment.start, end_date: segment.end,
    }, 'el informe historial de hospitalización');

    /** The official pieces of a segment in time order: { buffer } or { unservedDay }, or a failure. */
    const fetchSegment = async ({ info, item, segment, budget, keepAlive }) => {
      if (budget.requests >= MAX_SEGMENT_REQUESTS) return { failure: budget.firstFailure };
      budget.requests += 1;
      keepAlive();
      const result = await segmentPdf(info, item, segment);
      if (result.buffer) return { pieces: [{ buffer: result.buffer }] };
      if (!unserved(result)) return { failure: result };
      budget.firstFailure = budget.firstFailure || result;
      const halves = historySegments.halves(segment);
      if (!halves) {
        if (budget.unservedDays >= MAX_UNSERVED_DAYS) return { failure: budget.firstFailure };
        budget.unservedDays += 1;
        return { pieces: [{ unservedDay: historySegments.dayOf(segment.start) }] };
      }
      const pieces = [];
      for (const half of halves) {
        const part = await fetchSegment({ info, item, segment: half, budget, keepAlive });
        if (part.failure) return part;
        pieces.push(...part.pieces);
      }
      return { pieces };
    };

    /**
     * Returns { buffer, days: [status] } or the failure of an official segment, which the caller
     * may retry. A failed daily summary or annex is reported in days[] instead of failing the file.
     * keepAlive is called before each segment request, so a long split still shows progress.
     */
    const reconstruct = async ({ info, item, split, patient, nowMs, keepAlive = () => {} }) => {
      // Read once, back to the earliest day that needs an annex.
      let history = null;
      let historyFrom = '';
      const historyFor = async day => {
        if (!history || day < historyFrom) {
          historyFrom = day;
          history = await readHistory({ info, encId: item.encId, earliestDay: day, nowMs });
        }
        return history;
      };
      const budget = { requests: 0, unservedDays: 0, firstFailure: null };
      const buffers = [];
      const days = [];
      const addDay = async (day, extra) => {
        const rebuilt = await reconstructDay({ info, item, day, history: await historyFor(day), patient, nowMs });
        if (rebuilt.fatal) return rebuilt;
        buffers.push(...rebuilt.buffers);
        days.push({ ...rebuilt.status, ...extra });
        return null;
      };
      for (const part of split.parts) {
        if (part.segment) {
          const fetched = await fetchSegment({ info, item, segment: part.segment, budget, keepAlive });
          if (fetched.failure) return fetched.failure;
          for (const piece of fetched.pieces) {
            if (piece.buffer) buffers.push(piece.buffer);
            else {
              const fatal = await addDay(piece.unservedDay, { unserved: true });
              if (fatal) return fatal;
            }
          }
          continue;
        }
        const fatal = await addDay(part.skippedDay, {});
        if (fatal) return fatal;
      }
      if (buffers.length === 0) {
        return { permanent: true, error: `Eloísa no entregó nada para el ${split.skipped.join(' y ')} (cambio de hora)` };
      }
      try {
        return { buffer: await mergePdfs(buffers), days };
      } catch (error) {
        return { error: 'No se pudo unir el historial: ' + String((error && error.message) || error) };
      }
    };

    return Object.freeze({ reconstruct });
  };

  const api = Object.freeze({ create });
  root.HhrAuditHistoryReconstruction = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
