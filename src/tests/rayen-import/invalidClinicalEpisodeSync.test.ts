import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// Synthetic case modelled on 2026-11-05: Eloísa admitted the same person twice. The duplicate
// episode was marked «paciente no válido»; the original episode stays in NEO1.
const RUN = '12.345.678-5';
const now = new Date('2026-11-05T18:00:00Z');
const VALID = '900100';
const DUPLICATE = '900200';

const encounter = (encounterId: string, bed: string): RayenEncounter => ({
  encounterId,
  run: RUN,
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintética',
  birthDate: '1994-03-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: bed.startsWith('NEO') ? 'Neonatología' : 'Box',
  bed,
  admissionDatetime: '2026-11-05T08:30:00-05:00',
  diagnosis: 'Diagnóstico sintético',
});

const occupant = (bedId: string, clinicalEpisodeId: string): DailyRecord['beds'][string] => ({
  ...EMPTY_PATIENT,
  bedId,
  location: bedId,
  patientName: 'Paciente Sintética',
  rut: RUN,
  clinicalEpisodeId,
  admissionDate: '2026-11-05',
  admissionTime: '08:30',
});

const record = (beds: DailyRecord['beds']): DailyRecord => ({
  date: '2026-11-05',
  beds: { BOX2: { ...EMPTY_PATIENT, bedId: 'BOX2' }, ...beds },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-11-05T17:00:00.000Z',
  activeExtraBeds: [],
});

const snapshot = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: now.toISOString(),
  facilityId: 1342,
  isComplete: true,
  encounters,
});

const duplicateEgreso: EgresoReportRow = {
  encounterId: DUPLICATE,
  run: RUN,
  patientName: 'Paciente Sintética',
  bedLabel: 'BOX2',
  servicio: 'Box',
  edad: '32',
  destino: 'Domicilio (Habitual)',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '05-11-2026 14:37',
  exactEpisodeVerification: 'verified',
};

const plan = async (
  baseRecord: DailyRecord,
  source: RayenCensusSnapshot,
  invalidEpisodeIds: ReadonlySet<string>,
  egresoRows: EgresoReportRow[] = []
): Promise<CensusImportDiff> => {
  const dailyRecord = {
    getAuthoritativeForDate: vi.fn().mockResolvedValue(null),
    getForDate: vi.fn().mockResolvedValue(null),
    getLocalForDateWithMeta: vi.fn().mockResolvedValue({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none',
    }),
  } as unknown as DailyRecordRepositoryPort;
  const { diff } = await prepareRayenStructuralPlan({
    baseRecord,
    planningSnapshot: source,
    bundle: {
      id: 'synthetic-invalid-episode',
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      facilityId: 1342,
      dateStart: baseRecord.date,
      dateEnd: baseRecord.date,
      fichaMedicoCapturedAt: now.toISOString(),
      gestionCamasCapturedAt: now.toISOString(),
      sourceSkewMs: 0,
      egresoRows,
    },
    isHistoricalDay: false,
    invalidEpisodeIds,
    reportDate: baseRecord.date,
    dailyRecord,
    isAdmin: true,
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: operation => operation(),
    extractStatisticalText: vi.fn().mockResolvedValue(''),
    evidenceClient: {
      lookupHospitalizations: vi.fn().mockResolvedValue({ ok: false }),
      lookupEgresos: vi.fn().mockResolvedValue([]),
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    },
  });
  return diff;
};

/** Every planned entry that names the episode, in any of the places the sync writes from. */
const entriesNaming = (diff: CensusImportDiff, episodeId: string): unknown[] =>
  [
    ...diff.admissions,
    ...diff.updates,
    ...diff.moves,
    ...diff.discharges,
    ...diff.pendingAdministrativeDischarges,
    ...diff.conflicts,
    ...(diff.reportEgresos ?? []),
    ...(diff.previousDayAdmissionCandidates ?? []),
  ].filter(entry => JSON.stringify(entry).includes(episodeId));

const marked = new Set([DUPLICATE]);
const unmarked = new Set<string>();

describe('the Eloísa sync respects a patient marked as not valid', () => {
  it('never admits the duplicate episode again while Eloísa keeps it open', async () => {
    const current = record({ NEO1: occupant('NEO1', VALID) });
    const source = snapshot([encounter(VALID, 'NEO1'), encounter(DUPLICATE, 'BOX2')]);

    expect(entriesNaming(await plan(current, source, unmarked), DUPLICATE)).not.toEqual([]);

    const diff = await plan(current, source, marked);
    expect(entriesNaming(diff, DUPLICATE)).toEqual([]);
    expect(diff.admissions).toEqual([]);
    expect(diff.activeClinicalEpisodeIds).toEqual([VALID]);
  });

  it('never files the egreso Eloísa records to close the duplicate', async () => {
    const current = record({ NEO1: occupant('NEO1', VALID) });
    const source = snapshot([encounter(VALID, 'NEO1')]);

    expect(
      entriesNaming(await plan(current, source, unmarked, [duplicateEgreso]), DUPLICATE)
    ).not.toEqual([]);

    const diff = await plan(current, source, marked, [duplicateEgreso]);
    expect(entriesNaming(diff, DUPLICATE)).toEqual([]);
    expect(diff.discharges).toEqual([]);
    expect(diff.reportEgresos ?? []).toEqual([]);
  });

  it('leaves alone a bed that still holds the marked episode', async () => {
    const current = record({ NEO1: occupant('NEO1', VALID), BOX2: occupant('BOX2', DUPLICATE) });
    const source = snapshot([encounter(VALID, 'NEO1')]);

    expect(entriesNaming(await plan(current, source, unmarked), DUPLICATE)).not.toEqual([]);

    const diff = await plan(current, source, marked);
    expect(entriesNaming(diff, DUPLICATE)).toEqual([]);
    expect(diff.discharges).toEqual([]);
  });

  it('still admits a real readmission of the same person, which is another episode', async () => {
    const current = record({});
    const diff = await plan(current, snapshot([encounter(VALID, 'NEO1')]), marked);

    expect(diff.admissions).toEqual([
      expect.objectContaining({
        bedId: 'NEO1',
        patient: expect.objectContaining({ rut: RUN, clinicalEpisodeId: VALID }),
      }),
    ]);
  });
});
