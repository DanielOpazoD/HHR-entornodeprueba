import { describe, expect, it, vi } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  runClinicalFill,
  type ClinicalFillDeps,
  type EgresoReportRow,
  type RayenCensusSnapshot,
  type RayenHistoryScaleEvent,
} from '@/features/rayen-import';
import {
  buildAppliedRayenSyncEvent,
  upsertRayenSyncEvent,
  type RayenSyncRun,
} from '@/features/rayen-import/domain/rayenSyncHistory';
import { prepareRayenSyncTemporalContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import {
  bradenHistoryEvent,
  CURRENT_CLINICAL_DAY,
  emptyRecordFor,
  patientAt,
  REPLAY_NOW,
  snapshotFor,
  syntheticEncounter,
  verifiedShortStayDischarge,
  vitalSignsForm,
} from './deterministicClinicalReplay.fixtures';

interface ReplayEvidence {
  historyByEpisode?: Record<string, RayenHistoryScaleEvent[]>;
  formsByEpisode?: Record<string, unknown[]>;
  egresos?: EgresoReportRow[];
}

interface ReplayResult {
  record: DailyRecord;
  target: Awaited<ReturnType<typeof prepareRayenSyncTemporalContext>>['target'];
  structural: ReturnType<typeof applyCensusImportDiff>;
  clinical: Awaited<ReturnType<typeof runClinicalFill>>;
  clinicalWrites: number;
}

let runSequence = 0;

const replay = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  evidence: ReplayEvidence = {},
  now = REPLAY_NOW
): Promise<ReplayResult> => {
  const runId = `synthetic-replay-${++runSequence}`;
  const prepared = await prepareRayenSyncTemporalContext({
    displayedRecord: current,
    runId,
    loadFreshRecord: async () => current,
    now: () => now,
  });
  const reference = new Date(snapshot.capturedAt);
  const planned = reconcileCensus(prepared.record, snapshot, { reference });
  const diff = evidence.egresos
    ? applyEgresoReport(planned, evidence.egresos, prepared.record)
    : planned;
  let movementSequence = 0;
  const structural = applyCensusImportDiff(prepared.record, diff, {
    idFactory: () => `${runId}-movement-${++movementSequence}`,
    now: reference,
    actor: 'Operador sintético',
    syncRunId: runId,
  });
  const run: RayenSyncRun = {
    id: runId,
    sourceDate: prepared.selectedDate,
    startedAt: prepared.preparedAt,
    by: 'Operador sintético',
    policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'shadow' },
  };
  const completedAt = new Date(now.getTime() + 1_000).toISOString();
  const appliedEvent = buildAppliedRayenSyncEvent(run, diff, completedAt);
  const confirmed = prepareDailyRecordForPersistence(
    {
      ...structural.record,
      rayenSync: { at: completedAt, by: run.by, runId, status: 'applied' },
      rayenSyncHistory: upsertRayenSyncEvent(structural.record.rayenSyncHistory, appliedEvent),
      lastUpdated: completedAt,
    },
    prepared.selectedDate
  );
  const handoff = resolveConfirmedRayenCensusHandoff(
    {
      record: confirmed,
      result: {
        date: prepared.selectedDate,
        outcome: 'clean',
        savedLocally: true,
        savedRemotely: true,
        queuedForRetry: false,
        autoMerged: false,
        consistencyState: 'persisted_and_synced',
        sourceOfTruth: 'remote',
        retryability: 'not_applicable',
        recoveryAction: 'none',
        conflictSummary: null,
        observabilityTags: ['synthetic_replay'],
        repairApplied: false,
        confirmedRecord: confirmed,
      },
    },
    { date: prepared.selectedDate, clinicalDay: prepared.target.clinicalDay, runId, diff }
  );
  let stored = handoff.record;
  const applyPatch = vi.fn(async (patch: DailyRecordPatch) => {
    stored = prepareDailyRecordForPersistence(applyPatches(stored, patch), prepared.selectedDate);
  });
  const deps: ClinicalFillDeps = {
    fetchDeviceReport: vi.fn().mockResolvedValue({ base64: '' }),
    extractDeviceItems: vi.fn().mockResolvedValue([]),
    fetchHistoryScales: vi.fn(async (episodeId: string) => ({
      events: evidence.historyByEpisode?.[episodeId] ?? [],
      nursingActivity: [],
      effectiveLookbackDays: 14,
      coverageWindowStartIsoDay: prepared.selectedDate,
      coverageWindowEndIsoDay: prepared.target.clinicalDay,
    })),
    fetchScalesForms: vi.fn(async (episodeId: string) => ({
      forms: evidence.formsByEpisode?.[episodeId] ?? [],
    })),
    fetchCudyrCategories: vi.fn().mockResolvedValue({
      items: [],
      source: 'gestion_camas',
      historyAvailable: true,
    }),
    applyPatch,
    allowedClinicalEpisodeIds: handoff.safeClinicalEpisodeIds,
    now: () => now,
    createId: () => `${runId}-clinical`,
  };
  const clinical = await runClinicalFill(handoff.record, handoff.clinicalDay, deps);
  return {
    record: stored,
    target: prepared.target,
    structural,
    clinical,
    clinicalWrites: applyPatch.mock.calls.length,
  };
};

describe('deterministic sanitized clinical replay', () => {
  it('enriches a new admission with vitals and Braden in its first synchronization', async () => {
    const admission = syntheticEncounter('admission');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      snapshotFor(CURRENT_CLINICAL_DAY, [admission]),
      {
        historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(CURRENT_CLINICAL_DAY)] },
        formsByEpisode: { [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1001)] },
      }
    );

    expect(result.structural.applied.admissions).toBe(1);
    expect(result.clinical).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(result.record.beds.H1C1).toMatchObject({
      clinicalEpisodeId: admission.encounterId,
      vitalSigns: { systolic: 118, diastolic: 72, heartRate: 76, spo2: 98 },
      evaluationScores: { braden: { total: 17 } },
    });
  });

  it.each([
    ['D-1', '2026-08-14', 1],
    ['D-7', '2026-08-08', 7],
  ])(
    'runs the complete %s flow against its frozen historical record',
    async (_label, date, days) => {
      const admission = syntheticEncounter('admission', {
        admissionDatetime: `${date}T10:00:00-06:00`,
      });
      const result = await replay(emptyRecordFor(date), snapshotFor(date, [admission]), {
        historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(date)] },
        formsByEpisode: { [admission.encounterId]: [vitalSignsForm(date, 1100 + days)] },
      });

      expect(result.target).toMatchObject({ kind: 'historical', lookbackDays: days });
      expect(result.record.date).toBe(date);
      expect(result.clinical).toMatchObject({ patched: 1, errors: [] });
      expect(result.record.beds.H1C1).toMatchObject({
        clinicalEpisodeId: admission.encounterId,
        vitalSigns: { systolic: 118, diastolic: 72, heartRate: 76, spo2: 98 },
        evaluationScores: { braden: { total: 17 } },
      });
    }
  );

  it('admits a new clinicalEpisodeId when the same synthetic RUN has an older discharge', async () => {
    const readmission = syntheticEncounter('readmission', {
      encounterId: 'episode-readmission-new',
    });
    const current = emptyRecordFor(CURRENT_CLINICAL_DAY, {
      discharges: [
        {
          id: 'synthetic-old-discharge',
          movementDate: '2026-08-14',
          admissionDate: '2026-08-13',
          bedName: 'H1C1',
          bedId: 'H1C1',
          bedType: 'Cama',
          patientName: 'Caso readmission',
          rut: readmission.run,
          diagnosis: 'Diagnóstico sintético',
          time: '16:00',
          status: 'Vivo',
          clinicalEpisodeId: 'episode-readmission-old',
        },
      ],
    });
    const result = await replay(current, snapshotFor(CURRENT_CLINICAL_DAY, [readmission]));

    expect(result.structural.applied.admissions).toBe(1);
    expect(result.record.beds.H1C1.clinicalEpisodeId).toBe('episode-readmission-new');
  });

  it('records a verified brief hospitalization that was already discharged before capture', async () => {
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      snapshotFor(CURRENT_CLINICAL_DAY, []),
      {
        egresos: [verifiedShortStayDischarge()],
      }
    );

    expect(result.record.discharges).toEqual([
      expect.objectContaining({
        clinicalEpisodeId: 'episode-shortStay',
        status: 'Fallecido',
        admissionDate: CURRENT_CLINICAL_DAY,
        time: '16:30',
      }),
    ]);
    expect(Object.keys(result.record.beds).length).toBeGreaterThan(0);
    expect(Object.values(result.record.beds).every(patient => !patient.rut)).toBe(true);
  });

  it('keeps mother and newborn as two clinical episodes in one principal bed', async () => {
    const mother = syntheticEncounter('mother', { room: 'H5', bed: 'C1' });
    const newborn = syntheticEncounter('newborn', {
      birthDate: CURRENT_CLINICAL_DAY,
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      snapshotFor(CURRENT_CLINICAL_DAY, [mother, newborn])
    );

    expect(result.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: mother.encounterId,
      clinicalCrib: { clinicalEpisodeId: newborn.encounterId, bedMode: 'Cuna' },
    });
    expect(result.clinical.total).toBe(2);
  });

  it('chains a move after discharge and safely reuses both released beds', async () => {
    const departing = syntheticEncounter('departing', { room: 'H2', bed: 'C2' });
    const moving = syntheticEncounter('moving', { room: 'H2', bed: 'C2' });
    const incoming = syntheticEncounter('incoming', { room: 'H1', bed: 'C1' });
    const current = emptyRecordFor(CURRENT_CLINICAL_DAY, {
      beds: {
        H1C1: patientAt({ ...moving, room: 'H1', bed: 'C1' }, 'H1C1'),
        H2C2: patientAt(departing, 'H2C2'),
      },
    });
    const egreso: EgresoReportRow = {
      ...verifiedShortStayDischarge(),
      run: departing.run,
      encounterId: departing.encounterId,
      patientName: 'Caso departing',
      bedLabel: 'H2C2',
      destino: 'Domicilio',
    };
    const result = await replay(
      current,
      snapshotFor(CURRENT_CLINICAL_DAY, [
        incoming,
        moving,
        { ...departing, hasMedicalDischarge: true },
      ]),
      {
        egresos: [egreso],
      }
    );

    expect(result.structural.skipped).toEqual([]);
    expect(result.structural.applied.discharges).toBe(1);
    expect(result.record.beds.H1C1.clinicalEpisodeId).toBe(incoming.encounterId);
    expect(result.record.beds.H2C2.clinicalEpisodeId).toBe(moving.encounterId);
    expect(result.record.discharges).toContainEqual(
      expect.objectContaining({
        clinicalEpisodeId: departing.encounterId,
        status: 'Vivo',
      })
    );
  });

  it('reaches a fixed point: replaying identical evidence creates no duplicates or clinical writes', async () => {
    const admission = syntheticEncounter('admission');
    const evidence = {
      historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(CURRENT_CLINICAL_DAY)] },
      formsByEpisode: { [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1002)] },
    };
    const first = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      snapshotFor(CURRENT_CLINICAL_DAY, [admission]),
      evidence
    );
    const second = await replay(
      first.record,
      snapshotFor(CURRENT_CLINICAL_DAY, [admission]),
      evidence
    );

    expect(second.structural.applied).toEqual({
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
    });
    expect(second.clinical).toMatchObject({ total: 1, patched: 0, errors: [] });
    expect(second.clinicalWrites).toBe(0);
    expect(second.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
    expect(second.record.beds.H1C1.evaluationScores?.history).toHaveLength(1);
  });
});
