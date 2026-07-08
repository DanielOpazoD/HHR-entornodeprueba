import { describe, expect, it } from 'vitest';

import { generateAuditPdfHtml } from '@/features/admin/components/internal/audit/utils/auditPdfUtils';
import { buildClinicalAuditPatientPackages } from '@/services/admin/clinicalAuditPatientPackages';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const log: AuditLogEntry = {
  id: 'pdf-audit-1',
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

describe('auditPdfUtils', () => {
  it('renders clinical legal PDF content without raw implementation language', () => {
    const html = generateAuditPdfHtml({
      filteredLogs: [log],
      stats: { activeUserCount: 1, criticalCount: 0 },
    });

    expect(html).toContain('Reporte de Auditoría Clínica/Legal');
    expect(html).toContain('Paquete clínico/legal');
    expect(html).toContain('Resumen legal');
    expect(html).toContain('Paquete por paciente');
    expect(html).toContain('Paciente trasladado de cama');
    expect(html).toContain('Juan Perez fue trasladado desde cama 4 a cama 6');
    expect(html).toContain('IP 190.10.10.10');
    expect(html).not.toContain('PATIENT_MODIFIED');
    expect(html).not.toContain('movementKind');
    expect(html).not.toContain('Movimiento técnico');
  });

  it('renders a patient-centered PDF when patient packages are provided', () => {
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

    const html = generateAuditPdfHtml({
      filteredLogs: [log],
      patientPackages,
      exportMode: 'patient-packages',
      stats: { activeUserCount: 1, criticalCount: 0 },
    });

    expect(html).toContain('Reporte de Auditoría por Paciente');
    expect(html).toContain('FECHA CENSO');
    expect(html).toContain('MÓDULO/VALOR');
    expect(html).toContain('Juan Perez');
    expect(html).toContain('Estable');
    expect(html).toContain('ICC');
    expect(html).not.toContain('PATIENT_DIAGNOSIS_CHANGED');
  });
});
