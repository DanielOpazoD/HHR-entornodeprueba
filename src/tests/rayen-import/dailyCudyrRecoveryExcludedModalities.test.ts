// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { runClinicalFill } from '@/features/rayen-import/clinicalFillRunner';
import type { ClinicalFillDeps } from '@/features/rayen-import/contracts/clinicalFillContracts';
import { resolveClinicalStageResult } from '@/features/rayen-import/domain/clinicalStageResolution';
import { createDailyCudyrRecoveryReader } from '@/features/rayen-import/hooks/dailyCudyrRecoveryReader';
import { planDailyCudyrGaps, recoverDailyCudyrGap } from '@/services/cudyr/dailyCudyrRecoveryPlan';
import { applyPatches } from '@/utils/patchUtils';
import {
  currentDay,
  documentary,
  historicalDay,
  now,
  parsedSource,
  patient,
} from './dailyCudyrRecovery.fixtures';

const emptySource = () => ({ map: new Map(), historyAvailable: true });
const plan = (record: ReturnType<typeof historicalDay>, episode = patient().clinicalEpisodeId) =>
  planDailyCudyrGaps([record], [episode], emptySource(), now());
const excludedPlacements = [
  { label: 'independent crib', bedId: 'R1', fields: { bedMode: 'Cuna' } },
  { label: 'CMA bed', bedId: 'CMA1', fields: {} },
  { label: 'CMA bed name', bedId: 'R1', fields: { bedName: 'CMA Hospitalizados' } },
  { label: 'CMA service', bedId: 'R1', fields: { location: 'CMA Pabellón' } },
  { label: 'CMA recovery', bedId: 'R1', fields: { location: 'Quirúrgica Indiferenciada' } },
  { label: 'UEA bed', bedId: 'B1UEA', fields: {} },
  { label: 'UEA bed name', bedId: 'R1', fields: { bedName: 'UEA' } },
  { label: 'UEA service', bedId: 'unknown-bed', fields: { location: 'UEA' } },
  { label: 'emergency box', bedId: 'BOX1', fields: {} },
] satisfies { label: string; bedId: string; fields: Partial<PatientData> }[];

const companionDay = (bedMode: PatientData['bedMode'] = 'Cuna') => {
  const record = historicalDay();
  record.beds.R1.clinicalCrib = {
    ...patient(),
    bedId: 'C-R1',
    bedMode,
    clinicalEpisodeId: 'synthetic-companion-crib',
    patientName: 'RN Sintético Acompañante',
    rut: '',
    age: '0',
  };
  return record;
};

describe('daily documentary CUDYR recovery candidates retain their destination placement', () => {
  it.each(['Cuna', 'Cama'] as const)(
    'does not plan a nested companion even when its stored bedMode is %s',
    bedMode => {
      const record = companionDay(bedMode);
      const before = structuredClone(record);
      expect(plan(record, 'synthetic-companion-crib')).toEqual([]);
      expect(record).toEqual(before);
    }
  );

  it('keeps the hospital deadline while excluding only the unidentifiable crib after closure', () => {
    const beforeClosure = new Date('2026-10-27T11:59:00-05:00');
    const afterClosure = new Date('2026-10-27T12:01:00-05:00');
    const companion = companionDay();
    for (const time of [beforeClosure, afterClosure])
      expect(
        planDailyCudyrGaps([companion], ['synthetic-companion-crib'], emptySource(), time)
      ).toEqual([]);
    const independent = historicalDay();
    independent.beds = {
      NEO1: { ...patient(), age: '0', patientName: 'RN Sintético Independiente' },
    };
    const episodes = [patient().clinicalEpisodeId];
    expect(planDailyCudyrGaps([independent], episodes, emptySource(), beforeClosure)).toEqual([]);
    const gaps = planDailyCudyrGaps([independent], episodes, emptySource(), afterClosure);
    expect(gaps).toHaveLength(1);
    const report = parsedSource();
    report.report.patients[0].patientName = independent.beds.NEO1.patientName;
    expect(recoverDailyCudyrGap(gaps[0], [independent], report)).toMatchObject({
      kind: 'recovered',
      cudyr: { category: 'C2', recordedDate: independent.date },
    });
  });

  it.each(excludedPlacements)(
    'does not plan an unidentifiable documentary gap for $label',
    ({ bedId, fields }) => {
      const record = historicalDay();
      record.beds = { [bedId]: { ...patient(), ...fields, rut: '' } };
      const before = structuredClone(record);
      expect(plan(record)).toEqual([]);
      expect(record).toEqual(before);
    }
  );

  it.each(excludedPlacements)(
    'recovers a documented category with a personal identity in $label',
    async ({ bedId, fields }) => {
      const record = historicalDay();
      record.beds = { [bedId]: { ...patient(), ...fields } };
      const before = structuredClone(record);
      expect(plan(record)).toHaveLength(1);
      const capture = vi.fn(async () => parsedSource());
      const read = createDailyCudyrRecoveryReader({
        signal: new AbortController().signal,
        now,
        loadDay: async () => null,
        capture,
      });
      const result = await read(record, [patient().clinicalEpisodeId], emptySource());
      expect(capture).toHaveBeenCalledOnce();
      expect(result.current.get(patient().clinicalEpisodeId)).toEqual(documentary());
      expect(result.previous).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(record).toEqual(before);
    }
  );

  it.each(['Cuna', 'Cama'] as const)(
    'recovers a nested crib with its own document even with stored bedMode %s',
    async bedMode => {
      const record = historicalDay();
      record.beds.R1 = {
        ...patient(),
        rut: '22.222.222-2',
        patientName: 'Madre Sintética',
        clinicalEpisodeId: 'synthetic-mother',
        clinicalCrib: { ...patient(), bedId: 'C-R1', bedMode },
      };
      expect(plan(record)).toHaveLength(1);
      const read = createDailyCudyrRecoveryReader({
        signal: new AbortController().signal,
        now,
        loadDay: async () => null,
        capture: async () => parsedSource(),
      });
      const result = await read(record, [patient().clinicalEpisodeId], emptySource());
      expect(result.current.get(patient().clinicalEpisodeId)).toEqual(documentary());
      expect(result.errors).toEqual([]);
    }
  );

  it.each([
    { label: 'invalid RUT', fields: { rut: '123' } },
    { label: 'passport', fields: { documentType: 'Pasaporte' } },
    { label: 'missing name', fields: { patientName: '  ' } },
    { label: 'maternal linkage', fields: { neonatalMaternalRut: '22.222.222-2' } },
    { label: 'provisional identity', fields: { identityStatus: 'provisional' } },
  ] satisfies { label: string; fields: Partial<PatientData> }[])(
    'does not plan an excluded crib with $label',
    ({ fields }) => {
      const record = historicalDay();
      record.beds.R1 = { ...patient(), bedMode: 'Cuna', ...fields };
      expect(plan(record)).toEqual([]);
    }
  );

  it.each(['R1', 'unknown-bed'])('keeps a missing personal document pending in %s', async bedId => {
    const record = historicalDay();
    record.beds = { [bedId]: { ...patient(), bedId, rut: '' } };
    expect(plan(record)).toHaveLength(1);
    const capture = vi.fn(async () => parsedSource());
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture,
    });
    const result = await read(record, [patient().clinicalEpisodeId], emptySource());
    expect(capture).toHaveBeenCalledOnce();
    expect(result.current.size).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        cudyrRecovery: { kind: 'attribution_unreliable', targetDate: record.date },
      }),
    ]);
  });

  it('keeps an unknown modality unresolved when the documentary source is inconclusive', async () => {
    const record = historicalDay();
    record.beds = { 'unknown-bed': { ...patient(), bedId: 'unknown-bed' } };
    expect(plan(record)).toMatchObject([
      { date: record.date, clinicalEpisodeId: patient().clinicalEpisodeId },
    ]);
    const report = parsedSource();
    report.report.patients = [];
    const capture = vi.fn(async () => report);
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture,
    });
    const result = await read(record, [patient().clinicalEpisodeId], emptySource());
    expect(capture).toHaveBeenCalledOnce();
    expect(result.current.size).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        cudyrRecovery: { kind: 'documentary_inconclusive', targetDate: record.date },
      }),
    ]);
  });

  it('recovers an independent hospitalized newborn using its own document and destination bed', async () => {
    const newborn = {
      ...patient(),
      patientName: 'RN Sintético Independiente',
      age: '0',
      bedId: 'BOX1',
    };
    const record = historicalDay();
    record.beds = { NEO1: newborn };
    const before = structuredClone(record);
    expect(plan(record)).toMatchObject([{ patient: newborn, date: record.date }]);
    const report = parsedSource();
    report.report.patients[0].patientName = newborn.patientName;
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture: async () => report,
    });
    const result = await read(record, [newborn.clinicalEpisodeId], emptySource());
    expect(result.errors).toEqual([]);
    expect(result.current.get(newborn.clinicalEpisodeId)).toEqual({
      ...documentary(),
      documentaryEvidence: {
        ...documentary().documentaryEvidence,
        patientName: newborn.patientName,
      },
    });
    expect(result.previous).toEqual([]);
    expect(record).toEqual(before);
  });

  it.each(['Cuna', 'Cama'] as const)(
    'uses the historical %s placement when the current placement is different',
    historicalMode => {
      const previous = historicalDay();
      previous.beds.R1.bedMode = historicalMode;
      previous.beds.R1.rut = '';
      const current = currentDay();
      current.beds = {
        R2: {
          ...patient(),
          rut: '',
          bedId: 'R2',
          bedMode: historicalMode === 'Cuna' ? 'Cama' : 'Cuna',
        },
      };
      const before = structuredClone([current, previous]);
      const gaps = planDailyCudyrGaps(
        [current, previous],
        [patient().clinicalEpisodeId],
        emptySource(),
        now()
      );
      expect(gaps.map(gap => gap.date)).toEqual(historicalMode === 'Cuna' ? [] : [previous.date]);
      expect([current, previous]).toEqual(before);
    }
  );

  it.each(excludedPlacements)('preserves a recorded CUDYR in $label', async ({ bedId, fields }) => {
    const record = historicalDay();
    record.beds = {
      [bedId]: { ...patient(), ...fields, evaluationScores: { cudyr: documentary() } },
    };
    const before = structuredClone(record);
    const capture = vi.fn(async () => parsedSource());
    const read = createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture,
    });
    expect(await read(record, [patient().clinicalEpisodeId], emptySource())).toEqual({
      current: new Map(),
      previous: [],
      errors: [],
    });
    expect(capture).not.toHaveBeenCalled();
    expect(record).toEqual(before);
  });

  it.each(['nested crib', 'excluded census entry'])(
    'keeps the %s in duplicate-episode attribution checks',
    kind => {
      const record = historicalDay();
      const duplicate = {
        ...patient(),
        rut: '',
        patientName: 'Otro Paciente Sintético',
      };
      if (kind === 'nested crib') record.beds.R1.clinicalCrib = duplicate;
      else record.beds.CMA1 = duplicate;
      const gaps = plan(record);
      expect(gaps).toHaveLength(1);
      expect(recoverDailyCudyrGap(gaps[0], [record], parsedSource())).toEqual({
        kind: 'attribution_unreliable',
      });
    }
  );
});

const clinicalRun = (record: ReturnType<typeof historicalDay>, episode: string) => {
  const capture = vi
    .fn<NonNullable<Parameters<typeof createDailyCudyrRecoveryReader>[0]['capture']>>()
    .mockRejectedValue(new Error('synthetic documentary source unavailable'));
  const deps: ClinicalFillDeps = {
    recoverMissingCudyr: createDailyCudyrRecoveryReader({
      signal: new AbortController().signal,
      now,
      loadDay: async () => null,
      capture,
    }),
    fetchCudyrCategories: vi.fn<ClinicalFillDeps['fetchCudyrCategories']>().mockResolvedValue({
      source: 'gestion_camas',
      historyAvailable: true,
      items: [],
      captureContract: 1,
      observedEpisodeIds: [],
      metadataStatus: 'complete',
    }),
    fetchDeviceReport: vi.fn(),
    extractDeviceItems: vi.fn(),
    fetchHistoryScales: vi.fn(),
    fetchScalesForms: vi.fn(),
    applyPatch: vi.fn(),
    applyHistoricalCudyrBatch: vi.fn(),
    allowedClinicalEpisodeIds: [episode],
    historicalCudyrEpisodeIds: [episode],
    pendingReads: { [episode]: ['cudyr'] },
    now,
    createId: () => 'synthetic-excluded-recovery',
  };
  return {
    capture,
    deps,
    run: async () => {
      const summary = await runClinicalFill(record, record.date, deps);
      return {
        summary,
        stage: resolveClinicalStageResult(
          record,
          record,
          [episode],
          summary,
          false,
          [episode],
          [episode]
        ),
      };
    },
  };
};

describe('excluded documentary CUDYR does not manufacture a partial clinical stage', () => {
  it.each(['census', 'crib'] as const)(
    'fills a documented excluded %s patient and completes the clinical stage',
    async section => {
      const record = historicalDay();
      if (section === 'census') record.beds.R1.bedMode = 'Cuna';
      else
        record.beds.R1 = {
          ...patient(),
          rut: '22.222.222-2',
          patientName: 'Madre Sintética',
          clinicalEpisodeId: 'synthetic-mother',
          clinicalCrib: { ...patient(), bedId: 'C-R1', bedMode: 'Cuna' },
        };
      let persisted = structuredClone(record);
      const { run, capture, deps } = clinicalRun(record, patient().clinicalEpisodeId);
      capture.mockResolvedValue(parsedSource());
      deps.applyPatch = vi.fn<ClinicalFillDeps['applyPatch']>().mockImplementation(async patch => {
        persisted = applyPatches(persisted, patch);
      });
      const { summary, stage } = await run();
      expect(summary.errors).toEqual([]);
      expect(summary.patched).toBe(1);
      expect(stage).toEqual({ status: 'complete' });
      expect(capture).toHaveBeenCalledOnce();
      const recovered = section === 'crib' ? persisted.beds.R1.clinicalCrib : persisted.beds.R1;
      expect(recovered?.evaluationScores?.cudyr).toEqual(documentary());
      if (section === 'crib') expect(persisted.beds.R1.evaluationScores?.cudyr).toBeUndefined();
    }
  );

  it('completes a companion-crib CUDYR retry without capture, errors or another pending retry', async () => {
    const record = companionDay();
    const before = structuredClone(record);
    const { run, capture, deps } = clinicalRun(record, 'synthetic-companion-crib');
    const { summary, stage } = await run();
    expect(summary.total).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(stage).toEqual({ status: 'complete' });
    expect(capture).not.toHaveBeenCalled();
    expect(deps.applyPatch).not.toHaveBeenCalled();
    expect(deps.applyHistoricalCudyrBatch).not.toHaveBeenCalled();
    expect(record).toEqual(before);
  });

  it.each(['documentary', 'live and documentary'])(
    'keeps a hospitalized episode partial after a failed %s source',
    async failure => {
      const record = historicalDay();
      const episode = patient().clinicalEpisodeId;
      const { run, capture, deps } = clinicalRun(record, episode);
      if (failure === 'live and documentary')
        vi.mocked(deps.fetchCudyrCategories).mockRejectedValue(
          new Error('synthetic live source unavailable')
        );
      const { summary, stage } = await run();
      expect(capture).toHaveBeenCalledOnce();
      expect(summary.errors).toHaveLength(failure === 'documentary' ? 1 : 2);
      expect(summary.errors).toContainEqual(
        expect.objectContaining({
          clinicalEpisodeId: episode,
          source: 'cudyr',
          reason: 'source_unavailable',
          cudyrRecovery: { kind: 'read_failed', targetDate: record.date },
        })
      );
      expect(stage).toMatchObject({
        status: 'partial',
        retry: {
          pendingClinicalEpisodeIds: [episode],
          pendingHistoricalCudyrEpisodeIds: [episode],
        },
      });
      expect(deps.applyPatch).not.toHaveBeenCalled();
      expect(deps.applyHistoricalCudyrBatch).not.toHaveBeenCalled();
      expect(record.beds.R1.evaluationScores?.cudyr).toBeUndefined();
    }
  );
});
