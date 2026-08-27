import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
const {
  createAdminCudyrResultFunctions,
} = require('../../../functions/lib/adminCudyrResultFunctions.js');

const now = {
  seconds: 20,
  nanoseconds: 0,
  toDate: () => new Date('2026-08-27T00:00:20.000Z'),
};

const makeRemoteRecord = () => ({
  date: '2026-08-26',
  lastUpdated: '2026-08-26T22:30:00.000Z',
  meta: { revision: 5 },
  beds: {
    H3C2: {
      patientName: 'Paciente prueba',
      clinicalEpisodeId: 'episode-1',
      evaluationScores: {
        braden: { code: 'BRADEN', total: 15 },
        downton: { code: 'DOWNTON', total: 2 },
        cudyr: {
          category: 'C1',
          recordedDate: '2026-08-26',
          source: 'Eloísa · Gestión de Camas',
        },
      },
      clinicalCrib: {
        patientName: 'RN prueba',
        clinicalEpisodeId: 'crib-episode-1',
        evaluationScores: {
          cudyr: {
            category: 'D2',
            recordedDate: '2026-08-26',
            source: 'Eloísa · Gestión de Camas',
          },
        },
      },
    },
  },
});

const makeContext = () => ({
  auth: { uid: 'admin-uid', token: { email: 'admin@example.com' } },
});

const createHarness = ({ role = 'admin', remote = makeRemoteRecord() } = {}) => {
  const set = vi.fn();
  const recordRef = {
    id: '2026-08-26',
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: 'history-1', kind: 'history' })) })),
  };
  const auditRef = { id: 'audit-1', kind: 'audit' };
  const dailyRecords = { doc: vi.fn(() => recordRef) };
  const auditLogs = { doc: vi.fn(() => auditRef) };
  const hospitalRef = {
    collection: vi.fn((name: string) => (name === 'auditLogs' ? auditLogs : dailyRecords)),
  };
  const firestore = {
    collection: vi.fn(() => ({ doc: vi.fn(() => hospitalRef) })),
    runTransaction: vi.fn(async callback =>
      callback({
        get: vi.fn(async () => ({ exists: true, data: () => remote })),
        set,
      })
    ),
  };
  const functionsApi = createAdminCudyrResultFunctions({
    firestore,
    Timestamp: { now: vi.fn(() => now) },
    resolveRoleForEmail: vi.fn().mockResolvedValue(role),
  });
  const payload = {
    date: '2026-08-26',
    bedId: 'H3C2',
    clinicalCrib: false,
    clinicalEpisodeId: 'episode-1',
    category: 'B2',
    expectedLastUpdated: '2026-08-26T22:30:00.000Z',
  };

  return { functionsApi, payload, set, recordRef, auditRef };
};

const findRecordWrite = (set: ReturnType<typeof vi.fn>, recordRef: object) =>
  set.mock.calls.find(([ref]) => ref === recordRef)?.[1];

describe('setAdminCudyrResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates from the controlled category set and preserves adjacent clinical scales', async () => {
    const { functionsApi, payload, set, recordRef, auditRef } = createHarness();

    await expect(
      functionsApi.setAdminCudyrResult.run(payload, makeContext())
    ).resolves.toMatchObject({
      success: true,
      previousCategory: 'C1',
      category: 'B2',
      revision: 6,
    });

    const written = findRecordWrite(set, recordRef);
    expect(written.beds.H3C2.evaluationScores).toMatchObject({
      braden: { code: 'BRADEN', total: 15 },
      downton: { code: 'DOWNTON', total: 2 },
      cudyr: {
        category: 'B2',
        recordedDate: '2026-08-26',
        author: 'admin@example.com',
        authorRole: 'Administrador',
        source: 'HHR · ajuste administrativo',
      },
    });
    expect(set).toHaveBeenCalledWith(
      auditRef,
      expect.objectContaining({ action: 'CUDYR_MODIFIED', userId: 'admin@example.com' })
    );
  });

  it('removes only imported CUDYR while preserving Braden, Downton and the local score', async () => {
    const baseline = makeRemoteRecord();
    const remote = {
      ...baseline,
      beds: {
        ...baseline.beds,
        H3C2: { ...baseline.beds.H3C2, cudyr: { changeClothes: 2 } },
      },
    };
    const { functionsApi, payload, set, recordRef } = createHarness({ remote });

    await functionsApi.setAdminCudyrResult.run({ ...payload, category: null }, makeContext());

    const written = findRecordWrite(set, recordRef);
    expect(written.beds.H3C2.evaluationScores.cudyr).toBeUndefined();
    expect(written.beds.H3C2.evaluationScores.braden.total).toBe(15);
    expect(written.beds.H3C2.evaluationScores.downton.total).toBe(2);
    expect(written.beds.H3C2.cudyr).toEqual({ changeClothes: 2 });
  });

  it('supports the clinical crib only when its exact episode still matches', async () => {
    const { functionsApi, payload, set, recordRef } = createHarness();

    await functionsApi.setAdminCudyrResult.run(
      {
        ...payload,
        clinicalCrib: true,
        clinicalEpisodeId: 'crib-episode-1',
        category: 'A3',
      },
      makeContext()
    );

    expect(
      findRecordWrite(set, recordRef).beds.H3C2.clinicalCrib.evaluationScores.cudyr.category
    ).toBe('A3');
  });

  it('rejects free text instead of accepting an arbitrary result', async () => {
    const { functionsApi, payload, set } = createHarness();

    await expect(
      functionsApi.setAdminCudyrResult.run({ ...payload, category: 'CRITICO' }, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(set).not.toHaveBeenCalled();

    await expect(
      functionsApi.setAdminCudyrResult.run({ ...payload, category: 'A1anything' }, makeContext())
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(set).not.toHaveBeenCalled();
  });

  it('does not create history or a revision when the selected result is unchanged', async () => {
    const { functionsApi, payload, set } = createHarness();

    await expect(
      functionsApi.setAdminCudyrResult.run({ ...payload, category: 'C1' }, makeContext())
    ).resolves.toMatchObject({ success: true, changed: false, revision: 5 });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects stale census versions and changed clinical episodes', async () => {
    const stale = createHarness();
    await expect(
      stale.functionsApi.setAdminCudyrResult.run(
        { ...stale.payload, expectedLastUpdated: '2026-08-26T22:00:00.000Z' },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(stale.set).not.toHaveBeenCalled();

    const changedEpisode = createHarness();
    await expect(
      changedEpisode.functionsApi.setAdminCudyrResult.run(
        { ...changedEpisode.payload, clinicalEpisodeId: 'different-episode' },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(changedEpisode.set).not.toHaveBeenCalled();
  });

  it('rejects a record whose remote version is absent or malformed', async () => {
    const baseline = makeRemoteRecord();
    const withoutVersion = { ...baseline, lastUpdated: '' };
    const missing = createHarness({ remote: withoutVersion });

    await expect(
      missing.functionsApi.setAdminCudyrResult.run(
        { ...missing.payload, expectedLastUpdated: '1970-01-01T00:00:00.000Z' },
        makeContext()
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(missing.set).not.toHaveBeenCalled();
  });

  it('is restricted to administrators', async () => {
    const { functionsApi, payload, set } = createHarness({ role: 'nurse_hospital' });

    await expect(
      functionsApi.setAdminCudyrResult.run(payload, makeContext())
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(set).not.toHaveBeenCalled();
  });
});
