import { describe, expect, it } from 'vitest';

import { generateAuditWorkbook } from '@/services/exporters/auditWorkbook';
import { normalizeAuditTrailEvents } from '@/services/admin/auditTrail/auditTrailNormalize';
import { buildAuditTrailSessions } from '@/services/admin/auditTrail/auditTrailSessions';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const logs: AuditLogEntry[] = [
  {
    id: 'move-1',
    timestamp: '2026-05-28T15:15:30.000Z',
    userId: 'dra.riviere@hospital.cl',
    userDisplayName: 'Dra. Riviere',
    ipAddress: '190.10.10.10',
    action: 'PATIENT_BED_CHANGED',
    entityType: 'patient',
    entityId: '6',
    sessionId: 'conn-1',
    details: {
      movementKind: 'move',
      patientName: 'Juan Perez',
      rut: '12.345.678-9',
      sourceBed: '4',
      targetBed: '6',
    },
  },
  {
    id: 'login-1',
    timestamp: '2026-05-28T14:00:00.000Z',
    userId: 'dra.riviere@hospital.cl',
    userDisplayName: 'Dra. Riviere',
    action: 'USER_LOGIN',
    entityType: 'user',
    entityId: 'dra.riviere@hospital.cl',
    sessionId: 'conn-1',
    device: 'Chrome · Windows',
    details: { start: 'sign_in' },
  },
];

describe('auditWorkbook', () => {
  it('exports events with before/after columns and the connections of the period', async () => {
    const events = normalizeAuditTrailEvents(logs);
    const workbook = await generateAuditWorkbook({
      events,
      sessions: buildAuditTrailSessions(events),
    });

    const eventsSheet = workbook.getWorksheet('Eventos');
    expect(eventsSheet?.getRow(1).values).toEqual(
      expect.arrayContaining(['Fecha', 'Hora', 'Funcionario', 'Paciente', 'Antes', 'Después'])
    );
    expect(eventsSheet?.getRow(2).values).toEqual(
      expect.arrayContaining([
        '28-05-2026',
        '09:15:30',
        'Dra. Riviere',
        'Juan Perez',
        '12.345.678-9',
        'Cambio de cama',
        'Cama',
        '4',
        '6',
      ])
    );

    const connections = workbook.getWorksheet('Conexiones');
    expect(connections?.getRow(2).values).toEqual(
      expect.arrayContaining([
        'Dra. Riviere',
        '28-05-2026',
        '08:00',
        'Sin cierre registrado',
        'Chrome · Windows',
      ])
    );
  });
});
