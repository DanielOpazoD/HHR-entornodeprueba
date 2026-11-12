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
const COLLECTION = {
  kind: 'collection',
  parent: { kind: 'recordDocRef', date: DATE },
  name: 'clinicalDerived',
};
const DAY = { kind: 'recordDocRef', date: DATE };
const EPISODE = { kind: 'doc', parent: COLLECTION, id: 'ep_a' };
const rejectRead = (fn: ReturnType<typeof vi.fn>, ref: unknown, error: unknown) => {
  fn.mockImplementation(async actual => {
    expect(actual).toEqual(ref);
    throw error;
  });
};
const docSnapshot = (data?: Record<string, unknown>, pending = false) => ({
  exists: () => data !== undefined,
  data: () => data,
  metadata: { fromCache: false, hasPendingWrites: pending },
});
const rawError = Object.assign(new Error('Missing or insufficient permissions: secret detail'), {
  code: 'permission-denied',
});

describe('clinicalDerivedEpisodeReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of [
      firestore.getDoc,
      firestore.getDocFromServer,
      firestore.getDocs,
      firestore.getDocsFromServer,
    ])
      fn.mockReset();
  });

  it('returns a denial typed, reports only its code and never feeds the permission storm', async () => {
    rejectRead(firestore.getDocs, COLLECTION, rawError);

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
    rejectRead(firestore.getDocs, COLLECTION, error);

    expect(await readClinicalDerivedEpisodeDocs(DATE, GENERATION)).toEqual({
      status: 'failed',
      code,
    });
    expect(recordOperationalTelemetry.mock.calls[0][0].context).toEqual({
      readScope: 'day',
      errorCode: code,
    });
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
    rejectRead(firestore.getDoc, EPISODE, rawError);
    rejectRead(firestore.getDocFromServer, EPISODE, { code: 'unavailable' });

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
    rejectRead(firestore.getDocs, COLLECTION, error);
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

// Transport races cannot be scheduled deterministically through the real SDK.
// The collection read changes server state; repeated day reads do not consume a queue.
describe('day read transport failures', () => {
  const day = (revision = 4, generation: string | null = GENERATION) => ({
    date: DATE,
    meta: { revision },
    ...(generation ? { clinicalDerivedLayout: { version: 1, generation } } : {}),
  });
  let state: Record<string, unknown> | undefined;
  let pending: boolean;
  let dayError: unknown;
  let queryError: unknown;
  let afterQuery: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    state = day();
    pending = false;
    dayError = undefined;
    queryError = undefined;
    afterQuery = () => {};
    firestore.getDocFromServer.mockImplementation(async ref => {
      expect(ref).toEqual(DAY);
      if (dayError) throw dayError;
      return docSnapshot(state, pending);
    });
    firestore.getDocsFromServer.mockImplementation(async ref => {
      expect(ref).toEqual(COLLECTION);
      if (queryError) throw queryError;
      afterQuery();
      return {
        docs: [{ id: 'ep_a', data: () => episode('ep_a') }],
        metadata: { fromCache: false },
      };
    });
  });
  it.each([
    ['generation', day(4, 'gen_b')],
    ['revision', day(5)],
    ['marker', day(4, null)],
    ['deletion', undefined],
  ])('rejects a concurrent %s change', async (_label, after) => {
    afterQuery = () => {
      state = after;
    };
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'day_changed',
    });
  });
  it.each([true, false])('rejects pending writes, marked=%s', async marked => {
    state = day(4, marked ? GENERATION : null);
    pending = true;
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'day_changed',
    });
  });
  it('reports typed day and query failures without raw errors or permission storms', async () => {
    dayError = rawError;
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'permission_denied',
      code: 'permission-denied',
    });
    dayError = undefined;
    queryError = { code: 'unavailable' };
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
  it('does not return documents when confirmation fails after the query', async () => {
    afterQuery = () => {
      dayError = { code: 'unavailable' };
    };
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'failed',
      code: 'unavailable',
    });
  });
});
