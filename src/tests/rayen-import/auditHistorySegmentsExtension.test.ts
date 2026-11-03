// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import * as PDFLib from 'pdf-lib';

import '../../../extension/audit-history-segments.js';
import { BOTH, PATIENT_A, makeRuntime, row } from './support/auditDocumentsRuntimeHarness';

const segments = (
  globalThis as unknown as {
    HhrAuditHistorySegments: {
      segmentsAround: (period: { start: string; end: string }) => {
        skipped: string[];
        segments: Array<{ start: string; end: string }>;
      };
    };
  }
).HhrAuditHistorySegments;

describe('history periods around the day Eloísa cannot build', () => {
  it('splits a stay that crosses 2026-09-06 with the boundaries Eloísa serves', () => {
    expect(
      segments.segmentsAround({
        start: '2026-09-04T09:00:00.00-06:00',
        end: '2026-09-15T10:00:00.0-03:00',
      })
    ).toEqual({
      skipped: ['2026-09-06'],
      segments: [
        { start: '2026-09-04T09:00:00.00-06:00', end: '2026-09-05T23:59:59-04:00' },
        { start: '2026-09-07T00:00:00-03:00', end: '2026-09-15T10:00:00.0-03:00' },
      ],
    });
  });

  it.each([
    ['a stay after the change', '2026-09-07T09:00:00.00-05:00', '2026-09-15T10:00:00.0-05:00'],
    [
      'the April change, when the clock goes back',
      '2026-04-01T09:00:00-03:00',
      '2026-04-10T09:00:00-04:00',
    ],
  ])('leaves %s whole', (_case, start, end) => {
    expect(segments.segmentsAround({ start, end })).toEqual({ skipped: [], segments: [] });
  });

  it('reads the mainland day, so a Rapa Nui admission late on Sept 5 starts on Sept 7', () => {
    expect(
      segments.segmentsAround({
        start: '2026-09-05T23:30:00-05:00',
        end: '2026-09-10T10:00:00-03:00',
      }).segments
    ).toEqual([{ start: '2026-09-07T00:00:00-03:00', end: '2026-09-10T10:00:00-03:00' }]);
  });

  it('keeps only what exists when the stay starts, ends or stays within the skipped day', () => {
    expect(
      segments.segmentsAround({
        start: '2026-09-01T10:00:00-04:00',
        end: '2026-09-06T15:00:00-03:00',
      }).segments
    ).toEqual([{ start: '2026-09-01T10:00:00-04:00', end: '2026-09-05T23:59:59-04:00' }]);
    expect(
      segments.segmentsAround({
        start: '2026-09-06T02:00:00-03:00',
        end: '2026-09-06T20:00:00-03:00',
      })
    ).toEqual({ skipped: ['2026-09-06'], segments: [] });
  });

  it('finds every September change in a long stay, without fixed dates', () => {
    expect(
      segments.segmentsAround({
        start: '2025-09-01T10:00:00-04:00',
        end: '2026-09-10T10:00:00-03:00',
      }).skipped
    ).toEqual(['2025-09-07', '2026-09-06']);
  });
});

describe('a history that crosses the change of time, in the audit ZIP', () => {
  const crossing = row({
    encounterId: 901,
    patientIdentifier: '111111111',
    patientName: 'Paciente Prueba Uno',
    startPeriod: '2026-09-04T09:00:00.00-06:00',
    endPeriod: '2026-09-15T10:00:00.0-03:00',
  });
  const isHistory = (url: URL) => url.pathname.endsWith('GetHospitalizedEncounterHistory');
  // Eloísa's behaviour, measured: any period whose dates include Sept 6 fails.
  const touchesSkippedDay = (url: URL) =>
    (url.searchParams.get('start_date') ?? '') < '2026-09-07' &&
    (url.searchParams.get('end_date') ?? '') >= '2026-09-06';

  it('joins the segments into one PDF and names the missing day', async () => {
    const { runtime, archive, fetchOfficialPdf } = makeRuntime({
      history: { '111111111': [crossing] },
      pharmacological: { '111111111': [] },
      pdfStatus: url =>
        isHistory(url) && touchesSkippedDay(url) ? { status: 500, error: 'HTTP 500' } : null,
      realPdfPages: url => (url.searchParams.get('end_date')?.startsWith('2026-09-05') ? 2 : 5),
    });

    const result = await runtime.handleRequest({
      requestId: 'req-40',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1, failedCount: 0 });
    expect(result.summary?.[0]).toMatchObject({ downloaded: 1, incomplete: 1 });
    const name =
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-09-04 - sin 2026-09-06.pdf';
    const merged = await PDFLib.PDFDocument.load(archive()[name]);
    expect(merged.getPageCount()).toBe(7);
    expect(strFromU8(archive()['00 Resumen.csv'])).toContain(
      'Descargado sin el 2026-09-06: Eloísa no genera el historial de ese día (cambio de hora)'
    );
    // The whole period first, then the two segments; no retries of a period that cannot work.
    expect(fetchOfficialPdf).toHaveBeenCalledTimes(3);
  });

  it('does not split a history that fails for another reason', async () => {
    const after = row({ ...crossing, startPeriod: '2026-09-08T09:00:00.00-05:00' });
    const { runtime, fetchOfficialPdf } = makeRuntime({
      history: { '111111111': [after] },
      pharmacological: { '111111111': [] },
      pdfStatus: url => (isHistory(url) ? { status: 500, error: 'HTTP 500' } : null),
    });

    await runtime.handleRequest({
      requestId: 'req-41',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(
      fetchOfficialPdf.mock.calls.every(
        ([request]) =>
          !new URL(request.url).searchParams.get('start_date')?.startsWith('2026-09-07')
      )
    ).toBe(true);
  });

  it('says a stay inside the skipped day cannot be obtained, without retrying it', async () => {
    const insideDay = row({
      ...crossing,
      startPeriod: '2026-09-06T02:00:00.00-03:00',
      endPeriod: '2026-09-06T20:00:00.0-03:00',
    });
    const { runtime, fetchOfficialPdf, archive } = makeRuntime({
      history: { '111111111': [insideDay, row({ ...crossing, encounterId: 902 })] },
      pharmacological: { '111111111': [] },
      pdfStatus: url =>
        isHistory(url) && touchesSkippedDay(url) ? { status: 500, error: 'HTTP 500' } : null,
      realPdfPages: () => 1,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-42',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, failedCount: 1 });
    expect(strFromU8(archive()['00 Resumen.csv'])).toContain(
      'No descargado: Eloísa no genera el historial del 2026-09-06 (cambio de hora);'
    );
    // The one inside the day: one whole-period try. The other: whole period plus two segments.
    expect(fetchOfficialPdf).toHaveBeenCalledTimes(4);
  });
});
