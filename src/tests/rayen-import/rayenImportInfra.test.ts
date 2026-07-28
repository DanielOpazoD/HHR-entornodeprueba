import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RAYEN_IMPORT_MODE,
  getRayenImportMode,
  setRayenImportMode,
  subscribeRayenImportMode,
  isRayenCensusSnapshot,
  isRayenSyncBundle,
  requestRayenSyncBundle,
  cancelRayenSyncBundleRequest,
  type RayenCensusSnapshot,
} from '@/features/rayen-import';
import {
  RAYEN_EGRESO_REPORT_RESULT_TYPE,
  RAYEN_EGRESO_LOOKUP_RESULT_TYPE,
  RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
  requestEgresoReport,
  requestEgresoLookup,
  requestHistoryScales,
  subscribeToRayenImportErrors,
  subscribeToRayenSnapshots,
} from '@/features/rayen-import/bridge/rayenImportBridge';
import {
  RAYEN_PATIENT_FLOW_REQUEST_TYPE,
  RAYEN_PATIENT_FLOW_RESULT_TYPE,
  requestPatientFlowReport,
} from '@/features/rayen-import/bridge/patientFlowBridge';

describe('rayen import mode setting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to preview', () => {
    expect(DEFAULT_RAYEN_IMPORT_MODE).toBe('preview');
    expect(getRayenImportMode()).toBe('preview');
  });

  it('persists and reads the auto mode', () => {
    setRayenImportMode('auto');
    expect(getRayenImportMode()).toBe('auto');
    expect(localStorage.getItem('hhr_rayen_import_mode')).toBe('auto');
    setRayenImportMode('preview');
    expect(getRayenImportMode()).toBe('preview');
  });

  it('notifies subscribers on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRayenImportMode(listener);
    setRayenImportMode('auto');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setRayenImportMode('preview');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('isRayenCensusSnapshot', () => {
  const validSnapshot: RayenCensusSnapshot = {
    capturedAt: '2026-07-08T20:00:00-06:00',
    facilityId: 1342,
    encounters: [
      { encounterId: 'E1', run: '144700554', firstGivenName: 'Ana', firstFamilyName: 'Perez' },
    ],
  };

  it('accepts a well-formed snapshot', () => {
    expect(isRayenCensusSnapshot(validSnapshot)).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isRayenCensusSnapshot(null)).toBe(false);
    expect(isRayenCensusSnapshot({ facilityId: 1342 })).toBe(false);
    expect(isRayenCensusSnapshot({ ...validSnapshot, encounters: [{ run: '1' }] })).toBe(false);
    expect(
      isRayenCensusSnapshot({
        ...validSnapshot,
        encounters: [
          {
            ...validSnapshot.encounters[0],
            verifiedBedPlacement: {
              source: 'patient-flow-report',
              bedId: 'H2C2',
              changedAt: '2026-07-23T23:10:09',
            },
          },
        ],
      })
    ).toBe(false);
  });
});

describe('Rayen synchronized source bundle bridge', () => {
  const bundle = {
    id: 'sync-1',
    startedAt: '2026-07-24T10:00:00.000Z',
    completedAt: '2026-07-24T10:00:05.000Z',
    facilityId: 1342,
    dateStart: '2026-07-24',
    dateEnd: '2026-07-25',
    fichaMedicoCapturedAt: '2026-07-24T10:00:01.000Z',
    gestionCamasCapturedAt: '2026-07-24T10:00:04.000Z',
    sourceSkewMs: 3000,
    egresoRows: [],
  };

  it('validates temporal evidence and rejects malformed report rows', () => {
    expect(isRayenSyncBundle(bundle)).toBe(true);
    expect(isRayenSyncBundle({ ...bundle, sourceSkewMs: Number.NaN })).toBe(false);
    expect(isRayenSyncBundle({ ...bundle, sourceSkewMs: 120_001 })).toBe(false);
    expect(
      isRayenSyncBundle({ ...bundle, gestionCamasCapturedAt: '2026-07-24T12:00:00.000Z' })
    ).toBe(false);
    expect(isRayenSyncBundle({ ...bundle, egresoRows: [{ run: '1' }] })).toBe(false);
  });

  it('ignores standalone snapshots and accepts only the matching guarded bundle', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToRayenSnapshots(handler);
    const snapshot: RayenCensusSnapshot = {
      capturedAt: bundle.fichaMedicoCapturedAt,
      facilityId: bundle.facilityId,
      encounters: [],
      isComplete: true,
    };
    const requestId = requestRayenSyncBundle(bundle.dateStart, bundle.dateEnd);

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'HHR_RAYEN_CENSUS_SNAPSHOT', requestId, snapshot },
      })
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
          requestId,
          snapshot: { ...snapshot, isComplete: false },
          bundle,
        },
      })
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'HHR_RAYEN_CENSUS_SNAPSHOT', requestId, snapshot, bundle },
      })
    );
    expect(handler).toHaveBeenCalledWith(snapshot, bundle);
    unsubscribe();
  });

  it('ignores a late response after a newer correlated request supersedes it', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToRayenSnapshots(handler);
    const staleRequestId = requestRayenSyncBundle(bundle.dateStart, bundle.dateEnd);
    const activeRequestId = requestRayenSyncBundle(bundle.dateStart, bundle.dateEnd);
    const snapshot: RayenCensusSnapshot = {
      capturedAt: bundle.fichaMedicoCapturedAt,
      facilityId: bundle.facilityId,
      encounters: [],
      isComplete: true,
    };

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
          requestId: staleRequestId,
          snapshot,
          bundle,
        },
      })
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: 'HHR_RAYEN_CENSUS_SNAPSHOT',
          requestId: activeRequestId,
          snapshot,
          bundle,
        },
      })
    );
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('requests both sources with the exact census report range', () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const requestId = requestRayenSyncBundle('2026-07-24', '2026-07-25');

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
        requestId,
        dateStart: '2026-07-24',
        dateEnd: '2026-07-25',
      },
      window.location.origin
    );
    cancelRayenSyncBundleRequest(requestId);
    postMessage.mockRestore();
  });
});

describe('patient-flow report bridge', () => {
  it('requests one numeric episode and correlates its PDF response', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const pending = requestPatientFlowReport('142040', 1000);
    const request = postMessage.mock.calls[0]?.[0] as {
      type: string;
      reqId: string;
      encId: string;
    };

    expect(request).toMatchObject({
      type: RAYEN_PATIENT_FLOW_REQUEST_TYPE,
      encId: '142040',
    });
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_PATIENT_FLOW_RESULT_TYPE,
          reqId: request.reqId,
          base64: 'RESPUESTA-FRAME',
        },
      })
    );
    await Promise.resolve();
    expect(resolved).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data: {
          type: RAYEN_PATIENT_FLOW_RESULT_TYPE,
          reqId: request.reqId,
          base64: 'JVBERg==',
        },
      })
    );

    await expect(pending).resolves.toEqual({ base64: 'JVBERg==', error: undefined });
    postMessage.mockRestore();
  });

  it('rejects a non-numeric episode before posting a request', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    await expect(requestPatientFlowReport('../142040')).resolves.toEqual({
      base64: '',
      error: 'El episodio clínico no es válido.',
    });
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });
});

describe('bounded clinical-history bridge', () => {
  it('carries the requested census day through the correlated extension request', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const pending = requestHistoryScales('142040', '2026-07-21', 1000);
    const request = postMessage.mock.calls[0]?.[0] as { reqId: string };

    expect(request).toMatchObject({
      type: 'HHR_RAYEN_HISTORY_SCALES_REQUEST',
      encId: '142040',
      censusDate: '2026-07-21',
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'HHR_RAYEN_HISTORY_SCALES_RESULT', reqId: request.reqId, events: [] },
      })
    );

    await expect(pending).resolves.toEqual({ events: [], nursingActivity: [], error: undefined });
    postMessage.mockRestore();
  });
});

describe('Rayen import error bridge', () => {
  it('delivers only the error correlated to the active sync request', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToRayenImportErrors(handler);
    const requestId = requestRayenSyncBundle('2026-07-24', '2026-07-25');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
          error: 'Error legado sin correlación.',
        },
      })
    );
    expect(handler).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_IMPORT_ERROR_MESSAGE_TYPE,
          requestId,
          error: 'No hay una pestaña de Ficha Médico abierta.',
        },
      })
    );

    expect(handler).toHaveBeenCalledWith('No hay una pestaña de Ficha Médico abierta.');
    unsubscribe();
  });
});

describe('administrative-discharge report bridge', () => {
  it('accepts a successful empty report as authoritative', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const pending = requestEgresoReport('2026-07-14', '2026-07-15', 1000);
    const request = postMessage.mock.calls[0]?.[0] as { reqId: string };

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_EGRESO_REPORT_RESULT_TYPE,
          reqId: request.reqId,
          ok: true,
          rows: [],
        },
      })
    );

    await expect(pending).resolves.toEqual({ ok: true, rows: [] });
    postMessage.mockRestore();
  });

  it('rejects a legacy rows-only response that cannot prove report availability', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const pending = requestEgresoReport('2026-07-14', '2026-07-15', 1000);
    const request = postMessage.mock.calls[0]?.[0] as { reqId: string };

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: RAYEN_EGRESO_REPORT_RESULT_TYPE, reqId: request.reqId, rows: [] },
      })
    );

    await expect(pending).resolves.toEqual({ ok: false, reason: 'unavailable' });
    postMessage.mockRestore();
  });

  it('returns an explicit timeout instead of an authoritative empty report', async () => {
    vi.useFakeTimers();
    const pending = requestEgresoReport('2026-07-14', '2026-07-15', 25);

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
    vi.useRealTimers();
  });
});

describe('exact-episode egreso lookup bridge', () => {
  it('sends both the normalized compatibility RUN list and the exact hospitalization target', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const pending = requestEgresoLookup([{ run: '22.025.389-9', encounterId: '141704' }], 1000);
    const request = postMessage.mock.calls[0]?.[0] as {
      reqId: string;
      runs: string[];
      targets: Array<{ run: string; encounterId: string }>;
    };

    expect(request.runs).toEqual(['22.025.389-9']);
    expect(request.targets).toEqual([{ run: '22.025.389-9', encounterId: '141704' }]);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: {
          type: RAYEN_EGRESO_LOOKUP_RESULT_TYPE,
          reqId: request.reqId,
          results: [{ run: '220253899', encounterId: '141704', egreso: { id: 141704 } }],
        },
      })
    );

    await expect(pending).resolves.toEqual([
      { run: '220253899', encounterId: '141704', egreso: { id: 141704 } },
    ]);
    postMessage.mockRestore();
  });
});
