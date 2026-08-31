import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import {
  DailyRecordFreshnessGateError,
  markDailyRecordRemoteConfirmed,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { assertHydratedRemotePatchCanProceed } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { getSyncClientId } from '@/services/storage/sync/syncMutationIdentity';

const DATE = '2026-08-30';

const buildRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: DATE,
    lastUpdated: '2026-08-30T10:00:00.000Z',
    beds: {
      R1: { bedId: 'R1', patientName: 'Paciente Uno', status: 'Estable' },
      R2: { bedId: 'R2', patientName: 'Paciente Dos', status: 'Estable' },
    },
    discharges: [],
    transfers: [],
    cma: [],
    ...overrides,
  }) as unknown as DailyRecord;

const buildHydratedFreshness = (record: DailyRecord): DailyRecordQueryResult =>
  ({
    record,
    runtime: {
      conflictSummary: {
        kind: 'hydrated_from_remote',
        localTimestamp: '2026-08-30T10:00:00.000Z',
        remoteTimestamp: record.lastUpdated,
      },
    },
  }) as unknown as DailyRecordQueryResult;

describe('assertHydratedRemotePatchCanProceed · bypass de confirmaciones propias', () => {
  beforeEach(() => {
    resetDailyRecordFreshnessGateForTests();
  });

  const runGate = (hydratedRecord: DailyRecord) => {
    // La mutación partió antes de que llegara la confirmación nueva.
    const remoteConfirmedAtBeforeMutation = 1_000;
    markDailyRecordRemoteConfirmed(DATE, {
      source: 'write',
      remoteLastUpdated: hydratedRecord.lastUpdated,
      confirmedRecord: hydratedRecord,
    });
    return () =>
      assertHydratedRemotePatchCanProceed({
        date: DATE,
        attemptedPatch: { 'beds.R2.status': 'Grave' },
        previousRecord: buildRecord(),
        freshness: buildHydratedFreshness(hydratedRecord),
        remoteConfirmedAtBeforeMutation,
      });
  };

  it('no descarta una edición cuando la confirmación nueva es de este mismo cliente', () => {
    // El eco de la edición anterior del propio usuario (misma cama, mismo grupo
    // clínico) no debe botar la siguiente edición de la ráfaga.
    const hydrated = buildRecord({
      lastUpdated: '2026-08-30T10:00:05.000Z',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente Uno', status: 'Estable' },
        R2: { bedId: 'R2', patientName: 'Paciente Dos', status: 'De cuidado' },
      },
      meta: { revision: 7, lastWriterClientId: getSyncClientId() },
    } as unknown as Partial<DailyRecord>);

    expect(runGate(hydrated)).not.toThrow();
  });

  it('sigue bloqueando cuando la confirmación viene de otro cliente y toca el mismo campo', () => {
    const hydrated = buildRecord({
      lastUpdated: '2026-08-30T10:00:05.000Z',
      beds: {
        R1: { bedId: 'R1', patientName: 'Paciente Uno', status: 'Estable' },
        R2: { bedId: 'R2', patientName: 'Paciente Dos', status: 'De cuidado' },
      },
      meta: { revision: 7, lastWriterClientId: 'client_de-otro-equipo' },
    } as unknown as Partial<DailyRecord>);

    expect(runGate(hydrated)).toThrow(DailyRecordFreshnessGateError);
  });
});
