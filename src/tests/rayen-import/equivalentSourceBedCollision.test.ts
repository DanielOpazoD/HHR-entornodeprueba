import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const EQUIVALENT_BEDS = ['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2'] as const;
const encounter = (bedId: string, episode: string, cma = false): RayenEncounter => ({
  encounterId: episode,
  run: cma ? '111111111' : '222222222',
  firstGivenName: cma ? 'Paciente CMA' : 'Paciente Hospitalizado',
  firstFamilyName: 'Prueba',
  admissionDatetime: '2026-08-21T08:00:00-06:00',
  service: cma ? 'Área quirúrgica indiferenciada' : 'Área Médico Quirúrgica Indiferenciada',
  room: cma ? `CMA ${bedId}` : bedId,
  bed: cma ? `CMA${bedId}` : bedId,
});
const patient = (source: RayenEncounter, bedId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: `${source.firstGivenName} Prueba`,
  rut: source.run ?? '',
  clinicalEpisodeId: source.encounterId,
  handoffNote: `nota-${source.encounterId}`,
});
const fixture = (bedId: string, reversed = false) => {
  const cma = encounter(bedId, `CMA-${bedId}`, true);
  const hospital = encounter(bedId, `MQ-${bedId}`);
  const current: DailyRecord = {
    date: '2026-08-21',
    beds: { [bedId]: patient(cma, bedId), H2C1: patient(hospital, 'H2C1') },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '',
  };
  const snapshot: RayenCensusSnapshot = {
    capturedAt: '2026-08-21T12:00:00-06:00',
    facilityId: 1342,
    encounters: reversed ? [hospital, cma] : [cma, hospital],
    isComplete: true,
  };
  return { cma, hospital, current, snapshot };
};
const context = () => {
  let id = 0;
  return {
    idFactory: () => `movement-${++id}`,
    now: new Date('2026-08-21T12:30:00-06:00'),
    actor: 'Nurse Test',
    syncRunId: 'run-equivalent-assignments',
  };
};

describe('CMA and hospital assignments with the same bed label', () => {
  it.each(EQUIVALENT_BEDS)(
    'keeps both %s episodes and their notes without a forced disposition',
    bedId => {
      for (const reversed of [false, true]) {
        const { cma, hospital, current, snapshot } = fixture(bedId, reversed);
        const diff = reconcileCensus(current, snapshot);
        expect(diff.conflicts).toEqual([]);
        expect(diff.bedOccupancyCollisions).toEqual([]);
        const result = applyCensusImportDiff(current, diff, context());
        expect(result.skipped).toEqual([]);
        expect(result.record.beds[`CMA_${bedId}`]).toMatchObject({
          clinicalEpisodeId: cma.encounterId,
          handoffNote: `nota-${cma.encounterId}`,
        });
        expect(result.record.beds[bedId]).toMatchObject({
          clinicalEpisodeId: hospital.encounterId,
          handoffNote: `nota-${hospital.encounterId}`,
        });
        expect(result.record.beds.H2C1).toBeUndefined();
        expect(result.record.discharges).toEqual([]);
        expect(result.record.transfers).toEqual([]);
        const repeated = reconcileCensus(result.record, snapshot);
        expect(repeated.moves).toEqual([]);
        expect(repeated.admissions).toEqual([]);
        expect(repeated.conflicts).toEqual([]);
      }
    }
  );

  it('does not use an unrelated blocked bed as a workaround', () => {
    const { current, snapshot } = fixture('R1');
    current.beds.H3C1 = {
      ...EMPTY_PATIENT,
      bedId: 'H3C1',
      isBlocked: true,
      blockedReason: 'Mantención',
    };
    const result = applyCensusImportDiff(current, reconcileCensus(current, snapshot), context());
    expect(result.record.beds.H3C1).toEqual(current.beds.H3C1);
    expect(result.record.beds.R1.clinicalEpisodeId).toBe('MQ-R1');
    expect(result.record.beds.CMA_R1.clinicalEpisodeId).toBe('CMA-R1');
  });

  it('collapses two source aliases of one episode instead of duplicating that patient', () => {
    const { current, snapshot } = fixture('R1');
    delete current.beds.H2C1;
    snapshot.encounters[1] = {
      ...snapshot.encounters[0],
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'R1',
      bed: 'R1',
    };
    const diff = reconcileCensus(current, snapshot);
    const result = applyCensusImportDiff(current, diff, context());
    expect(diff.conflicts).toEqual([]);
    expect(
      Object.values(result.record.beds).filter(value => value.clinicalEpisodeId === 'CMA-R1')
    ).toHaveLength(1);
    expect(result.record.beds.R1.clinicalEpisodeId).toBe('CMA-R1');
  });

  it('excludes future episodes when synchronizing a historical census', () => {
    const { current, snapshot } = fixture('R1');
    current.date = '2026-08-20';
    delete current.beds.H2C1;
    const diff = reconcileCensus(current, snapshot, {
      reference: new Date('2026-08-21T12:00:00-06:00'),
    });
    expect(diff.bedOccupancyCollisions).toEqual([]);
    expect(diff.admissions.some(entry => entry.source?.encounterId === 'MQ-R1')).toBe(false);
    expect(diff.moves.some(entry => entry.source?.encounterId === 'MQ-R1')).toBe(false);
  });

  it('retains a real conflict between two hospital episodes in the same assignment', () => {
    const existing = encounter('NEO1', 'existing');
    const current = fixture('NEO1').current;
    current.beds = { NEO1: patient(existing, 'NEO1') };
    const incoming = encounter('NEO1', 'incoming');
    incoming.run = '333333333';
    const snapshot = { ...fixture('NEO1').snapshot, encounters: [existing, incoming] };
    const diff = reconcileCensus(current, snapshot);
    expect(diff.conflicts.length).toBeGreaterThan(0);
    const result = applyCensusImportDiff(current, diff, context());
    expect(result.record.beds.NEO1.clinicalEpisodeId).toBe('existing');
    expect(result.record.discharges).toEqual([]);
  });
});
