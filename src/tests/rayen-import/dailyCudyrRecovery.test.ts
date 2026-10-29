// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { captureCudyrMonthlyReport } from '@/services/cudyr/cudyrMonthlyReportCapture';
import { parseCudyrSupplementBinary } from '@/services/cudyr/cudyrSupplementBinary';
import { recoverDailyCudyrGap, planDailyCudyrGaps } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import {
  resolveHistoricalCudyrPatch,
  resolveHistoricalCudyrBatchOperation,
} from '@/features/rayen-import/domain/historicalCudyrPatch';
import { rebuildClinicalEnrichmentOperations } from '@/features/rayen-import/domain/rebuildClinicalEnrichmentOperations';
import { applyPatches } from '@/utils/patchUtils';
import { DailyRecordSchema } from '@/schemas/zodSchemas';
import { buildScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';

import {
  now,
  patient,
  historicalDay,
  currentDay,
  reportBytes,
  parsedSource,
  documentary,
} from './dailyCudyrRecovery.fixtures';

describe('daily documentary CUDYR recovery', () => {
  it.each(['2026-10-26', '2026-10-27'])(
    'persists the prior night when selecting %s after discharge, using real XLS bytes',
    async selectedDate => {
      let previous = historicalDay();
      const current = currentDay();
      current.beds = {
        R1: {
          ...patient(),
          patientName: 'Otro Paciente Sintético',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'synthetic-episode-b',
        },
      };
      const originalCurrent = structuredClone(current);
      const bytes = new Uint8Array(reportBytes());
      const fetchReport = vi.fn(async (month: string) => ({
        month,
        base64: btoa(String.fromCharCode(...bytes)),
        capturedAt: now().toISOString(),
      }));
      const readFile = async (file: File) => {
        const parsed = parseCudyrSupplementBinary(await file.arrayBuffer());
        if (!parsed.ok) throw new Error('Invalid synthetic source');
        return {
          report: parsed.report,
          file: { name: file.name, base64: 'synthetic-bytes' },
          operationId: crypto.randomUUID(),
        };
      };
      const save = vi.fn(async () => ({
        persisted: true,
        captureStored: true,
        id: 'synthetic-content-id',
        status: 'ok',
      }));
      const capture: typeof captureCudyrMonthlyReport = (month, signal, check) =>
        captureCudyrMonthlyReport(month, signal, check, { fetchReport, readFile, save });
      const reader = createDailyCudyrRecoveryReader({
        signal: new AbortController().signal,
        now,
        loadDay: async date =>
          date === previous.date ? previous : date === current.date ? current : null,
        capture,
      });
      const selected = () => (selectedDate === previous.date ? previous : current);
      const deps: ClinicalFillDeps = {
        recoverMissingCudyr: reader,
        fetchCudyrCategories: async () => ({
          source: 'gestion_camas',
          historyAvailable: true,
          captureContract: 1,
          observedEpisodeIds: [],
          metadataStatus: 'complete',
          items: [
            {
              encId: 'synthetic-episode-b',
              source: 'gestion_camas',
              crdValue: 'C1',
              crdDateTime: '2026-10-27T03:00:00-05:00',
            },
          ],
        }),
        fetchDeviceReport: vi.fn(),
        extractDeviceItems: vi.fn(),
        fetchHistoryScales: vi.fn(),
        fetchScalesForms: vi.fn(),
        pendingReads: {
          [patient().clinicalEpisodeId]: ['cudyr'],
          'synthetic-episode-b': ['cudyr'],
        },
        applyPatch: async patch => {
          previous = applyPatches(previous, patch);
        },
        applyHistoricalCudyrBatch: async (date, items) => {
          expect(date).toBe(previous.date);
          return items.map(item => {
            const resolution = resolveHistoricalCudyrPatch(
              previous,
              item.clinicalEpisodeId,
              item.cudyr
            );
            if (resolution.patch) previous = applyPatches(previous, resolution.patch);
            return {
              clinicalEpisodeId: item.clinicalEpisodeId,
              persisted: resolution.matched,
              ...(!resolution.matched ? { applicable: false } : {}),
              changed: Boolean(resolution.patch),
            };
          });
        },
        now,
        createId: () => 'synthetic-recovery',
      };
      const summary = await runClinicalFill(selected(), selectedDate, deps);
      expect(summary.errors).toEqual([]);
      const reread = DailyRecordSchema.parse(previous);
      expect(reread.beds.R1.evaluationScores?.cudyr).toEqual(documentary());
      expect(
        importedCudyrBelongsToCensus(reread.beds.R1.evaluationScores?.cudyr, previous.date)
      ).toBe(true);
      expect(reread.beds.R1.evaluationScores?.cudyr).not.toHaveProperty('recordedAt');
      expect(buildScoresCellModel(reread.beds.R1, previous.date).cudyr?.category).toBe('C2');
      expect(current).toEqual(originalCurrent);
      expect(fetchReport).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledOnce();
      await runClinicalFill(selected(), selectedDate, deps);
      expect(fetchReport).toHaveBeenCalledOnce();
      expect(previous.beds.R1.evaluationScores?.cudyr).toEqual(documentary());
    }
  );
  it('shares one monthly report for multiple gaps', async () => {
    const record = historicalDay();
    const second = {
      ...patient(),
      bedId: 'R2',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'synthetic-episode-b',
    };
    record.beds.R2 = second;
    const report = parsedSource();
    report.report.patients.push({
      ...report.report.patients[0],
      sourceRow: 6,
      document: second.rut,
    });
    const capture = vi.fn(async () => report);
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture,
    });
    const result = await reader(record, [patient().clinicalEpisodeId, second.clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(result.current.size).toBe(2);
  });
  it.each([
    'failed',
    'missing',
    'blank',
    'duplicate',
    'ambiguous episode',
    'maternal',
    'passport',
    'cancelled',
  ])('keeps %s evidence unresolved without manufacturing an application', async kind => {
    const record = historicalDay();
    const report = parsedSource();
    const controller = new AbortController();
    if (kind === 'blank')
      report.report.patients[0].days[26] = {
        ...report.report.patients[0].days[26],
        category: null,
        state: 'blank',
      };
    if (kind === 'missing') report.report.patients = [];
    if (kind === 'duplicate')
      report.report.patients.push(structuredClone(report.report.patients[0]));
    if (kind === 'ambiguous episode')
      record.beds.R2 = { ...patient(), clinicalEpisodeId: 'different-readmission' };
    if (kind === 'maternal') record.beds.R1.neonatalMaternalRut = patient().rut;
    if (kind === 'passport') record.beds.R1.documentType = 'Pasaporte';
    const reader = createDailyCudyrRecoveryReader({
      signal: controller.signal,
      now,
      loadDay: async () => null,
      capture: async () => {
        if (kind === 'cancelled') controller.abort();
        if (kind === 'failed') throw new Error('synthetic offline');
        return report;
      },
    });
    if (kind === 'cancelled')
      await expect(
        reader(record, [patient().clinicalEpisodeId], { map: new Map(), historyAvailable: true })
      ).rejects.toThrow();
    else {
      const result = await reader(record, [patient().clinicalEpisodeId], {
        map: new Map(),
        historyAvailable: true,
      });
      expect(result.current.size).toBe(0);
      expect(result.previous).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
    expect(record.beds.R1.evaluationScores?.cudyr).toBeUndefined();
  });
  it.each(['2026-10-31', '2026-12-31'])('uses the next calendar date at the %s boundary', date => {
    const record = { ...historicalDay(), date };
    const gaps = planDailyCudyrGaps(
      [record],
      [patient().clinicalEpisodeId],
      { map: new Map(), historyAvailable: true },
      new Date('2027-01-03T20:00:00-05:00')
    );
    expect(gaps[0].sourceDate).toBe(date === '2026-10-31' ? '2026-11-01' : '2027-01-01');
  });
  it('does not request a report during an open night or for a protected/accepted day', () => {
    for (const record of [
      { ...historicalDay(), cudyrLocked: true },
      { ...historicalDay(), cudyrCompletedAt: now().toISOString() },
      {
        ...historicalDay(),
        beds: { R1: { ...patient(), evaluationScores: { cudyr: documentary() } } },
      },
    ])
      expect(
        planDailyCudyrGaps(
          [record],
          [patient().clinicalEpisodeId],
          { map: new Map(), historyAvailable: true },
          now()
        )
      ).toEqual([]);
    expect(
      planDailyCudyrGaps(
        [historicalDay()],
        [patient().clinicalEpisodeId],
        { map: new Map(), historyAvailable: true },
        new Date('2026-10-27T03:00:00-05:00')
      )
    ).toEqual([]);
  });
  it.each(['accepted', 'admin', 'legacy'])(
    'preserves a concurrent %s CUDYR on every historical rebuild',
    kind => {
      const record = historicalDay();
      if (kind === 'legacy')
        record.beds.R1.cudyr = {
          changeClothes: 2,
          mobilization: 0,
          feeding: 0,
          elimination: 0,
          psychosocial: 0,
          surveillance: 0,
          vitalSigns: 0,
          fluidBalance: 0,
          oxygenTherapy: 0,
          airway: 0,
          proInterventions: 0,
          skinCare: 0,
          pharmacology: 0,
          invasiveElements: 0,
        };
      else
        record.beds.R1.evaluationScores = {
          cudyr: {
            category: 'D1',
            recordedDate: record.date,
            source: kind === 'admin' ? 'HHR · ajuste administrativo' : 'Eloísa · Gestión de Camas',
          },
        };
      expect(
        resolveHistoricalCudyrPatch(record, patient().clinicalEpisodeId, documentary()).patch
      ).toBeNull();
      expect(
        resolveHistoricalCudyrBatchOperation(record, patient().clinicalEpisodeId, documentary())
          .operation
      ).toBeNull();
    }
  );
  it('rejects documentary writes after patient replacement, duplicate episode or locking', () => {
    const score = documentary();
    const record = historicalDay();
    record.beds.R1.rut = '22.222.222-2';
    expect(() => resolveHistoricalCudyrPatch(record, patient().clinicalEpisodeId, score)).toThrow(
      /evidencia/
    );
    const duplicate = historicalDay();
    duplicate.beds.R2 = patient();
    expect(resolveHistoricalCudyrPatch(duplicate, patient().clinicalEpisodeId, score).matched).toBe(
      false
    );
    expect(() =>
      resolveHistoricalCudyrPatch(
        { ...historicalDay(), cudyrLocked: true },
        patient().clinicalEpisodeId,
        score
      )
    ).toThrow(/protegido/);
    const base = historicalDay();
    const current = historicalDay();
    current.beds.R1.evaluationScores = { cudyr: { ...score, category: 'D1' } };
    expect(() =>
      rebuildClinicalEnrichmentOperations({
        baseRecord: base,
        currentRecord: current,
        operations: [
          {
            target: {
              censusDate: base.date,
              bedId: 'R1',
              clinicalEpisodeId: patient().clinicalEpisodeId,
            },
            patch: { 'beds.R1.evaluationScores': { cudyr: score } },
          },
        ],
      })
    ).toThrow(/registrado/);
  });
  it.each(['sparse movement', 'snapshot crib'])('rejects a competing identity in a %s', kind => {
    const record = historicalDay();
    const movement = currentDay().discharges[0];
    record.discharges = [
      { ...movement, clinicalEpisodeId: 'different-readmission', originalData: undefined },
    ];
    if (kind === 'snapshot crib')
      record.discharges = [
        {
          ...movement,
          clinicalEpisodeId: 'synthetic-mother',
          rut: '22.222.222-2',
          patientName: 'Madre Sintética',
          originalData: {
            ...patient(),
            clinicalEpisodeId: 'synthetic-mother',
            rut: '22.222.222-2',
            patientName: 'Madre Sintética',
            clinicalCrib: { ...patient(), clinicalEpisodeId: 'synthetic-newborn' },
          },
        },
      ];
    const target = {
      clinicalEpisodeId: patient().clinicalEpisodeId,
      date: record.date,
      sourceDate: '2026-10-27',
      patient: record.beds.R1,
    };
    expect(recoverDailyCudyrGap(target, [record], parsedSource())).toEqual({
      kind: 'attribution_unreliable',
    });
    expect(() =>
      resolveHistoricalCudyrPatch(record, patient().clinicalEpisodeId, documentary())
    ).toThrow(/evidencia/);
  });
  it.each([false, true])(
    'recovers the prior night when unusable live fallback has historyAvailable=%s',
    async historyAvailable => {
      const prior = historicalDay();
      const capture = vi.fn(async () => parsedSource());
      const read = createDailyCudyrRecoveryReader({
        signal: new AbortController().signal,
        now,
        loadDay: async date => (date === prior.date ? prior : null),
        capture,
      });
      const result = await read(currentDay(), [patient().clinicalEpisodeId], {
        historyAvailable,
        map: new Map([
          [
            patient().clinicalEpisodeId,
            {
              encId: patient().clinicalEpisodeId,
              source: 'ficha_medico',
              crdValue: 'C1',
              crdDateTime: '2026-10-27T03:00:00-05:00',
            },
          ],
        ]),
      });
      expect(capture).toHaveBeenCalledOnce();
      expect(result.previous).toEqual([
        { clinicalEpisodeId: patient().clinicalEpisodeId, cudyr: documentary() },
      ]);
      expect(result.errors).toEqual([]);
    }
  );
  it('checks the following calendar-day census before recovering a closed selected night', async () => {
    const record = historicalDay();
    const next = currentDay();
    next.beds.R2 = { ...patient(), clinicalEpisodeId: 'readmission-on-application-day' };
    const capture = vi.fn(async () => parsedSource());
    const loadDay = vi.fn(async (date: string) => (date === next.date ? next : null));
    const reader = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay,
      capture,
    });
    const result = await reader(record, [patient().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(loadDay).toHaveBeenCalledWith('2026-10-27');
    expect(result.current.size).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
  it('reads the application-day identity without turning it into a third write destination', async () => {
    const record = historicalDay();
    const next = { ...historicalDay(), date: '2026-10-27' };
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now: () => new Date('2026-10-28T20:00:00-05:00'),
      loadDay: async date => (date === next.date ? next : null),
      capture: async () => parsedSource(),
    });
    const result = await read(record, [patient().clinicalEpisodeId], {
      map: new Map(),
      historyAvailable: true,
    });
    expect(result.current.size).toBe(1);
    expect(result.previous).toEqual([]);
    expect(result.errors).toEqual([]);
  });
  it('keeps an accepted documentary CUDYR while rebuilding an adjacent scale update', () => {
    const base = historicalDay();
    const score = documentary();
    base.beds.R1.evaluationScores = { cudyr: score };
    const current = structuredClone(base);
    current.beds.R2 = { ...patient(), clinicalEpisodeId: 'later-readmission' };
    const braden = {
      code: 'BRADEN' as const,
      name: 'Braden',
      encounterEventId: 1,
      total: 18,
      severity: 'Bajo',
      recordedDate: base.date,
      recordedAt: `${base.date}T15:00:00-05:00`,
    };
    const result = rebuildClinicalEnrichmentOperations({
      baseRecord: base,
      currentRecord: current,
      operations: [
        {
          target: {
            censusDate: base.date,
            bedId: 'R1',
            clinicalEpisodeId: patient().clinicalEpisodeId,
          },
          patch: { 'beds.R1.evaluationScores': { cudyr: score, braden } },
        },
      ],
    });
    expect(result[0].patch['beds.R1.evaluationScores']).toEqual({ cudyr: score, braden });
  });
});
