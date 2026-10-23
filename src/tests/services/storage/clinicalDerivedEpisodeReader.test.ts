import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((parent: unknown, name: string) => ({ kind: 'collection', parent, name })),
  doc: vi.fn((parent: unknown, id: string) => ({ kind: 'doc', parent, id })),
  getDoc: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
}));
const { recordOperationalTelemetry, reportBasicReadPermissionDenied } = vi.hoisted(() => ({
  recordOperationalTelemetry: vi.fn(),
  reportBasicReadPermissionDenied: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  getRecordDocRef: vi.fn((date: string) => ({ kind: 'recordDocRef', date })),
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({ kind: 'db' }) },
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry,
}));
vi.mock('@/services/auth/sessionPermissionStormDetector', () => ({
  reportBasicReadPermissionDenied,
}));

import {
  readClinicalDerivedEpisodeDoc,
  readClinicalDerivedEpisodeDocs,
} from '@/services/storage/firestore/clinicalDerivedEpisodeReader';

const DATE = '2026-11-02';
const episode = (clinicalEpisodeId: string, fields: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId,
  layoutGeneration: 'gen_synthetic_a',
  dayRevision: 3,
  vitalSignsHistory: null,
  ...fields,
});
const snapshotOf = (...docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
  docs: docs.map(item => ({ id: item.id, data: () => item.data })),
});
const docSnapshot = (id: string, data?: Record<string, unknown>) => ({
  id,
  exists: () => data !== undefined,
  data: () => data,
});
const rawError = Object.assign(new Error('Missing or insufficient permissions: secret detail'), {
  code: 'permission-denied',
});

describe('clinicalDerivedEpisodeReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads every episode document of the day under the day document', async () => {
    firestore.getDocs.mockResolvedValueOnce(
      snapshotOf({ id: 'ep_a', data: episode('ep_a') }, { id: 'ep_b', data: episode('ep_b') })
    );

    const result = await readClinicalDerivedEpisodeDocs(DATE);

    expect(firestore.collection).toHaveBeenCalledWith(
      { kind: 'recordDocRef', date: DATE },
      'clinicalDerived'
    );
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'resolved', docs: [episode('ep_a'), episode('ep_b')] });
    expect(recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('bypasses the local cache when asked for the server and resolves a real empty day', async () => {
    firestore.getDocsFromServer.mockResolvedValueOnce(snapshotOf());

    expect(await readClinicalDerivedEpisodeDocs(DATE, { source: 'server' })).toEqual({
      status: 'resolved',
      docs: [],
    });
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('returns a denial typed, reports only its code and never feeds the permission storm', async () => {
    firestore.getDocs.mockRejectedValueOnce(rawError);

    const result = await readClinicalDerivedEpisodeDocs(DATE);

    expect(result).toEqual({ status: 'permission_denied', code: 'permission-denied' });
    expect(reportBasicReadPermissionDenied).not.toHaveBeenCalled();
    expect(recordOperationalTelemetry).toHaveBeenCalledTimes(1);
    const event = recordOperationalTelemetry.mock.calls[0][0];
    expect(event).toMatchObject({
      category: 'firestore',
      operation: 'clinical_derived_read',
      date: DATE,
      context: { scope: 'day', code: 'permission-denied', result: 'permission_denied' },
    });
    expect(JSON.stringify(event)).not.toContain('secret detail');
  });

  it.each([
    [{ code: 'unavailable', message: 'network down' }, 'unavailable'],
    [new Error('no code at all'), 'unknown'],
  ])('returns any other read error as failed with its code', async (error, code) => {
    firestore.getDocs.mockRejectedValueOnce(error);

    expect(await readClinicalDerivedEpisodeDocs(DATE)).toEqual({ status: 'failed', code });
    expect(recordOperationalTelemetry.mock.calls[0][0].context).toEqual({
      scope: 'day',
      code,
      result: 'failed',
    });
  });

  it.each([
    ['an unknown schema version', 'ep_a', episode('ep_a', { schemaVersion: 2 })],
    ['an id that differs from its episode', 'ep_other', episode('ep_a')],
  ])('fails the whole read on a document with %s instead of dropping it', async (_l, id, data) => {
    firestore.getDocs.mockResolvedValueOnce(
      snapshotOf({ id: 'ep_ok', data: episode('ep_ok') }, { id, data })
    );

    expect(await readClinicalDerivedEpisodeDocs(DATE)).toEqual({
      status: 'failed',
      code: 'invalid_document',
    });
  });

  it('reads one episode document, or resolves null when the episode has none', async () => {
    firestore.getDoc.mockResolvedValueOnce(docSnapshot('ep_a', episode('ep_a')));
    firestore.getDocFromServer.mockResolvedValueOnce(docSnapshot('ep_b'));

    expect(await readClinicalDerivedEpisodeDoc(DATE, 'ep_a')).toEqual({
      status: 'resolved',
      doc: episode('ep_a'),
    });
    expect(firestore.doc).toHaveBeenLastCalledWith(
      { kind: 'collection', parent: { kind: 'recordDocRef', date: DATE }, name: 'clinicalDerived' },
      'ep_a'
    );
    expect(await readClinicalDerivedEpisodeDoc(DATE, 'ep_b', { source: 'server' })).toEqual({
      status: 'resolved',
      doc: null,
    });
  });

  it('never reads for an id that cannot own a document', async () => {
    for (const id of ['', 'ep/1', 'ep.1', '__x__']) {
      expect(await readClinicalDerivedEpisodeDoc(DATE, id)).toEqual({
        status: 'resolved',
        doc: null,
      });
    }
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.doc).not.toHaveBeenCalled();
  });

  it('returns a failed single read typed, with the episode scope', async () => {
    firestore.getDoc.mockRejectedValueOnce(rawError);
    firestore.getDocFromServer.mockRejectedValueOnce({ code: 'unavailable' });

    expect(await readClinicalDerivedEpisodeDoc(DATE, 'ep_a')).toEqual({
      status: 'permission_denied',
      code: 'permission-denied',
    });
    expect(await readClinicalDerivedEpisodeDoc(DATE, 'ep_a', { source: 'server' })).toEqual({
      status: 'failed',
      code: 'unavailable',
    });
    expect(recordOperationalTelemetry.mock.calls.map(([event]) => event.context.scope)).toEqual([
      'episode',
      'episode',
    ]);
    expect(reportBasicReadPermissionDenied).not.toHaveBeenCalled();
  });
});
