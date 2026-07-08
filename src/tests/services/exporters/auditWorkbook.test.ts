import { describe, expect, it } from 'vitest';

import { generateAuditWorkbook } from '@/services/exporters/auditWorkbook';
import { buildClinicalAuditPatientPackages } from '@/services/admin/clinicalAuditPatientPackages';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const log: AuditLogEntry = {
  id: 'xlsx-audit-1',
  timestamp: '2026-05-28T10:15:30.000Z',
  userId: 'dra.riviere@hospital.cl',
  userDisplayName: 'Dra. Riviere',
  userUid: 'uid-123',
  ipAddress: '190.10.10.10',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'Cama 6',
  patientIdentifier: '12.345.678-9',
  summary: 'Movimiento técnico',
  details: {
    movementKind: 'move',
    patientName: 'Juan Perez',
    sourceBed: '4',
    targetBed: '6',
  },
};

describe('auditWorkbook', () => {
  it('exports clinical legal columns instead of raw details', async () => {
    const workbook = await generateAuditWorkbook([log]);
    const sheet = workbook.getWorksheet('Auditoría Clínica Legal');

    expect(sheet).toBeDefined();
    expect(sheet?.getRow(1).values).toEqual(
      expect.arrayContaining([
        'PAQUETE',
        'EPISODIO',
        'EVENTO CLÍNICO',
        'RELATO CLÍNICO',
        'AFECTADO',
        'ORIGEN/IP',
        'RESUMEN LEGAL',
      ])
    );

    const exportedValues = JSON.stringify(sheet?.getRow(2).values);
    expect(exportedValues).toContain('Paquete por paciente');
    expect(exportedValues).toContain('RUT/ID 12.345.678-9');
    expect(exportedValues).toContain('Paciente trasladado de cama');
    expect(exportedValues).toContain('Juan Perez fue trasladado desde cama 4 a cama 6');
    expect(exportedValues).toContain('IP 190.10.10.10');
    expect(exportedValues).not.toContain('PATIENT_MODIFIED');
    expect(exportedValues).not.toContain('movementKind');
    expect(exportedValues).not.toContain('Movimiento técnico');
  });

  it('adds a patient-centered worksheet when patient packages are provided', async () => {
    const patientPackages = buildClinicalAuditPatientPackages([
      {
        ...log,
        id: 'status-1',
        details: {
          patientName: 'Juan Perez',
          rut: '12.345.678-9',
          bedId: 'Cama 6',
          changes: { status: { old: '', new: 'Estable' } },
        },
      },
      {
        ...log,
        id: 'diagnosis-1',
        timestamp: '2026-05-28T10:17:30.000Z',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        details: {
          patientName: 'Juan Perez',
          rut: '12.345.678-9',
          bedId: 'Cama 6',
          changes: { diagnosis: { old: '', new: 'ICC' } },
        },
      },
    ]);

    const workbook = await generateAuditWorkbook([log], { patientPackages });
    const patientSheet = workbook.getWorksheet('Auditoría por Paciente');
    const rawSheet = workbook.getWorksheet('Eventos Crudos Clínicos');

    expect(patientSheet).toBeDefined();
    expect(rawSheet).toBeDefined();
    expect(patientSheet?.getRow(1).values).toEqual(
      expect.arrayContaining(['FECHA CENSO', 'PACIENTE', 'MÓDULO/VALOR', 'ANTES', 'DESPUÉS'])
    );

    const patientValues = JSON.stringify(patientSheet?.getRow(2).values);
    expect(patientValues).toContain('Juan Perez');
    expect(patientValues).toContain('Estable');
    expect(patientValues).not.toContain('movementKind');
  });
});
