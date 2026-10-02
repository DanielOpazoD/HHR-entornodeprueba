// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
const mocks = vi.hoisted(() => ({ pages: vi.fn(), local: vi.fn() }));
vi.mock('@/services/storage/firestore', () => ({ getRecordPagesFromFirestore: mocks.pages }));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords: mocks.local,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
import { getPatientMovementHistoryDetailed } from '@/services/patient/patientHistoryService';
import { projectPatientHistoryRecord } from '@/services/patient/patientHistoryRecordLoader';

const record = (date: string) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {
      R1: DataFactory.createMockPatient('R1', { rut: 'synthetic-1', admissionDate: '2026-01-01' }),
    },
  });
describe('complete paged patient history', () => {
  beforeEach(() => vi.resetAllMocks());
  it('preserves episode transitions across pages and ignores tombstoned departures', async () => {
    const a = record('2026-01-01');
    const b = record('2026-01-02');
    b.beds = { R2: { ...a.beds.R1, bedId: 'R2' } };
    b.discharges = [
      DataFactory.createMockDischarge({ rut: 'synthetic-1', deletedAt: '2026-01-02T10:00:00Z' }),
    ];
    const c = record('2026-01-03');
    c.beds = {};
    c.discharges = [
      DataFactory.createMockDischarge({
        rut: 'synthetic-1',
        bedId: 'R2',
        bedName: 'R2',
        dischargeType: 'Domicilio (Habitual)',
      }),
    ];
    const d = record('2026-02-01');
    d.beds.R1.admissionDate = '2026-02-01';
    const e = record('2026-02-02');
    e.beds = {};
    e.transfers = [DataFactory.createMockTransfer({ rut: 'synthetic-1', bedId: 'R1' })];
    mocks.pages.mockImplementation(async function* () {
      yield [e, d, c];
      yield [b, a];
    });
    const progress = vi.fn();
    const result = await getPatientMovementHistoryDetailed('synthetic-1', {
      forceFullRemoteHydration: true,
      onProgress: progress,
    });
    expect(result.source).toBe('server');
    expect(result.history?.movements.map(m => [m.date, m.type])).toEqual([
      ['2026-01-01', 'admission'],
      ['2026-01-02', 'internal_move'],
      ['2026-01-03', 'discharge'],
      ['2026-02-01', 'admission'],
      ['2026-02-02', 'transfer'],
    ]);
    expect(progress.mock.calls).toEqual([[3], [5]]);
    expect(mocks.local).not.toHaveBeenCalled();
  });

  it('discards partial server pages and labels the local fallback explicitly', async () => {
    mocks.pages.mockImplementation(async function* () {
      yield [record('2026-01-01')];
      throw new Error('next page failed');
    });
    mocks.local.mockResolvedValue({ '2026-02-01': record('2026-02-01') });
    const result = await getPatientMovementHistoryDetailed('synthetic-1', {
      forceFullRemoteHydration: true,
    });
    expect(result.source).toBe('local');
    expect(result.history?.movements.map(m => m.date)).toEqual(['2026-02-01']);
  });

  it('does not fall back or return complete history when cancelled on the final page', async () => {
    const controller = new AbortController();
    mocks.pages.mockImplementation(async function* () {
      yield [record('2026-01-01')];
    });
    await expect(
      getPatientMovementHistoryDetailed('synthetic-1', {
        forceFullRemoteHydration: true,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.local).not.toHaveBeenCalled();
  });

  it('returns authoritative absence after an empty traversal rather than resurrecting local days', async () => {
    mocks.pages.mockImplementation(async function* () {
      yield [];
    });
    mocks.local.mockResolvedValue({ '2026-01-01': record('2026-01-01') });
    await expect(
      getPatientMovementHistoryDetailed('synthetic-1', { forceFullRemoteHydration: true })
    ).resolves.toEqual({ history: null, source: 'server' });
    expect(mocks.local).not.toHaveBeenCalled();
  });

  it('projects only movement fields while preserving crib identity and tombstones without mutating source', () => {
    const original = record('2026-01-01');
    original.beds.R1.clinicalCrib = {
      ...DataFactory.createMockPatient('R1-cuna'),
      rut: 'child',
      admissionDate: '2026-01-01',
    };
    original.discharges = [
      DataFactory.createMockDischarge({
        originalData: original.beds.R1,
        deletedAt: '2026-01-02T10:00:00Z',
      }),
    ];
    original.transfers = [DataFactory.createMockTransfer({ originalData: original.beds.R1 })];
    const copy = structuredClone(original);
    const projected = projectPatientHistoryRecord(original);
    expect(projected.beds.R1.clinicalCrib?.rut).toBe('child');
    expect(projected.discharges[0].deletedAt).toBe(original.discharges[0].deletedAt);
    expect(projected.beds.R1).not.toHaveProperty('vitalSigns');
    expect(projected.discharges[0]).not.toHaveProperty('originalData');
    expect(projected.transfers[0]).not.toHaveProperty('originalData');
    expect(original).toEqual(copy);
    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(original).length);
  });
});
