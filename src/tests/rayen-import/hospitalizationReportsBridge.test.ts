import { describe, expect, it, vi } from 'vitest';

import {
  RAYEN_HOSPITALIZATION_REPORT_REQUEST_TYPE,
  RAYEN_HOSPITALIZATION_REPORT_RESULT_TYPE,
  requestRayenHospitalizationDocument,
  requestRayenHospitalizationEpisodes,
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
            { encId: '141336', startDate: '2026-07-18', endDate: '', active: true },
            { encId: 'invalid', startDate: '2026-07-01', diagnosis: 'must not cross' },
          ],
        },
      })
    );

    await expect(pending).resolves.toEqual({
      ok: true,
      opened: false,
      error: undefined,
      episodes: [{ encId: '141336', startDate: '2026-07-18', endDate: '', active: true }],
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
      error: 'El paciente no tiene un RUN válido para buscar informes.',
    });
  });
});
