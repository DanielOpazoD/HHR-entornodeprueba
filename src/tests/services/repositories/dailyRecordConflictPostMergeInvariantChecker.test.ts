import { describe, expect, it } from 'vitest';
import { evaluateDailyRecordConflictPostMergeInvariants } from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { CUDYR_SCORE_FIELDS } from '@/domain/cudyr/cudyrCompletion';
import type { CudyrScore } from '@/types/domain/cudyr';

const completeCudyr = (value = 1): CudyrScore =>
  Object.fromEntries(CUDYR_SCORE_FIELDS.map(field => [field, value])) as unknown as CudyrScore;

const makeRecord = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-07-01',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

const makePatient = (
  patientName: string,
  rut: string,
  admissionDate: string,
  extras: Partial<DailyRecord['beds'][string]> = {}
): DailyRecord['beds'][string] =>
  ({
    bedId: 'R1',
    patientName,
    rut,
    admissionDate,
    ...extras,
  }) as DailyRecord['beds'][string];

describe('dailyRecordConflictPostMergeInvariantChecker', () => {
  it('blocks post-merge records that drop visible movements, revive tombstones or duplicate active patients', () => {
    const remote = makeRecord('2026-07-01T10:10:00.000Z');
    remote.discharges = [
      { id: 'discharge-remote', bedId: 'R1', patientName: 'Alta remota' },
      {
        id: 'discharge-deleted',
        bedId: 'R2',
        patientName: 'Alta eliminada',
        deletedAt: '2026-07-01T10:09:00.000Z',
      },
    ] as unknown as DailyRecord['discharges'];
    remote.transfers = [
      { id: 'transfer-remote', bedId: 'R3', patientName: 'Traslado remoto' },
    ] as unknown as DailyRecord['transfers'];
    remote.cma = [
      {
        id: 'cma-remote',
        bedName: 'R4',
        originalBedId: 'R4',
        patientName: 'CMA remoto',
      },
    ] as unknown as DailyRecord['cma'];

    const local = makeRecord('2026-07-01T10:00:00.000Z');
    local.discharges = [
      { id: 'discharge-local', bedId: 'R5', patientName: 'Alta local' },
      { id: 'discharge-deleted', bedId: 'R2', patientName: 'Alta eliminada revivida' },
    ] as unknown as DailyRecord['discharges'];
    local.transfers = [
      { id: 'transfer-local', bedId: 'R6', patientName: 'Traslado local' },
    ] as unknown as DailyRecord['transfers'];
    local.cma = [
      {
        id: 'cma-local',
        bedName: 'R7',
        originalBedId: 'R7',
        patientName: 'CMA local',
      },
    ] as unknown as DailyRecord['cma'];

    const resolved = makeRecord('2026-07-01T10:10:00.000Z');
    resolved.beds = {
      R8: {
        bedId: 'R8',
        patientName: 'Paciente duplicado',
        rut: '12.345.678-9',
      } as unknown as DailyRecord['beds'][string],
      R9: {
        bedId: 'R9',
        patientName: 'Paciente duplicado',
        rut: '12.345.678-9',
      } as unknown as DailyRecord['beds'][string],
    };
    resolved.discharges = [
      { id: 'discharge-local', bedId: 'R5', patientName: 'Alta local' },
      { id: 'discharge-deleted', bedId: 'R2', patientName: 'Alta eliminada revivida' },
    ] as unknown as DailyRecord['discharges'];
    resolved.transfers = [
      { id: 'transfer-remote', bedId: 'R3', patientName: 'Traslado remoto' },
    ] as unknown as DailyRecord['transfers'];
    resolved.cma = [
      {
        id: 'cma-local',
        bedName: 'R7',
        originalBedId: 'R7',
        patientName: 'CMA local',
      },
    ] as unknown as DailyRecord['cma'];

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-01', phase: 'sync_publish' },
    });

    expect(result.status).toBe('blocked');
    expect(result.violations.map(violation => violation.type)).toEqual(
      expect.arrayContaining([
        'movement_missing_after_merge',
        'movement_tombstone_revived',
        'duplicate_active_patient_after_merge',
      ])
    );
    expect(result.violations.map(violation => violation.path)).toEqual(
      expect.arrayContaining([
        'discharges.discharge-remote',
        'transfers.transfer-local',
        'cma.cma-remote',
        'discharges.discharge-deleted',
        'beds.R9',
      ])
    );
  });

  it('accepts safe merged movement unions with dominant tombstones and no duplicate active patient', () => {
    const remote = makeRecord('2026-07-01T10:10:00.000Z');
    remote.discharges = [
      {
        id: 'discharge-deleted',
        bedId: 'R2',
        patientName: 'Alta eliminada',
        deletedAt: '2026-07-01T10:09:00.000Z',
      },
    ] as unknown as DailyRecord['discharges'];

    const local = makeRecord('2026-07-01T10:00:00.000Z');
    local.discharges = [
      { id: 'discharge-local', bedId: 'R5', patientName: 'Alta local' },
      { id: 'discharge-deleted', bedId: 'R2', patientName: 'Alta eliminada revivida' },
    ] as unknown as DailyRecord['discharges'];

    const resolved = makeRecord('2026-07-01T10:10:00.000Z');
    resolved.discharges = [
      {
        id: 'discharge-deleted',
        bedId: 'R2',
        patientName: 'Alta eliminada',
        deletedAt: '2026-07-01T10:09:00.000Z',
      },
      { id: 'discharge-local', bedId: 'R5', patientName: 'Alta local' },
    ] as unknown as DailyRecord['discharges'];

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-01', phase: 'sync_publish' },
    });

    expect(result).toMatchObject({
      status: 'ok',
      violations: [],
    });
    expect(result.record).toBe(resolved);
  });

  it('blocks two active classifications that share the same egreso lineage', () => {
    const remote = makeRecord('2026-07-01T10:10:00.000Z');
    const local = makeRecord('2026-07-01T10:00:00.000Z');
    const resolved = makeRecord('2026-07-01T10:10:00.000Z');
    const provenance = {
      source: 'reclassified' as const,
      lineageId: 'egreso-lineage-1',
      classifiedAt: '2026-07-01T10:10:00.000Z',
      previousMovementId: 'source-1',
      previousClassification: 'discharge' as const,
    };
    resolved.transfers = [
      { id: 'transfer-1', movementProvenance: provenance },
    ] as unknown as DailyRecord['transfers'];
    resolved.cma = [
      { id: 'cma-1', movementProvenance: provenance },
    ] as unknown as DailyRecord['cma'];

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-01', phase: 'sync_publish' },
    });

    expect(result.status).toBe('blocked');
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        type: 'movement_lineage_classified_twice',
        path: 'movements.lineage.egreso-lineage-1',
      })
    );
  });

  it('blocks handoff note and medical entry loss for the same clinical episode', () => {
    const remote = makeRecord('2026-07-01T10:10:00.000Z');
    remote.beds = {
      R1: makePatient('Paciente Handoff', '12.345.678-9', '2026-07-01', {
        handoffNoteDayShift: 'Nota enfermeria remota',
        medicalHandoffEntries: [
          { id: 'entry-remote', specialty: 'cirugia', note: 'Entrada remota' },
        ] as never,
      }),
    };

    const local = makeRecord('2026-07-01T10:00:00.000Z');
    local.beds = {
      R1: makePatient('Paciente Handoff', '12.345.678-9', '2026-07-01', {
        handoffNoteNightShift: 'Nota enfermeria local',
        medicalHandoffEntries: [
          { id: 'entry-local', specialty: 'medicinaInterna', note: 'Entrada local' },
        ] as never,
      }),
    };

    const resolved = makeRecord('2026-07-01T10:10:00.000Z');
    resolved.beds = {
      R1: makePatient('Paciente Handoff', '12.345.678-9', '2026-07-01', {
        handoffNoteDayShift: '',
        handoffNoteNightShift: '',
        medicalHandoffEntries: [
          { id: 'entry-remote', specialty: 'cirugia', note: 'Entrada remota' },
        ] as never,
      }),
    };

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-01', phase: 'sync_publish' },
    });

    expect(result.status).toBe('blocked');
    expect(result.violations.map(violation => violation.type)).toEqual(
      expect.arrayContaining([
        'handoff_note_missing_after_merge',
        'medical_handoff_entry_missing_after_merge',
      ])
    );
    expect(result.violations.map(violation => violation.path)).toEqual(
      expect.arrayContaining([
        'beds.R1.handoffNoteDayShift',
        'beds.R1.handoffNoteNightShift',
        'beds.R1.medicalHandoffEntries.entry-local',
      ])
    );
  });

  it('blocks stale medical handoff entries revived into a different clinical episode', () => {
    const remote = makeRecord('2026-07-01T10:10:00.000Z');
    remote.beds = {
      R1: makePatient('Paciente Nuevo', '22.222.222-2', '2026-07-01', {
        medicalHandoffEntries: [],
      }),
    };

    const local = makeRecord('2026-07-01T10:00:00.000Z');
    local.beds = {
      R1: makePatient('Paciente Antiguo', '11.111.111-1', '2026-06-25', {
        medicalHandoffEntries: [
          { id: 'entry-old', specialty: 'cirugia', note: 'Entrada del episodio antiguo' },
        ] as never,
      }),
    };

    const resolved = makeRecord('2026-07-01T10:10:00.000Z');
    resolved.beds = {
      R1: makePatient('Paciente Nuevo', '22.222.222-2', '2026-07-01', {
        medicalHandoffEntries: [
          { id: 'entry-old', specialty: 'cirugia', note: 'Entrada del episodio antiguo' },
        ] as never,
      }),
    };

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-01', phase: 'sync_publish' },
    });

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'medical_handoff_entry_cross_episode_after_merge',
          path: 'beds.R1.medicalHandoffEntries.entry-old',
        }),
      ])
    );
  });

  it('repairs stale medical handoff summary from merged specialty notes', () => {
    const remote = makeRecord('2026-07-01T10:10:00.000Z');
    remote.medicalHandoffBySpecialty = {
      cirugia: {
        note: 'Control quirurgico',
        updatedAt: '2026-07-01T10:00:00.000Z',
      },
    } as DailyRecord['medicalHandoffBySpecialty'];
    remote.medicalHandoffNovedades = 'Cirugía\nControl quirurgico';

    const local = makeRecord('2026-07-01T10:00:00.000Z');
    local.medicalHandoffBySpecialty = {
      medicinaInterna: {
        note: 'Ajustar antihipertensivos',
        updatedAt: '2026-07-01T10:05:00.000Z',
      },
    } as DailyRecord['medicalHandoffBySpecialty'];
    local.medicalHandoffNovedades = 'Medicina Interna\nAjustar antihipertensivos';

    const resolved = makeRecord('2026-07-01T10:10:00.000Z');
    resolved.medicalHandoffBySpecialty = {
      ...remote.medicalHandoffBySpecialty,
      ...local.medicalHandoffBySpecialty,
    };
    resolved.medicalHandoffNovedades = remote.medicalHandoffNovedades;

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-01', phase: 'sync_publish' },
    });

    expect(result.status).toBe('ok');
    expect(result.record.medicalHandoffNovedades).toContain('Cirugía');
    expect(result.record.medicalHandoffNovedades).toContain('Medicina Interna');
    expect(result.record.medicalHandoffNovedades).toContain('Ajustar antihipertensivos');
  });

  it('blocks a delayed CUDYR merge after another client completed the night shift', () => {
    const remote = makeRecord('2026-07-17T01:05:00.000Z');
    remote.cudyrLocked = true;
    remote.cudyrShiftDate = '2026-07-16';
    remote.beds = {
      R1: makePatient('Paciente CUDYR', '11.111.111-1', '2026-07-15', {
        cudyr: { changeClothes: 1, mobilization: 1 } as never,
      }),
    };

    const local = makeRecord('2026-07-17T00:55:00.000Z');
    local.beds = {
      R1: makePatient('Paciente CUDYR', '11.111.111-1', '2026-07-15', {
        cudyr: { changeClothes: 3, mobilization: 1 } as never,
      }),
    };

    const resolved = {
      ...remote,
      beds: local.beds,
    };
    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-16', phase: 'sync_publish' },
    });

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cudyr_changed_after_remote_completion',
          path: 'beds.R1.cudyr',
        }),
      ])
    );
  });

  it('allows identity detail corrections for the same episode after CUDYR closure', () => {
    const remote = makeRecord('2026-07-17T01:05:00.000Z');
    remote.date = '2026-07-16';
    remote.cudyrLocked = true;
    remote.cudyrShiftDate = '2026-07-16';
    remote.beds = {
      R1: makePatient('Paciente CUDYR', '11.111.111-1', '2026-07-15', {
        clinicalEpisodeId: 'episode-cudyr',
        cudyr: completeCudyr(),
      }),
    };
    const resolved = {
      ...remote,
      beds: {
        R1: { ...remote.beds.R1, patientName: 'Paciente CUDYR corregido' },
      },
    };

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local: resolved,
      resolved,
      context: { date: '2026-07-16', phase: 'sync_publish' },
    });

    expect(result.status).toBe('ok');
  });

  it('protects last-save attribution after CUDYR closure', () => {
    const remote = makeRecord('2026-07-17T01:05:00.000Z');
    remote.date = '2026-07-16';
    remote.cudyrLocked = true;
    remote.cudyrUpdatedAt = '2026-07-17T01:05:00.000Z';
    remote.cudyrUpdatedBy = 'Enfermera oficial';
    remote.cudyrUpdatedById = 'nurse-official';
    const resolved = {
      ...remote,
      cudyrUpdatedBy: 'Cliente atrasado',
    };

    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local: resolved,
      resolved,
      context: { date: '2026-07-16', phase: 'sync_publish' },
    });

    expect(result.status).toBe('blocked');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cudyr_changed_after_remote_completion',
          path: 'cudyrUpdatedBy',
        }),
      ])
    );
  });

  it('closes a CUDYR completed by disjoint concurrent patient updates', () => {
    const remote = makeRecord('2026-07-17T01:04:00.000Z');
    remote.date = '2026-07-16';
    remote.beds = {
      R1: makePatient('Paciente uno', '1-1', '2026-07-15', { cudyr: completeCudyr(1) }),
      R2: makePatient('Paciente dos', '2-2', '2026-07-15'),
    };

    const local = makeRecord('2026-07-17T01:05:00.000Z');
    local.date = '2026-07-16';
    local.cudyrUpdatedAt = '2026-07-17T01:05:00.000Z';
    local.cudyrUpdatedBy = 'Enfermera Noche';
    local.cudyrUpdatedById = 'nurse-1';
    local.cudyrShiftDate = '2026-07-16';
    local.beds = {
      R1: makePatient('Paciente uno', '1-1', '2026-07-15'),
      R2: makePatient('Paciente dos', '2-2', '2026-07-15', { cudyr: completeCudyr(2) }),
    };

    const resolved = {
      ...local,
      beds: {
        R1: remote.beds.R1,
        R2: local.beds.R2,
      },
    };
    const result = evaluateDailyRecordConflictPostMergeInvariants({
      remote,
      local,
      resolved,
      context: { date: '2026-07-16', phase: 'sync_publish' },
    });

    expect(result.status).toBe('ok');
    expect(result.record).toMatchObject({
      cudyrLocked: true,
      cudyrLockedAt: '2026-07-17T01:05:00.000Z',
      cudyrLockedBy: 'nurse-1',
      cudyrShiftDate: '2026-07-16',
      cudyrCompletedAt: '2026-07-17T01:05:00.000Z',
      cudyrCompletedBy: 'Enfermera Noche',
    });
  });
});
