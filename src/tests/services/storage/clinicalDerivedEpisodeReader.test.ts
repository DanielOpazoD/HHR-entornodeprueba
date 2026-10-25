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
  docToRecord: (data: Record<string, unknown>, date: string) => ({ ...data, date }),
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
  readClinicalDerivedDaySnapshot,
  readClinicalDerivedEpisodeDoc,
  readClinicalDerivedEpisodeDocs,
} from '@/services/storage/firestore/clinicalDerivedEpisodeReader';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const episode = (clinicalEpisodeId: string, fields: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  date: DATE,
  clinicalEpisodeId,
  layoutGeneration: GENERATION,
  dayRevision: 3,
  vitalSignsHistory: null,
  ...fields,
});
const snapshotOf = (...docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
  docs: docs.map(item => ({ id: item.id, data: () => item.data })),
  metadata: { fromCache: false },
});
const docSnapshot = (id: string, data?: Record<string, unknown>, fromCache = false) => ({
  id,
  exists: () => data !== undefined,
  data: () => data,
  metadata: { fromCache },
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

    const result = await readClinicalDerivedEpisodeDocs(DATE, GENERATION);

    expect(firestore.collection).toHaveBeenCalledWith(
      { kind: 'recordDocRef', date: DATE },
      'clinicalDerived'
    );
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'resolved',
      docs: [episode('ep_a'), episode('ep_b')],
      fromCache: false,
    });
    expect(recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('bypasses the local cache when asked for the server and resolves a real empty day', async () => {
    firestore.getDocsFromServer.mockResolvedValueOnce(snapshotOf());

    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION, { source: 'server' })).toEqual({
      status: 'resolved',
      docs: [],
      fromCache: false,
    });
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('returns a denial typed, reports only its code and never feeds the permission storm', async () => {
    firestore.getDocs.mockRejectedValueOnce(rawError);

    const result = await readClinicalDerivedEpisodeDocs(DATE, GENERATION);

    expect(result).toEqual({ status: 'permission_denied', code: 'permission-denied' });
    expect(reportBasicReadPermissionDenied).not.toHaveBeenCalled();
    expect(recordOperationalTelemetry).toHaveBeenCalledTimes(1);
    const event = recordOperationalTelemetry.mock.calls[0][0];
    expect(event).toMatchObject({
      category: 'firestore',
      operation: 'clinical_derived_read',
      date: DATE,
      context: { readScope: 'day', errorCode: 'permission-denied' },
    });
    expect(JSON.stringify(event)).not.toContain('secret detail');
  });

  it.each([
    [{ code: 'unavailable', message: 'network down' }, 'unavailable'],
    [new Error('no code at all'), 'unknown'],
  ])('returns any other read error as failed with its code', async (error, code) => {
    firestore.getDocs.mockRejectedValueOnce(error);

    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'failed',
      code,
    });
    expect(recordOperationalTelemetry.mock.calls[0][0].context).toEqual({
      readScope: 'day',
      errorCode: code,
    });
  });

  it.each([
    ['an unknown schema version', 'ep_a', episode('ep_a', { schemaVersion: 2 })],
    ['an id that differs from its episode', 'ep_other', episode('ep_a')],
  ])('fails the whole read on a document with %s instead of dropping it', async (_l, id, data) => {
    firestore.getDocs.mockResolvedValueOnce(
      snapshotOf({ id: 'ep_ok', data: episode('ep_ok') }, { id, data })
    );

    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'failed',
      code: 'invalid_document',
    });
  });

  it('skips leftovers of another generation or date unread, even malformed ones (D14)', async () => {
    const leftover = { ...episode('ep_old', { layoutGeneration: 'gen_deleted' }), dayRevision: -1 };
    firestore.getDocs.mockResolvedValueOnce(
      snapshotOf(
        { id: 'ep_ok', data: episode('ep_ok') },
        { id: 'ep_old', data: leftover },
        { id: 'ep_moved', data: episode('ep_moved', { date: '2026-11-01', schemaVersion: 9 }) }
      )
    );

    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'resolved',
      docs: [episode('ep_ok')],
      fromCache: false,
    });
    firestore.getDoc.mockResolvedValueOnce(docSnapshot('ep_old', leftover));
    expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_old')).toEqual({
      status: 'resolved',
      doc: null,
      fromCache: false,
    });
  });

  it('says when the answer came from the offline cache', async () => {
    firestore.getDocs.mockResolvedValueOnce({ ...snapshotOf(), metadata: { fromCache: true } });
    firestore.getDoc.mockResolvedValueOnce(docSnapshot('ep_a', episode('ep_a'), true));

    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'resolved',
      docs: [],
      fromCache: true,
    });
    expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_a')).toMatchObject({
      status: 'resolved',
      fromCache: true,
    });
  });

  it('reads one episode document, or resolves null when the episode has none', async () => {
    firestore.getDoc.mockResolvedValueOnce(docSnapshot('ep_a', episode('ep_a')));
    firestore.getDocFromServer.mockResolvedValueOnce(docSnapshot('ep_b'));

    expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_a')).toEqual({
      status: 'resolved',
      doc: episode('ep_a'),
      fromCache: false,
    });
    expect(firestore.doc).toHaveBeenLastCalledWith(
      { kind: 'collection', parent: { kind: 'recordDocRef', date: DATE }, name: 'clinicalDerived' },
      'ep_a'
    );
    expect(
      await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_b', { source: 'server' })
    ).toEqual({ status: 'resolved', doc: null, fromCache: false });
  });

  it('never reads for an id that cannot own a document', async () => {
    for (const id of ['', 'ep/1', 'ep.1', '__x__']) {
      expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, id)).toEqual({
        status: 'resolved',
        doc: null,
        fromCache: false,
      });
    }
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.doc).not.toHaveBeenCalled();
  });

  it('returns a failed single read typed, with the episode scope', async () => {
    firestore.getDoc.mockRejectedValueOnce(rawError);
    firestore.getDocFromServer.mockRejectedValueOnce({ code: 'unavailable' });

    expect(await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_a')).toEqual({
      status: 'permission_denied',
      code: 'permission-denied',
    });
    expect(
      await readClinicalDerivedEpisodeDoc(DATE, GENERATION, 'ep_a', { source: 'server' })
    ).toEqual({ status: 'failed', code: 'unavailable' });
    expect(recordOperationalTelemetry.mock.calls.map(([event]) => event.context.readScope)).toEqual(
      ['episode', 'episode']
    );
    expect(reportBasicReadPermissionDenied).not.toHaveBeenCalled();
  });

  // What leaves the device: the allowlist sanitizer must keep the operation, scope and code.
  it.each([
    [rawError, 'permission-denied', 'auth_issue'],
    [{ code: 'unavailable' }, 'unavailable', 'unavailable_issue'],
    [{ code: 'deadline-exceeded' }, 'deadline-exceeded', 'timeout_issue'],
    [{ code: 'invalid_document' }, 'invalid_document', 'schema_issue'],
    [new Error('no code at all'), 'unknown', 'unclassified_issue'],
  ])('reports a failure that survives the privacy sanitizer', async (error, code, issue) => {
    firestore.getDocs.mockRejectedValueOnce(error);
    await readClinicalDerivedEpisodeDocs(DATE, GENERATION);

    const sanitized = sanitizeOperationalTelemetryEvent(
      recordOperationalTelemetry.mock.calls[0][0]
    );
    expect(sanitized).toMatchObject({
      category: 'firestore',
      operation: 'clinical_derived_read',
      date: DATE,
      issues: [issue],
      context: { readScope: 'day', errorCode: code },
      droppedContextKeys: [],
    });
  });
});

describe('readClinicalDerivedDaySnapshot', () => {
  const day = (revision: number, generation: string | null = GENERATION) => ({
    date: DATE,
    meta: { revision },
    ...(generation ? { clinicalDerivedLayout: { version: 1, generation } } : {}),
  });
  /** The server's day on each read, in order, and the documents under it. */
  const serverHolds = (days: Array<Record<string, unknown> | undefined>, ...docIds: string[]) => {
    days.forEach(data => firestore.getDocFromServer.mockResolvedValueOnce(docSnapshot(DATE, data)));
    firestore.getDocsFromServer.mockResolvedValueOnce(
      snapshotOf(...docIds.map(id => ({ id, data: episode(id) })), {
        id: 'ep_old',
        data: episode('ep_old', { layoutGeneration: 'gen_deleted' }),
      })
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the day with its generation’s documents, all read from the server', async () => {
    serverHolds([day(4), day(4)], 'ep_a');

    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'resolved',
      day: day(4),
      docs: [episode('ep_a')],
    });
    expect(firestore.getDocFromServer).toHaveBeenCalledTimes(2);
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it.each([
    ['gets another generation', day(4, 'gen_synthetic_b')],
    ['gets another revision', day(5)],
    ['loses its marker', day(4, null)],
    ['is deleted', undefined],
  ])('fails when the day %s while its documents are read', async (_label, after) => {
    serverHolds([day(4), after], 'ep_a');

    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'day_changed',
    });
  });

  it('fails on a day this client still has unconfirmed writes for, marked or not', async () => {
    const pending = (data: Record<string, unknown>) => ({
      ...docSnapshot(DATE, data),
      metadata: { fromCache: false, hasPendingWrites: true },
    });
    firestore.getDocFromServer
      .mockResolvedValueOnce(pending(day(4)))
      .mockResolvedValueOnce(docSnapshot(DATE, day(4)));
    firestore.getDocsFromServer.mockResolvedValueOnce(snapshotOf());
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'day_changed',
    });

    firestore.getDocFromServer.mockResolvedValueOnce(pending(day(4, null)));
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'day_changed',
    });
    expect(firestore.getDocFromServer).toHaveBeenCalledTimes(3);
  });

  it('resolves a day the server does not have, and an unmarked day without a query', async () => {
    firestore.getDocFromServer.mockResolvedValueOnce(docSnapshot(DATE));
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({ status: 'missing' });

    firestore.getDocFromServer.mockResolvedValueOnce(docSnapshot(DATE, day(4, null)));
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'resolved',
      day: day(4, null),
      docs: [],
    });
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('returns a failed day or document read typed, reporting only its code', async () => {
    firestore.getDocFromServer.mockRejectedValueOnce(rawError);
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'permission_denied',
      code: 'permission-denied',
    });

    firestore.getDocFromServer.mockResolvedValueOnce(docSnapshot(DATE, day(4)));
    firestore.getDocsFromServer.mockRejectedValueOnce({ code: 'unavailable' });
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'unavailable',
    });
    expect(recordOperationalTelemetry.mock.calls.map(([event]) => event.context)).toEqual([
      { readScope: 'day', errorCode: 'permission-denied' },
      { readScope: 'day', errorCode: 'unavailable' },
    ]);
    expect(JSON.stringify(recordOperationalTelemetry.mock.calls)).not.toContain('secret detail');
    expect(reportBasicReadPermissionDenied).not.toHaveBeenCalled();
  });
});
