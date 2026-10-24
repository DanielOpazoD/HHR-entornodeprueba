import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pages: vi.fn(),
  save: vi.fn(),
  local: vi.fn(),
  readDocs: vi.fn(),
  readDoc: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  documentId: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  startAfter: vi.fn(),
  getDocsFromServer: mocks.pages,
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { ready: Promise.resolve(), getDb: vi.fn() },
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords: mocks.local,
}));
vi.mock('@/services/staff/eloisaStaffRegistry', () => ({ saveDiscoveredStaff: mocks.save }));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDocs: mocks.readDocs,
  readClinicalDerivedEpisodeDoc: mocks.readDoc,
}));

import { recoverCensusStaff } from '@/services/staff/recoverCensusStaff';

const GENERATION = 'gen_synthetic_a';
const SPLIT_DAY = '2026-11-02';

const serverDay = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
const page = (...docs: ReturnType<typeof serverDay>[]) => ({ size: docs.length, docs });

const authoredBy = (author: string, authorRole: string) => [
  { recordedDate: SPLIT_DAY, recordedAt: `${SPLIT_DAY}T08:00:00`, author, authorRole },
];
const episodeDoc = (clinicalEpisodeId: string, author: string, authorRole: string) => ({
  schemaVersion: 1,
  date: SPLIT_DAY,
  clinicalEpisodeId,
  layoutGeneration: GENERATION,
  dayRevision: 3,
  vitalSignsHistory: authoredBy(author, authorRole),
});

// The bed holds one active episode; the discharge, transfer and CMA snapshots of a split day no
// longer carry their vitals history, so those authors live only in the episode documents.
const splitDay = serverDay(SPLIT_DAY, {
  clinicalDerivedLayout: { version: 1, generation: GENERATION },
  beds: { R1: { patientName: 'Paciente Sintético', clinicalEpisodeId: 'ep_active' } },
  discharges: [{ originalData: { clinicalEpisodeId: 'ep_discharged' } }],
  transfers: [{ originalData: { clinicalEpisodeId: 'ep_transferred' } }],
  cma: [{ originalData: { clinicalEpisodeId: 'ep_cma' } }],
});
const unmarkedDay = serverDay('2026-11-01', { nursesDayShift: ['Ana Sintética'], beds: {} });

const savedNames = () =>
  (mocks.save.mock.calls[0][0] as Array<{ name: string }>).map(entry => entry.name).sort();

describe('staff tool on split days (D10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.local.mockResolvedValue({});
    mocks.save.mockResolvedValue([]);
  });

  it('visits every episode document of a split day, discharged, transferred and CMA included', async () => {
    mocks.pages.mockResolvedValueOnce(page(unmarkedDay, splitDay));
    mocks.readDocs.mockResolvedValueOnce({
      status: 'resolved',
      fromCache: false,
      docs: [
        episodeDoc('ep_active', 'Berta Activa', 'Enfermera'),
        episodeDoc('ep_discharged', 'Carla Egresada', 'TENS'),
        episodeDoc('ep_transferred', 'Diego Trasladado', 'Enfermera'),
        episodeDoc('ep_cma', 'Elena Ambulatoria', 'TENS'),
      ],
    });

    const result = await recoverCensusStaff(vi.fn());

    expect(mocks.readDocs).toHaveBeenCalledTimes(1);
    expect(mocks.readDocs).toHaveBeenCalledWith(SPLIT_DAY, GENERATION, { source: 'server' });
    expect(savedNames()).toEqual([
      'Ana Sintética',
      'Berta Activa',
      'Carla Egresada',
      'Diego Trasladado',
      'Elena Ambulatoria',
    ]);
    expect(result).toMatchObject({ censuses: 2, nurseCount: 3, tensCount: 2, unreadSplitDays: [] });
  });

  it('publishes what it found and reports the split days it could not read', async () => {
    const readableDay = serverDay('2026-11-03', { ...splitDay.data(), date: '2026-11-03' });
    const futureLayoutDay = serverDay('2026-11-04', {
      ...splitDay.data(),
      clinicalDerivedLayout: { version: 2, generation: GENERATION },
    });
    mocks.pages.mockResolvedValueOnce(page(unmarkedDay, splitDay, readableDay, futureLayoutDay));
    mocks.readDocs
      .mockResolvedValueOnce({ status: 'failed', code: 'unavailable' })
      .mockResolvedValueOnce({
        status: 'resolved',
        fromCache: false,
        docs: [episodeDoc('ep_discharged', 'Carla Egresada', 'TENS')],
      });

    const result = await recoverCensusStaff(vi.fn());

    // The future marker version is never read; it is reported like an unreadable day.
    expect(mocks.readDocs).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(savedNames()).toEqual(['Ana Sintética', 'Carla Egresada']);
    expect(result).toMatchObject({ censuses: 4, unreadSplitDays: [SPLIT_DAY, '2026-11-04'] });
  });

  it('stops at the abort signal while reading episode documents', async () => {
    const controller = new AbortController();
    const nextSplitDay = serverDay('2026-11-03', splitDay.data());
    mocks.pages.mockResolvedValueOnce(page(splitDay, nextSplitDay));
    mocks.readDocs.mockImplementationOnce(async () => {
      controller.abort();
      return { status: 'resolved', fromCache: false, docs: [] };
    });

    await expect(recoverCensusStaff(vi.fn(), controller.signal)).rejects.toThrow();
    expect(mocks.readDocs).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('reads no episode documents for unmarked server days nor for local copies', async () => {
    mocks.local.mockResolvedValue({
      local: {
        date: SPLIT_DAY,
        clinicalDerivedLayout: { version: 1, generation: GENERATION },
        beds: {},
      },
    });
    mocks.pages.mockResolvedValueOnce(page(unmarkedDay));

    await recoverCensusStaff(vi.fn());

    expect(mocks.readDocs).not.toHaveBeenCalled();
    expect(mocks.readDoc).not.toHaveBeenCalled();
    expect(savedNames()).toEqual(['Ana Sintética']);
  });
});
