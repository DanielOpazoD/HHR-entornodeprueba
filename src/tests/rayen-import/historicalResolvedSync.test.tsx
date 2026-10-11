import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import type { RayenSyncBundle } from '@/features/rayen-import/contracts/rayenSnapshot';
import { computePreviousDayEdits } from '@/features/rayen-import/domain/previousDayCorrections';
import {
  applyConfirmedRayenImport,
  hasSkippedPreviousDayCorrections,
} from '@/features/rayen-import/hooks/confirmRayenImport';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { resolveIsNewAdmissionForRecord } from '@/features/census/controllers/patientRowNewAdmissionIndicatorController';
import type { ApplyResult } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { RayenSyncRun } from '@/features/rayen-import/domain/rayenSyncHistory';
import { RayenImportPreviewModal } from '@/features/rayen-import/components/RayenImportPreviewModal';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import {
  motherAndNewbornDiff,
  repository,
  resetPreviousDayAdmissionFixtures,
} from './previousDayAdmissionCorrections.fixtures';

vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', () => ({
  patchDailyRecordWithCompatibility: vi.fn(),
}));

const row: EgresoReportRow = {
  run: '12.345.678-5',
  patientName: 'Paciente Resuelto',
  bedLabel: 'H4C1',
  servicio: 'AMQI',
  edad: '40',
  destino: 'Domicilio',
  motivo: 'Alta',
  fechaEgreso: '24-07-2026 17:38',
};
const record = {
  date: '2026-07-24',
  beds: {},
  transfers: [],
  cma: [],
  discharges: [
    {
      id: 'resolved',
      bedId: 'H4C1',
      rut: row.run,
      patientName: row.patientName,
      clinicalEpisodeId: '142845',
      movementDate: '2026-07-24',
      time: '15:38',
      movementProvenance: { source: 'gestion_camas' },
    },
  ],
} as unknown as DailyRecord;

describe('resolved historical synchronization', () => {
  afterEach(() => vi.useRealTimers());

  it('does not reconstruct an administrative row whose exact discharge is already recorded', async () => {
    const lookupEgresos = vi.fn().mockResolvedValue([
      {
        run: row.run,
        encounterId: '142845',
        egreso: { id: '142845', hasAdministrativeDischarge: true },
      },
    ]);
    const fetchStatisticalDischarge = vi.fn().mockResolvedValue({ base64: 'QQ==' });
    const planningSnapshot = {
      capturedAt: '2026-07-25T13:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [],
    };
    const result = await prepareRayenStructuralPlan({
      baseRecord: record,
      planningSnapshot,
      bundle: { egresoRows: [row] } as RayenSyncBundle,
      isHistoricalDay: true,
      reportDate: record.date,
      dailyRecord: repository,
      isAdmin: true,
      counters: { requests: 0, cacheHits: 0, timeouts: 0 },
      measureEvidence: operation => operation(),
      evidenceClient: {
        lookupEgresos,
        fetchStatisticalDischarge,
        fetchPatientFlowReport: vi.fn(),
      },
      extractStatisticalText: async () => `Informe Estadístico de Egreso Hospitalario
1.RUN: 1 2 3 4 5 6 7 8 - 5
24 INGRESO 1 0 - 0 0 2 4 - 0 7 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
25 1er TRASLADO - - -
26 2° TRASLADO - - -
27 3er TRASLADO - - -
28 4° TRASLADO - - -
29 EGRESO 1 5 - 3 8 2 4 - 0 7 - 2 6 1. Domicilio. 4 0 4`,
    });
    expect(lookupEgresos).toHaveBeenCalled();
    expect(fetchStatisticalDischarge).toHaveBeenCalledWith('142845');
    expect(result.diff.conflicts).toEqual([]);
    expect(result.diff.admissions).toEqual([]);
    expect(result.diff.reportEgresos).toEqual([]);
  });

  it.each([
    { fechaEgreso: '24-07-2026 17:39' },
    { encounterId: '142846', fechaEgreso: 'sin fecha verificable' },
    { bedLabel: 'H4C2' },
  ])('does not hide a different or unresolved episode: %j', async change => {
    const result = await reconstructHistoricalSnapshotAtClose(
      '2026-07-24',
      {
        capturedAt: '2026-07-25T13:00:00-06:00',
        facilityId: 1342,
        isComplete: true,
        encounters: [],
      },
      record,
      [{ ...row, ...change }],
      { fetchReport: vi.fn() }
    );
    expect(result.conflicts).toHaveLength(1);
  });

  it('includes a verified, editable night admission in the ordinary confirmation', async () => {
    resetPreviousDayAdmissionFixtures();
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );
    expect(plan.edits[0]).toEqual(expect.objectContaining({ automaticNightAdmission: true }));
    const onConfirm = vi.fn();
    render(
      <RayenImportPreviewModal
        isOpen
        diff={{ ...motherAndNewbornDiff, previousDayEdits: plan.edits }}
        error={null}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByLabelText('Acepto modificar los días previos indicados')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e importar' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it.each([true, false])(
    'persists only automatic admissions and finalizes already-filed departures (remote=%s)',
    async updatedRemotely => {
      resetPreviousDayAdmissionFixtures();
      vi.mocked(patchDailyRecordWithCompatibility).mockResolvedValue({
        outcome: updatedRemotely ? 'clean' : 'blocked',
        updatedRemotely,
        savedLocally: true,
      } as never);
      const plan = await computePreviousDayEdits(
        repository,
        motherAndNewbornDiff,
        '2026-07-26',
        false
      );
      const diff = {
        ...motherAndNewbornDiff,
        previousDayEdits: [
          ...plan.edits,
          {
            day: '2026-07-24',
            reason: 'discharge-day-correction' as const,
            patientNames: ['Otro Paciente'],
            recordExists: true,
            withinEditingWindow: true,
            isSigned: false,
          },
        ],
      };
      const base = { ...record, date: '2026-07-26' };
      const finalizeHistoricalDischarges = vi.fn(async (result: ApplyResult) => result);
      const result = await applyConfirmedRayenImport({
        applyPreviousDays: false,
        base,
        diff,
        dailyRecord: repository,
        isAdmin: false,
        ensureRun: () => ({ id: 'test-sync' }) as RayenSyncRun,
        applyDiff: vi
          .fn()
          .mockResolvedValue({ record: base, applied: {}, skipped: [] } as unknown as ApplyResult),
        getFreshRecord: vi.fn(),
        replanDiff: vi.fn(),
        clinicalDay: '2026-07-26',
        createId: () => 'test-id',
        finalizeHistoricalDischarges,
      });
      expect(result.historicalCorrectionsPending).toBe(!updatedRemotely);
      expect(finalizeHistoricalDischarges).toHaveBeenCalledTimes(1);
      expect(patchDailyRecordWithCompatibility).toHaveBeenCalled();
      expect(
        vi
          .mocked(patchDailyRecordWithCompatibility)
          .mock.calls.every(call => call[1] === '2026-07-25')
      ).toBe(true);
      expect(
        hasSkippedPreviousDayCorrections({ ...diff, previousDayEdits: plan.edits }, false)
      ).toBe(false);
      const admission = motherAndNewbornDiff.admissions[0].patient;
      expect(resolveIsNewAdmissionForRecord({ ...admission, recordDate: '2026-07-25' })).toBe(true);
      expect(resolveIsNewAdmissionForRecord({ ...admission, recordDate: '2026-07-26' })).toBe(
        false
      );
    }
  );

  it('keeps protected or unavailable historical days behind review', async () => {
    resetPreviousDayAdmissionFixtures();
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'));
    const plan = await computePreviousDayEdits(
      repository,
      motherAndNewbornDiff,
      '2026-07-26',
      false
    );
    expect(plan.edits[0].automaticNightAdmission).toBeUndefined();
    expect(plan.edits[0].withinEditingWindow).toBe(false);
  });
});
