// @vitest-environment node

import { createRequire } from 'node:module';
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
import { collectClinicalEpisodeCoverage } from '@/services/repositories/dailyRecordClinicalAuthorityCore';
import { assertDailyRecordClinicalAuthority } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';

const require = createRequire(import.meta.url);
const serverPolicy = require('../../../../functions/lib/dailyRecordClinicalAuthorityPolicy.js') as {
  evaluateDailyRecordClinicalAuthority: (record: DailyRecord) => {
    status: 'ok' | 'blocked';
    violations: Array<{
      type: string;
      path: string;
      bedId?: string;
      episodeKey: string;
      message: string;
    }>;
  };
  collectClinicalEpisodeCoverage: typeof collectClinicalEpisodeCoverage;
};

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

const evaluateBoth = (record: DailyRecord) => {
  const client = evaluateDailyRecordClinicalAuthority(record, {
    date: record.date,
    phase: 'sync_publish',
  });
  const server = serverPolicy.evaluateDailyRecordClinicalAuthority(record);
  expect(server).toEqual({
    status: client.status,
    violations: client.violations,
  });
  return client;
};

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

    const result = evaluateBoth(record);

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

    const result = evaluateBoth(record);

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

    const result = evaluateBoth(record);

    expect(result.status).toBe('ok');
    expect(result.violations).toEqual([]);
  });

  it('allows two occupied beds with different names when both lack document and clinicalEpisodeId (ID-01)', () => {
    const record = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: 'Paciente Sintetico A',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
        R2: makePatient({
          bedId: 'R2',
          patientName: 'Paciente Sintetico B',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
      },
    });

    const result = evaluateBoth(record);

    expect(result.status).toBe('ok');
    expect(result.violations).toEqual([]);
    expect(() => assertDailyRecordClinicalAuthority(record)).not.toThrow();
  });

  it('blocks an active bed and discharge with the same normalized name and admission context when both lack document and clinicalEpisodeId (ID-01)', () => {
    const record = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: 'María  Sintética',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
      },
      discharges: [
        {
          id: 'discharge-sin-rut',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'maria sintetica',
          rut: '',
          diagnosis: 'Diagnostico',
          admissionDate: '2026-05-13',
          time: '11:00',
          status: 'Vivo',
          originalData: makePatient({
            bedId: 'R1',
            patientName: 'maria sintetica',
            rut: '',
            clinicalEpisodeId: undefined,
            admissionDate: '2026-05-13',
            admissionTime: '08:00',
          }),
        },
      ],
    });

    const result = evaluateBoth(record);

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual([
      expect.objectContaining({
        type: 'closed_episode_active_in_bed',
        path: 'beds.R1',
        bedId: 'R1',
      }),
    ]);
    expect(() => assertDailyRecordClinicalAuthority(record)).toThrow(ConcurrencyError);
  });

  it('allows homonyms without document or clinicalEpisodeId in separate beds and when discharging one without admissionTime (ID-01)', () => {
    const activeHomonyms = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: 'Juan Sintetico',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
        R2: makePatient({
          bedId: 'R2',
          patientName: 'Juan Sintetico',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
      },
    });

    expect(evaluateBoth(activeHomonyms).status).toBe('ok');

    const oneHomonymDischarged = makeRecord({
      beds: {
        R2: makePatient({
          bedId: 'R2',
          patientName: 'Juan Sintetico',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '',
        }),
      },
      discharges: [
        {
          id: 'discharge-homonym-r1',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Juan Sintetico',
          rut: '',
          diagnosis: 'Diagnostico',
          admissionDate: '2026-05-13',
          time: '11:00',
          status: 'Vivo',
        },
      ],
    });

    expect(evaluateBoth(oneHomonymDischarged).status).toBe('ok');
  });

  it('keeps mother and newborn distinct even when sharing maternal RUN without clinicalEpisodeId (ID-03)', () => {
    const motherWithNestedCrib = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: 'Madre Sintetica',
          rut: '11.111.111-1',
          clinicalEpisodeId: undefined,
          bedMode: 'Cama',
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
          clinicalCrib: makePatient({
            bedId: 'R1',
            patientName: 'RN Madre Sintetica',
            rut: '11.111.111-1',
            clinicalEpisodeId: undefined,
            bedMode: 'Cuna',
            admissionDate: '2026-05-13',
            admissionTime: '08:00',
          }),
        }),
      },
    });

    expect(evaluateBoth(motherWithNestedCrib).status).toBe('ok');

    const motherWithStandaloneCrib = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: 'Madre Sintetica',
          rut: '11.111.111-1',
          clinicalEpisodeId: undefined,
          bedMode: 'Cama',
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
        R2: makePatient({
          bedId: 'R2',
          patientName: 'RN Madre Sintetica',
          rut: '11.111.111-1',
          clinicalEpisodeId: undefined,
          bedMode: 'Cuna',
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
      },
    });

    expect(evaluateBoth(motherWithStandaloneCrib).status).toBe('ok');

    // Discharging mother while newborn stays in crib is allowed.
    const motherDischargedNewbornRemains = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: '',
          rut: '',
          admissionDate: '',
          clinicalEpisodeId: undefined,
          clinicalCrib: makePatient({
            bedId: 'R1',
            patientName: 'RN Madre Sintetica',
            rut: '11.111.111-1',
            clinicalEpisodeId: undefined,
            bedMode: 'Cuna',
            admissionDate: '2026-05-13',
            admissionTime: '08:00',
          }),
        }),
      },
      discharges: [
        {
          id: 'discharge-mother',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cama',
          patientName: 'Madre Sintetica',
          rut: '11.111.111-1',
          diagnosis: 'Diagnostico',
          admissionDate: '2026-05-13',
          time: '12:00',
          status: 'Vivo',
          isNested: false,
          originalData: makePatient({
            bedId: 'R1',
            rut: '11.111.111-1',
            clinicalEpisodeId: undefined,
            bedMode: 'Cama',
            admissionDate: '2026-05-13',
            admissionTime: '08:00',
          }),
        },
      ],
    });

    expect(evaluateBoth(motherDischargedNewbornRemains).status).toBe('ok');

    // Discharging newborn while the same newborn stays in crib is blocked.
    const newbornDischargedStillInCrib = makeRecord({
      ...motherDischargedNewbornRemains,
      discharges: [
        {
          id: 'discharge-rn',
          bedId: 'R1',
          bedName: 'R1',
          bedType: 'Cuna',
          patientName: 'RN Madre Sintetica',
          rut: '11.111.111-1',
          diagnosis: 'RN sano',
          admissionDate: '2026-05-13',
          time: '12:00',
          status: 'Vivo',
          isNested: true,
          originalData: makePatient({
            bedId: 'R1',
            rut: '11.111.111-1',
            clinicalEpisodeId: undefined,
            bedMode: 'Cuna',
            admissionDate: '2026-05-13',
            admissionTime: '08:00',
          }),
        },
      ],
    });

    const rnResult = evaluateBoth(newbornDischargedStillInCrib);
    expect(rnResult.status).toBe('blocked');
    expect(rnResult.violations).toEqual([
      expect.objectContaining({
        type: 'closed_episode_active_in_bed',
        path: 'beds.R1.clinicalCrib',
      }),
    ]);
  });

  it('never equates a passport with a RUT and ignores beds lacking identity (ID-01)', () => {
    const passportAndRut = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: 'Extranjero Sintetico',
          rut: '12345678-5',
          documentType: 'Pasaporte',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
        R2: makePatient({
          bedId: 'R2',
          patientName: 'Residente Sintetico',
          rut: '12345678-5',
          documentType: 'RUT',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
      },
    });

    expect(evaluateBoth(passportAndRut).status).toBe('ok');

    const unnamedBeds = makeRecord({
      beds: {
        R1: makePatient({
          bedId: 'R1',
          patientName: '',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
        R2: makePatient({
          bedId: 'R2',
          patientName: '',
          rut: '',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-05-13',
          admissionTime: '08:00',
        }),
      },
    });

    expect(evaluateBoth(unnamedBeds).status).toBe('ok');
  });

  it('records fallback coverage telemetry and keeps client/server coverage parity', () => {
    const record = makeRecord({
      beds: {
        R1: makePatient({ clinicalEpisodeId: undefined }),
        R2: makePatient({ bedId: 'R2', clinicalEpisodeId: 'ep-canonical' }),
      },
    });

    expect(serverPolicy.collectClinicalEpisodeCoverage(record)).toEqual(
      collectClinicalEpisodeCoverage(record)
    );

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
