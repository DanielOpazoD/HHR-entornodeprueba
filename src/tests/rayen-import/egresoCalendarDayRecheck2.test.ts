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

import {
  encounter,
  newborn,
  recordWith,
  snapshotOf,
  dischargeRow,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { createHash } from 'node:crypto';

it('un RN con día civil inválido sale con su propia hora, como en main', async () => {
  const mother = encounter({ encounterId: '71001' });
  const baby = { ...newborn(), encounterId: '71002' };
  const base = recordWith(mother, baby);
  const input = reconcileCensus(
    base,
    { ...snapshotOf([]), isComplete: true },
    { reference: REFERENCE }
  );
  const report = [
    dischargeRow(mother),
    {
      ...dischargeRow(baby),
      correctedTime: '13:00',
      correctedDay: base.date,
      correctedCalendarDay: '2026-07-32',
      exactEpisodeVerification: 'verified' as const,
    },
    { ...dischargeRow(baby), fechaEgreso: '08-07-2026 13:00' },
  ];
  const validPlan = applyEgresoReport(input, [report[0], report[2]], base);
  // Control: both readable rows; mother 10:00 and RN 11:00 as on main.
  const validSaved = await reread(
    applyCensusImportDiff(base, validPlan, {
      ...ctx,
      idFactory: (() => {
        let n = 0;
        return () => String(++n);
      })(),
    }).record
  );
  expect(movements(validSaved).map(m => [m.clinicalEpisodeId, m.time, m.isNested])).toEqual([
    ['71001', '10:00', false],
    ['71002', '11:00', true],
  ]);
  const diff = applyEgresoReport(input, report, base);
  let id = 0;
  const saved = await reread(
    applyCensusImportDiff(base, diff, { ...ctx, idFactory: () => String(++id) }).record
  );
  const facts = {
    events: movements(saved).map(m => [m.clinicalEpisodeId, m.time, m.isNested]),
    conflicts: diff.conflicts.map(c => c.reason),
    remaining: Object.values(saved.beds)
      .flatMap(b => [b.clinicalEpisodeId, b.clinicalCrib?.clinicalEpisodeId])
      .filter(Boolean),
  };
  // The invalid calendar day is ignored: the RN row reads as on main (its corrected 13:00).
  expect(facts).toEqual({
    events: [
      ['71001', '10:00', false],
      ['71002', '13:00', true],
    ],
    conflicts: [],
    remaining: [],
  });
});

it('fila heredada con mes imposible y texto masivo legible no interrumpe la reconstrucción', async () => {
  const source = row('06-11-2026 23:00', { correctedDay: '2026-13-06', correctedTime: '07:00' });
  const result = await reconstructHistoricalSnapshotAtClose(
    census,
    { capturedAt: ctx.now.toISOString(), facilityId: 1342, isComplete: true, encounters: [] },
    record(),
    [source],
    {
      fetchReport: async () => ({ base64: '', error: 'sin trazabilidad adicional' }),
    }
  );
  expect(result.snapshot).toBeDefined();
});

it('paridad de una sola fila heredada en todas las horas y minutos del día', () => {
  const hash = createHash('sha256');
  let count = 0;
  for (const day of [
    '2026-11-05',
    '2026-11-06',
    '2026-11-07',
    '2026-11-08',
    '2026-12-07',
    '2026-12-08',
  ]) {
    const current = record(day);
    const initial = plan(current);
    for (let minute = 0; minute < 1440; minute++) {
      const time = [Math.floor(minute / 60), minute % 60]
        .map(n => String(n).padStart(2, '0'))
        .join(':');
      const diff = applyEgresoReport(
        initial,
        [row('', { correctedDay: day, correctedTime: time })],
        current
      );
      const applied = applyCensusImportDiff(current, diff, ctx).record;
      expect(diff.conflicts).toHaveLength(0);
      expect(movements(applied)).toHaveLength(1);
      const m = movements(applied)[0];
      hash.update(
        JSON.stringify([
          day,
          time,
          m.movementDate,
          m.time,
          m.clinicalEpisodeId,
          m.movementDateSource,
          Boolean(applied.beds.R2?.patientName),
        ])
      );
      count++;
    }
  }
  // Measured on main (191aeb154): one legacy row per minute gives the same movements.
  expect(`${count} ${hash.digest('hex')}`).toBe(
    '8640 a5e9817698b2009133f6a52783de855a362e781cf972e51d09bba6fbc79bd7b9'
  );
}, 120000);

it.each(['06', '07'])('masivo, consulta y PDF de %s coinciden en un alta ordinaria', async dd => {
  const raw = dd + '-11-2026 08:30';
  const exact = {
    run: episode.run,
    encounterId: episode.encounterId,
    egreso: {
      id: 91001,
      dateDischarge: '2026-11-' + dd + 'T13:30:00Z',
      hasAdministrativeDischarge: true,
    },
  };
  const [pdf] = await enrichReportOnlyDischarges([row(raw, { encounterId: '' })], census, {
    lookupEgresos: async () => [exact],
    fetchStatisticalDischarge: async () => ({ base64: 'cGRm' }),
    extractText: async () =>
      [
        '1.RUN: 12345678-5',
        '24 INGRESO 10-00 02-11-26 Medicina',
        '29 EGRESO 08-30 ' + dd + '-11-26 Domicilio',
      ].join('\n'),
  });
  expect(pdf.exactEpisodeVerification).toBe('verified');
  const { reportRowFromLookup } =
    await import('@/features/rayen-import/domain/applyEgresoLookupFallback');
  const rows = [
    row(raw),
    pdf,
    reportRowFromLookup(exact, { patientName: 'Persona Sintética', bedId: 'R2' }),
  ];
  for (const order of [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
    [1, 0, 2],
    [0, 2, 1],
  ]) {
    const { diff, events, saved } = await flow(order.map(i => rows[i]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ time: '08:30', movementDate: '2026-11-' + dd });
    expect(diff.conflicts).toHaveLength(0);
    expect(saved.beds.R2.patientName).toBeFalsy();
  }
});
it.each([
  ['coincide', '07:00', '2026-11-07', false, 0],
  ['día diferente', '07:00', '2026-11-05', false, 1],
  ['hora diferente', '07:01', '2026-11-07', false, 1],
  ['dos folios', '07:00', '2026-11-07', true, 1],
] as const)(
  'cuna ya registrada de madrugada, %s',
  async (_label, time, day, twins, minimumConflicts) => {
    const { replanRayenStructure } =
      await import('@/features/rayen-import/hooks/replanRayenStructure');
    const base = {
      ...record(),
      beds: {},
      discharges: [
        {
          id: 'rn-guardado',
          bedId: 'H5C1',
          bedName: 'Cuna H5C1',
          bedType: 'Cuna',
          patientName: 'RN Sintético',
          rut: '',
          diagnosis: '',
          clinicalEpisodeId: '700002',
          isNested: true,
          movementDate: day,
          time,
          status: 'Vivo' as const,
        },
      ],
    };
    const legacy = row('', {
      correctedDay: census,
      correctedTime: '07:00',
      run: '7654321',
      encounterId: '',
      patientName: 'RN Sintético',
      bedLabel: 'Cuna H5C1',
      exactEpisodeVerification: 'unverified',
    });
    for (const historical of [false, true]) {
      let current = await reread(base);
      for (let attempt = 1; attempt <= 2; attempt++) {
        const rows = twins ? [legacy, { ...legacy, run: '7654322' }] : [legacy];
        const diff = await replanRayenStructure(
          current,
          {
            reportDate: census,
            egresoRows: rows,
            isHistoricalDay: historical,
            invalidEpisodeIds: new Set(),
            sourceSnapshot: {
              capturedAt: ctx.now.toISOString(),
              facilityId: 1342,
              isComplete: true,
              encounters: [],
            },
          },
          {
            dailyRecord: {
              getAuthoritativeForDate: async () => null,
            } as unknown as import('@/application/ports/dailyRecordPort').DailyRecordRepositoryPort,
            isAdmin: false,
            lookupEgresos: async () => [],
            fetchPatientFlowReport: async () => ({ base64: '' }),
            fetchStatisticalDischarge: async () => ({ base64: '' }),
          }
        );
        current = await reread(applyCensusImportDiff(current, diff, ctx).record);
        expect(movements(current).map(m => [m.id, m.movementDate, m.time])).toEqual([
          ['rn-guardado', day, time],
        ]);
        // Same as main: the historical plan keeps its review for a legacy dawn row.
        if (minimumConflicts || historical)
          expect(diff.conflicts.length).toBeGreaterThanOrEqual(minimumConflicts || 1);
        else expect(diff.conflicts).toHaveLength(0);
      }
    }
  }
);
it.each(['PDF disponible', 'PDF no disponible', 'solo consulta por episodio'])(
  'plan ordinario completo, %s',
  async mode => {
    const { prepareRayenStructuralPlan } =
      await import('@/features/rayen-import/hooks/prepareRayenStructuralPlan');
    const current = record();
    const iso = ctx.now.toISOString();
    const calls = { lookup: 0, pdf: 0 };
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
        egresoRows:
          mode === 'solo consulta por episodio'
            ? []
            : [row('07-11-2026 07:00', { encounterId: '' })],
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
          calls.lookup += targets.length;
          return targets.map(() => ({
            encounterId: episode.encounterId,
            run: episode.run,
            egreso: {
              id: 91001,
              dateDischarge: '2026-11-07T12:00:00Z',
              hasAdministrativeDischarge: true,
            },
          }));
        },
        lookupHospitalizations: async () => ({ ok: false }),
        fetchPatientFlowReport: async () => ({ base64: '', error: 'sin trazabilidad' }),
        fetchStatisticalDischarge: async () => {
          calls.pdf++;
          return mode === 'PDF disponible' ? { base64: 'cGRm' } : { base64: '', error: 'sin PDF' };
        },
      },
      extractStatisticalText: async () =>
        [
          '1.RUN: 12345678-5',
          '24 INGRESO 10-00 02-11-26 Medicina',
          '29 EGRESO 07-00 07-11-26 Domicilio',
        ].join('\n'),
    });
    const saved = await reread(applyCensusImportDiff(current, diff, ctx).record);
    const facts = {
      mode,
      calls,
      events: movements(saved).map(m => [m.clinicalEpisodeId, m.movementDate, m.time]),
      conflicts: diff.conflicts.map(c => c.reason),
      occupied: Boolean(saved.beds.R2?.patientName),
    };
    expect(facts.conflicts).toEqual([]);
    expect(facts.events).toEqual([[episode.encounterId, '2026-11-07', '07:00']]);
    expect(facts.occupied).toBe(false);
  }
);
