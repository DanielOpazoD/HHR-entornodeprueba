// @vitest-environment node
// Fuzz of the official egreso calendar day (W20-EGR1): only a valid, coherent text YYYY-MM-DD may
// change a result. Any other value is absent, so a row reads exactly as on main, where the field
// does not exist. Synthetic data only.
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type EgresoReportRow,
  type RayenEncounter,
} from '@/features/rayen-import';
import { correctedStamp } from '@/features/rayen-import/domain/egresoReportPolicy';
import {
  latestReportRowsByEpisode,
  reportClinicalStamp,
} from '@/features/rayen-import/domain/historicalAdministrativeEvidence';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  getRecordForDateStrict,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const census = '2026-11-06';
const episode: RayenEncounter = {
  encounterId: '91001',
  run: '123456785',
  firstGivenName: 'Persona',
  firstFamilyName: 'Sintética',
  room: 'Sala 1',
  bed: 'R2',
  service: 'Área Médico Quirúrgica Indiferenciada',
  admissionDatetime: '2026-11-02T10:00:00-05:00',
};
const ctx = {
  idFactory: () => 'egreso-fuzz',
  syncRunId: 'fuzz',
  now: new Date('2026-12-10T22:00:00Z'),
};
const record = (): DailyRecord => ({
  date: census,
  beds: { R2: { ...rayenToPatientData(episode, ctx.now).patient, bedId: 'R2' } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});
const row = (fechaEgreso: string, overrides: Partial<EgresoReportRow> = {}): EgresoReportRow => ({
  run: '12.345.678-5',
  encounterId: episode.encounterId,
  patientName: 'Persona Sintética',
  bedLabel: 'R2',
  servicio: 'Área Médico Quirúrgica',
  edad: '',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso,
  ...overrides,
});

/** Everything a user or the history can observe from one report row. */
const observe = async (source: EgresoReportRow) => {
  const current = record();
  const plan = reconcileCensus(
    current,
    {
      capturedAt: ctx.now.toISOString(),
      facilityId: 1342,
      isComplete: true,
      encounters: [{ ...episode, hasMedicalDischarge: true }],
    },
    { reference: ctx.now }
  );
  const diff = applyEgresoReport(plan, [source], current);
  const applied = applyCensusImportDiff(current, diff, ctx).record;
  expect(await saveRecordStrict(applied)).toMatchObject({ ok: true });
  const saved = migrateLegacyDataWithReport((await getRecordForDateStrict(census))!, census).record;
  const history = await reconstructHistoricalSnapshotAtClose(
    census,
    { capturedAt: ctx.now.toISOString(), facilityId: 1342, isComplete: true, encounters: [] },
    record(),
    [source],
    { fetchReport: async () => ({ base64: '', error: 'sin informe adicional' }) }
  );
  const stamp = correctedStamp(
    source.fechaEgreso,
    source.correctedDay,
    source.correctedTime,
    source.correctedCalendarDay
  );
  return {
    stamp: [stamp.correctedDay ?? null, stamp.correctedTime ?? null],
    clinical: reportClinicalStamp(source),
    latest: latestReportRowsByEpisode([source]).has(episode.encounterId),
    movements: [...saved.discharges, ...saved.transfers].map(m => [
      m.movementDate,
      m.time,
      m.movementDateSource ?? null,
    ]),
    conflicts: diff.conflicts.map(c => c.reason),
    occupied: Boolean(saved.beds.R2?.patientName),
    historyConflicts: history.conflicts.length,
    historyEncounters: history.snapshot.encounters.length,
  };
};

const BASE_ROWS: [string, EgresoReportRow][] = [
  ['antigua 08:30', row('06-11-2026 08:30', { correctedDay: census, correctedTime: '08:30' })],
  ['antigua 15:20', row('', { correctedDay: census, correctedTime: '15:20' })],
  ['masiva sábado 08:30', row('07-11-2026 08:30')],
  ['mes 13', row('06-11-2026 12:15', { correctedDay: '2026-13-06', correctedTime: '07:00' })],
];

// Values that are not a valid text calendar day coherent with these rows (types and formats).
const ODD_VALUES: unknown[] = [
  null,
  '',
  ' ',
  'texto',
  '2026-11-31',
  '2026-13-06',
  '2026-02-29',
  '2026-11-05',
  '2026-11-08',
  ' 2026-11-06',
  '2026-11-06 ',
  '2026-11-6',
  '06-11-2026',
  '2026/11/06',
  '2026-11-06T00:00:00Z',
  ['2026-11-06'],
  { day: '2026-11-06' },
  20261106,
  true,
  Number.NaN,
  new Date('2026-11-06T12:00:00Z'),
];

// Same rows without the field, measured on main (9d0fa122a) with this observation. Movements are
// compared by date and time: main has no `movementDateSource` marker.
const MAIN_RESULTS: Record<string, unknown> = {
  'antigua 08:30': {
    stamp: ['2026-11-06', '08:30'],
    clinical: { iso: '2026-11-06', calendarIso: '2026-11-06', hhmm: '08:30' },
    latest: true,
    movements: [['2026-11-07', '08:30']],
    conflicts: [],
    occupied: false,
    historyConflicts: 0,
    historyEncounters: 0,
  },
  'antigua 15:20': {
    stamp: ['2026-11-06', '15:20'],
    clinical: { iso: '2026-11-06', calendarIso: '2026-11-06', hhmm: '15:20' },
    latest: true,
    movements: [['2026-11-06', '15:20']],
    conflicts: [],
    occupied: false,
    historyConflicts: 0,
    historyEncounters: 0,
  },
  'masiva sábado 08:30': {
    stamp: ['2026-11-06', '08:30'],
    clinical: { iso: '2026-11-06', calendarIso: '2026-11-07', hhmm: '08:30' },
    latest: true,
    movements: [['2026-11-07', '08:30']],
    conflicts: [],
    occupied: false,
    historyConflicts: 0,
    historyEncounters: 0,
  },
  'mes 13': {
    stamp: ['2026-11-06', '12:15'],
    clinical: { iso: '2026-13-06', calendarIso: '2026-13-06', hhmm: '07:00' },
    latest: true,
    movements: [['2026-11-06', '12:15']],
    conflicts: [],
    occupied: false,
    historyConflicts: 1,
    historyEncounters: 0,
  },
};

it.each(BASE_ROWS)(
  '%s: ningún valor raro del día civil cambia el resultado de main',
  async (label, base) => {
    const baseline = await observe(base);
    expect({
      ...baseline,
      movements: baseline.movements.map(([date, time]) => [date, time]),
    }).toEqual(MAIN_RESULTS[label]);
    for (const value of ODD_VALUES) {
      const source = { ...base, correctedCalendarDay: value } as unknown as EgresoReportRow;
      expect({ value: String(value), ...(await observe(source)) }).toEqual({
        value: String(value),
        ...baseline,
      });
    }
  }
);
