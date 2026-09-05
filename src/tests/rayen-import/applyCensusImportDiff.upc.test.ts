import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  type ApplyContext,
  type CensusImportDiff,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const REFERENCE = new Date(2026, 6, 8);
const NOW = new Date(2026, 6, 8, 15, 30, 0);

const makeCtx = (): ApplyContext => {
  let n = 0;
  return {
    idFactory: () => `id-${++n}`,
    now: NOW,
    actor: 'Enfermera Rayen',
    syncRunId: 'sync-run-1',
  };
};

const makeRecord = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-07-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const seedBed = (encounter: RayenEncounter, bedIdOverride?: string): [string, PatientData] => {
  const { patient, bedId } = rayenToPatientData(encounter, REFERENCE);
  return [bedIdOverride ?? bedId ?? '', patient];
};

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...over,
});

describe('Rayen UPC review invalidation', () => {
  it('invalidates the UPC review through Rayen moves, including a same-day return', () => {
    const [, patient] = seedBed(makeEncounter());
    const checklist = {
      uciCriteria: [],
      utiCriteria: ['uti_mon_cardiaca'],
      classification: 'UPC_UTI' as const,
      evaluatedAt: '2026-07-08T12:00:00Z',
      evaluatedForDate: '2026-07-08',
      evaluatedBedId: 'R1',
      evaluatedBy: { uid: 'test', displayName: 'Cuenta de prueba' },
      responsibleNurse: {
        name: 'Enfermera de prueba',
        source: 'assigned' as const,
      },
    };
    const original = makeRecord({
      R1: { ...patient, bedId: 'R1', isUPC: true, upcChecklist: checklist },
    });
    const move = (fromBedId: string, toBedId: string) =>
      makeDiff({
        moves: [
          {
            fromBedId,
            toBedId,
            rut: patient.rut,
            patientName: patient.patientName,
            source: makeEncounter(),
          },
        ],
      });
    const moved = applyCensusImportDiff(original, move('R1', 'R2'), makeCtx());
    expect(moved.record.beds.R2.upcChecklist).toEqual({ ...checklist, reviewRequired: true });
    const returned = applyCensusImportDiff(moved.record, move('R2', 'R1'), makeCtx());
    expect(returned.record.beds.R1.upcChecklist).toEqual({ ...checklist, reviewRequired: true });
    expect(original.beds.R1.upcChecklist).toEqual(checklist);
    const unchanged = applyCensusImportDiff(original, makeDiff(), makeCtx());
    expect(unchanged.record.beds.R1.upcChecklist).toEqual(checklist);
  });
});
