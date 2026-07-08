import { describe, expect, it } from 'vitest';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-02-18',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

describe('conflict resolution movement deletion policy', () => {
  it('keeps local-only movement rows during newer remote whole-record merges', () => {
    const remote = makeRecord('2026-02-18T10:05:00.000Z');
    remote.discharges = [];

    const local = makeRecord('2026-02-18T10:00:00.000Z');
    local.discharges = [
      {
        id: 'discharge-local-just-created',
        bedId: 'H2C2',
        patientName: 'Paciente Alta Local',
        rut: '17.274.300-5',
        diagnosis: 'Diagnóstico de egreso',
      },
    ] as unknown as DailyRecord['discharges'];

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'discharge-local-just-created',
          patientName: 'Paciente Alta Local',
        }),
      ])
    );
  });

  it('keeps remote tombstones dominant when the same movement was deleted remotely', () => {
    const remote = makeRecord('2026-02-18T10:05:00.000Z');
    remote.discharges = [
      {
        id: 'discharge-deleted-remotely',
        bedId: 'R1',
        patientName: 'Paciente Alta',
        deletedAt: '2026-02-18T10:04:00.000Z',
      },
    ] as unknown as DailyRecord['discharges'];

    const local = makeRecord('2026-02-18T10:00:00.000Z');
    local.discharges = [
      {
        id: 'discharge-deleted-remotely',
        bedId: 'R1',
        patientName: 'Paciente Alta',
      },
    ] as unknown as DailyRecord['discharges'];

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.discharges[0]).toMatchObject({
      id: 'discharge-deleted-remotely',
      deletedAt: '2026-02-18T10:04:00.000Z',
    });
  });

  it('keeps remote tombstones dominant during changed-path movement merges', () => {
    const remote = makeRecord('2026-02-18T10:05:00.000Z');
    remote.discharges = [
      {
        id: 'discharge-deleted-remotely',
        bedId: 'R1',
        patientName: 'Paciente Alta',
        deletedAt: '2026-02-18T10:04:00.000Z',
      },
    ] as unknown as DailyRecord['discharges'];

    const local = makeRecord('2026-02-18T10:00:00.000Z');
    local.discharges = [
      {
        id: 'discharge-deleted-remotely',
        bedId: 'R1',
        patientName: 'Paciente Alta',
      },
    ] as unknown as DailyRecord['discharges'];

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['discharges'],
    });

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.discharges[0]).toMatchObject({
      id: 'discharge-deleted-remotely',
      deletedAt: '2026-02-18T10:04:00.000Z',
    });
  });

  it('preserves local-only movements during whole-record merge; deletions must travel as tombstones', () => {
    const remote = makeRecord('2026-02-18T10:05:00.000Z');
    remote.discharges = [];
    remote.transfers = [];
    remote.cma = [];

    const local = makeRecord('2026-02-18T10:00:00.000Z');
    local.discharges = [
      {
        id: 'discharge-deleted-remotely',
        bedId: 'R1',
        patientName: 'Paciente Alta',
      },
    ] as unknown as DailyRecord['discharges'];
    local.transfers = [
      {
        id: 'transfer-deleted-remotely',
        bedId: 'R2',
        patientName: 'Paciente Traslado',
      },
    ] as unknown as DailyRecord['transfers'];
    local.cma = [
      {
        id: 'cma-deleted-remotely',
        bedName: 'R3',
        patientName: 'Paciente CMA',
      },
    ] as unknown as DailyRecord['cma'];

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'discharge-deleted-remotely' })])
    );
    expect(resolved.transfers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'transfer-deleted-remotely' })])
    );
    expect(resolved.cma).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'cma-deleted-remotely' })])
    );
  });

  it('keeps explicit local movement edits in changed-path merges', () => {
    const remote = makeRecord('2026-02-18T10:05:00.000Z');
    remote.discharges = [
      {
        id: 'd1',
        bedId: 'R1',
        patientName: 'Paciente Remoto',
      },
    ] as unknown as DailyRecord['discharges'];

    const local = makeRecord('2026-02-18T10:00:00.000Z');
    local.discharges = [
      {
        id: 'd1',
        bedId: 'R1',
        patientName: 'Paciente Editado Local',
      },
    ] as unknown as DailyRecord['discharges'];

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['discharges'],
    });

    expect(resolved.discharges).toHaveLength(1);
    expect(resolved.discharges[0].patientName).toBe('Paciente Editado Local');
  });
});
