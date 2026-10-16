// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { reconstructHistoricalSnapshotAtClose } from '@/features/rayen-import/domain/historicalSnapshotReconstruction';
import { reconcileCensus } from '@/features/rayen-import/domain/reconcileCensus';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { resolveOccupiedBedTraceabilityChain } from '@/features/rayen-import/bedTraceabilityResolver';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';

const NOW = new Date('2026-10-15T13:00:00-05:00');
const encounter = (
  encounterId: string,
  run: string,
  bed: string,
  admissionDatetime: string
): RayenEncounter => ({
  encounterId,
  run,
  firstGivenName: 'Paciente',
  firstFamilyName: encounterId,
  service: 'Area Medico Quirurgica Indiferenciada',
  room: bed,
  bed,
  admissionDatetime,
});
const sources = [
  encounter('142040', '111111111', 'H6C1', '2026-10-05T17:05:00-05:00'),
  encounter('142041', '222222222', 'H6C1', '2026-10-12T11:42:00-05:00'),
  encounter('142042', '333333333', 'R3', '2026-10-15T00:01:00-05:00'),
  encounter('142043', '444444444', 'B1UEA', '2026-10-14T21:30:00-05:00'),
];
const patient = (source: RayenEncounter, bedId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: `Paciente ${source.encounterId}`,
  clinicalEpisodeId: source.encounterId,
  rut: source.run,
  admissionDate: source.admissionDatetime!.slice(0, 10),
  admissionTime: source.admissionDatetime!.slice(11, 16),
  handoffNote: `nota-${source.encounterId}`,
});
const currentRecord = (): DailyRecord => ({
  date: '2026-10-14',
  beds: { H6C1: patient(sources[0], 'H6C1'), R3: patient(sources[1], 'R3') },
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '',
});
const flowReports = (lastLocation = 'BOX 4 UEA'): Record<string, string> => ({
  '142040': `RUN: 111111111
05/10/2026 17:05:00 Servicio Hospitalizados H6C1
15/10/2026 01:00:00 Area Medico Quirurgica Hospitalizacion Urgencias BOX 4 UEA Media ${lastLocation}
15/10/2026 08:00:00 Servicio Hospitalizados H3C1`,
  '142041': `RUN: 222222222
12/10/2026 11:42:00 Servicio Hospitalizados R3
15/10/2026 01:10:00 Servicio Hospitalizados H6C1
15/10/2026 09:00:00 Servicio Hospitalizados H2C1`,
  '142042': `RUN: 333333333
15/10/2026 00:01:00 Servicio Hospitalizados R3`,
  '142043': `RUN: 444444444
14/10/2026 21:30:00 Area Medico Quirurgica Hospitalizacion Urgencias BOX 1 UEA Media BOX 1 UEA`,
});
const dependencies = (reports = flowReports()) => ({
  fetchReport: async (id: string) => ({ base64: btoa(id) }),
  extractText: async (buffer: ArrayBuffer) => reports[new TextDecoder().decode(buffer)] ?? '',
});
const plan = async (
  current: DailyRecord,
  snapshot: RayenCensusSnapshot,
  reports = flowReports()
) => {
  const reconstructed = await reconstructHistoricalSnapshotAtClose(
    current.date,
    snapshot,
    current,
    [],
    dependencies(reports)
  );
  return {
    reconstructed,
    diff: reconcileCensus(current, reconstructed.snapshot, { reference: NOW }),
  };
};
const apply = (current: DailyRecord, diff: ReturnType<typeof reconcileCensus>) =>
  applyCensusImportDiff(current, diff, {
    now: NOW,
    syncRunId: 'synthetic-historical-urgency',
    idFactory: () => 'synthetic-move',
  });
const snapshot = (omitFirst: boolean): RayenCensusSnapshot => ({
  facilityId: 1342,
  capturedAt: NOW.toISOString(),
  isComplete: true,
  encounters: omitFirst ? sources.slice(1).reverse() : sources,
  activeBedAssignments: [{ encounterId: '142040', bedId: 'BOX4' }],
});

describe('historical hospital-to-urgency movement chain', () => {
  it("does not let today's pavilion location suppress yesterday's verified hospital episode", async () => {
    const current = { ...currentRecord(), beds: { H6C1: patient(sources[0], 'H6C1') } };
    const captured = {
      ...snapshot(false),
      encounters: [{ ...sources[0], room: 'P-R1', bed: 'P-R1' }],
      activeBedAssignments: [{ encounterId: '142040', bedId: 'P-R1' }],
    };
    const reports = {
      '142040': `RUN: 111111111
14/10/2026 20:00:00 Servicio Hospitalizados H6C1
15/10/2026 08:30:00 Servicio Recuperacion Pabellon P-R1`,
    };
    const { reconstructed, diff } = await plan(current, captured, reports);
    expect(reconstructed.conflicts).toEqual([]);
    expect(reconstructed.snapshot.activeBedAssignments).toEqual([]);
    expect(reconstructed.snapshot.encounters[0]).toMatchObject({ room: 'H6C1', bed: 'H6C1' });
    expect(diff.activeClinicalEpisodeIds).toContain('142040');
    expect(diff).toMatchObject({ conflicts: [], moves: [], discharges: [] });
  });

  it.each([
    ['2026-10-14', '2026-10-15', '02:00:00', '01:00:00', '03:00:00'],
    ['2026-10-14', '2026-10-15', '13:00:00', '07:59:59', '08:00:00'],
    ['2026-10-16', '2026-10-17', '11:00:00', '08:30:00', '09:00:00'],
  ])(
    'bounds live conflict evidence by capture and the nursing handoff (%s %s %s)',
    async (day, nextDay, captureTime, moveTime, futureTime) => {
      const current = { ...currentRecord(), date: day };
      const captured = {
        ...snapshot(false),
        encounters: sources.slice(0, 2),
        capturedAt: `${nextDay}T${captureTime}-05:00`,
      };
      const reportDate = nextDay.split('-').reverse().join('/');
      const reports = {
        '142040': `RUN: 111111111
${day.split('-').reverse().join('/')} 20:00:00 Servicio Hospitalizados H6C1
${reportDate} ${moveTime} Servicio Hospitalizados H1C1
${reportDate} ${futureTime} Servicio Hospitalizados H3C1`,
      };
      const replan = (source: RayenCensusSnapshot) =>
        reconcileCensus(current, source, { reference: NOW });
      const resolved = await resolveOccupiedBedTraceabilityChain(
        current,
        captured,
        replan(captured),
        dependencies(reports),
        replan
      );
      expect(resolved.diff.conflicts).toEqual([]);
      expect(resolved.diff.moves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromBedId: 'H6C1', toBedId: 'H1C1' }),
          expect.objectContaining({ fromBedId: 'R3', toBedId: 'H6C1' }),
        ])
      );
      expect(resolved.snapshot.encounters[0].verifiedBedPlacement?.changedAt).toBe(
        `${nextDay}T${moveTime}`
      );
    }
  );

  it.each([false, true])(
    'resolves the night chain, preserves notes and converges (Ficha omission: %s)',
    async omitFirst => {
      const current = currentRecord();
      const before = structuredClone(current);
      const captured = snapshot(omitFirst);
      const { reconstructed, diff } = await plan(current, captured);
      expect(reconstructed.conflicts).toEqual([]);
      expect(diff.conflicts).toEqual([]);
      expect(diff.moves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fromBedId: 'H6C1', toBedId: 'BOX4' }),
          expect.objectContaining({ fromBedId: 'R3', toBedId: 'H6C1' }),
        ])
      );
      expect(diff.admissions.map(entry => entry.bedId)).toEqual(
        expect.arrayContaining(['R3', 'BOX1'])
      );
      const applied = apply(current, diff);
      expect(applied.skipped).toEqual([]);
      expect(applied.record.beds.BOX4).toMatchObject({
        clinicalEpisodeId: '142040',
        handoffNote: 'nota-142040',
      });
      expect(applied.record.beds.H6C1).toMatchObject({
        clinicalEpisodeId: '142041',
        handoffNote: 'nota-142041',
      });
      expect(applied.record.beds.R3).toMatchObject({
        clinicalEpisodeId: '142042',
        admissionDate: '2026-10-15',
        admissionTime: '00:01',
      });
      expect(applied.record.beds.BOX1.clinicalEpisodeId).toBe('142043');
      expect(applied.record.discharges).toEqual([]);
      expect(current).toEqual(before);
      const repeated = await plan(applied.record, captured);
      expect(repeated.reconstructed.conflicts).toEqual([]);
      expect(repeated.diff).toMatchObject({
        moves: [],
        admissions: [],
        discharges: [],
        conflicts: [],
      });
    }
  );

  it.each(['BOX 5 UEA', 'DESCONOCIDA'])(
    'keeps the occupied chain intact when the official destination is %s',
    async destination => {
      const current = currentRecord();
      const { reconstructed, diff } = await plan(
        current,
        snapshot(false),
        flowReports(destination)
      );
      expect(reconstructed.conflicts).toHaveLength(1);
      expect(diff.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ bedId: 'H6C1' }),
          expect.objectContaining({ bedId: 'R3' }),
        ])
      );
      const applied = apply(current, diff);
      expect(applied.record.beds.H6C1.clinicalEpisodeId).toBe('142040');
      expect(applied.record.beds.R3.clinicalEpisodeId).toBe('142041');
      expect(applied.record.discharges).toEqual([]);
    }
  );
});
