import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  reconcileCensus,
} from '@/features/rayen-import';
import type { RayenCensusSnapshot, RayenEncounter } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const reference = new Date('2026-07-08T20:00:00-06:00');
const mother: RayenEncounter = {
  encounterId: '111',
  run: '11.111.111-1',
  firstGivenName: 'Madre',
  firstFamilyName: 'Sintética',
  birthDate: '1990-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H4',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
};
const child: RayenEncounter = {
  ...mother,
  encounterId: '222',
  run: '222222222',
  firstGivenName: 'RN de Madre',
  birthDate: '2026-07-08',
  room: 'Cunas',
  bed: 'CH4C1',
  clinicalCribParentBedId: 'H4C1',
};
const snapshot = (encounters: RayenEncounter[], isComplete = true): RayenCensusSnapshot => ({
  capturedAt: reference.toISOString(),
  facilityId: 1342,
  encounters,
  isComplete,
});
const seed = (withCrib = false): DailyRecord => ({
  date: '2026-07-08',
  beds: {
    H4C1: {
      ...rayenToPatientData(mother, reference).patient,
      ...(withCrib ? { clinicalCrib: rayenToPatientData(child, reference).patient } : {}),
    },
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

describe('present episodes with unresolved locations', () => {
  it.each([false, true])(
    'preserves presence and beds when location is missing (nested RN: %s)',
    withCrib => {
      const current = seed(withCrib);
      const before = structuredClone(current);
      const encounters = [
        { ...mother, room: undefined, bed: undefined },
        ...(withCrib
          ? [{ ...child, room: undefined, bed: undefined, clinicalCribParentBedId: undefined }]
          : []),
      ];
      // A genuinely absent mother remains absent even if her newborn is present.
      const missing = reconcileCensus(current, snapshot(withCrib ? [child] : []), { reference });
      expect(missing.pendingAdministrativeDischarges).toEqual([
        expect.objectContaining({ encounterId: '111', signal: 'missing-from-ficha' }),
      ]);
      expect(
        reconcileCensus(current, snapshot([], false), { reference }).pendingAdministrativeDischarges
      ).toEqual([]);
      const diff = reconcileCensus(current, snapshot(encounters), { reference });
      expect(diff.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bedId: null,
            source: expect.objectContaining({ encounterId: '111' }),
          }),
        ])
      );
      expect(diff.moves).toEqual([]);
      expect(diff.updates).toEqual([]);
      expect(diff.admissions).toEqual([]);
      expect(diff.discharges).toEqual([]);
      expect(current).toEqual(before);
      expect(
        applyCensusImportDiff(current, diff, {
          now: reference,
          syncRunId: 'synthetic-location',
          idFactory: () => 'synthetic-id',
        }).record.beds
      ).toEqual(current.beds);
      expect(diff.pendingAdministrativeDischarges).toEqual([]);
    }
  );
});
