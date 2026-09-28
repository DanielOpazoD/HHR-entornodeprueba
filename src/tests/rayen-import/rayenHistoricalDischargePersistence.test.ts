import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  buildRecord,
  buildPatient,
} from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { useRayenCensusDiffApplication } from '@/features/rayen-import/hooks/useRayenCensusDiffApplication';
import { finalizeRayenHistoricalDischarges } from '@/features/rayen-import/hooks/finalizeRayenHistoricalDischarges';
import { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';
import { checkRegression } from '@/utils/integrityGuard';
import { evaluateDailyRecordClinicalAuthority } from '@/services/repositories/dailyRecordClinicalAuthorityPolicy';
import { computePreviousDayEdits } from '@/features/rayen-import/domain/previousDayCorrections';
import { resolveHistoricalCudyrBatchOperation } from '@/features/rayen-import/domain/historicalCudyrPatch';
import { buildDischarge } from '@/features/rayen-import/domain/applyCensusImportDiff';

const setup = async (emptyCrib = false) => {
  const date = '2026-09-27';
  const run = {
    id: 'synthetic-historical-run',
    sourceDate: date,
    startedAt: '2026-09-28T03:00:00.000Z',
    by: 'Test',
  };
  const departed: PatientData = {
    ...buildPatient('R3', 'Paciente histórico sintético'),
    clinicalEpisodeId: 'episode-departed',
    ...(emptyCrib ? { clinicalCrib: { ...EMPTY_PATIENT, bedId: 'R3-crib' } } : {}),
  };
  const active = {
    ...buildPatient('R2', 'Paciente activo sintético'),
    clinicalEpisodeId: 'episode-active',
  };
  let remote: DailyRecord = { ...buildRecord(date), beds: { R3: departed, R2: active } };
  const entry = {
    bedId: 'R3',
    rut: departed.rut,
    patientName: departed.patientName,
    encounterId: departed.clinicalEpisodeId,
    kind: 'alta' as const,
    status: 'Vivo' as const,
    reason: 'administrative-discharge' as const,
    correctedDay: '2026-09-26',
    correctedTime: '15:00',
  };
  const diff: CensusImportDiff = {
    admissions: [],
    updates: [],
    moves: [],
    discharges: [entry],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    unchangedCount: 1,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 1,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 1,
    },
  };
  const stamp = (record: DailyRecord) => ({
    record: {
      ...record,
      rayenSync: { at: run.startedAt, by: run.by, runId: run.id, status: 'applied' },
      rayenSyncHistory: [{ ...run, completedAt: run.startedAt, status: 'applied' }],
    } as DailyRecord,
  });
  const accept = (record: DailyRecord) => {
    expect(findPatientErasures(remote, record)).toEqual([]);
    expect(checkRegression(remote, record).isSuspicious).toBe(false);
    remote = { ...record, lastUpdated: '2026-09-28T03:01:00.000Z' };
    return {
      record: remote,
      result: { date, outcome: 'clean', updatedRemotely: true, confirmedRecord: remote },
    };
  };
  const save = vi.fn(async (record: DailyRecord) => accept(record));
  const checkpoint = vi.fn(
    async (_date: string, patch: object) => accept({ ...remote, ...patch }).result
  );
  const queryClient = new QueryClient();
  const hook = renderHook(() =>
    useRayenCensusDiffApplication({
      ensureRun: () => run as never,
      applyRunToRecord: stamp,
      saveDailyRecord: save as never,
      checkpointRepository: { updatePartialDetailed: checkpoint as never },
      queryClient,
      loadAuthoritativeRecord: async () => remote,
      loadLocalRecord: async () =>
        ({
          record: remote,
          writeState: 'none',
          hasPendingWrites: false,
          hasPendingWritesForDate: false,
        }) as never,
      recordRunPerformance: vi.fn(),
    })
  );
  let applied!: Awaited<ReturnType<typeof hook.result.current>>;
  await act(async () => {
    applied = await hook.result.current(remote, diff);
  });
  const history = buildRecord(entry.correctedDay);
  history.discharges = [
    buildDischarge(departed, entry, history, {
      idFactory: () => 'historical-movement',
      now: new Date(run.startedAt),
      syncRunId: run.id,
    }),
  ];
  const patch = vi.fn(
    async (
      targetDate: string,
      value: Record<string, unknown>,
      options: { intentionalBedClear?: { confirmedOccupant: { clinicalEpisodeId?: string } } }
    ) => {
      expect(options.intentionalBedClear?.confirmedOccupant.clinicalEpisodeId).toBe(
        departed.clinicalEpisodeId
      );
      expect(Object.keys(value)).toEqual(['beds.R3']);
      if (targetDate === history.date) {
        history.beds.R3 = { ...EMPTY_PATIENT, bedId: 'R3' };
        history.lastUpdated = '2026-09-28T03:01:30.000Z';
        return {
          date: history.date,
          outcome: 'clean',
          updatedRemotely: true,
          confirmedRecord: history,
        };
      }
      remote = {
        ...remote,
        beds: { ...remote.beds, R3: { ...EMPTY_PATIENT, bedId: 'R3' } },
        lastUpdated: '2026-09-28T03:02:00.000Z',
      };
      return { date, outcome: 'clean', updatedRemotely: true, confirmedRecord: remote };
    }
  );
  const repository = {
    getAuthoritativeForDate: vi.fn(async (day: string) => (day === date ? remote : history)),
    updatePartialDetailed: patch,
  };
  return {
    applied,
    diff,
    repository,
    patch,
    queryClient,
    history,
    save,
    checkpoint,
    replaceRemote: (value: DailyRecord) => {
      remote = value;
    },
    current: () => remote,
  };
};

describe('historical discharge structural-to-clinical handoff', () => {
  it('keeps the historical occupant through the selected-day CAS, then clears only after its movement is confirmed', async () => {
    const x = await setup();
    expect(x.checkpoint).toHaveBeenCalledOnce();
    expect(x.save).not.toHaveBeenCalled();
    expect(x.applied.record.beds.R3.patientName).toBeTruthy();
    expect(x.applied.record.discharges).toEqual([]);
    expect(x.applied.confirmedHandoff.safeClinicalEpisodeIds).toEqual(['episode-active']);
    const finished = await finalizeRayenHistoricalDischarges(
      x.applied,
      x.repository as never,
      x.queryClient
    );
    expect(x.patch).toHaveBeenCalledOnce();
    expect(finished.record.beds.R3.patientName).toBe('');
    expect(finished.record.beds.R2.clinicalEpisodeId).toBe('episode-active');
    expect(finished.record.discharges).toEqual([]);
    expect(x.history.discharges).toHaveLength(1);
    expect(finished.confirmedHandoff.acceptedRevision).toBe(finished.record.lastUpdated);
    expect(finished.confirmedHandoff.safeClinicalEpisodeIds).toEqual(['episode-active']);
  });

  it.each([false, true])(
    'clears a copied empty crib form without inventing a newborn discharge (historical form: %s)',
    async historicalForm => {
      const x = await setup(true);
      x.history.beds.R3 = {
        ...x.applied.record.beds.R3,
        clinicalCrib: historicalForm ? { ...EMPTY_PATIENT, bedId: 'R3-crib' } : undefined,
      };
      const finished = await finalizeRayenHistoricalDischarges(
        x.applied,
        x.repository as never,
        x.queryClient,
        true
      );
      expect(x.patch).toHaveBeenCalledTimes(2);
      expect(x.patch.mock.calls[1][2]).toMatchObject({
        intentionalBedClear: { confirmedAssociatedCrib: { presenceOnly: true } },
      });
      expect(finished.record.beds.R3.patientName).toBe('');
      expect(finished.record.beds.R3.clinicalCrib).toBeUndefined();
      expect(x.history.discharges).toHaveLength(1);
      expect(finished.record.discharges).toHaveLength(0);
    }
  );

  it.each(['patientName', 'rut', 'clinicalEpisodeId'] as const)(
    'preserves a real crib identified only by %s',
    async field => {
      const x = await setup(true);
      x.applied.record.beds.R3.clinicalCrib![field] = 'synthetic-identity';
      await expect(
        finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient, true)
      ).rejects.toThrow('cuna asociada');
      expect(x.patch).not.toHaveBeenCalled();
    }
  );

  it.each(['transfers', 'cma'] as const)(
    'respects an existing %s closing the same episode without inventing another alta',
    async kind => {
      const x = await setup(true);
      const movement = x.history.discharges[0];
      x.history[kind] = [movement] as never;
      x.history.discharges = [];
      x.history.beds.R3 = { ...x.applied.record.beds.R3 };
      const finished = await finalizeRayenHistoricalDischarges(
        x.applied,
        x.repository as never,
        x.queryClient,
        true
      );
      expect(x.history[kind]).toEqual([movement]);
      expect(x.history.discharges).toHaveLength(0);
      expect(finished.record.discharges).toHaveLength(0);
      expect(finished.record.beds.R3.patientName).toBe('');
    }
  );

  it('repairs a filed historical discharge before CUDYR for remaining patients', async () => {
    const x = await setup();
    x.history.beds = { ...x.applied.record.beds };
    expect(
      evaluateDailyRecordClinicalAuthority(x.history, {
        date: x.history.date,
        phase: 'persistence',
      }).status
    ).toBe('blocked');
    const plan = await computePreviousDayEdits(
      {
        ...x.repository,
        getLocalForDateWithMeta: async () => ({
          record: x.history,
          hasPendingWrites: false,
          writeState: 'none',
        }),
      } as never,
      x.diff,
      x.applied.record.date,
      true
    );
    expect(plan.edits).toMatchObject([{ day: '2026-09-26', reason: 'discharge-day-correction' }]);
    expect(plan.recordedDischargeBedIds).toEqual(['R3']);
    const finished = await finalizeRayenHistoricalDischarges(
      x.applied,
      x.repository as never,
      x.queryClient,
      true
    );
    expect(x.patch).toHaveBeenCalledTimes(2);
    expect(x.history.discharges).toHaveLength(1);
    expect(finished.record.discharges).toHaveLength(0);
    expect(
      evaluateDailyRecordClinicalAuthority(x.history, {
        date: x.history.date,
        phase: 'persistence',
      }).status
    ).toBe('ok');
    const { operation } = resolveHistoricalCudyrBatchOperation(x.history, 'episode-active', {
      category: 'C2',
      recordedDate: '2026-09-26',
      recordedAt: '2026-09-27T06:00:00Z',
      source: 'Eloísa · Gestión de Camas',
    });
    expect(operation?.target).toMatchObject({ censusDate: '2026-09-26', bedId: 'R2' });
  });

  it('preserves a historical bed reused by another episode and does not clear signed days', async () => {
    const x = await setup();
    x.history.beds.R3 = { ...x.applied.record.beds.R3, clinicalEpisodeId: 'new-episode' };
    await finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient, true);
    expect(x.history.beds.R3.clinicalEpisodeId).toBe('new-episode');
    expect(x.patch).toHaveBeenCalledTimes(1);
    const y = await setup();
    y.history.beds = { ...y.applied.record.beds };
    Object.assign(y.history, { medicalSignature: { signedBy: 'Test' } });
    await expect(
      finalizeRayenHistoricalDischarges(y.applied, y.repository as never, y.queryClient, true)
    ).rejects.toThrow('firmado');
    expect(y.patch).not.toHaveBeenCalled();
  });

  it('never clears when the historical movement has not reached the server', async () => {
    const x = await setup();
    x.history.discharges = [];
    await expect(
      finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient)
    ).rejects.toThrow('aún no está confirmado');
    expect(x.patch).not.toHaveBeenCalled();
  });

  it('cannot clear a different patient who reused the bed', async () => {
    const x = await setup();
    x.replaceRemote({
      ...x.current(),
      beds: {
        ...x.current().beds,
        R3: { ...buildPatient('R3', 'Otro paciente sintético'), clinicalEpisodeId: 'new-episode' },
      },
    });
    await expect(
      finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient)
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(x.patch).not.toHaveBeenCalled();
  });

  it('binds the staged occupant to the historical movement before authorizing a clear', async () => {
    const x = await setup();
    x.applied.record = {
      ...x.applied.record,
      beds: {
        ...x.applied.record.beds,
        R3: { ...x.applied.record.beds.R3, clinicalEpisodeId: 'different-episode' },
      },
    };
    x.replaceRemote(x.applied.record);
    await expect(
      finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient)
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(x.patch).not.toHaveBeenCalled();
  });

  it('cannot clear a crib added after the census was reviewed', async () => {
    const x = await setup();
    x.replaceRemote({
      ...x.current(),
      beds: {
        ...x.current().beds,
        R3: {
          ...x.current().beds.R3,
          clinicalCrib: { ...buildPatient('R3', 'RN sintético'), clinicalEpisodeId: 'newborn' },
        },
      },
    });
    await expect(
      finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient)
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(x.patch).not.toHaveBeenCalled();
  });

  it('requires the newborn movement again on the fresh historical read', async () => {
    const x = await setup();
    const child = { ...buildPatient('R3', 'RN sintético'), clinicalEpisodeId: 'newborn' };
    x.applied.record.beds.R3 = { ...x.applied.record.beds.R3, clinicalCrib: child };
    const entry = {
      ...x.diff.discharges[0],
      associatedClinicalCrib: {
        clinicalEpisodeId: 'newborn',
        patientName: child.patientName,
        rut: child.rut,
      },
    };
    x.applied.deferredHistoricalDischarges = [entry];
    x.history.beds = { ...x.applied.record.beds };
    const withNewborn = {
      ...x.history,
      discharges: [
        ...x.history.discharges,
        buildDischarge(child, { ...entry, encounterId: 'newborn' }, x.history, {
          idFactory: () => 'newborn-movement',
          now: new Date(),
          syncRunId: 'test',
        }),
      ],
    };
    x.repository.getAuthoritativeForDate.mockResolvedValueOnce(withNewborn);
    // The next authoritative read contains only the parent movement.
    await expect(
      finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient, true)
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(x.patch).not.toHaveBeenCalled();
  });

  it('does not mistake a concurrent bed move for an already completed clear', async () => {
    const x = await setup();
    x.replaceRemote({
      ...x.current(),
      beds: {
        ...x.current().beds,
        R4: { ...x.current().beds.R3, bedId: 'R4' },
        R3: { ...EMPTY_PATIENT, bedId: 'R3' },
      },
    });
    await expect(
      finalizeRayenHistoricalDischarges(x.applied, x.repository as never, x.queryClient)
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(x.patch).not.toHaveBeenCalled();
  });

  it('is idempotent after an accepted clear whose response was lost', async () => {
    const x = await setup();
    x.replaceRemote({
      ...x.current(),
      beds: { ...x.current().beds, R3: { ...EMPTY_PATIENT, bedId: 'R3' } },
    });
    const finished = await finalizeRayenHistoricalDischarges(
      x.applied,
      x.repository as never,
      x.queryClient
    );
    expect(x.patch).not.toHaveBeenCalled();
    expect(finished.deferredHistoricalDischarges).toEqual([]);
  });
});
