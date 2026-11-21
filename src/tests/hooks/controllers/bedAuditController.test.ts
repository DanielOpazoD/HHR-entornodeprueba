// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolvePatientChangeAudit } from '@/hooks/controllers/bedAuditController';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

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
});
