import { describe, expect, it } from 'vitest';
import { evaluateDailyRecordConflictPostMergeInvariants } from '@/services/repositories/dailyRecordConflictPostMergeInvariantChecker';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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
});
