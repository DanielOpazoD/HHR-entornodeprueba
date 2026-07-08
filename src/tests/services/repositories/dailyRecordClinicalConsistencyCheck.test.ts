import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const recordOperationalTelemetryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: recordOperationalTelemetryMock,
}));

import {
  applyDailyRecordClinicalConsistencyCheck,
  recordClinicalConsistencyTelemetry,
  recordRemoteCanonicalReconciliationTelemetry,
} from '@/services/repositories/dailyRecordClinicalConsistencyCheck';

const makeRecord = (): DailyRecord =>
  ({
    date: '2026-02-18',
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        pathology: 'Diagnostico',
        admissionDate: '2026-02-10',
        status: 'Estable',
      },
    },
    discharges: [
      {
        id: 'discharge-1',
        bedId: 'R1',
        patientName: 'Paciente Egresado',
        rut: '33.333.333-3',
        admissionDate: '2026-02-10',
        movementDate: '2026-02-18',
      },
    ],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated: '2026-02-18T10:00:00.000Z',
  }) as unknown as DailyRecord;

describe('dailyRecordClinicalConsistencyCheck', () => {
  beforeEach(() => {
    recordOperationalTelemetryMock.mockClear();
  });

  it('repairs movement/bed contradictions before a record is published', () => {
    const result = applyDailyRecordClinicalConsistencyCheck(makeRecord(), {
      date: '2026-02-18',
      phase: 'read_publish',
    });

    expect(result.status).toBe('repaired');
    expect(result.record.beds.R1.patientName).toBe('');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'bed_discharge_violation',
          path: 'beds.R1',
        }),
      ])
    );
  });

  it('records semantic consistency telemetry for repaired clinical records', () => {
    const result = applyDailyRecordClinicalConsistencyCheck(makeRecord(), {
      date: '2026-02-18',
      phase: 'read_publish',
    });

    recordClinicalConsistencyTelemetry(result);

    expect(recordOperationalTelemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'daily_record_clinical_consistency',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          date: '2026-02-18',
          phase: 'read_publish',
          violationTypes: ['bed_discharge_violation'],
          repairedPaths: ['beds.R1'],
        }),
      })
    );
  });

  it('records telemetry when remote canonical fields replace stale local values', () => {
    const localRecord = makeRecord();
    const remoteRecord = makeRecord();
    remoteRecord.beds.R1.patientName = 'Paciente Firebase';
    remoteRecord.beds.R1.rut = '44.444.444-4';
    remoteRecord.beds.R1.pathology = 'Diagnostico Firebase';
    const selectedRecord = {
      ...remoteRecord,
      beds: {
        ...remoteRecord.beds,
        R1: {
          ...remoteRecord.beds.R1,
          handoffNote: 'Nota local preservada',
        },
      },
    } as DailyRecord;

    recordRemoteCanonicalReconciliationTelemetry({
      date: '2026-02-18',
      phase: 'read_publish',
      localRecord,
      remoteRecord,
      selectedRecord,
    });

    expect(recordOperationalTelemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'daily_record_remote_canonical_reconciled',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          date: '2026-02-18',
          reconciledPaths: expect.arrayContaining([
            'beds.R1.patientName',
            'beds.R1.rut',
            'beds.R1.pathology',
          ]),
        }),
      })
    );
  });
});
