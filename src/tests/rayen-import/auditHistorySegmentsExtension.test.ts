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
        parts: unknown[];
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
      // In time order, so the skipped day's documents go between the two segments.
      parts: [
        { segment: { start: '2026-09-04T09:00:00.00-06:00', end: '2026-09-05T23:59:59-04:00' } },
        { skippedDay: '2026-09-06' },
        { segment: { start: '2026-09-07T00:00:00-03:00', end: '2026-09-15T10:00:00.0-03:00' } },
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
    expect(segments.segmentsAround({ start, end })).toEqual({
      skipped: [],
      segments: [],
      parts: [],
    });
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
    ).toEqual({ skipped: ['2026-09-06'], segments: [], parts: [{ skippedDay: '2026-09-06' }] });
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
  const isDailySummary = (url: URL) => url.pathname.endsWith('Resumen_diario_paciente.pdf');
  // Eloísa's behaviour, measured: any period whose dates include Sept 6 fails.
  const touchesSkippedDay = (url: URL) =>
    (url.searchParams.get('start_date') ?? '') < '2026-09-07' &&
    (url.searchParams.get('end_date') ?? '') >= '2026-09-06';
  const failingHistory = (url: URL) =>
    isHistory(url) && touchesSkippedDay(url) ? { status: 500, error: 'HTTP 500' } : null;
  // Synthetic records: mainland times, as Ficha Médico writes them.
  const historyJson = [
    {
      publishDatetime: '2026-09-06T10:15:00',
      evolutionResume: [
        {
          OBE_PUBLISH_DATETIME: '2026-09-06T10:15:00',
          OBE_NOTES: 'Evolución sintética del día',
          HCP_FGN: 'Ana',
          HCP_FFN: 'Prueba',
          HCPR_NAME: 'Médico',
        },
      ],
    },
    {
      publishDatetime: '2026-09-07T09:00:00',
      evolutionResume: [
        { OBE_PUBLISH_DATETIME: '2026-09-07T09:00:00', OBE_NOTES: 'Ya en el tramo oficial' },
      ],
    },
  ];
  const pagesFor = (url: URL) => {
    if (isDailySummary(url)) return 1;
    return url.searchParams.get('end_date')?.startsWith('2026-09-05') ? 2 : 5;
  };

  it('places the official daily summary and the HHR annex of Sept 6 between the segments', async () => {
    const { runtime, archive, fetchOfficialPdf } = makeRuntime({
      history: { '111111111': [crossing] },
      pharmacological: { '111111111': [] },
      pdfStatus: failingHistory,
      realPdfPages: pagesFor,
      historyJson,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-40',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1, failedCount: 0 });
    expect(result.summary?.[0]).toMatchObject({ downloaded: 1, reconstructed: 1, incomplete: 0 });
    const name =
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-09-04 - 2026-09-06 con resumen diario y anexo HHR.pdf';
    const merged = await PDFLib.PDFDocument.load(archive()[name]);
    // Segment until Sept 5 (2) + daily summary (1) + annex (1) + segment from Sept 7 (5).
    expect(merged.getPageCount()).toBe(9);
    expect(strFromU8(archive()['00 Resumen.csv'])).toContain(
      'el 2026-09-06 va con el Resumen diario oficial de Eloísa y un anexo HHR no oficial con 1 registro(s) de Ficha Médico'
    );
    const summaryCall = fetchOfficialPdf.mock.calls
      .map(([request]) => new URL(request.url))
      .find(isDailySummary);
    expect(Object.fromEntries(summaryCall?.searchParams ?? [])).toEqual({
      enc_id: '901',
      fecha: '2026-09-06',
      fac_id: '7',
    });
  });

  it('still joins the rest when the daily summary or the records are missing, and says which', async () => {
    const noSummary = makeRuntime({
      history: { '111111111': [crossing] },
      pharmacological: { '111111111': [] },
      pdfStatus: url =>
        isDailySummary(url) ? { status: 500, error: 'HTTP 500' } : failingHistory(url),
      realPdfPages: pagesFor,
      historyJson,
    });
    const noRecords = makeRuntime({
      history: { '111111111': [crossing] },
      pharmacological: { '111111111': [] },
      pdfStatus: failingHistory,
      realPdfPages: pagesFor,
      historyJson: 503,
    });

    const first = await noSummary.runtime.handleRequest({
      requestId: 'req-41',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });
    const second = await noRecords.runtime.handleRequest({
      requestId: 'req-42',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(first.summary?.[0]).toMatchObject({ downloaded: 1, reconstructed: 0, incomplete: 1 });
    expect(Object.keys(noSummary.archive())).toContain(
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-09-04 - 2026-09-06 solo anexo HHR.pdf'
    );
    expect(strFromU8(noSummary.archive()['00 Resumen.csv'])).toContain(
      'sin el Resumen diario (HTTP 500)'
    );
    expect(second.summary?.[0]).toMatchObject({ downloaded: 1, incomplete: 1 });
    expect(strFromU8(noRecords.archive()['00 Resumen.csv'])).toContain(
      'sin anexo HHR (Ficha Médico respondió HTTP 503 al leer los registros.)'
    );
  });

  it('does not split a history that fails for another reason', async () => {
    const after = row({ ...crossing, startPeriod: '2026-09-08T09:00:00.00-05:00' });
    const { runtime, fetchOfficialPdf } = makeRuntime({
      history: { '111111111': [after] },
      pharmacological: { '111111111': [] },
      pdfStatus: url => (isHistory(url) ? { status: 500, error: 'HTTP 500' } : null),
    });

    await runtime.handleRequest({
      requestId: 'req-43',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(
      fetchOfficialPdf.mock.calls.every(([request]) => {
        const url = new URL(request.url);
        return (
          !isDailySummary(url) && !url.searchParams.get('start_date')?.startsWith('2026-09-07')
        );
      })
    ).toBe(true);
  });

  // Measured 2026-11-03: Eloísa dropped the connection on one segment of two such stays, every run.
  const covers = (url: URL, day: string) =>
    (url.searchParams.get('start_date') ?? '').slice(0, 10) <= day &&
    (url.searchParams.get('end_date') ?? '').slice(0, 10) >= day;
  const dropped = { error: 'Falló la conexión con Eloísa: Failed to fetch' };
  const period = (url: URL) =>
    `${url.searchParams.get('start_date')?.slice(0, 10)}..${url.searchParams.get('end_date')?.slice(0, 10)}`;

  it('asks for a segment Eloísa drops in halves and rebuilds only the day it never serves', async () => {
    const { runtime, archive, fetchOfficialPdf, sendTabMessage } = makeRuntime({
      history: { '111111111': [crossing] },
      pharmacological: { '111111111': [] },
      pdfStatus: url =>
        isHistory(url) && covers(url, '2026-09-10') ? dropped : failingHistory(url),
      realPdfPages: () => 1,
      historyJson,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-45',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1, failedCount: 0 });
    expect(result.summary?.[0]).toMatchObject({ downloaded: 1, reconstructed: 1, incomplete: 0 });
    const requests = fetchOfficialPdf.mock.calls.map(([request]) => new URL(request.url));
    expect(requests.filter(isHistory).map(period)).toEqual([
      '2026-09-04..2026-09-15',
      '2026-09-04..2026-09-05',
      '2026-09-07..2026-09-15',
      '2026-09-07..2026-09-10',
      '2026-09-07..2026-09-08',
      '2026-09-09..2026-09-10',
      '2026-09-09..2026-09-09',
      '2026-09-10..2026-09-10',
      '2026-09-11..2026-09-15',
    ]);
    expect(requests.filter(isDailySummary).map(url => url.searchParams.get('fecha'))).toEqual([
      '2026-09-06',
      '2026-09-10',
    ]);
    const name =
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-09-04 - 2026-09-06 con resumen diario y anexo HHR - 2026-09-10 con resumen diario y anexo HHR.pdf';
    expect(Object.keys(archive())).toContain(name);
    expect(strFromU8(archive()['00 Resumen.csv'])).toContain(
      'Descargado en tramos: Eloísa no entregó el historial oficial de algunos días; el 2026-09-06 va con el Resumen diario oficial de Eloísa y un anexo HHR no oficial con 1 registro(s) de Ficha Médico; el 2026-09-10 (Eloísa no entregó su historial) va con el Resumen diario oficial de Eloísa'
    );
    // Every segment request repeats the progress, so HHR keeps waiting during a long split.
    const waiting = sendTabMessage.mock.calls.filter(
      ([, message]) =>
        (message as { type?: string; phase?: string }).type === 'RAYEN_AUDIT_DOCUMENTS_PROGRESS' &&
        (message as { phase?: string }).phase === 'downloading'
    );
    expect(waiting.length).toBeGreaterThanOrEqual(1 + 8 + 1);
  });

  it('gives a history up within its limits when Eloísa serves no day of it', async () => {
    const { runtime, fetchOfficialPdf } = makeRuntime({
      history: { '111111111': [crossing] },
      pharmacological: { '111111111': [] },
      pdfStatus: url => (isHistory(url) ? dropped : null),
      realPdfPages: () => 1,
      historyJson,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-46',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result.error).toBe('Eloísa no entregó ninguno de los documentos. No se descargó nada.');
    expect(result.summary?.[0]).toMatchObject({ downloaded: 0, failed: 1 });
    const requests = fetchOfficialPdf.mock.calls.map(([request]) => new URL(request.url));
    // Three attempts, each the whole stay plus a few days before the three-day limit stops it.
    expect(requests.filter(isHistory).length).toBeLessThanOrEqual(3 * 21);
    expect(requests.filter(isDailySummary).length).toBeLessThanOrEqual(3 * 3);
  });

  it('rebuilds a stay that lies entirely within the skipped day from its summary and records', async () => {
    const insideDay = row({
      ...crossing,
      startPeriod: '2026-09-06T02:00:00.00-03:00',
      endPeriod: '2026-09-06T20:00:00.0-03:00',
    });
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [insideDay] },
      pharmacological: { '111111111': [] },
      pdfStatus: failingHistory,
      realPdfPages: () => 1,
      historyJson,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-44',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1, failedCount: 0 });
    const name =
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-09-06 - 2026-09-06 con resumen diario y anexo HHR.pdf';
    expect((await PDFLib.PDFDocument.load(archive()[name])).getPageCount()).toBe(2);
  });
});
