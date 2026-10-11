import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import { reconcileCensus } from '@/features/rayen-import/domain/reconcileCensus';
import { applyEgresoReport } from '@/features/rayen-import/domain/applyEgresoReport';
import { applyEgresoLookupFallback } from '@/features/rayen-import/domain/applyEgresoLookupFallback';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { collectEgresoLookupTargets } from '@/features/rayen-import/hooks/rayenSnapshotLookupTargets';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

const now = new Date('2026-08-13T23:00:00Z');
const patient = {
  ...EMPTY_PATIENT,
  bedId: 'R2',
  patientName: 'Paciente Sintético',
  rut: '8.260.364-6',
  clinicalEpisodeId: '1001',
  admissionDate: '2026-08-13',
  admissionTime: '14:04',
};
const record = (occupied = true): DailyRecord => ({
  date: '2026-08-13',
  beds: { R2: occupied ? patient : { ...EMPTY_PATIENT, bedId: 'R2' } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});
const snapshot: RayenCensusSnapshot = {
  capturedAt: now.toISOString(),
  facilityId: 1342,
  isComplete: true,
  encounters: [
    {
      encounterId: '1001',
      run: patient.rut,
      firstGivenName: 'Paciente',
      firstFamilyName: 'Sintético',
      bed: 'R2',
      room: 'Recuperación 2',
      admissionDatetime: '2026-08-13T14:04:00-06:00',
      hasMedicalDischarge: true,
      hasNurseDischarge: true,
    },
  ],
};
const row: EgresoReportRow = {
  run: patient.rut,
  patientName: patient.patientName,
  bedLabel: 'R2',
  servicio: 'Medicina',
  edad: '40 años',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '13-08-2026 22:29',
  diagnostico: 'Diagnóstico A',
};
const statisticalText = `Informe Estadístico de Egreso Hospitalario
1.RUN: 8 2 6 0 3 6 4 - 6
24 INGRESO 1 4 - 0 4 1 3 - 0 8 - 2 6 Área Médico Quirúrgico Cuidados Medios 4 0 4
29 EGRESO 2 0 - 2 9 1 3 - 0 8 - 2 6 Domicilio 4 0 4
30 DÍAS ESTADIA 0 0 0 1 31 1) VIVO 2) FALLECIDO 1`;
const lookup = {
  run: '82603646',
  encounterId: '1001',
  egreso: {
    id: 1001,
    hasAdministrativeDischarge: true,
    dateDischarge: '2026-08-13T20:29:00',
    dischargeDestination: 'Domicilio',
  },
};
const dependencies = () => ({
  lookupEgresos: vi.fn().mockResolvedValue([lookup]),
  fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
  extractText: vi.fn().mockResolvedValue(statisticalText),
});

describe('administrative departures after manual census actions', () => {
  it.each([true, false])(
    'resolves diagnosis rows into one discharge with occupied=%s',
    async occupied => {
      const current = record(occupied);
      const deps = dependencies();
      const rows = await enrichReportOnlyDischarges(
        [row, { ...row, diagnostico: 'Diagnóstico B' }],
        current.date,
        deps
      );
      expect(deps.lookupEgresos).toHaveBeenCalledTimes(1);
      expect(deps.lookupEgresos.mock.calls[0][0]).toHaveLength(1);
      expect(rows.map(r => r.diagnostico)).toEqual(['Diagnóstico A', 'Diagnóstico B']);
      expect(
        rows.every(r => r.encounterId === '1001' && r.exactEpisodeVerification === 'verified')
      ).toBe(true);
      const diff = applyEgresoReport(
        reconcileCensus(current, snapshot, { reference: now }),
        rows,
        current
      );
      expect(diff.admissions).toHaveLength(0);
      expect(diff.conflicts).toHaveLength(0);
      const applied = applyCensusImportDiff(current, diff, {
        now,
        idFactory: () => 'movement-1',
        syncRunId: 'synthetic',
      });
      expect(applied.record.beds.R2?.patientName ?? '').toBe('');
      expect(applied.record.discharges).toHaveLength(1);
      const again = applyEgresoReport(
        reconcileCensus(applied.record, snapshot, { reference: now }),
        rows,
        applied.record
      );
      expect(again.admissions).toHaveLength(0);
      expect(again.discharges).toHaveLength(0);
      expect(again.reportEgresos ?? []).toHaveLength(0);
      expect(again.conflicts).toHaveLength(0);
    }
  );

  it('keeps identical-looking twins unresolved when the source cannot identify one episode', async () => {
    const deps = dependencies();
    deps.lookupEgresos.mockResolvedValue([{ run: lookup.run, encounterId: '', egreso: null }]);
    const rows = await enrichReportOnlyDischarges(
      [row, { ...row, diagnostico: 'Diagnóstico B' }],
      record().date,
      deps
    );
    expect(rows.every(r => r.exactEpisodeVerification === 'unverified')).toBe(true);
    expect(deps.fetchStatisticalDischarge).not.toHaveBeenCalled();
  });

  it.each(['bedLabel', 'patientName', 'fechaEgreso', 'destino'] as const)(
    'does not conflate rows differing in %s',
    async field => {
      const deps = dependencies();
      const rows = await enrichReportOnlyDischarges(
        [row, { ...row, [field]: field === 'fechaEgreso' ? '13-08-2026 23:29' : 'Otro valor' }],
        record().date,
        deps
      );
      expect(rows.some(r => r.exactEpisodeVerification === 'verified')).toBe(false);
    }
  );

  it('does not query administrative closure for an ordinary active admission', () => {
    const active = {
      ...snapshot,
      encounters: snapshot.encounters.map(encounter => ({
        ...encounter,
        hasMedicalDischarge: false,
        hasNurseDischarge: false,
      })),
    };
    const plan = reconcileCensus(record(false), active, { reference: now });
    expect(plan.admissions).toHaveLength(1);
    expect(plan.pendingAdministrativeDischarges).toEqual([]);
    expect(collectEgresoLookupTargets(plan)).toEqual([]);
  });

  it('verifies a clinically closed episode after its bed was manually cleared', () => {
    const current = record(false);
    const plan = reconcileCensus(current, snapshot, { reference: now });
    expect(collectEgresoLookupTargets(plan)).toEqual([{ run: patient.rut, encounterId: '1001' }]);
    const resolved = applyEgresoLookupFallback(plan, [lookup], current);
    expect(resolved.admissions).toHaveLength(0);
    expect(resolved.reportEgresos).toEqual([expect.objectContaining({ encounterId: '1001' })]);
  });

  it('still investigates a closed episode when its former bed has a replacement', () => {
    const replacement = {
      ...patient,
      patientName: 'Otro Paciente',
      rut: '11.111.111-1',
      clinicalEpisodeId: '2002',
    };
    const current = { ...record(), beds: { R2: replacement } };
    const plan = reconcileCensus(current, snapshot, { reference: now });
    expect(collectEgresoLookupTargets(plan)).toEqual(
      expect.arrayContaining([{ run: patient.rut, encounterId: '1001' }])
    );
    const resolved = applyEgresoLookupFallback(plan, [lookup], current);
    expect(resolved.admissions).toHaveLength(0);
    expect(resolved.discharges.some(entry => entry.encounterId === '2002')).toBe(false);
    expect(resolved.reportEgresos).toEqual([expect.objectContaining({ encounterId: '1001' })]);
    const applied = applyCensusImportDiff(current, resolved, {
      now,
      idFactory: () => 'old-discharge',
      syncRunId: 'turnover',
    }).record;
    expect(applied.beds.R2.clinicalEpisodeId).toBe('2002');
    expect(applied.discharges).toHaveLength(1);
  });

  it('does not invent a statistical discharge from clinical closure and manual clearing', () => {
    const current = record(false);
    const plan = reconcileCensus(current, snapshot, { reference: now });
    const unresolved = applyEgresoLookupFallback(
      plan,
      [{ ...lookup, egreso: { hasAdministrativeDischarge: false } }],
      current
    );
    expect(unresolved.discharges).toHaveLength(0);
    expect(unresolved.reportEgresos ?? []).toHaveLength(0);
    expect(unresolved.admissions).toHaveLength(1);
    expect(unresolved.pendingAdministrativeDischarges).toHaveLength(1);
  });

  it.each(['discharges', 'transfers', 'cma'] as const)(
    'respects legacy manual %s anchored in undo provenance',
    category => {
      const current = record(false);
      current[category] = [
        {
          rut: patient.rut,
          patientName: patient.patientName,
          originalData: { ...patient, admissionTime: undefined },
        } as never,
      ];
      const plan = reconcileCensus(current, snapshot, { reference: now });
      expect(plan.admissions).toHaveLength(0);
      expect(plan.pendingAdministrativeDischarges).toHaveLength(0);
      const readmission = {
        ...snapshot,
        encounters: snapshot.encounters.map(e => ({ ...e, encounterId: '1002' })),
      };
      expect(reconcileCensus(current, readmission, { reference: now }).admissions).toHaveLength(1);
    }
  );
});

describe('absent D-1 patient with diagnosis-expanded discharge report', () => {
  it.each([true, false])(
    'investigates the episode and requires official evidence: %s',
    async verified => {
      const current = record(false);
      const previous = {
        ...record(),
        date: '2026-08-12',
        beds: {
          R2: { ...patient, admissionDate: '2026-08-12' },
        },
      };
      const repository = {
        getAuthoritativeForDate: vi.fn(async (day: string) =>
          day === previous.date ? previous : null
        ),
        getForDate: vi.fn().mockResolvedValue(null),
        getLocalForDateWithMeta: vi.fn().mockResolvedValue({
          record: null,
          hasPendingWrites: false,
          hasPendingWritesForDate: false,
          writeState: 'none',
        }),
      } as unknown as DailyRecordRepositoryPort;
      const lookupEgresos = vi.fn(async (targets: unknown[]) =>
        targets.length && verified ? [lookup] : []
      );
      const fetchStatisticalDischarge = vi.fn().mockResolvedValue({ base64: 'cGRm' });
      const prepare = (baseRecord: DailyRecord) =>
        prepareRayenStructuralPlan({
          baseRecord,
          planningSnapshot: { ...snapshot, encounters: [] },
          bundle: {
            id: 'synthetic-d1',
            startedAt: now.toISOString(),
            completedAt: now.toISOString(),
            facilityId: 1342,
            dateStart: current.date,
            dateEnd: current.date,
            fichaMedicoCapturedAt: now.toISOString(),
            gestionCamasCapturedAt: now.toISOString(),
            sourceSkewMs: 0,
            egresoRows: [row, { ...row, diagnostico: 'Diagnóstico B' }],
          },
          isHistoricalDay: false,
          reportDate: current.date,
          dailyRecord: repository,
          isAdmin: false,
          counters: { requests: 0, cacheHits: 0, timeouts: 0 },
          measureEvidence: operation => operation(),
          evidenceClient: {
            lookupEgresos,
            fetchStatisticalDischarge,
            fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
          },
          extractStatisticalText: vi
            .fn()
            .mockResolvedValue(
              statisticalText.replace('1 4 - 0 4 1 3 - 0 8 - 2 6', '1 4 - 0 4 1 2 - 0 8 - 2 6')
            ),
        });
      const { diff } = await prepare(current);
      expect(lookupEgresos).toHaveBeenCalledWith([
        expect.objectContaining({ run: patient.rut, dischargeDay: current.date }),
      ]);
      expect(diff.admissions).toHaveLength(0);
      if (!verified) {
        expect(diff.reportEgresos ?? []).toHaveLength(0);
        expect(diff.conflicts).toEqual(
          expect.arrayContaining([expect.objectContaining({ code: 'previous-census-continuity' })])
        );
        return;
      }
      expect(fetchStatisticalDischarge).toHaveBeenCalledWith('1001');
      expect(diff.conflicts).toEqual([]);
      expect(diff.reportEgresos).toEqual([
        expect.objectContaining({
          encounterId: '1001',
          correctedDay: current.date,
          admissionDay: previous.date,
        }),
      ]);
      const applied = applyCensusImportDiff(current, diff, {
        now,
        idFactory: () => 'd1-discharge',
        syncRunId: 'd1',
      }).record;
      expect(applied.discharges).toHaveLength(1);
      expect(applied.discharges[0].clinicalEpisodeId).toBe('1001');
      const replay = await prepare(applied);
      expect(replay.diff.reportEgresos ?? []).toHaveLength(0);
      expect(replay.diff.conflicts).toEqual([]);
    }
  );
});
