import { describe, expect, it } from 'vitest';
import {
  resolveDailyRecordConflict,
  resolveDailyRecordConflictWithTrace,
} from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (date: string, lastUpdated: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated,
  nurses: [],
  activeExtraBeds: [],
});

describe('conflictResolution explicit canonical paths', () => {
  it('does not let stale explicit local paths overwrite newer remote canonical census fields', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Nombre remoto vigente',
        pathology: 'Diagnostico remoto vigente',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Nombre local stale',
        pathology: 'Diagnostico local stale',
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.patientName', 'beds.R1.pathology'],
    });

    expect(resolved.beds.R1.patientName).toBe('Nombre remoto vigente');
    expect(resolved.beds.R1.pathology).toBe('Diagnostico remoto vigente');
  });

  it('keeps explicit local specialty and status edits for the same active episode', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'episode-r1',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-17',
        specialty: 'Medicina',
        secondarySpecialty: undefined,
        status: 'Estable',
        pathology: 'Diagnostico remoto vigente',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'episode-r1',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-17',
        specialty: 'Otra especialidad',
        secondarySpecialty: 'Infectologia',
        status: 'De cuidado',
        pathology: 'Diagnostico local stale',
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, {
      changedPaths: ['beds.R1.specialty', 'beds.R1.secondarySpecialty', 'beds.R1.status'],
    });

    const resolved = result.record;
    expect(resolved.beds.R1.specialty).toBe('Otra especialidad');
    expect(resolved.beds.R1.secondarySpecialty).toBe('Infectologia');
    expect(resolved.beds.R1.status).toBe('De cuidado');
    expect(resolved.beds.R1.pathology).toBe('Diagnostico remoto vigente');
    expect(result.trace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'beds.R1.specialty',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
      ])
    );
  });

  it('keeps explicit local diagnosis, obstetric and UPC edits for the same active episode', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'episode-r1',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-17',
        pathology: 'Diagnostico remoto anterior',
        diagnosisComments: 'Comentario remoto anterior',
        snomedCode: '123',
        cie10Code: 'J18.9',
        cie10Description: 'Neumonia remota',
        ginecobstetriciaType: undefined,
        deliveryRoute: undefined,
        deliveryDate: undefined,
        deliveryCesareanLabor: undefined,
        isUPC: false,
        upcChecklist: undefined,
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'episode-r1',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-17',
        pathology: 'Diagnostico local nuevo',
        diagnosisComments: 'Comentario local nuevo',
        snomedCode: '456',
        cie10Code: '',
        cie10Description: '',
        ginecobstetriciaType: 'Obstétrica',
        deliveryRoute: 'Cesárea',
        deliveryDate: '2026-02-18',
        deliveryCesareanLabor: 'Con TdP',
        isUPC: true,
        upcChecklist: {
          classification: 'UPC_UCI',
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          evaluatedAt: '2026-02-18T10:00:00.000Z',
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, {
      changedPaths: [
        'beds.R1.pathology',
        'beds.R1.diagnosisComments',
        'beds.R1.snomedCode',
        'beds.R1.cie10Code',
        'beds.R1.cie10Description',
        'beds.R1.ginecobstetriciaType',
        'beds.R1.deliveryRoute',
        'beds.R1.deliveryDate',
        'beds.R1.deliveryCesareanLabor',
        'beds.R1.isUPC',
        'beds.R1.upcChecklist',
      ],
    });

    expect(result.record.beds.R1.pathology).toBe('Diagnostico local nuevo');
    expect(result.record.beds.R1.diagnosisComments).toBe('Comentario local nuevo');
    expect(result.record.beds.R1.snomedCode).toBe('456');
    expect(result.record.beds.R1.cie10Code).toBe('');
    expect(result.record.beds.R1.cie10Description).toBe('');
    expect(result.record.beds.R1.ginecobstetriciaType).toBe('Obstétrica');
    expect(result.record.beds.R1.deliveryRoute).toBe('Cesárea');
    expect(result.record.beds.R1.deliveryDate).toBe('2026-02-18');
    expect(result.record.beds.R1.deliveryCesareanLabor).toBe('Con TdP');
    expect(result.record.beds.R1.isUPC).toBe(true);
    expect(result.record.beds.R1.upcChecklist).toMatchObject({
      classification: 'UPC_UCI',
      uciCriteria: ['uci_vmi'],
    });
    expect(result.trace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'beds.R1.pathology',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
        expect.objectContaining({
          path: 'beds.R1.upcChecklist',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
      ])
    );
  });

  it('keeps explicit status edits when the remote snapshot already has a generated episode id', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'ep_r1_generated',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        status: '',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: undefined,
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        status: 'Grave',
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, {
      changedPaths: ['beds.R1.status'],
    });

    expect(result.record.beds.R1.status).toBe('Grave');
    expect(result.trace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'beds.R1.status',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
      ])
    );
  });

  it('keeps newer local status and specialty visible for the same episode during whole-record reconciliation', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'ep_r1_generated',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        status: '',
        specialty: '',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:05.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: undefined,
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        status: 'Grave',
        specialty: 'Medicina',
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, { changedPaths: ['*'] });

    expect(result.record.beds.R1.status).toBe('Grave');
    expect(result.record.beds.R1.specialty).toBe('Medicina');
    expect(result.trace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'beds.R1.status',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
        expect.objectContaining({
          path: 'beds.R1.specialty',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
      ])
    );
  });

  it('keeps sequential local diagnosis and specialty edits when a newer same-episode snapshot only confirms status', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:08.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'ep_r1_generated',
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        pathology: '',
        specialty: '',
        status: 'De cuidado',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:05.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: undefined,
        patientName: 'Paciente vigente',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        pathology: 'Neumonia adquirida en la comunidad',
        specialty: 'Medicina',
        status: 'De cuidado',
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, { changedPaths: ['*'] });

    expect(result.record.beds.R1.pathology).toBe('Neumonia adquirida en la comunidad');
    expect(result.record.beds.R1.specialty).toBe('Medicina');
    expect(result.record.beds.R1.status).toBe('De cuidado');
    expect(result.record.beds.R1.clinicalEpisodeId).toBe('ep_r1_generated');
    expect(result.trace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'beds.R1.pathology',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
        expect.objectContaining({
          path: 'beds.R1.specialty',
          winner: 'local',
          reason: 'explicit_local_census_patch_same_episode',
        }),
      ])
    );
  });

  it('does not keep explicit local specialty and status edits for a different episode', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'episode-new',
        patientName: 'Paciente nuevo',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '15:30',
        specialty: 'Medicina',
        secondarySpecialty: undefined,
        status: 'Estable',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        clinicalEpisodeId: 'episode-old',
        patientName: 'Paciente antiguo',
        rut: '11.111.111-1',
        admissionDate: '2026-02-18',
        admissionTime: '08:00',
        specialty: 'Otra especialidad',
        secondarySpecialty: 'Infectologia',
        status: 'De cuidado',
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.specialty', 'beds.R1.secondarySpecialty', 'beds.R1.status'],
    });

    expect(resolved.beds.R1.specialty).toBe('Medicina');
    expect(resolved.beds.R1.secondarySpecialty).toBeUndefined();
    expect(resolved.beds.R1.status).toBe('Estable');
  });
});
