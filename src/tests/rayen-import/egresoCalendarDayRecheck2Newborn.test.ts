// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  encounter,
  newborn,
  recordWith,
  snapshotOf,
  dischargeRow,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { applyCensusImportDiff } from '@/features/rayen-import';
import {
  getRecordForDateStrict,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
it('el plan completo trata el RN con día civil inválido como en main, en ambos órdenes', async () => {
  const mother = encounter({ encounterId: '71001' }),
    baby = { ...newborn(), encounterId: '71002' };
  const base = recordWith(mother, baby);
  const valid = { ...dischargeRow(baby), fechaEgreso: '08-07-2026 13:00' };
  const invalid = {
    ...dischargeRow(baby),
    correctedTime: '13:00',
    correctedDay: base.date,
    correctedCalendarDay: '2026-07-32',
    exactEpisodeVerification: 'verified' as const,
  };
  const snapshot = { ...snapshotOf([]), isComplete: true };
  for (const pair of [
    [valid, invalid],
    [invalid, valid],
  ]) {
    const { diff } = await prepareRayenStructuralPlan({
      baseRecord: base,
      planningSnapshot: snapshot,
      bundle: {
        id: 'sonda',
        startedAt: snapshot.capturedAt,
        completedAt: snapshot.capturedAt,
        facilityId: 1342,
        dateStart: base.date,
        dateEnd: base.date,
        fichaMedicoCapturedAt: snapshot.capturedAt,
        gestionCamasCapturedAt: snapshot.capturedAt,
        sourceSkewMs: 0,
        egresoRows: [dischargeRow(mother), ...pair],
      },
      isHistoricalDay: false,
      reportDate: base.date,
      isAdmin: false,
      invalidEpisodeIds: new Set(),
      counters: { requests: 0, cacheHits: 0, timeouts: 0 },
      measureEvidence: async op => op(),
      dailyRecord: {
        getAuthoritativeForDate: async () => null,
      } as unknown as DailyRecordRepositoryPort,
      evidenceClient: {
        lookupEgresos: async () => [],
        lookupHospitalizations: async () => ({ ok: false }),
        fetchPatientFlowReport: async () => ({ base64: '' }),
        fetchStatisticalDischarge: async () => ({ base64: '' }),
      },
    });
    let id = 0;
    const applied = applyCensusImportDiff(base, diff, {
      idFactory: () => String(++id),
      now: REFERENCE,
      syncRunId: 'prueba',
    });
    expect(await saveRecordStrict(applied.record)).toMatchObject({ ok: true });
    const saved = await getRecordForDateStrict(base.date);
    const events = saved?.discharges.map(m => [m.clinicalEpisodeId, m.time, m.isNested]);
    const occupied = Object.values(saved?.beds ?? {}).some(b =>
      [b.clinicalEpisodeId, b.clinicalCrib?.clinicalEpisodeId].includes(baby.encounterId)
    );
    expect({ events, occupied, conflicts: diff.conflicts.length }).toEqual({
      events: [
        ['71001', '10:00', false],
        ['71002', '13:00', true],
      ],
      occupied: false,
      conflicts: 0,
    });
  }
});
