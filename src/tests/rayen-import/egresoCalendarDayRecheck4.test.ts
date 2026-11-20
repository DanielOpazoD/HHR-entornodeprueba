// @vitest-environment node
// Final review probes of W20-EGR1 (PR #1819): instants main accepted stay accepted, a non-text
// calendar day is absent, and row selection keeps every firm choice of main. Synthetic data only.
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type RayenCensusSnapshot,
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
function plan(
  current: DailyRecord,
  encounters: RayenEncounter[] = [{ ...episode, hasMedicalDischarge: true }],
  isComplete = true
) {
  const snapshot: RayenCensusSnapshot = {
    capturedAt: ctx.now.toISOString(),
    facilityId: 1342,
    isComplete,
    encounters,
  };
  return reconcileCensus(current, snapshot, { reference: ctx.now });
}
async function reread(applied: DailyRecord) {
  expect(await saveRecordStrict(applied)).toMatchObject({ ok: true, store: 'indexeddb' });
  const stored = await getRecordForDateStrict(applied.date);
  expect(stored).toBeTruthy();
  return migrateLegacyDataWithReport(stored!, applied.date).record;
}

import { isRayenSyncBundle } from '@/features/rayen-import/bridge/rayenSnapshotBridge';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { recoverPreviousCensusDischarges } from '@/features/rayen-import/domain/recoverPreviousCensusDischarges';
import {
  correctedStamp,
  selectReportRowsByEpisode,
} from '@/features/rayen-import/domain/egresoReportPolicy';
import {
  latestReportRowsByEpisode,
  reportClinicalStamp,
} from '@/features/rayen-import/domain/historicalAdministrativeEvidence';

it.each([
  ['texto inválido', '2026-11-31'],
  ['ausente', undefined],
  ['nulo', null],
  ['lista de una fecha', ['2026-11-06']],
  ['objeto simple', { day: census }],
])('paquete sintético y planificación con día civil %s', async (_label, value) => {
  const current = record();
  const iso = ctx.now.toISOString();
  const bundle: unknown = {
    id: 'sintetico',
    startedAt: iso,
    completedAt: iso,
    facilityId: 1342,
    dateStart: census,
    dateEnd: census,
    fichaMedicoCapturedAt: iso,
    gestionCamasCapturedAt: iso,
    sourceSkewMs: 0,
    egresoRows: [
      {
        ...row('06-11-2026 15:20', { correctedDay: census, correctedTime: '15:20' }),
        correctedCalendarDay: value,
      },
    ],
  };
  const accepted = isRayenSyncBundle(bundle);
  if (!accepted) throw new Error('Puente no admitió el paquete');
  const { diff } = await prepareRayenStructuralPlan({
    baseRecord: current,
    planningSnapshot: {
      facilityId: 1342,
      capturedAt: iso,
      isComplete: true,
      encounters: [{ ...episode, hasMedicalDischarge: true }],
    },
    bundle,
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
    } as never,
    evidenceClient: {
      lookupEgresos: async () => [],
      lookupHospitalizations: async () => ({ ok: false }),
      fetchPatientFlowReport: async () => ({ base64: '' }),
      fetchStatisticalDischarge: async () => ({ base64: '' }),
    },
  });
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  expect(saved.discharges[0]?.time).toBe('15:20');
  expect(diff.conflicts).toEqual([]);
});

it.each([
  '2026-11-06T20:20:00Z',
  '2026-11-06t20:20:00z',
  '2026-11-06 20:20:00+00:00',
  '2026-11-06T24:00:00Z',
  '2026-11-07T00:00:00Z',
])('recuperar desde D-1 con instante %s', async raw => {
  const previous = record('2026-11-05'),
    current = { ...record(), beds: {} };
  const snap = {
    capturedAt: ctx.now.toISOString(),
    facilityId: 1342,
    isComplete: true,
    encounters: [],
  };
  const calls: unknown[] = [];
  const rows = await recoverPreviousCensusDischarges(
    previous,
    current,
    plan(current, []),
    snap,
    async targets => {
      calls.push(targets);
      return [
        {
          run: episode.run,
          encounterId: episode.encounterId,
          egreso: { id: 91001, dateDischarge: raw, hasAdministrativeDischarge: true },
        },
      ];
    }
  );
  const diff = applyEgresoReport(plan(current, []), rows, current);
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  expect(saved.discharges).toHaveLength(1);
});

it('A/B de orden por episodio en el censo y el historial, en ambas permutaciones', () => {
  const contenders: EgresoReportRow[] = [];
  for (const time of ['01:00', '07:59', '08:00', '08:30', '08:59', '09:00', '17:45', '23:00']) {
    for (const dd of ['06', '07']) {
      const raw = dd + '-11-2026 ' + time;
      contenders.push(row(raw));
      for (const correctedDay of [census, '2026-11-07', '2026-13-06']) {
        for (const correctedCalendarDay of [undefined, census, '2026-11-07', '2026-11-31']) {
          contenders.push(row(raw, { correctedDay, correctedTime: time, correctedCalendarDay }));
        }
      }
    }
  }
  // Main's key: census day + time (census) and the history key of the row read without the new
  // field. Main keeps the first row on equal keys, so only different keys are a firm choice of main
  // that must hold in both orders; only main's ties may be broken by a valid calendar day.
  const censusKey = (r: EgresoReportRow) => {
    const stamp = correctedStamp(r.fechaEgreso, r.correctedDay, r.correctedTime);
    return `${stamp.correctedDay}T${stamp.correctedTime}`;
  };
  const historyKey = (r: EgresoReportRow) => {
    const stamp = reportClinicalStamp({ ...r, correctedCalendarDay: undefined });
    return stamp ? `${stamp.calendarIso}T${stamp.hhmm}` : null;
  };
  type Winner = (p: EgresoReportRow[]) => EgresoReportRow | undefined;
  const censusWinner: Winner = (p: EgresoReportRow[]) =>
    Array.from(selectReportRowsByEpisode(p, () => episode.encounterId).primaryByRun.values())[0];
  const historicalWinner = (p: EgresoReportRow[]) =>
    latestReportRowsByEpisode(p).get(episode.encounterId);
  let firm = 0;
  const changed: string[] = [];
  for (let i = 0; i < contenders.length; i++)
    for (let j = i + 1; j < contenders.length; j++) {
      const [a, b] = [contenders[i], contenders[j]];
      const checks: [Winner, EgresoReportRow | undefined][] = [];
      const [ca, cb] = [censusKey(a), censusKey(b)];
      if (ca !== cb) checks.push([censusWinner, cb > ca ? b : a]);
      const [ha, hb] = [historyKey(a), historyKey(b)];
      if (ha === null || hb === null)
        checks.push([historicalWinner, (ha ?? hb) ? (ha ? a : b) : undefined]);
      else if (ha !== hb) checks.push([historicalWinner, hb > ha ? b : a]);
      for (const [winner, expected] of checks) {
        firm++;
        if (winner([a, b]) !== expected || winner([b, a]) !== expected)
          changed.push(
            JSON.stringify(
              [a, b].map(r => [
                r.fechaEgreso,
                r.correctedDay,
                r.correctedTime,
                r.correctedCalendarDay,
              ])
            )
          );
      }
    }
  expect(firm).toBeGreaterThan(30000);
  expect(changed.slice(0, 5)).toEqual([]);
}, 120000);

it.each([false, true])(
  'historial con dos instantes distintos del mismo episodio, invertir=%s',
  reverse => {
    const early = row('2026-11-06T18:20:00Z');
    const late = row('2026-11-06t20:20:00z');
    const rows = reverse ? [late, early] : [early, late];
    const winner = latestReportRowsByEpisode(rows).get(episode.encounterId);
    expect(winner).toBe(late);
  }
);

it.each(['2026-11-06T20:20:00Z', '2026-11-06t20:20:00z', '2026-11-06 20:20:00+00:00'])(
  'plan completo con respuesta administrativa D-1 %s',
  async raw => {
    const previous = record('2026-11-05');
    const current = { ...record(), beds: {} };
    const iso = ctx.now.toISOString();
    const calls: string[] = [];
    const { diff } = await prepareRayenStructuralPlan({
      baseRecord: current,
      planningSnapshot: { facilityId: 1342, capturedAt: iso, isComplete: true, encounters: [] },
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
        egresoRows: [],
      },
      isHistoricalDay: false,
      reportDate: census,
      isAdmin: true,
      invalidEpisodeIds: new Set(),
      counters: { requests: 0, cacheHits: 0, timeouts: 0 },
      measureEvidence: async op => op(),
      dailyRecord: {
        getAuthoritativeForDate: async (day: string) => (day === previous.date ? previous : null),
        getForDate: async (day: string) => (day === previous.date ? previous : null),
        getLocalForDateWithMeta: async () => ({
          record: null,
          hasPendingWrites: false,
          writeState: 'none',
        }),
      } as never,
      evidenceClient: {
        lookupEgresos: async targets =>
          targets.flatMap(t => {
            if (typeof t === 'string' || t.encounterId !== episode.encounterId) return [];
            calls.push(t.encounterId);
            return [
              {
                run: episode.run,
                encounterId: episode.encounterId,
                egreso: { id: 91001, dateDischarge: raw, hasAdministrativeDischarge: true },
              },
            ];
          }),
        lookupHospitalizations: async () => ({ ok: false }),
        fetchPatientFlowReport: async () => ({ base64: '' }),
        fetchStatisticalDischarge: async () => ({ base64: '' }),
      },
    });
    const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
    expect(saved.discharges[0]).toMatchObject({ movementDate: census, time: '15:20' });
  }
);
