// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildCribCudyrAuditDetails,
  buildCudyrAuditDetails,
  resolvePatientChangeAudit,
} from '@/hooks/controllers/bedAuditController';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const buildCudyr = (overrides: Partial<CudyrScore> = {}): CudyrScore => ({
  changeClothes: 0,
  mobilization: 0,
  feeding: 0,
  elimination: 0,
  psychosocial: 0,
  surveillance: 0,
  vitalSigns: 0,
  fluidBalance: 0,
  oxygenTherapy: 0,
  airway: 0,
  proInterventions: 0,
  skinCare: 0,
  pharmacology: 0,
  invasiveElements: 0,
  ...overrides,
});

const buildPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
  bedId: 'B1',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: '',
  rut: '',
  age: '',
  pathology: '',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const buildRecord = (): DailyRecord =>
  ({
    date: '2026-01-19',
    beds: {
      B1: buildPatient({
        patientName: 'John Doe',
        rut: '123-4',
        cudyr: buildCudyr({ mobilization: 1 }),
      }),
      B2: buildPatient({
        clinicalCrib: buildPatient({
          patientName: 'Baby Doe',
          rut: '567-8',
          cudyr: buildCudyr({ feeding: 2 }),
        }),
      }),
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-01-19T00:00:00.000Z',
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('bedAuditController', () => {
  it('should resolve admissions and patient modifications', () => {
    const admission = resolvePatientChangeAudit(
      'patientName',
      buildPatient({ patientName: '', rut: '1-9' }),
      'Paciente Nuevo'
    );
    const statusChange = resolvePatientChangeAudit(
      'status',
      buildPatient({ patientName: 'John', status: PatientStatus.ESTABLE }),
      PatientStatus.DE_CUIDADO
    );

    expect(admission).toEqual({
      kind: 'admission',
      patientName: 'Paciente Nuevo',
      rut: '1-9',
    });
    expect(statusChange).toEqual({
      kind: 'modified',
      patientRut: '',
      details: {
        patientName: 'John',
        changes: {
          status: {
            old: PatientStatus.ESTABLE,
            new: PatientStatus.DE_CUIDADO,
          },
        },
      },
    });
  });

  it('should ignore unchanged patient updates and build device details diffs', () => {
    const unchanged = resolvePatientChangeAudit(
      'age',
      buildPatient({ patientName: 'John', age: '40' }),
      '40'
    );
    const deviceChange = resolvePatientChangeAudit(
      'deviceDetails',
      buildPatient({
        patientName: 'John',
        rut: '123-4',
        deviceDetails: { CVP: { installationDate: '2026-01-18' } },
      }),
      { CVP: { installationDate: '2026-01-18', notes: 'Cambio' } }
    );

    expect(unchanged).toBeNull();
    expect(deviceChange).toEqual({
      kind: 'modified',
      patientRut: '123-4',
      details: {
        patientName: 'John',
        changes: {
          deviceDetails: {
            CVP: {
              old: { installationDate: '2026-01-18' },
              new: { installationDate: '2026-01-18', notes: 'Cambio' },
            },
          },
        },
      },
    });
  });

  it('should build patient and crib CUDYR audit payloads only when values change', () => {
    const record = buildRecord();

    expect(buildCudyrAuditDetails(record, 'B1', 'mobilization', 3)).toEqual({
      patientName: 'John Doe',
      patientRut: '123-4',
      details: {
        patientName: 'John Doe',
        bedId: 'B1',
        field: 'mobilization',
        value: 3,
        oldValue: 1,
      },
    });

    expect(buildCribCudyrAuditDetails(record, 'B2', 'feeding', 5)).toEqual({
      patientName: 'Baby Doe',
      patientRut: '567-8',
      details: {
        patientName: 'Baby Doe',
        bedId: 'B2-crib',
        field: 'feeding',
        value: 5,
        oldValue: 2,
      },
    });

    expect(buildCudyrAuditDetails(record, 'B1', 'mobilization', 1)).toBeNull();
    expect(buildCribCudyrAuditDetails(record, 'B2', 'feeding', 2)).toBeNull();
  });
});
