// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  rayenToPatientData,
  type RayenEncounter,
  type EgresoReportRow,
} from '@/features/rayen-import';
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
  idFactory: () => 'egreso-prueba',
  syncRunId: 'sonda',
  now: new Date('2026-12-10T22:00:00Z'),
};
function record(date = census): DailyRecord {
  return {
    date,
    beds: { R2: { ...rayenToPatientData(episode, ctx.now).patient, bedId: 'R2' } },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    activeExtraBeds: [],
  };
}
function row(fechaEgreso: string, overrides: Partial<EgresoReportRow> = {}): EgresoReportRow {
  return {
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
  };
}
async function reread(applied: DailyRecord) {
  expect(await saveRecordStrict(applied)).toMatchObject({ ok: true, store: 'indexeddb' });
  const stored = await getRecordForDateStrict(applied.date);
  expect(stored).toBeTruthy();
  return migrateLegacyDataWithReport(stored!, applied.date).record;
}
const movements = (current: DailyRecord) => [...current.discharges, ...current.transfers];

const facts = (saved: DailyRecord, diff: ReturnType<typeof applyEgresoReport>) => ({
  events: movements(saved).map(m => [
    m.clinicalEpisodeId,
    m.movementDate,
    m.time,
    'status' in m ? m.status : 'traslado',
  ]),
  conflicts: diff.conflicts.map(c => c.reason),
  occupied: Boolean(saved.beds.R2?.patientName),
});
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
it.each([
  ['2026-11-31', false],
  ['2026-11-31', true],
  ['2026-11-08', false],
  ['2026-11-08', true],
] as const)('día civil %s con una tarde posterior, invertir=%s', async (bad, reverse) => {
  const current = record();
  const early = row('06-11-2026 08:30', {
    correctedDay: census,
    correctedTime: '08:30',
    correctedCalendarDay: bad,
  });
  const late = row('06-11-2026 17:45');
  const rows = reverse ? [late, early] : [early, late];
  const iso = ctx.now.toISOString();
  const called: string[] = [];
  const { diff } = await prepareRayenStructuralPlan({
    baseRecord: current,
    planningSnapshot: {
      facilityId: 1342,
      capturedAt: iso,
      isComplete: true,
      encounters: [{ ...episode, hasMedicalDischarge: true }],
    },
    bundle: {
      id: 'sintetico',
      startedAt: iso,
      completedAt: iso,
      facilityId: 1342,
      dateStart: census,
      dateEnd: census,
      fichaMedicoCapturedAt: iso,
      gestionCamasCapturedAt: iso,
      sourceSkewMs: 0,
      egresoRows: rows,
    },
    isHistoricalDay: false,
    reportDate: census,
    isAdmin: false,
    invalidEpisodeIds: new Set(),
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: async op => op(),
    dailyRecord: {
      getAuthoritativeForDate: async () => null,
      getLocalForDateWithMeta: async () => ({
        record: null,
        hasPendingWrites: false,
        writeState: 'none',
      }),
    } as unknown as import('@/application/ports/dailyRecordPort').DailyRecordRepositoryPort,
    evidenceClient: {
      lookupEgresos: async targets => {
        called.push(
          ...targets.map(
            t => 'lookup:' + ((typeof t === 'string' ? t : t.encounterId) || 'por documento')
          )
        );
        return [];
      },
      lookupHospitalizations: async () => ({ ok: false }),
      fetchPatientFlowReport: async () => ({ base64: '' }),
      fetchStatisticalDischarge: async () => {
        called.push('pdf');
        return { base64: 'cGRm' };
      },
    },
    extractStatisticalText: async () =>
      [
        '1.RUN: 12345678-5',
        '24 INGRESO 10-00 02-11-26 Medicina',
        '29 EGRESO 15-20 06-11-26 Domicilio',
      ].join('\n'),
  });
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  // Like main: the later Friday 17:45 egreso, whatever the malformed row says, in both orders.
  expect(facts(saved, diff).events.map(event => [event[1], event[2]])).toEqual([
    ['2026-11-06', '17:45'],
  ]);
});
