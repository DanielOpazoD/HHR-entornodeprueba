import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  runClinicalFill,
  type ClinicalFillDeps,
  type EgresoReportRow,
  type RayenHistoryScaleEvent,
} from '@/features/rayen-import';
import { buildStructuralReviewEvidence } from '@/features/rayen-import/domain/clinicalStageResolution';
import {
  presentRayenSyncOutcome,
  presentRayenSyncRecovery,
} from '@/features/rayen-import/components/rayenSyncPresentation';
import { prepareRayenSyncTemporalContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import { resolveConfirmedRayenCensusHandoff } from '@/features/rayen-import/hooks/rayenCensusPersistenceGuard';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import { applyPatches } from '@/utils/patchUtils';
import {
  bradenHistoryEvent,
  captureFor,
  CURRENT_CLINICAL_DAY,
  emptyRecordFor,
  patientAt,
  receiveCorrelatedCapture,
  REPLAY_NOW,
  type SyntheticRayenCapture,
  syntheticEncounter,
  verifiedShortStayDischarge,
  vitalSignsForm,
} from './deterministicClinicalReplay.fixtures';

interface ReplayEvidence {
  historyByEpisode?: Record<string, RayenHistoryScaleEvent[]>;
  formsByEpisode?: Record<string, unknown[]>;
  formsErrorByEpisode?: Record<string, string>;
}

interface ReplayResult {
  record: DailyRecord;
  target: Awaited<ReturnType<typeof prepareRayenSyncTemporalContext>>['target'];
  structural: ReturnType<typeof applyCensusImportDiff>;
  clinical: Awaited<ReturnType<typeof runClinicalFill>>;
  clinicalWrites: number;
  terminalEvent: NonNullable<DailyRecord['rayenSyncHistory']>[number];
  presentation: ReturnType<typeof presentRayenSyncOutcome>;
  recovery: ReturnType<typeof presentRayenSyncRecovery>;
}

let runSequence = 0;

const replay = async (
  current: DailyRecord,
  capture: SyntheticRayenCapture,
  evidence: ReplayEvidence = {},
  now = REPLAY_NOW
): Promise<ReplayResult> => {
  const runId = `synthetic-replay-${++runSequence}`;
  const { snapshot, bundle } = receiveCorrelatedCapture(capture);
  let stored = current;
  const currentRecordRef: { current: DailyRecord } = { current: stored };
  const persistPatch = async (patch: DailyRecordPatch): Promise<void> => {
    stored = DailyRecordSchema.parse(
      JSON.parse(
        JSON.stringify(prepareDailyRecordForPersistence(applyPatches(stored, patch), current.date))
      )
    );
    currentRecordRef.current = stored;
  };
  let auditClockTick = 0;
  const audit = renderHook(() =>
    useRayenSyncAudit({
      currentRecordRef,
      patchDailyRecord: persistPatch,
      actor: 'Operador sintético',
      now: () => new Date(now.getTime() + auditClockTick++ * 1_000),
      createId: () => runId,
    })
  );
  const run = audit.result.current.startRun(undefined, undefined, {
    mode: 'preview',
    revision: 1,
    clinicalBatchMode: 'shadow',
  });
  const prepared = await prepareRayenSyncTemporalContext({
    displayedRecord: current,
    runId,
    loadFreshRecord: async () => current,
    now: () => now,
  });
  const reference = new Date(snapshot.capturedAt);
  const planned = reconcileCensus(prepared.record, snapshot, { reference });
  const diff =
    bundle.egresoRows.length > 0
      ? applyEgresoReport(planned, bundle.egresoRows, prepared.record)
      : planned;
  let movementSequence = 0;
  const structural = applyCensusImportDiff(prepared.record, diff, {
    idFactory: () => `${runId}-movement-${++movementSequence}`,
    now: reference,
    actor: 'Operador sintético',
    syncRunId: runId,
  });
  const applied = audit.result.current.applyRunToRecord(structural.record, diff);
  const confirmed = prepareDailyRecordForPersistence(applied.record, prepared.selectedDate);
  stored = DailyRecordSchema.parse(JSON.parse(JSON.stringify(confirmed)));
  currentRecordRef.current = stored;
  const handoff = resolveConfirmedRayenCensusHandoff(
    {
      record: stored,
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
        confirmedRecord: stored,
      },
    },
    { date: prepared.selectedDate, clinicalDay: prepared.target.clinicalDay, runId, diff }
  );
  const applyPatch = vi.fn(async (patch: DailyRecordPatch) => {
    await persistPatch(patch);
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
      error: evidence.formsErrorByEpisode?.[episodeId],
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
  await audit.result.current.completeRun(handoff.record, clinical, null, run.id, {
    structuralReview: buildStructuralReviewEvidence(handoff),
  });
  const persistedTerminalEvent = stored.rayenSyncHistory?.find(event => event.id === runId);
  if (!persistedTerminalEvent) {
    throw new Error('El cierre terminal no sobrevivió a la persistencia del censo.');
  }
  audit.unmount();
  return {
    record: stored,
    target: prepared.target,
    structural,
    clinical,
    clinicalWrites: applyPatch.mock.calls.length,
    terminalEvent: persistedTerminalEvent,
    presentation: presentRayenSyncOutcome(persistedTerminalEvent),
    recovery: presentRayenSyncRecovery(persistedTerminalEvent, 'ready'),
  };
};

describe('deterministic sanitized clinical replay', () => {
  it('enriches a new admission with vitals and Braden in its first synchronization', async () => {
    const admission = syntheticEncounter('admission');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      {
        historyByEpisode: { [admission.encounterId]: [bradenHistoryEvent(CURRENT_CLINICAL_DAY)] },
        formsByEpisode: { [admission.encounterId]: [vitalSignsForm(CURRENT_CLINICAL_DAY, 1001)] },
      }
    );

    expect(result.structural.applied.admissions).toBe(1);
    expect(result.clinical).toMatchObject({ total: 1, patched: 1, errors: [] });
    expect(result.terminalEvent).toMatchObject({
      status: 'complete',
      coverage: { total: 1, completed: 1, errors: 0, sourceErrors: 0 },
    });
    expect(result.presentation).toEqual({
      label: 'Completa',
      detail: null,
      tone: 'success',
      unresolved: false,
    });
    expect(result.recovery).toBeNull();
    expect(result.record.rayenSync).toMatchObject({
      runId: result.terminalEvent.id,
      status: 'complete',
    });
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
      const result = await replay(emptyRecordFor(date), captureFor(date, [admission]), {
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

  it('persists a typed clinical failure and offers only the safe clinical retry', async () => {
    const admission = syntheticEncounter('admission');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      {
        formsErrorByEpisode: {
          [admission.encounterId]: 'Detalle externo deliberadamente cambiante.',
        },
      }
    );

    expect(result.terminalEvent).toMatchObject({
      status: 'partial',
      structuralReview: { structureConfirmed: true, isolatedConflicts: 0 },
      coverage: {
        total: 1,
        completed: 0,
        errors: 1,
        sourceErrors: 2,
        issues: [
          { bedId: 'H1C1', source: 'scales', reason: 'source_unavailable' },
          { bedId: 'H1C1', source: 'vitals', reason: 'source_unavailable' },
        ],
      },
    });
    expect(result.presentation).toMatchObject({
      label: 'Parcial',
      detail: '1 paciente no se pudo completar · Fuente clínica incompleta',
      tone: 'warning',
      unresolved: true,
    });
    expect(result.recovery).toMatchObject({
      title: 'Información clínica pendiente',
      action: 'retry_clinical',
      actionLabel: 'Reintentar información clínica',
    });
    expect(result.record.rayenSync).toMatchObject({
      runId: result.terminalEvent.id,
      status: 'partial',
    });
    expect(
      result.record.rayenSyncHistory?.filter(event => event.id === result.terminalEvent.id)
    ).toHaveLength(1);
    expect(JSON.stringify(result.terminalEvent)).not.toContain(
      'Detalle externo deliberadamente cambiante.'
    );
  });

  it('keeps an isolated structural conflict visible after the clinical stage settles', async () => {
    const occupant = syntheticEncounter('departing');
    const incoming = syntheticEncounter('incoming');
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY, {
        beds: { H1C1: patientAt(occupant, 'H1C1') },
      }),
      captureFor(CURRENT_CLINICAL_DAY, [incoming])
    );

    expect(result.terminalEvent).toMatchObject({
      status: 'partial',
      coverage: { total: 0, completed: 0, errors: 0, sourceErrors: 0 },
      structuralReview: {
        structureConfirmed: true,
        isolatedConflicts: 1,
        issues: [{ bedId: 'H1C1', reason: 'occupied-local-bed' }],
      },
    });
    expect(result.presentation).toMatchObject({
      label: 'Parcial',
      detail: '1 cambio del censo no se aplicó',
      tone: 'warning',
      unresolved: true,
    });
    expect(result.recovery).toMatchObject({
      title: 'Censo pendiente de revisión',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
    });
  });

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
    const result = await replay(current, captureFor(CURRENT_CLINICAL_DAY, [readmission]));

    expect(result.structural.applied.admissions).toBe(1);
    expect(result.record.beds.H1C1.clinicalEpisodeId).toBe('episode-readmission-new');
  });

  it('records a verified brief hospitalization that was already discharged before capture', async () => {
    const result = await replay(
      emptyRecordFor(CURRENT_CLINICAL_DAY),
      captureFor(CURRENT_CLINICAL_DAY, [], [verifiedShortStayDischarge()])
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
      captureFor(CURRENT_CLINICAL_DAY, [mother, newborn])
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
      captureFor(
        CURRENT_CLINICAL_DAY,
        [incoming, moving, { ...departing, hasMedicalDischarge: true }],
        [egreso]
      )
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
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
      evidence
    );
    const second = await replay(
      first.record,
      captureFor(CURRENT_CLINICAL_DAY, [admission]),
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
    expect(second.terminalEvent.status).toBe('complete');
    expect(second.presentation.unresolved).toBe(false);
    expect(second.record.beds.H1C1.vitalSignsHistory).toHaveLength(1);
    expect(second.record.beds.H1C1.evaluationScores?.history).toHaveLength(1);
  });
});
