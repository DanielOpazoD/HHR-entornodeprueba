import { describe, expect, it } from 'vitest';

import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveDailyRecordPersistenceGoldenPath } from '@/services/repositories/dailyRecordPersistenceGoldenPath';

const buildRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordPersistenceGoldenPath', () => {
  it('keeps the local record when it is newer than remote', () => {
    const local = buildRecord('2026-03-18', '2026-03-18T12:00:00.000Z');
    const remote = buildRecord('2026-03-18', '2026-03-18T08:00:00.000Z');

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord).toEqual(
      expect.objectContaining({
        date: local.date,
        lastUpdated: local.lastUpdated,
        beds: local.beds,
      })
    );
    expect(result.selectedStore).toBe('local');
    expect(result.shouldHydrateLocal).toBe(false);
    expect(result.consistencyState).toBe('local_authoritative');
    expect(result.recoveryAction).toBe('defer_remote_sync');
  });

  it('keeps newer local narrative while accepting remote canonical bed updates', () => {
    const local = buildRecord('2026-03-18', '2026-03-18T12:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'LOCAL BASELINE',
        pathology: 'USER A LOCAL DX',
        handoffNote: 'USER A LOCAL NOTE',
      },
      R2: {
        bedId: 'R2',
        patientName: '',
        pathology: '',
        admissionDate: '',
      },
    } as unknown as DailyRecord['beds'];
    const remote = buildRecord('2026-03-18', '2026-03-18T08:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'REMOTE BASELINE',
        pathology: 'REMOTE STALE DX',
        handoffNote: 'REMOTE STALE NOTE',
      },
      R2: {
        bedId: 'R2',
        patientName: 'USER B NEW PATIENT',
        pathology: 'USER B NON CONFLICT DX',
        admissionDate: '2026-03-18',
      },
    } as unknown as DailyRecord['beds'];

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord?.beds.R1.pathology).toBe('REMOTE STALE DX');
    expect(result.selectedRecord?.beds.R1.handoffNote).toBe('USER A LOCAL NOTE');
    expect(result.selectedRecord?.beds.R2.patientName).toBe('USER B NEW PATIENT');
    expect(result.selectedRecord?.beds.R2.pathology).toBe('USER B NON CONFLICT DX');
    expect(result.selectedStore).toBe('local');
    expect(result.consistencyState).toBe('local_authoritative');
  });

  it('promotes the remote record and hydrates local cache when remote is newer', () => {
    const local = buildRecord('2026-03-18', '2026-03-18T08:00:00.000Z');
    const remote = buildRecord('2026-03-18', '2026-03-18T12:00:00.000Z');

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord).toBe(remote);
    expect(result.selectedStore).toBe('remote');
    expect(result.shouldHydrateLocal).toBe(true);
    expect(result.consistencyState).toBe('remote_authoritative');
  });

  it('accepts a newer remote canonical diagnosis even when it is shorter than local text', () => {
    const local = buildRecord('2026-03-18', '2026-03-18T12:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Local',
        pathology: 'Puérpera de cesárea.',
        admissionDate: '2026-03-18',
      },
    } as unknown as DailyRecord['beds'];
    const remote = buildRecord('2026-03-18', '2026-03-18T12:00:02.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Local',
        pathology: 'Puérpera',
        admissionDate: '2026-03-18',
      },
    } as unknown as DailyRecord['beds'];

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord?.beds.R1.pathology).toBe('Puérpera');
    expect(result.selectedStore).toBe('remote');
    expect(result.shouldHydrateLocal).toBe(true);
  });

  it('keeps the local record as recoverable fallback when remote is unavailable', () => {
    const local = buildRecord('2026-03-18', '2026-03-18T08:00:00.000Z');

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: null,
      remoteAvailability: 'unavailable',
    });

    expect(result.selectedRecord).toBe(local);
    expect(result.selectedStore).toBe('local');
    expect(result.consistencyState).toBe('local_authoritative');
    expect(result.retryability).toBe('automatic_retry');
  });
});
