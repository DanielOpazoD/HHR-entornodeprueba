// @vitest-environment node
// Review probes of W20-EGR1 (PR #1819): official egreso calendar day from the report row through
// review, the movement, the IndexedDB save and the migrated read. Synthetic data only.
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
import { applyEgresoLookupFallback } from '@/features/rayen-import/domain/applyEgresoLookupFallback';
import { enrichReportOnlyDischarges } from '@/features/rayen-import/domain/enrichReportOnlyDischarges';
import { recoverPreviousCensusDischarges } from '@/features/rayen-import/domain/recoverPreviousCensusDischarges';
import { migrateLegacyDataWithReport } from '@/services/repositories/dataMigration';
import {
  getRecordForDateStrict,
  saveRecordStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { latestReportRowsByEpisode } from '@/features/rayen-import/domain/historicalAdministrativeEvidence';

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

for (const destino of ['Domicilio', 'Traslado']) {
  it.each([
    ['06-11-2026 08:30', census, '2026-11-06'],
    ['07-11-2026 08:30', census, '2026-11-07'],
    ['07-12-2026 08:30', '2026-12-07', '2026-12-07'],
    ['08-12-2026 08:30', '2026-12-07', '2026-12-08'],
    ['08-12-2026 09:00', '2026-12-08', '2026-12-08'],
    ['10-11-2026 07:59', '2026-11-09', '2026-11-10'],
    ['10-11-2026 08:00', '2026-11-10', '2026-11-10'],
    ['06-11-2026 23:59', census, '2026-11-06'],
    ['07-11-2026 00:00', census, '2026-11-07'],
  ])(destino + ' %s', async (raw, day, date) => {
    const { saved } = await flow([row(raw, { destino })], record(day));
    const items = destino === 'Traslado' ? saved.transfers : saved.discharges;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      movementDate: date,
      time: raw.slice(11),
      movementDateSource: 'official',
    });
    const replay = applyEgresoReport(
      plan(saved, []),
      [row('06-11-2026 17:11', { destino })],
      saved
    );
    const again = await reread(applyCensusImportDiff(saved, replay, ctx).record);
    expect(movements(again)).toEqual(movements(saved));
  });
}
it.each(['2026-11-31', '2026-11-08'])(
  'día civil oficial inválido %s se ignora: la fila se trata como en main',
  async bad => {
    const { events, saved } = await flow([
      row('', { correctedDay: census, correctedTime: '08:30', correctedCalendarDay: bad }),
    ]);
    // Census day + time with the handoff rule, exactly like a row without a calendar day.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ movementDate: '2026-11-07', time: '08:30' });
    expect(events[0].movementDateSource).toBeUndefined();
    expect(saved.beds.R2?.patientName).toBeFalsy();
  }
);
it('legacy sin día civil conserva el resultado', async () => {
  const { events } = await flow([row('', { correctedDay: census, correctedTime: '08:30' })]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ movementDate: '2026-11-07', time: '08:30' });
  expect(events[0].movementDateSource).toBeUndefined();
});
it('CEN-01 mantiene cama ante captura parcial y ninguna fila', async () => {
  const current = record();
  const diff = applyEgresoReport(plan(current, [], false), [], current);
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  expect(saved.beds.R2?.clinicalEpisodeId).toBe(episode.encounterId);
  expect(movements(saved)).toHaveLength(0);
});
it.each([
  '2026-11-06T13:30:00Z',
  '2026-11-06T10:30:00-03:00',
  '2026-11-06T08:30:00',
  '2026-11-31T13:30:00Z',
])('consulta por episodio %s', async raw => {
  const current = record();
  const diff = applyEgresoLookupFallback(
    plan(current),
    [
      {
        run: episode.run,
        encounterId: episode.encounterId,
        egreso: { dateDischarge: raw, hasAdministrativeDischarge: true },
      },
    ],
    current
  );
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  if (raw.includes('-31')) {
    expect(movements(saved)).toHaveLength(0);
    expect(saved.beds.R2?.patientName).toBeTruthy();
  } else
    expect(movements(saved)[0]).toMatchObject({
      movementDate: census,
      time: '08:30',
      movementDateSource: 'official',
    });
});
it.each([
  '2026-11-07T13:30:00Z',
  '2026-11-07T10:30:00-0300',
  '2026-11-07T10:30:00-03:00',
  '2026-11-31T13:30:00Z',
])('recuperación desde D-1 %s', async raw => {
  const prev = record('2026-11-05'),
    current = { ...record(), beds: {} };
  const snapshot = {
    capturedAt: ctx.now.toISOString(),
    facilityId: 1342,
    isComplete: true,
    encounters: [],
  };
  const rows = await recoverPreviousCensusDischarges(
    prev,
    current,
    plan(current, []),
    snapshot,
    async () => [
      {
        run: episode.run,
        encounterId: episode.encounterId,
        egreso: { id: 91001, dateDischarge: raw, hasAdministrativeDischarge: true },
      },
    ]
  );
  const diff = applyEgresoReport(plan(current, []), rows, current);
  const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
  if (raw.includes('-31')) expect(movements(saved)).toHaveLength(0);
  else
    expect(movements(saved)[0]).toMatchObject({
      movementDate: '2026-11-07',
      time: '08:30',
      movementDateSource: 'official',
    });
});
it.each(['06', '07'])('texto PDF del %s → revisión → movimiento', async dd => {
  const [source] = await enrichReportOnlyDischarges(
    [row(dd + '-11-2026 08:30', { encounterId: '' })],
    census,
    {
      lookupEgresos: async () => [
        { run: episode.run, encounterId: episode.encounterId, egreso: { id: 91001 } },
      ],
      fetchStatisticalDischarge: async () => ({ base64: 'cGRm' }),
      extractText: async () =>
        [
          '1.RUN: 12345678-5',
          '24 INGRESO 10-00 02-11-26 Medicina',
          '29 EGRESO 08-30 ' + dd + '-11-26 Domicilio',
        ].join('\n'),
    }
  );
  expect(source.exactEpisodeVerification).toBe('verified');
  const { events } = await flow([source]);
  expect(events[0]).toMatchObject({
    movementDate: '2026-11-' + dd,
    time: '08:30',
    movementDateSource: 'official',
  });
});
it('el historial y la aplicación eligen la fecha civil más reciente en ambos órdenes', async () => {
  const first = row('06-11-2026 08:30'),
    latest = row('07-11-2026 08:30');
  const observed: { first: string; history?: string; movement?: string }[] = [];
  for (const rows of [
    [first, latest],
    [latest, first],
  ]) {
    const { events } = await flow(rows);
    observed.push({
      first: rows[0].fechaEgreso,
      history: latestReportRowsByEpisode(rows).get(episode.encounterId)?.fechaEgreso,
      movement: events[0]?.movementDate,
    });
  }
  expect(observed.map(o => o.movement)).toEqual(['2026-11-07', '2026-11-07']);
  expect(observed.map(o => o.history)).toEqual(['07-11-2026 08:30', '07-11-2026 08:30']);
});
it('egreso de viernes antes de su ingreso a mediodía permanece para revisión', async () => {
  const current = record();
  current.beds.R2.admissionDate = census;
  current.beds.R2.admissionTime = '12:00';
  const { saved, events, diff } = await flow([row('06-11-2026 08:30')], current);
  expect(events).toHaveLength(0);
  expect(saved.beds.R2.patientName).toBeTruthy();
  expect(diff.conflicts.length).toBeGreaterThan(0);
});
it('el historial conserva la elección de main entre la fila corregida de las 00:30 y la de las 21:30', () => {
  const late = row('04-11-2026 21:30');
  const early = row('05-11-2026 00:30', {
    correctedDay: '2026-11-04',
    correctedTime: '00:30',
    correctedCalendarDay: '2026-11-05',
  });
  expect(latestReportRowsByEpisode([late, early]).get(episode.encounterId)).toBe(late);
});
it('archivar en el censo previo conserva el día y la hora incluso tras reintento', async () => {
  const { fileCrossDayCorrections, computePreviousDayEdits } =
    await import('@/features/rayen-import/domain/previousDayCorrections');
  type Port = import('@/application/ports/dailyRecordPort').DailyRecordRepositoryPort;
  const day = '2026-11-08',
    current = { ...record(day), beds: {} },
    historical = { ...record(census), beds: {} };
  await reread(historical);
  const port = {
    getAuthoritativeForDate: getRecordForDateStrict,
    getLocalForDateWithMeta: async () => ({
      record: null,
      hasPendingWrites: false,
      writeState: 'none',
    }),
    updatePartialDetailed: async (date: string, patch: Partial<DailyRecord>) => {
      const before = await getRecordForDateStrict(date);
      expect(before).toBeTruthy();
      const saved = await saveRecordStrict({ ...before!, ...patch });
      expect(saved.store).toBe('indexeddb');
      return { savedHere: true, state: 'confirmed', localCopy: 'current' };
    },
  } as unknown as Port;
  for (const raw of ['06-11-2026 08:30', '07-11-2026 08:40']) {
    const diff = applyEgresoReport(plan(current, []), [row(raw)], current);
    const planned = await computePreviousDayEdits(port, diff, day, true);
    await fileCrossDayCorrections(
      port,
      current,
      { ...diff, reportEgresos: planned.reportEgresos, previousDayEdits: planned.edits },
      day,
      true,
      ctx.idFactory,
      { syncRunId: ctx.syncRunId }
    );
    const stored = await getRecordForDateStrict(census);
    const events = movements(migrateLegacyDataWithReport(stored!, census).record);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      movementDate: census,
      time: '08:30',
      movementDateSource: 'official',
    });
  }
});
