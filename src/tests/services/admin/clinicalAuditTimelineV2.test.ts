import { describe, expect, it } from 'vitest';

import {
  buildClinicalAuditTimelineV2,
  filterClinicalAuditTimelineV2Groups,
} from '@/services/admin/clinicalAuditTimelineV2';
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

describe('clinicalAuditTimelineV2', () => {
  it('groups a short patient episode timeline and exposes compact clinical context', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'status-1',
        details: {
          patientName: 'Anastasio Hey Riroroko',
          rut: '25DF52626',
          bedId: 'H4C1',
          clinicalEpisodeId: 'episode-a',
          changes: { status: { old: '', new: 'Estable' } },
          mutationId: 'mut-1',
          clientId: 'pc-a',
          tabId: 'tab-a',
          resolution: 'accepted',
          changedPaths: ['beds.H4C1.status'],
        },
      }),
      baseLog({
        id: 'diagnosis-1',
        timestamp: '2026-07-01T19:37:29.000Z',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        details: {
          patientName: 'Anastasio Hey Riroroko',
          rut: '25DF52626',
          bedId: 'H4C1',
          clinicalEpisodeId: 'episode-a',
          changes: { diagnosis: { old: '', new: 'ICC' } },
          mutationId: 'mut-2',
          clientId: 'pc-a',
          tabId: 'tab-a',
          resolution: 'auto_merged',
          changedPaths: ['beds.H4C1.pathology'],
        },
      }),
    ]);

    expect(timeline.groups).toHaveLength(1);
    expect(timeline.groups[0]).toMatchObject({
      patientName: 'Anastasio Hey Riroroko',
      patientRut: '25DF52626',
      episodeId: 'episode-a',
      primaryBedLabel: 'H4C1',
      recordDate: '2026-07-01',
      eventCount: 2,
      clinicalMutationCount: 2,
      viewEventCount: 0,
      responsibleSummary: 'Daniel Opazo Damiani',
      originSummary: 'IP 148.227.67.162',
      syncStateSummary: 'Aceptada + Merge automático',
    });
    expect(timeline.groups[0].events.map(event => event.mutationState)).toEqual([
      'merged',
      'accepted',
    ]);
    expect(timeline.groups[0].events[0]).toMatchObject({
      id: 'diagnosis-1',
      changedPaths: ['beds.H4C1.pathology'],
      mutationId: 'mut-2',
      clientId: 'pc-a',
      tabId: 'tab-a',
    });
    expect(timeline.groups[0].visibleChanges.map(change => change.fieldLabel)).toEqual([
      'Estado',
      'Diagnóstico',
    ]);
  });

  it('does not merge similar patient names when RUT or episode differ', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'patient-a',
        patientIdentifier: '11.111.111-1',
        details: {
          patientName: 'Ana Maria Riro',
          rut: '11.111.111-1',
          bedId: 'H1C1',
          clinicalEpisodeId: 'episode-a',
          changes: { diagnosis: { old: '', new: 'Asma' } },
        },
      }),
      baseLog({
        id: 'patient-b',
        patientIdentifier: '22.222.222-2',
        details: {
          patientName: 'Ana Maria Riro',
          rut: '22.222.222-2',
          bedId: 'H1C2',
          clinicalEpisodeId: 'episode-b',
          changes: { diagnosis: { old: '', new: 'EPOC' } },
        },
      }),
    ]);

    expect(timeline.groups).toHaveLength(2);
    expect(timeline.groups.map(group => group.patientRut).sort()).toEqual([
      '11.111.111-1',
      '22.222.222-2',
    ]);
  });

  it('keeps useful patient, bed and date context when RUT is missing', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'no-rut-handoff',
        patientIdentifier: undefined,
        action: 'NURSE_HANDOFF_MODIFIED',
        details: {
          patientName: 'Paciente Sin Rut',
          bedId: 'H2C1',
          changes: {
            handoffNoteDayShift: { old: '', new: 'Control de dolor pendiente' },
          },
        },
      }),
    ]);

    expect(timeline.groups[0]).toMatchObject({
      patientName: 'Paciente Sin Rut',
      patientRut: undefined,
      primaryBedLabel: 'H2C1',
      recordDate: '2026-07-01',
    });
    expect(timeline.groups[0].visibleChanges[0]).toMatchObject({
      fieldLabel: 'Entrega enfermería - nota día',
      newValuePreview: 'Control de dolor pendiente',
    });
  });

  it('normalizes device and handoff paths into readable before-after changes', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'devices-1',
        details: {
          patientName: 'Paciente DMI',
          rut: '33.333.333-3',
          bedId: 'R3',
          changes: {
            devices: { old: ['VVP#1'], new: ['VVP#1', 'CVC'] },
            medicalHandoffBySpecialty: { old: '', new: 'Cirugía: revisar drenaje' },
          },
          changedPaths: ['beds.R3.devices', 'medicalHandoffBySpecialty.cirugia'],
        },
      }),
    ]);

    expect(timeline.groups[0].visibleChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldLabel: 'Dispositivos invasivos',
          oldValuePreview: 'VVP#1',
          newValuePreview: 'VVP#1, CVC',
        }),
        expect.objectContaining({
          fieldLabel: 'Entrega médica por especialidad',
          newValuePreview: 'Cirugía: revisar drenaje',
        }),
      ])
    );
  });

  it('filters by clinical mutation state including blocked and already applied', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'blocked-1',
        action: 'CONFLICT_AUTO_MERGED',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Paciente Bloqueado',
          rut: '44.444.444-4',
          bedId: 'H5C1',
          mutationId: 'mut-blocked',
          resolution: 'blocked',
          changedPaths: ['beds.H5C1.pathology'],
        },
      }),
      baseLog({
        id: 'already-applied-1',
        action: 'CONFLICT_AUTO_MERGED',
        entityType: 'dailyRecord',
        entityId: '2026-07-01',
        details: {
          patientName: 'Paciente Idempotente',
          rut: '55.555.555-5',
          bedId: 'H5C2',
          mutationId: 'mut-idempotent',
          syncStatus: 'already_applied',
          changedPaths: ['beds.H5C2.status'],
        },
      }),
    ]);

    expect(timeline.syncStateOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'blocked', label: 'Bloqueadas', count: 1 }),
        expect.objectContaining({ id: 'already_applied', label: 'Ya aplicadas', count: 1 }),
      ])
    );
    expect(filterClinicalAuditTimelineV2Groups(timeline.groups, { syncState: 'blocked' })).toEqual([
      expect.objectContaining({ patientName: 'Paciente Bloqueado' }),
    ]);
    expect(
      filterClinicalAuditTimelineV2Groups(timeline.groups, { syncState: 'already_applied' })
    ).toEqual([expect.objectContaining({ patientName: 'Paciente Idempotente' })]);
  });

  it('classifies queued, replayed and unknown states without reading clinical status as sync', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'queued-1',
        patientIdentifier: '66.666.666-6',
        details: {
          patientName: 'Paciente En Cola',
          rut: '66.666.666-6',
          bedId: 'H6C1',
          syncStatus: 'queued',
          changedPaths: ['beds.H6C1.pathology'],
        },
      }),
      baseLog({
        id: 'replayed-1',
        patientIdentifier: '77.777.777-7',
        timestamp: '2026-07-01T19:40:29.000Z',
        details: {
          patientName: 'Paciente Replay',
          rut: '77.777.777-7',
          bedId: 'H6C2',
          queueStatus: 'outbox_replayed',
          changedPaths: ['beds.H6C2.status'],
        },
      }),
      baseLog({
        id: 'unknown-view-1',
        action: 'VIEW_PATIENT',
        patientIdentifier: '88.888.888-8',
        timestamp: '2026-07-01T19:50:29.000Z',
        details: {
          patientName: 'Paciente Visualizado',
          rut: '88.888.888-8',
          bedId: 'H6C3',
        },
      }),
      baseLog({
        id: 'clinical-status-1',
        patientIdentifier: '99.999.999-9',
        timestamp: '2026-07-01T20:00:29.000Z',
        details: {
          patientName: 'Paciente Estado Clinico',
          rut: '99.999.999-9',
          bedId: 'H6C4',
          status: 'blocked',
          changes: { diagnosis: { old: 'Asma', new: 'EPOC' } },
        },
      }),
    ]);

    const eventsById = new Map(
      timeline.groups.flatMap(group => group.events).map(event => [event.id, event.mutationState])
    );

    expect(eventsById.get('queued-1')).toBe('queued');
    expect(eventsById.get('replayed-1')).toBe('replayed');
    expect(eventsById.get('unknown-view-1')).toBe('unknown');
    expect(eventsById.get('clinical-status-1')).toBe('accepted');
    expect(timeline.syncStateOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'queued', label: 'En cola', count: 1 }),
        expect.objectContaining({ id: 'replayed', label: 'Replay', count: 1 }),
        expect.objectContaining({ id: 'unknown', label: 'Sin estado sync', count: 1 }),
      ])
    );
  });

  it('keeps changed paths scoped to each event in multi-log packages', () => {
    const timeline = buildClinicalAuditTimelineV2([
      baseLog({
        id: 'multi-status-1',
        details: {
          patientName: 'Paciente Multipath',
          rut: '10.101.010-1',
          bedId: 'H7C1',
          clinicalEpisodeId: 'episode-multipath',
          changes: { status: { old: '', new: 'Estable' } },
          changedPaths: ['beds.H7C1.status'],
        },
      }),
      baseLog({
        id: 'multi-diagnosis-1',
        timestamp: '2026-07-01T19:37:29.000Z',
        action: 'PATIENT_DIAGNOSIS_CHANGED',
        details: {
          patientName: 'Paciente Multipath',
          rut: '10.101.010-1',
          bedId: 'H7C1',
          clinicalEpisodeId: 'episode-multipath',
          changes: {
            diagnosis: { old: 'Asma', new: 'EPOC' },
            specialty: { old: 'Medicina', new: 'Cirugía' },
          },
          changedPaths: ['beds.H7C1.pathology', 'beds.H7C1.specialty'],
        },
      }),
    ]);

    expect(
      timeline.groups[0].visibleChanges.map(change => [change.fieldLabel, change.changedPath])
    ).toEqual([
      ['Estado', 'beds.H7C1.status'],
      ['Diagnóstico', 'beds.H7C1.pathology'],
      ['Especialidad', 'beds.H7C1.specialty'],
    ]);
  });
});
