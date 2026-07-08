import { describe, expect, it } from 'vitest';

import { buildClinicalAuditTimelineGroups } from '@/services/admin/clinicalAuditTimeline';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog: AuditLogEntry = {
  id: 'timeline-1',
  timestamp: '2026-05-28T08:00:00.000Z',
  userId: 'enf.turno@hospital.cl',
  userDisplayName: 'Enfermera Turno',
  userUid: 'uid-turno',
  ipAddress: '190.10.10.22',
  action: 'PATIENT_ADMITTED',
  entityType: 'patient',
  entityId: 'Cama 1',
  patientIdentifier: '12.345.678-9',
  details: {
    patientName: 'Juan Perez',
    bedId: '1',
  },
};

describe('clinicalAuditTimeline', () => {
  it('groups audit events by clinical subject and exposes legal event fields', () => {
    const groups = buildClinicalAuditTimelineGroups([
      {
        ...baseLog,
        id: 'timeline-2',
        timestamp: '2026-05-28T09:00:00.000Z',
        action: 'PATIENT_MODIFIED',
        details: {
          patientName: 'Juan Perez',
          movementKind: 'move',
          sourceBed: '1',
          targetBed: '2',
          changes: { bedId: { old: '1', new: '2' } },
        },
      },
      baseLog,
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].subjectLabel).toBe('Juan Perez');
    expect(groups[0].subjectDetail).toContain('12.345.678-9');
    expect(groups[0].packageKindLabel).toBe('Paquete por paciente');
    expect(groups[0].packageSummary).toBe('2 eventos · 100% con IP · Áreas: censo');
    expect(groups[0].clinicalAreas).toEqual(['censo']);
    expect(groups[0].events.map(event => event.title)).toEqual([
      'Paciente trasladado de cama',
      'Paciente ingresado',
    ]);
    expect(groups[0].events[0]).toMatchObject({
      responsible: 'Enfermera Turno',
      origin: 'IP 190.10.10.22',
      affected: 'Juan Perez',
      relevantChanges: 'Cama: 1 -> 2',
    });
  });

  it('prefers canonical clinicalEpisodeId over patient identifier when grouping events', () => {
    const groups = buildClinicalAuditTimelineGroups([
      {
        ...baseLog,
        id: 'timeline-episode-1',
        patientIdentifier: '12.345.678-9',
        details: {
          patientName: 'Juan Perez',
          bedId: '1',
          clinicalEpisodeId: 'ep_morning_admission',
        },
      },
      {
        ...baseLog,
        id: 'timeline-episode-2',
        timestamp: '2026-05-28T18:00:00.000Z',
        patientIdentifier: '12.345.678-9',
        details: {
          patientName: 'Juan Perez',
          bedId: '8',
          clinicalEpisodeId: 'ep_afternoon_readmission',
        },
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.episodeId)).toEqual([
      'ep_afternoon_readmission',
      'ep_morning_admission',
    ]);
    expect(groups.map(group => group.packageKindLabel)).toEqual([
      'Paquete por episodio',
      'Paquete por episodio',
    ]);
    expect(groups[0].subjectDetail).toContain('Episodio ep_afternoon_readmission');
    expect(groups[1].subjectDetail).toContain('Episodio ep_morning_admission');
  });
});
