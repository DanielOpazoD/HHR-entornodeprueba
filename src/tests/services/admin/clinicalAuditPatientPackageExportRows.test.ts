import { describe, expect, it } from 'vitest';

import {
  PATIENT_PACKAGE_EXPORT_HEADERS,
  buildClinicalAuditPatientPackageExportRows,
} from '@/services/admin/clinicalAuditPatientPackageExportRows';
import { buildClinicalAuditPatientPackages } from '@/services/admin/clinicalAuditPatientPackages';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-1',
  timestamp: '2026-07-01T19:36:29.000Z',
  userId: 'daniel.opazo@hospitalhangaroa.cl',
  userDisplayName: 'Daniel Opazo Damiani',
  userUid: 'uid-123',
  ipAddress: '148.227.67.162',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'H4C1',
  recordDate: '2026-07-01',
  patientIdentifier: '25DF52626',
  details: {
    patientName: 'Anastasio Hey Riroroko',
    rut: '25DF52626',
    bedId: 'H4C1',
  },
  ...overrides,
});

describe('clinicalAuditPatientPackageExportRows', () => {
  it('builds patient-centered export rows with clinical columns and no raw JSON leakage', () => {
    const [auditPackage] = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'status-1',
        userId: 'enfermera@hospital.cl',
        userDisplayName: 'Enfermera Turno',
        userUid: 'uid-nurse',
        ipAddress: '10.0.0.10',
        details: {
          patientName: 'Anastasio Hey Riroroko',
          rut: '25DF52626',
          bedId: 'H4C1',
          changes: { status: { old: '', new: 'Estable' } },
        },
      }),
      baseLog({
        id: 'diagnosis-1',
        timestamp: '2026-07-01T19:38:00.000Z',
        userId: 'medico@hospital.cl',
        userDisplayName: 'Medico Turno',
        userUid: 'uid-doctor',
        ipAddress: '10.0.0.11',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        details: {
          patientName: 'Anastasio Hey Riroroko',
          rut: '25DF52626',
          bedId: 'H4C1',
          changes: { diagnosis: { old: '', new: 'ICC' } },
        },
      }),
    ]);

    const rows = buildClinicalAuditPatientPackageExportRows([auditPackage]);

    expect(PATIENT_PACKAGE_EXPORT_HEADERS).toEqual([
      'FECHA CENSO',
      'HORA',
      'PACIENTE',
      'RUT/ID',
      'CAMA',
      'ACCIÓN',
      'MÓDULO/VALOR',
      'ANTES',
      'DESPUÉS',
      'USUARIO',
      'IP',
      'FUENTE',
      'RESUMEN CLÍNICO',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      censusDate: '2026-07-01',
      timeRange: '13:36:29-13:38:00',
      patientName: 'Anastasio Hey Riroroko',
      patientRut: '25DF52626',
      bedLabel: 'H4C1',
      moduleLabel: 'Estado',
      beforeValue: '-',
      afterValue: 'Estable',
      responsible: 'Enfermera Turno, Medico Turno',
      ipAddress: '10.0.0.10, 10.0.0.11',
      source: 'status-1, diagnosis-1',
    });
    expect(rows[1]).toMatchObject({
      moduleLabel: 'Diagnóstico',
      beforeValue: '-',
      afterValue: 'ICC',
    });
    expect(rows.map(row => row.actionSummary).join(' · ')).toContain('Cambio de Diagnóstico');
    expect(JSON.stringify(rows)).not.toContain('"details"');
    expect(JSON.stringify(rows)).not.toContain('PATIENT_DIAGNOSIS_CHANGED');
  });

  it('emits one summary row when a patient package has no structured before-after changes', () => {
    const [auditPackage] = buildClinicalAuditPatientPackages([
      baseLog({
        id: 'discharge-1',
        action: 'PATIENT_DISCHARGED',
        entityType: 'discharge',
        details: {
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          bedId: 'H2C2',
          diagnosis: 'EPOC',
        },
      }),
    ]);

    const [row] = buildClinicalAuditPatientPackageExportRows([auditPackage]);

    expect(row.moduleLabel).toBe('Alta');
    expect(row.beforeValue).toBe('-');
    expect(row.afterValue).toBe('Paciente dado de alta');
    expect(row.clinicalSummary).toContain('Bernardo Orrego Llanos');
    expect(row.clinicalSummary).toContain('Alta');
  });
});
