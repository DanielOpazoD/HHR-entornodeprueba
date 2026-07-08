import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const recordOperationalTelemetryMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: recordOperationalTelemetryMock,
}));

import {
  evaluateDailyRecordClinicalAuthority,
  recordClinicalEpisodeIdCoverageTelemetry,
} from '@/services/repositories/dailyRecordClinicalAuthorityPolicy';

const makePatient = (overrides: Partial<PatientData> = {}): PatientData =>
  ({
    bedId: overrides.bedId || 'R1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'Paciente Uno',
    rut: '11.111.111-1',
    age: '40a',
    pathology: 'Diagnostico',
    specialty: 'Medicina',
    status: 'Estable',
    admissionDate: '2026-05-13',
    admissionTime: '08:00',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    clinicalEpisodeId: 'ep-paciente-uno',
    ...overrides,
  }) as PatientData;

const makeRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-05-13',
    beds: {
      R1: makePatient(),
    },
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated: '2026-05-13T12:00:00.000Z',
    ...overrides,
  }) as DailyRecord;

describe('dailyRecordClinicalAuthorityPolicy', () => {
  beforeEach(() => {
    recordOperationalTelemetryMock.mockClear();
  });

  it('blocks duplicate active clinical episodes across beds before publishing', () => {
    const record = makeRecord({
      beds: {
        R1: makePatient({ bedId: 'R1', clinicalEpisodeId: 'ep-duplicado' }),
        R2: makePatient({
          bedId: 'R2',
          patientName: 'Paciente Duplicado',
          clinicalEpisodeId: 'ep-duplicado',
        }),
      },
    });

    const result = evaluateDailyRecordClinicalAuthority(record, {
      date: record.date,
      phase: 'sync_publish',
    });

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'duplicate_active_episode',
          episodeKey: 'ep-duplicado',
          path: 'beds.R2',
        }),
      ])
    );
  });

  it('blocks an active bed when a non-tombstoned movement already closed the same episode', () => {
    const record = makeRecord({
      discharges: [
        {
          id: 'discharge-1',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Paciente Uno',
          rut: '11.111.111-1',
          diagnosis: 'Diagnostico',
          time: '11:00',
          status: 'Vivo',
          clinicalEpisodeId: 'ep-paciente-uno',
        },
      ],
    });

    const result = evaluateDailyRecordClinicalAuthority(record, {
      date: record.date,
      phase: 'sync_publish',
    });

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'closed_episode_active_in_bed',
          episodeKey: 'ep-paciente-uno',
          path: 'beds.R1',
        }),
      ])
    );
  });

  it('allows same-RUT same-day reingress when the closed movement belongs to a different episode', () => {
    const record = makeRecord({
      beds: {
        R1: makePatient({
          clinicalEpisodeId: 'ep-afternoon',
          admissionTime: '17:00',
        }),
      },
      discharges: [
        {
          id: 'discharge-1',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Paciente Uno',
          rut: '11.111.111-1',
          diagnosis: 'Diagnostico mañana',
          time: '11:00',
          status: 'Vivo',
          clinicalEpisodeId: 'ep-morning',
        },
      ],
    });

    const result = evaluateDailyRecordClinicalAuthority(record, {
      date: record.date,
      phase: 'sync_publish',
    });

    expect(result.status).toBe('ok');
    expect(result.violations).toEqual([]);
  });

  it('records fallback coverage telemetry when an active patient has no clinicalEpisodeId', () => {
    const record = makeRecord({
      beds: {
        R1: makePatient({ clinicalEpisodeId: undefined }),
        R2: makePatient({ bedId: 'R2', clinicalEpisodeId: 'ep-canonical' }),
      },
    });

    recordClinicalEpisodeIdCoverageTelemetry(record, {
      date: record.date,
      phase: 'persistence',
    });

    expect(recordOperationalTelemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'clinical_episode_id_coverage',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          date: '2026-05-13',
          phase: 'persistence',
          activePatients: 2,
          canonicalEpisodeIds: 1,
          fallbackEpisodeKeys: 1,
        }),
      })
    );
  });
});
