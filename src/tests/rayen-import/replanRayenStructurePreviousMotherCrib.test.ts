import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { EgresoLookupTarget } from '@/features/rayen-import/contracts/egresoLookup';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { replanRayenStructure } from '@/features/rayen-import/hooks/replanRayenStructure';

const TODAY = '2026-09-13';
const YESTERDAY = '2026-09-12';
const RUN = '28.106.852-0';

const mother: PatientData = {
  ...EMPTY_PATIENT,
  bedId: 'H5C1',
  patientName: 'Tania Cristina Valencia Ladino',
  rut: RUN,
  clinicalEpisodeId: '1001',
  admissionDate: YESTERDAY,
  admissionTime: '08:00',
  clinicalCrib: {
    ...EMPTY_PATIENT,
    bedId: 'H5C1',
    bedMode: 'Cuna',
    patientName: 'Rn De Tania Valencia Ladino',
    rut: RUN,
    clinicalEpisodeId: '1002',
    admissionDate: YESTERDAY,
    admissionTime: '08:05',
  },
};

const record = (date: string, beds: DailyRecord['beds'] = {}): DailyRecord =>
  ({
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: `${date}T20:00:00.000Z`,
  }) as DailyRecord;

const row = (
  encounterId: string,
  patientName: string,
  fromClinicalCrib = false
): EgresoReportRow => ({
  encounterId,
  run: RUN,
  patientName,
  bedLabel: 'H5C1',
  servicio: 'Ginecobstetricia',
  edad: fromClinicalCrib ? '0 días' : '18 años',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '13-09-2026 12:00',
  correctedDay: TODAY,
  correctedTime: '10:00',
  admissionDay: YESTERDAY,
  admissionTime: fromClinicalCrib ? '08:05' : '08:00',
  exactEpisodeVerification: 'verified',
  ...(fromClinicalCrib ? { fromClinicalCrib: true } : {}),
});

describe('current-day mother/newborn discharge continuity from exact D-1 evidence', () => {
  it('files both exact episodes and leaves no previous-census-continuity conflict', async () => {
    const previous = record(YESTERDAY, { H5C1: mother });
    const current = record(TODAY);
    const repository = {
      getAuthoritativeForDate: vi.fn(async (day: string) => (day === YESTERDAY ? previous : null)),
      getForDate: vi.fn().mockResolvedValue(null),
      getLocalForDateWithMeta: vi.fn().mockResolvedValue({
        record: null,
        hasPendingWrites: false,
        hasPendingWritesForDate: false,
        writeState: 'none',
      }),
    } as unknown as DailyRecordRepositoryPort;

    const diff = await replanRayenStructure(
      current,
      {
        sourceSnapshot: {
          capturedAt: `${TODAY}T14:00:00-06:00`,
          facilityId: 1342,
          encounters: [],
          isComplete: true,
        },
        egresoRows: [
          row('1001', mother.patientName),
          row('1002', mother.clinicalCrib?.patientName ?? '', true),
        ],
        reportDate: TODAY,
        isHistoricalDay: false,
      },
      {
        dailyRecord: repository,
        isAdmin: false,
        fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
        fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
        lookupEgresos: vi.fn().mockResolvedValue([]),
      }
    );

    expect(diff.reportEgresos).toHaveLength(2);
    expect(diff.reportEgresos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ encounterId: '1001' }),
        expect.objectContaining({ encounterId: '1002', fromClinicalCrib: true }),
      ])
    );
    expect(diff.reportEgresos?.find(egreso => egreso.encounterId === '1001')).not.toHaveProperty(
      'fromClinicalCrib'
    );
    expect(
      diff.conflicts.filter(conflict => conflict.code === 'previous-census-continuity')
    ).toEqual([]);

    const applied = applyCensusImportDiff(current, diff, {
      idFactory: (() => {
        let id = 0;
        return () => `movement-${++id}`;
      })(),
      now: new Date('2026-09-13T18:00:00.000Z'),
      syncRunId: 'mother-newborn-continuity',
    });
    expect(applied.record.discharges).toHaveLength(2);
    expect(applied.record.discharges.map(discharge => discharge.clinicalEpisodeId).sort()).toEqual([
      '1001',
      '1002',
    ]);
    expect(applied.record.discharges.filter(discharge => discharge.isNested)).toHaveLength(1);
  });
});

const rawRow = (patientName: string): EgresoReportRow => ({
  run: RUN,
  patientName,
  bedLabel: 'H5C1',
  servicio: 'Ginecobstetricia',
  edad: patientName.startsWith('Rn ') ? '0 días' : '18 años',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '13-09-2026 16:44',
  correctedDay: TODAY,
  correctedTime: '16:44',
});

const prepare = async (baseRecord: DailyRecord, previous: DailyRecord) => {
  const repository = {
    getAuthoritativeForDate: vi.fn(async (day: string) => (day === YESTERDAY ? previous : null)),
    getForDate: vi.fn().mockResolvedValue(null),
    getLocalForDateWithMeta: vi.fn().mockResolvedValue({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none',
    }),
  } as unknown as DailyRecordRepositoryPort;
  const lookupEgresos = vi.fn(async (targets: Array<string | EgresoLookupTarget>) =>
    targets.map(value => {
      const target = typeof value === 'string' ? { run: value, encounterId: '' } : value;
      return {
        run: target.run,
        encounterId: target.encounterId,
        egreso: target.encounterId
          ? {
              id: target.encounterId,
              endPeriod: '2026-09-13T16:44:11.33-03:00',
            }
          : undefined,
      };
    })
  );
  const planningSnapshot = {
    capturedAt: `${TODAY}T18:00:00-06:00`,
    facilityId: 1342,
    encounters: [],
    isComplete: true,
  };
  const bundle = {
    id: 'mother-newborn-bundle',
    startedAt: `${TODAY}T18:00:00.000Z`,
    completedAt: `${TODAY}T18:00:02.000Z`,
    facilityId: 1342,
    dateStart: TODAY,
    dateEnd: TODAY,
    fichaMedicoCapturedAt: `${TODAY}T18:00:00.000Z`,
    gestionCamasCapturedAt: `${TODAY}T18:00:01.000Z`,
    sourceSkewMs: 1000,
    egresoRows: [rawRow(mother.patientName), rawRow(mother.clinicalCrib?.patientName ?? '')],
  };
  const plan = await prepareRayenStructuralPlan({
    baseRecord,
    planningSnapshot,
    bundle,
    isHistoricalDay: false,
    reportDate: TODAY,
    dailyRecord: repository,
    isAdmin: false,
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: operation => operation(),
    evidenceClient: {
      lookupEgresos,
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
    },
    extractStatisticalText: vi.fn().mockResolvedValue('Formato neonatal alternativo'),
  });
  return { ...plan, lookupEgresos };
};

describe('full mother/newborn D-1 preparation chain', () => {
  it('recovers both exact episodes at Rapa Nui time, remains idempotent and repairs a partial run', async () => {
    const previous = record(YESTERDAY, { H5C1: mother });
    const first = await prepare(record(TODAY), previous);

    expect(first.diff.reportEgresos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ encounterId: '1001', correctedTime: '14:44' }),
        expect.objectContaining({
          encounterId: '1002',
          correctedTime: '14:44',
          fromClinicalCrib: true,
        }),
      ])
    );
    expect(first.diff.conflicts).toEqual([]);
    const applied = applyCensusImportDiff(record(TODAY), first.diff, {
      idFactory: (() => {
        let id = 0;
        return () => `full-chain-${++id}`;
      })(),
      now: new Date('2026-09-13T20:00:00.000Z'),
      syncRunId: 'full-chain',
    }).record;
    expect(applied.discharges).toHaveLength(2);
    expect(applied.discharges.filter(discharge => discharge.isNested)).toHaveLength(1);

    const replay = await prepare(applied, previous);
    expect(replay.diff.reportEgresos).toEqual([]);
    expect(replay.diff.conflicts).toEqual([]);

    const motherOnly = {
      ...applied,
      discharges: applied.discharges.filter(discharge => discharge.clinicalEpisodeId === '1001'),
    };
    const repair = await prepare(motherOnly, previous);
    expect(repair.diff.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: '1002', fromClinicalCrib: true }),
    ]);
    expect(repair.diff.conflicts).toEqual([]);
  });
});
