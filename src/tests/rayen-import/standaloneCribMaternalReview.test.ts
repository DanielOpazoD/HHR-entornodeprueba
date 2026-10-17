import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  reconcileCensus,
  applyCensusImportDiff,
  rayenToPatientData,
} from '@/features/rayen-import';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';

const now = new Date('2026-07-08T20:00:00-06:00');
const mother: RayenEncounter = {
  encounterId: 'synthetic-mother',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'AMQI',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Diagnóstico materno',
};
const child: RayenEncounter = {
  ...mother,
  encounterId: 'synthetic-newborn',
  firstGivenName: 'RN de Ana',
  birthDate: '2026-07-08',
  room: 'Cunas',
  bed: 'CR3',
  clinicalCribParentBedId: 'R3',
  diagnosis: 'Diagnóstico neonatal',
};
const current = (): DailyRecord => ({
  date: '2026-07-08',
  lastUpdated: '',
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  beds: {
    H5C1: rayenToPatientData(mother, now).patient,
    R3: { ...EMPTY_PATIENT, ...rayenToPatientData(child, now).patient, bedMode: 'Cuna' },
  },
});
const plan = (record: DailyRecord, sources = [mother, child]) =>
  reconcileCensus(
    record,
    {
      capturedAt: now.toISOString(),
      facilityId: 1342,
      isComplete: true,
      encounters: sources,
    },
    { reference: now }
  );

describe('standalone crib with a verified hospitalized mother', () => {
  it('requests a placement decision instead of silently retaining the RN in the stale source crib', () => {
    const diff = plan(current());
    expect(diff.neonatalPlacementReviews).toEqual([
      expect.objectContaining({
        episodeId: child.encounterId,
        existingBedId: 'R3',
        mothers: expect.arrayContaining([
          expect.objectContaining({ bedId: 'H5C1', episodeId: mother.encounterId }),
        ]),
      }),
    ]);
  });

  it('attaches only the reviewed episode, clears its previous representation and preserves neonatal data', () => {
    const record = current();
    record.beds.R3.handoffNoteDayShift = 'Nota neonatal que debe conservarse';
    const diff = plan(record);
    expect(diff.neonatalPlacementReviews).toHaveLength(1);
    const resolved = resolveNeonatalPlacements(
      record,
      diff,
      [
        {
          episodeId: child.encounterId,
          kind: 'mother',
          bedId: 'H5C1',
          parentEpisodeId: mother.encounterId,
        },
      ],
      now.toISOString(),
      'Operador sintético'
    );
    const result = applyCensusImportDiff(record, resolved, {
      now,
      idFactory: () => 'unused',
      syncRunId: 'synthetic',
    });
    expect(result.skipped).toEqual([]);
    expect(result.record.beds.R3.patientName).toBe('');
    expect(result.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: child.encounterId,
      bedMode: 'Cuna',
      rut: '',
      handoffNoteDayShift: 'Nota neonatal que debe conservarse',
    });
    expect(result.record.beds.H5C1.pathology).toBe('Diagnóstico materno');
    expect(result.record.beds.H5C1.clinicalCrib?.pathology).toBe('Diagnóstico neonatal');
    expect(plan(result.record).neonatalPlacementReviews).toEqual([]);
    const caughtUp = { ...child, room: 'Cunas', bed: 'CH5C1', clinicalCribParentBedId: 'H5C1' };
    expect(plan(result.record, [mother, caughtUp]).neonatalPlacementReviews).toEqual([]);
    expect(
      plan(result.record, [
        mother,
        {
          ...caughtUp,
          bed: 'CR2',
          clinicalCribParentBedId: 'R2',
        },
      ]).neonatalPlacementReviews
    ).toHaveLength(1);
  });

  it('changes a standalone crib into an independent hospital bed only after explicit review', () => {
    const record = current();
    const resolved = resolveNeonatalPlacements(
      record,
      plan(record),
      [
        {
          episodeId: child.encounterId,
          kind: 'independent',
          bedId: 'R3',
          effectiveAt: '2026-07-08T12:00:00-06:00',
        },
      ],
      now.toISOString(),
      'Operador sintético'
    );
    const result = applyCensusImportDiff(record, resolved, {
      now,
      idFactory: () => 'unused',
      syncRunId: 'synthetic',
    });
    expect(result.record.beds.R3).toMatchObject({
      clinicalEpisodeId: child.encounterId,
      bedMode: 'Cama',
      neonatalPlacementDecision: { kind: 'independent', effectiveAt: '2026-07-08T12:00:00-06:00' },
    });
    expect(result.record.beds.H5C1.clinicalCrib).toBeUndefined();
    expect(plan(result.record).neonatalPlacementReviews).toEqual([]);
  });

  it('keeps a standalone crib when no hospitalized mother can be identified', () => {
    const record = current();
    delete record.beds.H5C1;
    expect(plan(record, [child]).neonatalPlacementReviews).toEqual([]);
  });
});
