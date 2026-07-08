import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getForDateWithMeta,
  getMonthRecords,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  getPreviousDayRecord: vi.fn(),
  getAllDates: vi.fn(),
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getAvailableDatesFromFirestore: vi.fn(),
  getMonthRecordsFromFirestore: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
}));

vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: vi.fn(),
}));

import {
  getRecordForDate as getRecordFromIndexedDB,
  saveRecordStrict as saveToIndexedDB,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { loadRemoteRecordWithFallback } from '@/services/repositories/dailyRecordRemoteLoader';
import { getMonthRecordsFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';

const buildRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    nursesDayShift: [],
    nursesNightShift: [],
    tensDayShift: [],
    tensNightShift: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNightReceives: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    schemaVersion: 1,
  }) as DailyRecord;

describe('dailyRecordRepositoryReadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.__HHR_E2E_OVERRIDE__ = undefined;
  });

  it('keeps local authority and persists the selected merge when local is newer than remote', async () => {
    const local = buildRecord('2026-03-19', '2026-03-19T12:00:00.000Z');
    local.beds = {
      R1: { bedId: 'R1', patientName: 'LOCAL PATIENT', pathology: 'LOCAL DX' },
    } as unknown as DailyRecord['beds'];
    const remote = buildRecord('2026-03-19', '2026-03-19T08:00:00.000Z');
    remote.beds = {
      R2: { bedId: 'R2', patientName: 'REMOTE NEW PATIENT', pathology: 'REMOTE NEW DX' },
    } as unknown as DailyRecord['beds'];

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(local);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: remote,
      source: 'firestore',
      compatibilityTier: 'current_firestore',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.source).toBe('indexeddb');
    expect(result.record?.lastUpdated).toBe(local.lastUpdated);
    expect(result.sourceOfTruth).toBe('local');
    expect(result.consistencyState).not.toBe('remote_authoritative');
    expect(result.record?.beds.R1.pathology).toBe('LOCAL DX');
    expect(result.record?.beds.R2.patientName).toBe('REMOTE NEW PATIENT');
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({ pathology: 'LOCAL DX' }),
          R2: expect.objectContaining({ patientName: 'REMOTE NEW PATIENT' }),
        }),
      })
    );
  });

  it('keeps first status and specialty selections for a newly admitted patient when Firebase still has empty fields', async () => {
    const local = buildRecord('2026-03-19', '2026-03-19T12:00:05.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: undefined,
        patientName: 'PACIENTE NUEVO',
        rut: '11.111.111-1',
        admissionDate: '2026-03-19',
        admissionTime: '08:00',
        status: PatientStatus.GRAVE,
        specialty: Specialty.MEDICINA,
      },
    } as unknown as DailyRecord['beds'];
    const remote = buildRecord('2026-03-19', '2026-03-19T12:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'ep_r1_generated',
        patientName: 'PACIENTE NUEVO',
        rut: '11.111.111-1',
        admissionDate: '2026-03-19',
        admissionTime: '08:00',
        status: PatientStatus.EMPTY,
        specialty: Specialty.EMPTY,
      },
    } as unknown as DailyRecord['beds'];

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(local);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: remote,
      source: 'firestore',
      compatibilityTier: 'current_firestore',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.record?.beds.R1.status).toBe(PatientStatus.GRAVE);
    expect(result.record?.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(result.record?.beds.R1.clinicalEpisodeId).toBe('ep_r1_generated');
    expect(result.sourceOfTruth).toBe('local');
    expect(result.consistencyState).toMatch(/local/);
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            clinicalEpisodeId: 'ep_r1_generated',
            status: PatientStatus.GRAVE,
            specialty: Specialty.MEDICINA,
          }),
        }),
      })
    );
  });

  it('keeps fast sequential diagnosis and specialty edits when Firebase only confirms status first', async () => {
    const local = buildRecord('2026-03-19', '2026-03-19T12:00:05.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: undefined,
        patientName: 'PACIENTE NUEVO',
        rut: '11.111.111-1',
        admissionDate: '2026-03-19',
        admissionTime: '08:00',
        pathology: 'Neumonia adquirida en la comunidad',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.DE_CUIDADO,
      },
    } as unknown as DailyRecord['beds'];
    const remote = buildRecord('2026-03-19', '2026-03-19T12:00:08.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'ep_r1_generated',
        patientName: 'PACIENTE NUEVO',
        rut: '11.111.111-1',
        admissionDate: '2026-03-19',
        admissionTime: '08:00',
        pathology: '',
        specialty: Specialty.EMPTY,
        status: PatientStatus.DE_CUIDADO,
      },
    } as unknown as DailyRecord['beds'];

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(local);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: remote,
      source: 'firestore',
      compatibilityTier: 'current_firestore',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.record?.beds.R1.pathology).toBe('Neumonia adquirida en la comunidad');
    expect(result.record?.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(result.record?.beds.R1.status).toBe(PatientStatus.DE_CUIDADO);
    expect(result.record?.beds.R1.clinicalEpisodeId).toBe('ep_r1_generated');
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({
            clinicalEpisodeId: 'ep_r1_generated',
            pathology: 'Neumonia adquirida en la comunidad',
            specialty: Specialty.MEDICINA,
            status: PatientStatus.DE_CUIDADO,
          }),
        }),
      })
    );
  });

  it('hydrates local cache when remote record is newer than local', async () => {
    const local = buildRecord('2026-03-19', '2026-03-19T08:00:00.000Z');
    const remote = buildRecord('2026-03-19', '2026-03-19T12:00:00.000Z');

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(local);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: remote,
      source: 'firestore',
      compatibilityTier: 'current_firestore',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.source).toBe('firestore');
    expect(result.record?.lastUpdated).toBe(remote.lastUpdated);
    expect(result.consistencyState).toBe('remote_authoritative');
    expect(saveToIndexedDB).toHaveBeenCalledWith(
      expect.objectContaining({
        date: remote.date,
        lastUpdated: remote.lastUpdated,
      })
    );
  });

  it('uses the E2E localStorage seed as the local candidate when a runtime override supplies remote', async () => {
    const staleIndexedDb = buildRecord('2026-03-19', '2026-03-19T08:00:00.000Z');
    staleIndexedDb.beds = {
      R1: { bedId: 'R1', patientName: 'INDEXEDDB STALE', handoffNote: '' },
    } as unknown as DailyRecord['beds'];
    const localSeed = buildRecord('2026-03-19', '2026-03-19T12:00:00.000Z');
    localSeed.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'LOCAL SEEDED',
        rut: '11.111.111-1',
        admissionDate: '2026-03-19',
        pathology: 'LOCAL DX',
        handoffNote: 'LOCAL NOTE',
      },
    } as unknown as DailyRecord['beds'];
    const remoteOverride = buildRecord('2026-03-19', '2026-03-19T09:00:00.000Z');
    remoteOverride.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'REMOTE CANONICAL',
        rut: '11.111.111-1',
        admissionDate: '2026-03-19',
        pathology: 'REMOTE DX',
        handoffNote: '',
      },
    } as unknown as DailyRecord['beds'];

    window.localStorage.setItem(
      'hanga_roa_hospital_data',
      JSON.stringify({ '2026-03-19': localSeed })
    );
    window.__HHR_E2E_OVERRIDE__ = { '2026-03-19': remoteOverride };
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(staleIndexedDb);

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.record?.beds.R1.patientName).toBe('REMOTE CANONICAL');
    expect(result.record?.beds.R1.pathology).toBe('REMOTE DX');
    expect(result.record?.beds.R1.handoffNote).toBe('LOCAL NOTE');
  });

  it('falls back to local with recoverable metadata when remote fetch fails', async () => {
    const local = buildRecord('2026-03-19', '2026-03-19T08:00:00.000Z');

    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(local);
    vi.mocked(loadRemoteRecordWithFallback).mockRejectedValueOnce(new Error('remote down'));

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.source).toBe('indexeddb');
    expect(result.record?.lastUpdated).toBe(local.lastUpdated);
    expect(result.sourceOfTruth).toBe('local');
    expect(result.retryability).toBe('automatic_retry');
  });

  it('returns an explicit missing result when neither local nor remote has the record', async () => {
    vi.mocked(getRecordFromIndexedDB).mockResolvedValueOnce(null);
    vi.mocked(loadRemoteRecordWithFallback).mockResolvedValueOnce({
      record: null,
      source: 'not_found',
      compatibilityTier: 'none',
      compatibilityIntensity: 'none',
      migrationRulesApplied: [],
      cachedLocally: false,
    });

    const result = await getForDateWithMeta('2026-03-19');

    expect(result.source).toBe('not_found');
    expect(result.consistencyState).toBe('missing');
    expect(result.userSafeMessage).toBe('No hay registro disponible para este día.');
  });

  it('delegates month record loading to firestore queries when remote sync is enabled', async () => {
    vi.mocked(getMonthRecordsFromFirestore).mockResolvedValueOnce([
      { date: '2026-03-19' },
    ] as DailyRecord[]);

    const result = await getMonthRecords(2026, 2);

    expect(getMonthRecordsFromFirestore).toHaveBeenCalledWith(2026, 2);
    expect(result).toEqual([{ date: '2026-03-19' }]);
  });
});
