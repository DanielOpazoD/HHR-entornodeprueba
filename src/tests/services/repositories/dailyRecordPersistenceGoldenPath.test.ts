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

  it('hydrates a confirmed audit event even when the local census has the same revision', () => {
    const lastUpdated = '2026-09-23T15:39:50.727Z';
    const local = buildRecord('2026-09-19', lastUpdated);
    local.rayenSyncHistory = [];
    const remote = buildRecord('2026-09-19', lastUpdated);
    remote.rayenSyncHistory = [{
      id: 'run-historical',
      sourceDate: '2026-09-19',
      startedAt: '2026-09-23T15:37:00.000Z',
      completedAt: '2026-09-23T15:39:00.000Z',
      by: 'Operador HHR',
      status: 'partial',
    }];

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord?.rayenSyncHistory).toEqual(remote.rayenSyncHistory);
    expect(result.shouldHydrateLocal).toBe(true);
  });

  it('replaces stale local review details when the remote event has the same status and time', () => {
    const lastUpdated = '2026-09-23T15:39:50.727Z';
    const local = buildRecord('2026-09-19', lastUpdated);
    local.rayenSyncHistory = [{
      id: 'run-historical',
      startedAt: '2026-09-23T15:37:00.000Z',
      completedAt: '2026-09-23T15:39:00.000Z',
      by: 'Operador HHR',
      status: 'partial',
    }];
    const remote = buildRecord('2026-09-19', lastUpdated);
    remote.rayenSyncHistory = [{
      ...local.rayenSyncHistory[0],
      reviewRequirement: 'day_bootstrap',
      structuralReview: {
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 1,
        issues: [{ bedId: null, reason: 'unverified-report-row' }],
      },
    }];

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord?.rayenSyncHistory).toEqual(remote.rayenSyncHistory);
    expect(result.shouldHydrateLocal).toBe(true);
  });

  it('keeps a newer local terminal event when the server has an older revision', () => {
    const local = buildRecord('2026-09-19', '2026-09-23T15:40:00.000Z');
    local.rayenSyncHistory = [{
      id: 'run-historical',
      startedAt: '2026-09-23T15:37:00.000Z',
      completedAt: '2026-09-23T15:39:00.000Z',
      by: 'Operador HHR',
      status: 'complete',
    }];
    const remote = buildRecord('2026-09-19', '2026-09-23T15:38:00.000Z');
    remote.rayenSyncHistory = [{
      ...local.rayenSyncHistory[0],
      status: 'applied',
      completedAt: '2026-09-23T15:38:00.000Z',
    }];

    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });

    expect(result.selectedRecord?.rayenSyncHistory).toEqual(local.rayenSyncHistory);
    expect(result.shouldHydrateLocal).toBe(false);
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
