import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE,
  RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
  RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST_TYPE,
  RAYEN_STATISTICAL_DISCHARGE_REPORT_RESULT_TYPE,
  requestRayenHospitalizationDocument,
  requestRayenHospitalizationEpisodes,
  requestRayenStatisticalDischargeReport,
} from '@/features/rayen-import/bridge/hospitalizationReportsBridge';

const captureOutgoingRequest = async (request: Promise<unknown>) => {
  const posted: unknown[] = [];
  const listener = (event: MessageEvent) => posted.push(event.data);
  window.addEventListener('message', listener);
  await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
  const outgoing = posted.find(
    value => (value as { type?: string }).type === RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE
  ) as Record<string, unknown>;
  window.removeEventListener('message', listener);
  return { outgoing, request };
};

describe('hospitalization reports bridge', () => {
  it('normalizes the RUN and accepts only safe episode metadata', async () => {
    const pending = requestRayenHospitalizationEpisodes({
      patientRun: '17.752.753-1',
      censusDate: '2026-07-19',
    });
    const { outgoing } = await captureOutgoingRequest(pending);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
          episodes: [
            {
              encId: '141336',
              startDate: '2026-07-18',
              endDate: '',
              active: true,
              patientName: ' Paciente Sintetico ',
              identifierType: 4,
              diagnosis: 'must not cross',
            },
            { encId: 'invalid', startDate: '2026-07-01', diagnosis: 'must not cross' },
          ],
        },
      })
    );

    await expect(pending).resolves.toEqual({
      ok: true,
      opened: false,
      error: undefined,
      episodes: [
        {
          encId: '141336',
          startDate: '2026-07-18',
          endDate: '',
          active: true,
          patientName: 'Paciente Sintetico',
          identifierType: 4,
        },
      ],
    });
    expect(outgoing).toMatchObject({
      operation: 'list',
      patientRun: '177527531',
      censusDate: '2026-07-19',
    });
  });

  it('sends the selected episode and document type', async () => {
    const pending = requestRayenHospitalizationDocument({
      clinicalEpisodeId: '141336',
      patientRun: '17.752.753-1',
      documentType: 'history',
    });
    const { outgoing } = await captureOutgoingRequest(pending);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
          opened: true,
        },
      })
    );

    await expect(pending).resolves.toMatchObject({ ok: true, opened: true });
    expect(outgoing).toMatchObject({
      operation: 'download',
      documentType: 'history',
      encId: '141336',
    });
  });

  it('rejects invalid patient identifiers before posting', async () => {
    await expect(requestRayenHospitalizationEpisodes({ patientRun: 'SIN-RUN' })).resolves.toEqual({
      ok: false,
      error: 'El paciente no tiene un RUN ni un episodio válido para buscar informes.',
    });
  });

  it('uses the synced episode for a newborn without RUN', async () => {
    const pending = requestRayenHospitalizationEpisodes({
      patientRun: '',
      clinicalEpisodeId: '141814',
      admissionDate: '2026-07-20',
    });
    const { outgoing } = await captureOutgoingRequest(pending);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
          episodes: [{ encId: '141814', startDate: '2026-07-20', active: true }],
        },
      })
    );

    await expect(pending).resolves.toMatchObject({
      ok: true,
      episodes: [{ encId: '141814', startDate: '2026-07-20', active: true }],
    });
    expect(outgoing).toMatchObject({
      operation: 'list',
      patientRun: '',
      encId: '141814',
      admissionDate: '2026-07-20',
    });
  });

  it('preserves an unknown episode state and a missing admission date for direct newborn lookup', async () => {
    const pending = requestRayenHospitalizationEpisodes({
      patientRun: '',
      clinicalEpisodeId: '141814',
    });
    const { outgoing } = await captureOutgoingRequest(pending);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
          episodes: [{ encId: '141814', startDate: '', endDate: '' }],
        },
      })
    );

    await expect(pending).resolves.toEqual({
      ok: true,
      episodes: [{ encId: '141814', startDate: '', endDate: '' }],
      opened: false,
      error: undefined,
    });
  });

  it('requests the exact statistical-discharge episode without exposing patient data', async () => {
    const posted: unknown[] = [];
    const listener = (event: MessageEvent) => posted.push(event.data);
    window.addEventListener('message', listener);
    const pending = requestRayenStatisticalDischargeReport('141704');
    await vi.waitFor(() =>
      expect(
        posted.some(
          value =>
            (value as { type?: string }).type === RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST_TYPE
        )
      ).toBe(true)
    );
    const outgoing = posted.find(
      value => (value as { type?: string }).type === RAYEN_STATISTICAL_DISCHARGE_REPORT_REQUEST_TYPE
    ) as Record<string, unknown>;
    window.removeEventListener('message', listener);

    expect(outgoing).toMatchObject({ encId: '141704' });
    expect(outgoing).not.toHaveProperty('patientRun');
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_STATISTICAL_DISCHARGE_REPORT_RESULT_TYPE,
          reqId: outgoing.reqId,
          ok: true,
        },
      })
    );
    await expect(pending).resolves.toEqual({ ok: true, error: undefined });
  });
});

describe('hospitalization document identity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const runCases = [
    ['123456785', '123456785', true],
    ['12.345.678-5', '123456785', true],
    ['12345678-5', '123456785', true],
    [' 12.345.678-5 ', '123456785', true],
    ['12 345 678 5', '123456785', true],
    ['1234567k', '1234567K', true],
    ['1.234.567-k', '1234567K', true],
    ['1.234.567-K', '1234567K', true],
    ['1234560', '1234560', true],
    ['12.345.678-0', '123456780', true],
    ['1234567890', '1234567890', false],
    ['123456', '123456', false],
    ['1-9', '19', false],
    ['', '', false],
    ['---', '', false],
    ['K', 'K', false],
  ] as const;

  it.each(runCases)(
    'preserves the exact RUN message for %j',
    async (patientRun, normalized, valid) => {
      for (const clinicalEpisodeId of [undefined, '900001']) {
        for (const operation of ['list', 'download'] as const) {
          vi.mocked(window.postMessage).mockClear();
          const request = {
            patientRun,
            clinicalEpisodeId,
            admissionDate: '2026-11-01',
            censusDate: '2026-11-02',
          };
          const pending =
            operation === 'list'
              ? requestRayenHospitalizationEpisodes(request, 1)
              : requestRayenHospitalizationDocument({ ...request, documentType: 'history' }, 1);
          if (valid || clinicalEpisodeId) {
            const expected = {
              type: RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE,
              reqId: 'hospitalization-report-1000-500000000',
              operation,
              documentType: operation === 'download' ? 'history' : undefined,
              encId: clinicalEpisodeId,
              patientRun: normalized,
              admissionDate: request.admissionDate,
              censusDate: request.censusDate,
            };
            expect(JSON.stringify(vi.mocked(window.postMessage).mock.calls[0]?.[0])).toBe(
              JSON.stringify(expected)
            );
            expect(window.postMessage).toHaveBeenCalledWith(expected, window.location.origin);
          } else {
            expect(window.postMessage).not.toHaveBeenCalled();
          }
          await vi.runAllTimersAsync();
          await pending;
          vi.setSystemTime(1000);
        }
      }
    }
  );

  it.each(['P123456785', '12A3456785', 'K123456785', '12345678KK', 'Ñ123456785'])(
    'never searches passport %s as a RUN',
    async patientRun => {
      for (const clinicalEpisodeId of [undefined, 'invalid', ' 900001 ']) {
        for (const operation of ['list', 'download'] as const) {
          vi.mocked(window.postMessage).mockClear();
          const request = { patientRun, clinicalEpisodeId };
          const pending =
            operation === 'list'
              ? requestRayenHospitalizationEpisodes(request, 1)
              : requestRayenHospitalizationDocument({ ...request, documentType: 'epicrisis' }, 1);
          await vi.runAllTimersAsync();
          const result = await pending;
          if (clinicalEpisodeId === ' 900001 ') {
            expect(window.postMessage).toHaveBeenCalledWith(
              expect.objectContaining({ patientRun: '', encId: '900001', operation }),
              window.location.origin
            );
          } else {
            expect(window.postMessage).not.toHaveBeenCalled();
            expect(result).toEqual({
              ok: false,
              error: 'El paciente no tiene un RUN ni un episodio válido para buscar informes.',
            });
          }
        }
      }
    }
  );
});
