// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { BEDS, HOSPITAL_CAPACITY, REGULAR_BEDS } from '@/constants/beds';
import { EMPTY_PATIENT } from '@/constants/patient';
import { validateDailyRecord } from '@/schemas/zodValidationHelpers';
import { cudyrModality } from '@/domain/cudyr/cudyrStatisticalContext';
import {
  buildCensusBedRows,
  buildVisibleBeds,
} from '@/features/census/controllers/censusTableViewController';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import { reconcileCensus } from '@/features/rayen-import/domain/reconcileCensus';
import { resolveOccupiedBedTraceabilityChain } from '@/features/rayen-import/bedTraceabilityResolver';
import { resolveReportBedId } from '@/features/rayen-import/mapping/resolveReportBed';
import type {
  RayenCensusSnapshot,
  RayenEncounter,
} from '@/features/rayen-import/contracts/rayenSnapshot';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';

const NOW = new Date('2026-07-24T12:30:00-06:00');
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '142040',
  run: '111111111',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Anterior',
  admissionDatetime: '2026-07-23T10:00:00-06:00',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'NEO1',
  bed: 'NEO1',
  ...overrides,
});
const patient = (source: RayenEncounter, bedId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  clinicalEpisodeId: source.encounterId,
  rut: source.run ?? '',
  patientName: `${source.firstGivenName} ${source.firstFamilyName}`,
  admissionDate: '2026-07-23',
  admissionTime: '10:00',
  handoffNote: `nota-${source.encounterId}`,
});
const record = (beds: Record<string, PatientData> = {}): DailyRecord => ({
  date: '2026-07-24',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '',
});
const snapshot = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: NOW.toISOString(),
  facilityId: 1342,
  encounters,
  isComplete: true,
});
const plan = (current: DailyRecord, source: RayenCensusSnapshot) =>
  reconcileCensus(current, source, { reference: NOW });
const apply = (current: DailyRecord, diff: ReturnType<typeof plan>) =>
  applyCensusImportDiff(current, diff, {
    now: NOW,
    idFactory: () => 'test-movement',
    syncRunId: 'operational-test',
  });

describe('operational census bed occupancy', () => {
  it('holds contradictory bed aliases of one episode instead of duplicating the patient', () => {
    const first = encounter({
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMA R1',
    });
    const second = { ...first, room: 'CMA R2', bed: 'CMA R2' };
    const current = record({ H1C1: patient(first, 'H1C1') });
    const diff = plan(current, snapshot([first, second]));
    expect(diff.conflicts).toContainEqual(
      expect.objectContaining({ code: 'principal-bed-collision' })
    );
    expect(diff.moves).toEqual([]);
    expect(diff.admissions).toEqual([]);
    const result = apply(current, diff);
    expect(result.record.beds.H1C1.handoffNote).toBe('nota-142040');
    expect(
      Object.values(result.record.beds).filter(
        value => value.clinicalEpisodeId === first.encounterId
      )
    ).toHaveLength(1);
  });

  it('holds contradictory aliases of a new episode rather than admitting it twice', () => {
    const first = encounter({
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMA R1',
    });
    const diff = plan(record(), snapshot([first, { ...first, room: 'CMA R2', bed: 'CMA R2' }]));
    expect(diff.admissions).toEqual([]);
    expect(diff.conflicts).toHaveLength(1);
  });

  it.each(['NEO1', 'R1', 'H2C1'])(
    'keeps %s and its CMA occupancy visible without a forced choice',
    bedId => {
      const medical = encounter({ room: bedId, bed: bedId });
      const cma = encounter({
        encounterId: '142041',
        run: '222222222',
        firstFamilyName: 'Ambulatorio',
        service: 'Área quirúrgica indiferenciada',
        room: `CMA ${bedId}`,
        bed: `CMA ${bedId}`,
      });
      const current = record({ [bedId]: patient(medical, bedId) });
      const source = snapshot([cma, medical]);
      const diff = plan(current, source);
      expect(diff.conflicts).toEqual([]);
      expect(diff.bedOccupancyCollisions ?? []).toEqual([]);
      const result = apply(current, diff);
      expect(result.skipped).toEqual([]);
      const validation = validateDailyRecord(result.record);
      expect(validation.success ? [] : validation.errors).toEqual([]);
      expect(result.record.beds[bedId].clinicalEpisodeId).toBe('142040');
      expect(result.record.beds[`CMA_${bedId}`].clinicalEpisodeId).toBe('142041');
      const rows = buildCensusBedRows({
        beds: result.record.beds,
        visibleBeds: buildVisibleBeds({
          allBeds: BEDS,
          activeExtraBeds: result.record.activeExtraBeds ?? [],
        }),
      });
      expect(
        rows.unifiedRows.filter(row => row.kind === 'occupied').map(row => row.bed.name)
      ).toEqual(expect.arrayContaining([BEDS.find(bed => bed.id === bedId)?.name, `CMA ${bedId}`]));
      expect(HOSPITAL_CAPACITY).toBe(18);
      expect(REGULAR_BEDS).toHaveLength(18);
      expect(cudyrModality({ bedId: `CMA_${bedId}` })).toBe('cma');
      const repeated = plan(result.record, source);
      expect(repeated.admissions).toEqual([]);
      expect(repeated.moves).toEqual([]);
      expect(repeated.conflicts).toEqual([]);
    }
  );

  it('relocates an existing CMA alias without losing notes before placing the medical episode', () => {
    const cma = encounter({
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA NEO1',
      bed: 'CMA NEO1',
    });
    const medical = encounter({
      encounterId: '142042',
      run: '333333333',
      firstFamilyName: 'Medico',
    });
    const current = record({ NEO1: patient(cma, 'NEO1') });
    const result = apply(current, plan(current, snapshot([medical, cma])));
    expect(result.skipped).toEqual([]);
    expect(result.record.beds.CMA_NEO1).toMatchObject({
      clinicalEpisodeId: '142040',
      handoffNote: 'nota-142040',
      bedId: 'CMA_NEO1',
    });
    expect(result.record.beds.NEO1.clinicalEpisodeId).toBe('142042');
    expect(result.record.discharges).toEqual([]);
  });

  it.each([1, 2, 3, 4])(
    'activates and classifies Urgencias B%sUEA using compatible stored IDs',
    number => {
      const bedId = `BOX${number}`;
      const label = `B${number}UEA`;
      const result = apply(
        record(),
        plan(record(), snapshot([encounter({ room: label, bed: label })]))
      );
      expect(result.record.beds[bedId]?.clinicalEpisodeId).toBe('142040');
      expect(validateDailyRecord(result.record).success).toBe(true);
      expect(result.record.activeExtraBeds).toContain(bedId);
      expect(BEDS.find(bed => bed.id === bedId)?.name).toBe(label);
      expect(resolveReportBedId(label)).toBe(bedId);
      expect(cudyrModality({ bedId })).toBe('uea');
    }
  );

  it('checks an exact active assignment before declaring the previous bed occupied', () => {
    const old = encounter({ room: 'H6C1', bed: 'H6C1' });
    const next = encounter({ encounterId: '142043', run: '444444444', room: 'H6C1', bed: 'H6C1' });
    const current = record({ H6C1: patient(old, 'H6C1') });
    const source = {
      ...snapshot([next]),
      activeBedAssignments: [{ encounterId: old.encounterId, bedId: 'B4UEA' }],
    };
    const diff = plan(current, source);
    expect(diff.conflicts).toEqual([]);
    const result = apply(current, diff);
    expect(result.skipped).toEqual([]);
    expect(result.record.beds.BOX4).toMatchObject({
      clinicalEpisodeId: old.encounterId,
      handoffNote: 'nota-142040',
    });
    expect(result.record.beds.H6C1.clinicalEpisodeId).toBe(next.encounterId);
  });

  it.each([false, true])(
    'verifies an active occupant’s prior move even with stale Ficha location (reversed=%s)',
    async reversed => {
      const old = encounter({ room: 'R3', bed: 'R3' });
      const next = encounter({ encounterId: '142044', run: '555555555', room: 'R3', bed: 'R3' });
      const current = record({ R3: patient(old, 'R3') });
      const source = snapshot(reversed ? [old, next] : [next, old]);
      const fetchReport = vi.fn().mockResolvedValue({ base64: 'JVBERg==' });
      const verified = await resolveOccupiedBedTraceabilityChain(
        current,
        source,
        plan(current, source),
        {
          fetchReport,
          extractText: async () =>
            `Flujo del Paciente\nPaciente: Paciente Anterior RUN: 111111111\n23/07/2026 10:00:00 Área Médico Quirúrgica Recuperación 3 Básica R3\n24/07/2026 10:00:00 AMQI Urgencias B4UEA Básica B4UEA`,
        },
        incoming => plan(current, incoming)
      );
      expect(fetchReport).toHaveBeenCalledWith(old.encounterId);
      expect(verified.diff.conflicts).toEqual([]);
      const result = apply(current, verified.diff);
      expect(result.record.beds.BOX4?.clinicalEpisodeId).toBe(old.encounterId);
      expect(result.record.beds.R3?.clinicalEpisodeId).toBe(next.encounterId);
      expect(result.record.discharges).toEqual([]);
    }
  );

  it('does not duplicate a single episode reported under medical and CMA aliases', () => {
    const medical = encounter();
    const cma = {
      ...medical,
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA NEO1',
      bed: 'CMA NEO1',
    };
    const diff = plan(record(), snapshot([cma, medical]));
    const result = apply(record(), diff);
    expect(
      Object.values(result.record.beds).filter(
        value => value.clinicalEpisodeId === medical.encounterId
      )
    ).toHaveLength(1);
    expect(result.record.beds.NEO1?.clinicalEpisodeId).toBe(medical.encounterId);
    expect(diff.conflicts).toEqual([]);
  });

  it('clears the previous UEA modality on a confirmed move into a hospital bed', () => {
    const source = encounter({ room: 'H2C1', bed: 'H2C1' });
    const old = { ...patient(source, 'BOX4'), location: 'AMQI / B4UEA' };
    const current = record({ BOX4: old });
    const result = apply(current, plan(current, snapshot([source])));
    expect(result.record.beds.H2C1.handoffNote).toBe(old.handoffNote);
    expect(cudyrModality({ bedId: 'H2C1', location: result.record.beds.H2C1.location })).toBe(
      'hospitalizacion'
    );
  });
});
