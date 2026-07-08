import { describe, expect, it } from 'vitest';

import {
  buildClinicalAuditExportRows,
  formatClinicalAuditChanges,
} from '@/services/admin/clinicalAuditExportRows';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const movementLog: AuditLogEntry = {
  id: 'audit-export-1',
  timestamp: '2026-05-28T10:15:30.000Z',
  userId: 'dra.riviere@hospital.cl',
  userDisplayName: 'Dra. Riviere',
  userUid: 'uid-123',
  ipAddress: '190.10.10.10',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'Cama 6',
  patientIdentifier: '12.345.678-9',
  details: {
    movementKind: 'move',
    patientName: 'Juan Perez',
    sourceBed: '4',
    targetBed: '6',
    changes: {
      bedId: { old: '4', new: '6' },
    },
  },
};

describe('clinicalAuditExportRows', () => {
  it('builds clinical legal export rows without raw action codes or implementation fields', () => {
    const [row] = buildClinicalAuditExportRows([movementLog]);

    expect(row.eventTitle).toBe('Paciente trasladado de cama');
    expect(row.narrative).toContain('Juan Perez fue trasladado desde cama 4 a cama 6');
    expect(row.responsible).toBe('Dra. Riviere');
    expect(row.responsibleDetail).toContain('UID uid-123');
    expect(row.origin).toBe('IP 190.10.10.10');
    expect(row.affected).toBe('Juan Perez');
    expect(row.patientIdentifier).toBe('12.345.678-9');
    expect(row.packageKindLabel).toBe('Paquete por paciente');
    expect(row.packageKey).toBe('patient:123456789');
    expect(row.legalTraceSummary).toBe(
      'Paquete por paciente · Juan Perez · RUT/ID 12.345.678-9 · IP 190.10.10.10'
    );
    expect(row.relevantChanges).toBe('Cama: 4 -> 6');

    expect(Object.values(row).join(' ')).not.toContain('PATIENT_MODIFIED');
    expect(Object.values(row).join(' ')).not.toContain('movementKind');
  });

  it('formats missing relevant changes as a clinical empty value', () => {
    expect(formatClinicalAuditChanges([])).toBe('Sin cambios detallados');
  });

  it('adds explicit episode package context when the audit log carries an episode id', () => {
    const [row] = buildClinicalAuditExportRows([
      {
        ...movementLog,
        details: {
          ...movementLog.details,
          clinicalEpisodeId: 'ep_juan_2026_05_28',
        },
      },
    ]);

    expect(row.episodeId).toBe('ep_juan_2026_05_28');
    expect(row.packageKindLabel).toBe('Paquete por episodio');
    expect(row.packageKey).toBe('episode:ep_juan_2026_05_28');
    expect(row.legalTraceSummary).toBe(
      'Paquete por episodio · Juan Perez · Episodio ep_juan_2026_05_28 · RUT/ID 12.345.678-9 · IP 190.10.10.10'
    );
  });
});
