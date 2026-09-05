import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectPatientUpcHistory,
  isSameUpcHistoryEpisode,
  loadPatientUpcHistory,
} from '@/services/patient/patientUpcHistoryService';
import { getRecordsRange } from '@/services/storage/indexeddb/indexedDbRecordService';
import { getRecordsRangeFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { UpcChecklistRecord } from '@/domain/upc/upcContracts';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordsRange: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordsRangeFromFirestore: vi.fn(),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: vi.fn() }));

const entry = (id: string): UpcChecklistRecord => ({
  evaluationId: id,
  uciCriteria: [],
  utiCriteria: [],
  classification: null,
  evaluatedAt: '2026-09-04T12:00:00Z',
});
const patient = DataFactory.createMockPatient('R1', {
  rut: '12.345.678-5',
  admissionDate: '2026-09-01',
  clinicalEpisodeId: 'ep_current',
  upcChecklist: entry('current'),
});
const record = (id: string, date = '2026-09-04') => {
  const result = DataFactory.createMockDailyRecord(date);
  result.beds = { R2: { ...patient, bedId: 'R2', upcChecklist: entry(id) } };
  return result;
};

describe('patient UPC history reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFirestoreEnabled).mockReturnValue(true);
    vi.mocked(getRecordsRange).mockResolvedValue([]);
    vi.mocked(getRecordsRangeFromFirestore).mockResolvedValue([]);
  });
  it.each([
    [{ rut: '12345678-5' }, true],
    [{ rut: '99.999.999-9' }, false],
    [{ clinicalEpisodeId: 'ep_other' }, false],
    [{ clinicalEpisodeId: undefined }, true],
    [{ clinicalEpisodeId: undefined, admissionDate: '2026-08-01' }, false],
    [{ documentType: 'Pasaporte' as const }, false],
  ])('matches patient and episode, not bed: %j', (patch, expected) => {
    expect(isSameUpcHistoryEpisode(patient, { ...patient, ...patch })).toBe(expected);
  });
  it('joins days, moves, same-day revisions and current snapshot without duplicating copied evaluations', () => {
    const yesterday = record('previous', '2026-09-03');
    const today = record('current');
    today.beds.R2.upcChecklist = {
      ...today.beds.R2.upcChecklist!,
      history: [entry('previous'), entry('revision')],
    };
    expect(
      collectPatientUpcHistory([yesterday, today], patient)
        .map(e => e.evaluationId)
        .sort()
    ).toEqual(['current', 'previous', 'revision']);
  });
  it('keeps the clinical crib separate and can read an evaluation from a discharge snapshot', () => {
    const source = record('mother');
    source.beds.R2 = {
      ...patient,
      rut: '99.999.999-9',
      clinicalEpisodeId: 'ep_mother',
      upcChecklist: entry('mother'),
      clinicalCrib: { ...patient, upcChecklist: entry('crib') },
    };
    source.discharges = [
      {
        ...DataFactory.createMockDischarge(),
        originalData: { ...patient, upcChecklist: entry('discharged') },
      },
    ];
    expect(
      collectPatientUpcHistory([source], patient)
        .map(e => e.evaluationId)
        .sort()
    ).toEqual(['crib', 'current', 'discharged']);
  });
  it('queries only the stay on demand and uses server records instead of stale local revisions', async () => {
    vi.mocked(getRecordsRange).mockResolvedValue([record('stale')]);
    vi.mocked(getRecordsRangeFromFirestore).mockResolvedValue([record('remote')]);
    const result = await loadPatientUpcHistory(patient, '2026-09-04');
    expect(getRecordsRangeFromFirestore).toHaveBeenCalledWith('2026-09-01', '2026-09-04', {
      requireServer: true,
    });
    expect(result.warning).toBeNull();
    expect(result.entries.map(e => e.evaluationId)).toEqual(['remote']);
  });
  it('excludes local-only days and the open census snapshot after a successful server read', async () => {
    vi.mocked(getRecordsRange).mockResolvedValue([record('deleted-day', '2026-09-03')]);
    vi.mocked(getRecordsRangeFromFirestore).mockResolvedValue([record('remote')]);
    const result = await loadPatientUpcHistory(patient, '2026-09-04');
    expect(result.warning).toBeNull();
    expect(result.entries.map(e => e.evaluationId)).toEqual(['remote']);
  });
  it('returns an empty complete history when the server has no records despite local evaluations', async () => {
    vi.mocked(getRecordsRange).mockResolvedValue([record('local')]);
    const result = await loadPatientUpcHistory(patient, '2026-09-04');
    expect(result).toEqual({ entries: [], warning: null });
  });
  it('reports partial history on remote failure and preserves locally available snapshots', async () => {
    vi.mocked(getRecordsRange).mockResolvedValue([record('local')]);
    vi.mocked(getRecordsRangeFromFirestore).mockRejectedValue(new Error('offline'));
    const result = await loadPatientUpcHistory(patient, '2026-09-04');
    expect(result.warning).toMatch(/parcial/);
    expect(result.entries).toHaveLength(2);
  });
  it('does not scan all records when the admission anchor is missing', async () => {
    const result = await loadPatientUpcHistory(
      { ...patient, admissionDate: '', firstSeenDate: undefined },
      '2026-09-04'
    );
    expect(result.warning).toMatch(/falta/);
    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
    expect(getRecordsRange).not.toHaveBeenCalled();
  });
});
