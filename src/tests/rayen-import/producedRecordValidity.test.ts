import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  planRayenCensusImport,
  rayenToPatientData,
  type ApplyContext,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { validateDailyRecord } from '@/schemas/zodValidationHelpers';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

// Past dates so no future-date business rule can interfere with the structural check.
const REFERENCE = new Date(2020, 5, 1);
const NOW = new Date(2020, 5, 1, 15, 30, 0);

const makeCtx = (): ApplyContext => {
  let n = 0;
  return { idFactory: () => `id-${++n}`, now: NOW };
};

const makeRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2020-06-01',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2020-06-01T08:00:00.000Z',
  dateTimestamp: new Date(2020, 5, 1).getTime(),
  activeExtraBeds: [],
});

const enc = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2020-05-01T10:00:00-06:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const seedBed = (encounter: RayenEncounter): [string, PatientData] => {
  const { patient, bedId } = rayenToPatientData(encounter, REFERENCE);
  return [bedId ?? '', patient];
};

describe('produced DailyRecord validity (fix #2)', () => {
  it('a record produced by apply passes the HHR Zod schema and keeps dateTimestamp', () => {
    // Current census: patient A (general) + patient B (CMA bed R1).
    const encA = enc();
    const encB = enc({
      encounterId: 'ECMA',
      run: '89320666',
      firstGivenName: 'Ines',
      firstFamilyName: 'Leiva',
      service: 'Área quirúrgica indiferenciada',
      room: 'CMA R1',
      bed: 'CMAR1',
    });
    const [bedA, patA] = seedBed(encA);
    const [bedB, patB] = seedBed(encB);
    const current = makeRecord({ [bedA]: patA, [bedB]: patB });

    // Snapshot (complete): new admission C; B has a medical discharge (kept in bed,
    // pending nursing discharge); A is absent from the complete census → inferred
    // missing-in-rayen discharge that DOES vacate the bed.
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2020-06-01T20:00:00-06:00',
      facilityId: 1342,
      isComplete: true,
      encounters: [
        enc({
          encounterId: 'C',
          run: '56333576',
          firstGivenName: 'Carlos',
          firstFamilyName: 'Vasquez',
          room: 'H2',
          bed: 'C1',
        }),
        { ...encB, hasMedicalDischarge: true },
      ],
    };

    const { diff } = planRayenCensusImport({ current, snapshot, reference: REFERENCE });
    const { record, applied } = applyCensusImportDiff(current, diff, makeCtx());

    // Sanity on the scenario: C admitted, A discharged (missing-in-rayen), B kept in bed.
    expect(applied.admissions).toBe(1);
    expect(applied.discharges).toBe(1);
    expect(diff.summary.pendingNursingDischarges).toBe(1);
    expect(record.discharges).toHaveLength(1);
    expect(record.beds[bedB]?.patientName).toBe(patB.patientName);

    // The real gate: the produced record must satisfy the HHR's own Zod schema.
    const result = validateDailyRecord(record);
    expect(result.success ? [] : result.errors).toEqual([]);
    expect(result.success).toBe(true);

    // Firestore rule precondition must survive the transformation.
    expect(record.dateTimestamp).toBe(current.dateTimestamp);
  });
});
