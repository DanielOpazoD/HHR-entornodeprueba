import { describe, expect, it, vi } from 'vitest';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { prepareRayenStructuralPlan } from '@/features/rayen-import/hooks/prepareRayenStructuralPlan';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import {
  collectSafeClinicalEpisodeIds,
  describeStructuralConflicts,
} from '@/features/rayen-import/hooks/rayenStructuralConvergence';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import type { EgresoReportRow } from '@/features/rayen-import/contracts/egresoReport';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';

const D = '2026-08-13';
const now = new Date('2026-08-13T23:00:00Z');
const encounter = (run: string, ep: string, admission: string): RayenEncounter =>
  ({
    encounterId: ep,
    run,
    firstGivenName: 'AMALIA',
    firstFamilyName: 'INVENTADA',
    birthDate: '1980-01-01',
    service: 'Área Médico Quirúrgica Indiferenciada',
    room: 'H5',
    bed: 'C1',
    admissionDatetime: admission,
  }) as RayenEncounter;
const patient = (e: RayenEncounter): PatientData => ({
  ...rayenToPatientData(e, now).patient,
  clinicalEpisodeId: e.encounterId,
});
const recordWith = (date: string, p?: PatientData): DailyRecord =>
  ({
    date,
    beds: p ? { H5C1: p } : {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    activeExtraBeds: [],
  }) as unknown as DailyRecord;
const reportRow = (run: string, day: string, time: string): EgresoReportRow => ({
  run,
  patientName: 'AMALIA INVENTADA',
  bedLabel: 'H5C1',
  servicio: 'Hospitalizados',
  edad: '40 años',
  destino: 'Domicilio',
  motivo: 'Alta',
  fechaEgreso: `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)} ${time}`,
  correctedDay: day,
  correctedTime: time,
});
const EARLY = '2026-08-10T10:00:00-06:00';
const READMIT = '2026-08-13T09:00:00-06:00';

type Case = [label: string, doc: string, rowDay: string, scenario: 'left' | 'readmitted' | 'stale'];
const cases: Case[] = [];
for (const doc of ['12A3456785', '1234567A', '12.345.678-5', 'P123456785', 'AB1234567'])
  cases.push(
    [`${doc} mismo día, salió de Ficha`, doc, D, 'left'],
    [`${doc} día previo, salió de Ficha`, doc, '2026-08-12', 'left'],
    [`${doc} día previo, reingresó hoy (sigue en Ficha)`, doc, '2026-08-12', 'readmitted'],
    [`${doc} día previo, Ficha aún lista ep 1001`, doc, '2026-08-12', 'stale'],
    [`${doc} mismo día, Ficha aún lista ep 1001`, doc, D, 'stale']
  );

const runScenario = async (
  doc: string,
  rowDay: string,
  scenario: Case[3],
  previousCensus: 'present' | 'missing' = 'present'
) => {
  const old = encounter(doc, '1001', EARLY);
  const fresh = encounter(doc, '1003', READMIT);
  const current = recordWith(D, patient(scenario === 'readmitted' ? fresh : old));
  const previous = previousCensus === 'present' ? recordWith('2026-08-12', patient(old)) : null;
  const snapshot: RayenCensusSnapshot = {
    capturedAt: now.toISOString(),
    facilityId: 1342,
    isComplete: true,
    encounters: scenario === 'readmitted' ? [fresh] : scenario === 'stale' ? [old] : [],
  };
  const repository = {
    getAuthoritativeForDate: vi.fn(async () => previous),
    getForDate: vi.fn().mockResolvedValue(null),
    getLocalForDateWithMeta: vi.fn().mockResolvedValue({
      record: null,
      hasPendingWrites: false,
      hasPendingWritesForDate: false,
      writeState: 'none',
    }),
  } as unknown as DailyRecordRepositoryPort;
  // Eloísa confirma el alta solo del episodio exacto 1001 (dígitos sin episodio: no encontrado).
  const lookupEgresos = vi.fn(async (targets: { run: string; encounterId: string }[]) =>
    targets.map(t =>
      t.encounterId === '1001'
        ? {
            run: t.run,
            encounterId: '1001',
            egreso: {
              id: '1001',
              hasAdministrativeDischarge: true,
              dateDischarge: `${rowDay}T15:00:00-06:00`,
            },
          }
        : { run: t.run, encounterId: '', error: 'not found' }
    )
  );
  const { diff } = await prepareRayenStructuralPlan({
    baseRecord: current,
    planningSnapshot: snapshot,
    bundle: {
      id: 'synthetic',
      startedAt: now.toISOString(),
      completedAt: now.toISOString(),
      facilityId: 1342,
      dateStart: D,
      dateEnd: D,
      fichaMedicoCapturedAt: now.toISOString(),
      gestionCamasCapturedAt: now.toISOString(),
      sourceSkewMs: 0,
      egresoRows: [reportRow(doc, rowDay, '15:00')],
    },
    isHistoricalDay: false,
    invalidEpisodeIds: new Set<string>(),
    reportDate: D,
    dailyRecord: repository,
    isAdmin: false,
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: (operation: () => unknown) => operation(),
    evidenceClient: {
      lookupHospitalizations: vi.fn().mockResolvedValue({ ok: false }),
      lookupEgresos,
      fetchStatisticalDischarge: vi.fn().mockResolvedValue({ base64: 'cGRm' }),
      fetchPatientFlowReport: vi.fn().mockResolvedValue({ base64: '', error: 'unavailable' }),
    },
    extractStatisticalText: vi.fn().mockResolvedValue(''),
  } as never);
  const applied = applyCensusImportDiff(current, diff, {
    now,
    idFactory: () => 'probe-id',
    syncRunId: 'probe',
  }).record;
  const out = {
    targets: lookupEgresos.mock.calls.flatMap(c => c[0].map(t => `${t.run}#${t.encounterId}`)),
    discharges: diff.discharges.map(x => `${x.bedId}|${x.rut}`),
    conflicts: diff.conflicts.map(c => `${c.bedId}|${c.code ?? ''}|${c.reason.slice(0, 50)}`),
    bedAfter: applied.beds.H5C1?.patientName
      ? `${applied.beds.H5C1.patientName} ep=${applied.beds.H5C1.clinicalEpisodeId}`
      : '(vacía)',
    safeEpisodes: collectSafeClinicalEpisodeIds(
      applied,
      describeStructuralConflicts(diff.conflicts)
    ),
    applied: applied.discharges.map(x => `${x.rut}|${x.time}|ep=${x.clinicalEpisodeId ?? ''}`),
  };
  return out;
};

describe('verified own-episode discharge preserves readmissions', () => {
  it.each(cases)('%s', async (_label, doc, rowDay, scenario) => {
    const out = await runScenario(doc, rowDay, scenario);
    expect(out).toEqual({
      targets:
        (doc.startsWith('P') || doc.startsWith('AB')) && scenario !== 'readmitted'
          ? []
          : [`${doc}#1001`],
      discharges: scenario === 'readmitted' ? [] : [`H5C1|${doc}`],
      conflicts: [],
      bedAfter: scenario === 'readmitted' ? 'Amalia Inventada ep=1003' : '(vacía)',
      safeEpisodes: scenario === 'readmitted' ? ['1003'] : [],
      applied: scenario !== 'readmitted' && rowDay === D ? [`${doc}|15:00|ep=1001`] : [],
    });
  });

  // A discharge of the previous clinical day is not looked up by digits on main either: when the
  // previous census cannot vouch for it, the readmitted patient is left alone.
  it.each(['12A3456785', '1234567A', '12.345.678-5', 'P123456785'])(
    '%s día previo sin censo previo, reingresó hoy: sin conflicto sobre el episodio activo',
    async doc => {
      expect(await runScenario(doc, '2026-08-12', 'readmitted', 'missing')).toMatchObject({
        discharges: [],
        conflicts: [],
        bedAfter: 'Amalia Inventada ep=1003',
        safeEpisodes: ['1003'],
      });
    }
  );
});
