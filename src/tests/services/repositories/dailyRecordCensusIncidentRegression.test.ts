import { describe, expect, it } from 'vitest';
import { buildMovePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { buildDischargeEntries } from '@/application/census/controllers/patientMovementDischargeMutationController';
import { resolveConflictSnapshotRecoveryState } from '@/application/clinical-conflicts/conflictSnapshotRecoveryPresentation';
import { buildConflictAuditSummary } from '@/services/repositories/conflictResolutionAuditSummary';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

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

describe('daily record census incident regression', () => {
  it('keeps the July 1 movement/discharge/conflict evidence contract coherent', () => {
    const pierreJeanRecord = makeRecord('2026-07-01T13:00:00.000Z');
    pierreJeanRecord.beds = {
      H2C1: {
        ...createEmptyPatient('H2C1'),
        patientName: 'Pierre-jean',
        rut: '25DF52626',
        pathology: 'Celulitis pie izquierdo',
        location: 'Sala Hospitalizados',
      },
      H2C2: {
        ...createEmptyPatient('H2C2'),
        patientName: '',
        rut: '',
        pathology: '',
        location: 'Sala Hospitalizados',
      },
    };

    const movePatch = buildMovePatientPatches(pierreJeanRecord, 'H2C1', 'H2C2');

    expect(movePatch?.['beds.H2C2']).toEqual(
      expect.objectContaining({
        patientName: 'Pierre-jean',
        rut: '25DF52626',
        pathology: 'Celulitis pie izquierdo',
      })
    );

    const budegutu = {
      ...createEmptyPatient('H2C2'),
      patientName: 'Budegutu Osimap Lupeba',
      rut: '10.000.105-5',
      pathology: 'Diagnóstico de egreso',
      admissionDate: '2026-06-28',
      location: 'Sala Hospitalizados',
    };
    const { discharges } = buildDischargeEntries({
      patient: budegutu,
      bedId: 'H2C2',
      payload: {
        status: 'Vivo',
        type: 'Domicilio (Habitual)',
        time: '13:24',
        dischargeTarget: 'mother',
      },
      resolvedMovementDate: '2026-07-01',
      createId: () => 'discharge-budegutu-2026-07-01',
    });

    const remote = makeRecord('2026-07-01T13:30:00.000Z');
    remote.discharges = [];
    const local = makeRecord('2026-07-01T13:24:23.000Z');
    local.discharges = discharges;

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.discharges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'discharge-budegutu-2026-07-01',
          patientName: 'Budegutu Osimap Lupeba',
          rut: '10.000.105-5',
          diagnosis: 'Diagnóstico de egreso',
        }),
      ])
    );

    const auditSummary = buildConflictAuditSummary(
      ['beds.H2C1', 'beds.H2C2', 'discharges'],
      '2026-03-v3',
      [
        {
          path: 'discharges',
          strategy: 'merge_array_by_id',
          winner: 'merged',
          reason: 'remote_snapshot_priority_preserve_local_movements',
        },
      ]
    );
    const recoveryState = resolveConflictSnapshotRecoveryState({
      date: '2026-07-01',
      snapshotCount: 0,
      snapshotRecovery: {
        status: 'saved',
        snapshotIds: ['cid__remote_premerge', 'cid__incoming_premerge'],
        origins: ['remote_premerge', 'incoming_premerge'],
        ttlMs: 172800000,
      },
    });

    expect(auditSummary.sampleDecisions[0]).toMatchObject({
      path: 'discharges',
      winner: 'merged',
    });
    expect(recoveryState.kind).toBe('saved_but_unavailable');
  });
});
