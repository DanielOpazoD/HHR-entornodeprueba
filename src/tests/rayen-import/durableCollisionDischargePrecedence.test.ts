import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  reconcileCensus,
  type CensusImportDiff,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const fixture = () => {
  const cma: RayenEncounter = {
    encounterId: 'CMA-R3',
    run: '111111111',
    firstGivenName: 'Paciente CMA',
    firstFamilyName: 'Prueba',
    admissionDatetime: '2026-08-21T08:00:00-06:00',
    service: 'Área quirúrgica indiferenciada',
    room: 'CMA R3',
    bed: 'CMAR3',
  };
  const hospital: RayenEncounter = {
    ...cma,
    encounterId: 'MQ-R3',
    run: '222222222',
    firstGivenName: 'Paciente Hospitalizado',
    service: 'Área Médico Quirúrgica Indiferenciada',
    room: 'R3',
    bed: 'R3',
  };
  // Persisted state from the former forced-choice policy, rather than asking the new planner
  // to create an obsolete removal decision.
  const current: DailyRecord = {
    date: '2026-08-21',
    beds: {
      R3: {
        ...EMPTY_PATIENT,
        bedId: 'R3',
        patientName: 'Paciente CMA Prueba',
        rut: cma.run,
        clinicalEpisodeId: cma.encounterId,
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '',
    rayenBedCollisionResolutions: [
      {
        id: 'R3:CMA-R3:MQ-R3',
        selectedEpisodeId: 'CMA-R3',
        otherEpisodeId: 'MQ-R3',
        otherDisposition: { kind: 'remove' },
      },
    ],
  };
  const snapshot: RayenCensusSnapshot = {
    capturedAt: '2026-08-21T12:00:00-06:00',
    facilityId: 1342,
    encounters: [cma, hospital],
    isComplete: true,
  };
  return { current, snapshot };
};
const context = () => ({
  idFactory: () => 'movement-1',
  now: new Date('2026-08-21T12:30:00-06:00'),
  actor: 'Nurse Test',
  syncRunId: 'run-durable-collision-discharge',
});
const addDischarge = (diff: CensusImportDiff, bedId: string) =>
  diff.discharges.push({
    bedId,
    rut: '111111111',
    patientName: 'Paciente CMA Prueba',
    kind: 'alta',
    status: 'Vivo',
    reason: 'administrative-discharge',
    encounterId: 'CMA-R3',
    expectedOccupant: { clinicalEpisodeId: 'CMA-R3', rut: '111111111' },
  });

describe('existing collision receipts during migration to separate CMA assignments', () => {
  it('keeps stale-discharge protection while retaining both active source episodes', () => {
    const { current, snapshot } = fixture();
    const diff = reconcileCensus(current, snapshot);
    addDischarge(diff, 'R3');
    const result = applyCensusImportDiff(current, diff, context());
    expect(diff.retainedBedCollisionResolutions).toContainEqual(
      expect.objectContaining({ id: 'R3:CMA-R3:MQ-R3', selectedEpisodeId: 'CMA-R3' })
    );
    expect(result.record.beds.CMA_R3.clinicalEpisodeId).toBe('CMA-R3');
    expect(result.record.beds.R3.clinicalEpisodeId).toBe('MQ-R3');
    expect(result.record.discharges).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('permits a verified discharge once the selected episode is no longer active', () => {
    const { current, snapshot } = fixture();
    const first = applyCensusImportDiff(current, reconcileCensus(current, snapshot), context());
    const later = reconcileCensus(first.record, {
      ...snapshot,
      capturedAt: '2026-08-21T18:00:00-06:00',
      encounters: [snapshot.encounters[1]],
    });
    addDischarge(later, 'CMA_R3');
    const result = applyCensusImportDiff(first.record, later, context());
    expect(later.retainedBedCollisionResolutions).toEqual([]);
    expect(result.record.beds.CMA_R3).toBeUndefined();
    expect(result.record.beds.R3.clinicalEpisodeId).toBe('MQ-R3');
    expect(result.record.discharges).toHaveLength(1);
  });
});
