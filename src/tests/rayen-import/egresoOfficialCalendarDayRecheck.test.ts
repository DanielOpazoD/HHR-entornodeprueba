// @vitest-environment node
// Recheck probes of W20-EGR1 (PR #1819): rows of one episode are ordered by their Rapa Nui instant,
// and contradictory official evidence holds the whole episode for review. Synthetic data only.
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

const evaluate = async (rows: EgresoReportRow[]) => {
  const { events, diff, saved } = await flow(rows);
  return {
    events: events.map(event => [event.movementDate, event.time]),
    historyTime: latestReportRowsByEpisode(rows).get(episode.encounterId)?.fechaEgreso,
    conflicts: diff.conflicts.length,
    bedOccupied: Boolean(saved.beds.R2?.patientName),
    verified: diff.discharges[0]?.verification?.hospitalDischarge,
  };
};

it.each([false, true])('medianoche con fechas acreditadas, invertir=%s', async reverse => {
  const friday = row('06-11-2026 23:00');
  const saturday = row('07-11-2026 01:00');
  expect(Date.parse('2026-11-07T01:00:00-05:00') - Date.parse('2026-11-06T23:00:00-05:00')).toBe(
    7200000
  );
  const facts = await evaluate(reverse ? [saturday, friday] : [friday, saturday]);
  expect(facts).toMatchObject({
    events: [['2026-11-07', '01:00']],
    historyTime: saturday.fechaEgreso,
    conflicts: 0,
  });
});

it.each([false, true])(
  'fila antigua a las 07:00 y masiva a las 01:00, invertir=%s',
  async reverse => {
    const early = row('07-11-2026 01:00');
    const late = row('07-11-2026 07:00', { correctedDay: census, correctedTime: '07:00' });
    const soloLate = await evaluate([late]);
    const soloEarly = await evaluate([early]);
    const mixed = await evaluate(reverse ? [late, early] : [early, late]);
    expect(soloLate.events).toEqual([['2026-11-07', '07:00']]);
    expect(soloEarly.events).toEqual([['2026-11-07', '01:00']]);
    expect(mixed.events).toEqual(soloLate.events);
  }
);

it.each([false, true])('dos filas heredadas sin día civil, invertir=%s', async reverse => {
  const rows = ['01:00', '07:00'].map(time =>
    row('', { correctedDay: census, correctedTime: time })
  );
  const facts = await evaluate(reverse ? rows.reverse() : rows);
  expect(facts.events).toEqual([['2026-11-07', '07:00']]);
});

it.each([false, true])(
  'contradicción explícita con otra fila exacta, invertir=%s',
  async reverse => {
    const valid = row('06-11-2026 23:00');
    const invalid = row('07-11-2026 01:00', {
      correctedDay: census,
      exactEpisodeVerification: 'verified',
      correctedTime: '01:00',
      correctedCalendarDay: '2026-11-31',
    });
    const rows = reverse ? [invalid, valid] : [valid, invalid];
    const facts = await evaluate(rows);
    const { reconstructHistoricalSnapshotAtClose } =
      await import('@/features/rayen-import/domain/historicalSnapshotReconstruction');
    const historical = await reconstructHistoricalSnapshotAtClose(
      census,
      {
        capturedAt: ctx.now.toISOString(),
        facilityId: 1342,
        isComplete: true,
        encounters: [],
      },
      record(),
      rows,
      { fetchReport: async () => ({ base64: '', error: 'sin trazabilidad adicional' }) }
    );
    const { replanRayenStructure } =
      await import('@/features/rayen-import/hooks/replanRayenStructure');
    for (const isHistoricalDay of [false, true]) {
      const current = record();
      const replanned = await replanRayenStructure(
        current,
        {
          sourceSnapshot: {
            capturedAt: ctx.now.toISOString(),
            facilityId: 1342,
            isComplete: true,
            encounters: [{ ...episode, hasMedicalDischarge: true }],
          },
          egresoRows: rows,
          reportDate: census,
          isHistoricalDay,
          invalidEpisodeIds: new Set(),
        },
        {
          dailyRecord: {
            getAuthoritativeForDate: async () => null,
            getLocalForDateWithMeta: async () => ({
              record: null,
              hasPendingWrites: false,
              writeState: 'none',
            }),
          } as unknown as import('@/application/ports/dailyRecordPort').DailyRecordRepositoryPort,
          isAdmin: false,
          fetchPatientFlowReport: async () => ({ base64: '', error: 'sin trazabilidad adicional' }),
          fetchStatisticalDischarge: async () => ({ base64: '', error: 'sin informe adicional' }),
          lookupEgresos: async () => [],
        }
      );
      const saved = await reread(applyCensusImportDiff(current, replanned, ctx).record);
      expect(movements(saved)).toHaveLength(0);
      expect(replanned.conflicts.length).toBeGreaterThan(0);
    }
    expect(facts.events).toEqual([]);
    expect(facts.conflicts).toBeGreaterThan(0);
    expect(facts.bedOccupied).toBe(true);
    expect(historical.conflicts.length).toBeGreaterThan(0);
  }
);

it.each([
  ['09-11-2026 12:00', '2026-11-09', '2026-11-09', '12:00'],
  ['10-11-2026 07:59', '2026-11-09', '2026-11-10', '07:59'],
  ['10-11-2026 08:00', '2026-11-10', '2026-11-10', '08:00'],
  ['08-12-2026 08:59', '2026-12-07', '2026-12-08', '08:59'],
  ['08-12-2026 09:00', '2026-12-08', '2026-12-08', '09:00'],
  ['07-11-2026 01:00', census, '2026-11-07', '01:00'],
])('control ordinario %s', async (raw, day, calendarDay, hhmm) => {
  const { events, diff } = await flow([row(raw)], record(day));
  const observed = {
    raw,
    events: events.map(m => [m.movementDate, m.time]),
    conflicts: diff.conflicts.length,
  };
  expect(observed).toMatchObject({ events: [[calendarDay, hhmm]], conflicts: 0 });
});

it.each([
  ['2026-12-08T08:59:00', '2026-12-07', '2026-12-08', '08:59'],
  ['2026-12-08T13:59:00Z', '2026-12-07', '2026-12-08', '08:59'],
  ['2026-12-08T10:59:00-03:00', '2026-12-07', '2026-12-08', '08:59'],
  ['2026-12-08T09:00:00', '2026-12-08', '2026-12-08', '09:00'],
  ['2026-12-08T14:00:00Z', '2026-12-08', '2026-12-08', '09:00'],
  ['2026-12-08T11:00:00-03:00', '2026-12-08', '2026-12-08', '09:00'],
  ['2026-11-10T08:00:00', '2026-11-10', '2026-11-10', '08:00'],
  ['2026-11-10T13:00:00Z', '2026-11-10', '2026-11-10', '08:00'],
  ['2026-11-10T10:00:00-03:00', '2026-11-10', '2026-11-10', '08:00'],
])('consulta exacta en la entrega %s', async (dateDischarge, day, calendarDay, hhmm) => {
  const { applyEgresoLookupFallback } =
    await import('@/features/rayen-import/domain/applyEgresoLookupFallback');
  const current = record(day);
  const reviewed = applyEgresoLookupFallback(
    plan(current),
    [
      {
        run: episode.run,
        encounterId: episode.encounterId,
        egreso: { dateDischarge, hasAdministrativeDischarge: true },
      },
    ],
    current
  );
  const saved = await reread(applyCensusImportDiff(current, reviewed, ctx).record);
  const observed = {
    raw: dateDischarge,
    events: movements(saved).map(m => [m.movementDate, m.time]),
    conflicts: reviewed.conflicts.length,
    verified: reviewed.discharges[0]?.verification?.hospitalDischarge,
  };
  expect(observed).toMatchObject({
    events: [[calendarDay, hhmm]],
    conflicts: 0,
    verified: 'confirmed',
  });
});
