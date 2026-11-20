// @vitest-environment node
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
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
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
const movements = (current: DailyRecord) => [...current.discharges, ...current.transfers];
async function flow(rows: EgresoReportRow[], current = record()) {
  const diff = applyEgresoReport(plan(current), rows, current);
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  return { diff, saved, events: movements(saved) };
}

it.each([false, true])(
  'un mes 13 no cambia la hora de la última fila legible, invertir=%s',
  async reverse => {
    const early = row('06-11-2026 12:15', { correctedDay: '2026-13-06', correctedTime: '07:00' });
    const late = row('06-11-2026 17:45');
    const rows = reverse ? [late, early] : [early, late];
    const { saved, diff } = await flow(rows);
    expect(movements(saved).map(m => m.time)).toEqual(['17:45']);
    expect(diff.conflicts).toEqual([]);
  }
);

it.each([false, true])(
  'duplicados del mismo egreso con día imposible, invertir=%s',
  async reverse => {
    const duplicate = row('06-11-2026 15:20', {
      encounterId: '',
      correctedDay: census,
      correctedTime: '15:20',
    });
    const bad = { ...duplicate, correctedCalendarDay: '2026-11-31' };
    const current = record();
    const rows = reverse ? [bad, duplicate] : [duplicate, bad];
    const calls: string[] = [];
    const exact = {
      run: episode.run,
      encounterId: episode.encounterId,
      egreso: {
        id: 91001,
        dateDischarge: '2026-11-06T20:20:00Z',
        hasAdministrativeDischarge: true,
      },
    };
    const enriched = await enrichReportOnlyDischarges(rows, census, {
      lookupEgresos: async targets => {
        calls.push('lookup:' + targets.length);
        return [exact];
      },
      fetchStatisticalDischarge: async () => {
        calls.push('pdf');
        return { base64: 'cGRm' };
      },
      extractText: async () =>
        [
          '1.RUN: 12345678-5',
          '24 INGRESO 10-00 02-11-26 Medicina',
          '29 EGRESO 15-20 06-11-26 Domicilio',
        ].join('\n'),
    });
    const { saved, diff } = await flow(enriched, current);
    expect(movements(saved).map(m => m.time)).toEqual(['15:20']);
    expect(diff.conflicts).toEqual([]);
  }
);

it('límites completos antes de sábado y feriado con relectura', async () => {
  const mismatches: string[] = [];
  for (const day of ['2026-11-06', '2026-12-07']) {
    for (let minute = 0; minute < 60; minute++) {
      const time = '08:' + String(minute).padStart(2, '0');
      const { saved, events } = await flow(
        [row('', { correctedDay: day, correctedCalendarDay: day, correctedTime: time })],
        record(day)
      );
      if (events.length !== 1 || events[0]?.movementDate !== day || events[0]?.time !== time)
        mismatches.push(day + ' ' + time);
      expect.soft(saved.beds.R2?.patientName).toBeFalsy();
    }
  }
  expect(mismatches.length).toBe(0);
}, 60000);

import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
it.each([
  ['mes13', true],
  ['duplicado', true],
  ['mes13', false],
  ['duplicado', false],
] as const)(
  'preparar plan completo y releer, %s, con campo malformado=%s',
  async (mode, malformed) => {
    const current = mode === 'mes13' ? record() : { ...record(), beds: {} };
    const exact = {
      run: episode.run,
      encounterId: episode.encounterId,
      egreso: {
        id: 91001,
        dateDischarge: '2026-11-06T20:20:00Z',
        hasAdministrativeDischarge: true,
      },
    };
    const duplicate = row('06-11-2026 15:20', {
      encounterId: '',
      correctedDay: census,
      correctedTime: '15:20',
    });
    const rows =
      mode === 'mes13'
        ? [
            row('06-11-2026 12:15', { correctedDay: '2026-13-06', correctedTime: '07:00' }),
            row('06-11-2026 17:45'),
          ]
        : [duplicate, { ...duplicate, correctedCalendarDay: '2026-11-31' }];
    if (!malformed) {
      if (mode === 'mes13') delete rows[0].correctedDay;
      else delete rows[1].correctedCalendarDay;
    }
    const iso = ctx.now.toISOString();
    const called: string[] = [];
    const { diff } = await prepareRayenStructuralPlan({
      baseRecord: current,
      planningSnapshot: {
        facilityId: 1342,
        capturedAt: iso,
        isComplete: true,
        encounters: mode === 'mes13' ? [{ ...episode, hasMedicalDischarge: true }] : [],
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
          return mode === 'duplicado' && targets.length ? [exact] : [];
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
    expect(movements(saved).map(m => m.time)).toEqual([mode === 'mes13' ? '17:45' : '15:20']);
  }
);

// Measured on main (191aeb154) with this same matrix.
const MAIN_RESULTS: unknown[] = [
  [['2026-11-07 08:30'], 0, false, 0, 0],
  [['2026-11-07 08:30'], 0, false, 0, 0],
  [['2026-11-07 08:30'], 0, false, 0, 0],
  [['2026-11-07 08:30'], 0, false, 0, 0],
  [['2026-11-06 23:00'], 0, false, 1, 0],
  [['2026-11-06 23:00'], 0, false, 1, 0],
  [['2026-11-06 23:00'], 0, false, 0, 0],
  [['2026-11-06 23:00'], 0, false, 0, 0],
  [[], 1, true, 1, 0],
  [[], 1, true, 1, 0],
  [[], 1, true, 1, 0],
  [[], 1, true, 1, 0],
  [[], 1, true, 1, 0],
  [[], 1, true, 1, 0],
];

it('matriz A/B de una fila inválida en censo e histórico', async () => {
  const cases = [
    row('', { correctedDay: census, correctedTime: '08:30', correctedCalendarDay: '2026-11-31' }),
    row('', { correctedDay: census, correctedTime: '08:30', correctedCalendarDay: '2026-11-08' }),
    row('', { correctedDay: census, correctedTime: '08:30', correctedCalendarDay: 'texto' }),
    row('', { correctedDay: census, correctedTime: '08:30', correctedCalendarDay: '2026-13-06' }),
    row('06-11-2026 23:00', { correctedDay: '2026-13-06', correctedTime: '07:00' }),
    row('06-11-2026 23:00', { correctedDay: '2026-11-31', correctedTime: '07:00' }),
    row('06-11-2026 23:00', {
      correctedDay: census,
      correctedTime: '24:07',
      correctedCalendarDay: census,
    }),
    row('06-11-2026 23:00', {
      correctedDay: census,
      correctedTime: '07:60',
      correctedCalendarDay: census,
    }),
    row('06-13-2026 23:00'),
    row('31-11-2026 13:00'),
    row('29-02-2026 23:00'),
    row(''),
    row('ilegible'),
    row('', { correctedDay: '2026-13-06', correctedTime: '07:00' }),
  ];
  const { reconstructHistoricalSnapshotAtClose } =
    await import('@/features/rayen-import/domain/historicalSnapshotReconstruction');
  // Each malformed row alone gives main's result: movements, conflicts, occupancy and history.
  const observed: unknown[] = [];
  for (const source of cases) {
    const { saved, diff } = await flow([source]);
    const hist = await reconstructHistoricalSnapshotAtClose(
      census,
      { capturedAt: ctx.now.toISOString(), facilityId: 1342, isComplete: true, encounters: [] },
      record(),
      [source],
      { fetchReport: async () => ({ base64: '', error: 'sin informe adicional' }) }
    );
    observed.push([
      movements(saved).map(m => `${m.movementDate} ${m.time}`),
      diff.conflicts.length,
      Boolean(saved.beds.R2?.patientName),
      hist.conflicts.length,
      hist.snapshot.encounters.length,
    ]);
  }
  expect(observed).toEqual(MAIN_RESULTS);
});
