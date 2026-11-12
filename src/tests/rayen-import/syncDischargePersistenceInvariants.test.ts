import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import { logError } from '@/services/utils/errorService';

vi.mock('@/services/utils/errorService', () => ({ logError: vi.fn() }));

const now = new Date('2026-11-11T18:00:00Z');
const fixture = (scenario: string) => {
  const bedId = scenario === 'same-day bed move' ? 'H1C2' : 'H1C1';
  const patient: PatientData = {
    ...createEmptyPatient(bedId),
    patientName: 'Paciente sintético',
    rut: scenario === 'passport' ? 'AB123456' : '11111111-1',
    documentType: scenario === 'passport' ? ('Pasaporte' as const) : ('RUT' as const),
    clinicalEpisodeId: 'episode-principal',
    admissionDate: '2026-11-10',
    admissionTime: '09:00',
    pathology: 'Diagnóstico sintético',
  };
  if (scenario === 'mother and newborn') {
    patient.clinicalCrib = {
      ...createEmptyPatient(bedId),
      patientName: 'RN sintético',
      rut: '22222222-2',
      clinicalEpisodeId: 'episode-newborn',
      admissionDate: '2026-11-10',
      bedMode: 'Cuna',
    };
    patient.hasCompanionCrib = true;
  }
  const current: DailyRecord = {
    date: '2026-11-11',
    beds: Object.fromEntries(BEDS.map(bed => [bed.id, createEmptyPatient(bed.id)])),
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: now.toISOString(),
  };
  current.beds[bedId] = patient;
  const diff: CensusImportDiff = {
    admissions: [],
    updates: [],
    moves: [],
    conflicts: [],
    pendingAdministrativeDischarges: [],
    discharges: [
      {
        bedId,
        rut: patient.rut,
        patientName: patient.patientName,
        reason: 'administrative-discharge',
        kind: 'alta',
        status: 'Vivo',
        correctedDay: current.date,
        correctedTime: '12:47',
        encounterId: patient.clinicalEpisodeId,
        associatedClinicalCrib: patient.clinicalCrib
          ? { clinicalEpisodeId: 'episode-newborn', patientName: 'RN sintético', rut: '22222222-2' }
          : undefined,
      },
    ],
    unchangedCount: 0,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 1,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 0,
    },
  };
  let id = 0;
  const context = { now, idFactory: () => `movement-${++id}`, syncRunId: 'synthetic-run' };
  if (scenario === 'same-day bed move') {
    current.beds.H1C1 = { ...patient, bedId: 'H1C1' };
    current.beds.H1C2 = createEmptyPatient('H1C2');
    const moved = applyCensusImportDiff(
      current,
      {
        ...diff,
        discharges: [],
        moves: [
          {
            fromBedId: 'H1C1',
            toBedId: 'H1C2',
            rut: patient.rut,
            patientName: patient.patientName,
            source: {
              encounterId: patient.clinicalEpisodeId!,
              run: patient.rut,
              firstGivenName: 'Paciente',
              firstFamilyName: 'sintético',
              room: 'H1',
              bed: 'C2',
            },
          },
        ],
      },
      context
    );
    return { current: moved.record, diff, context, bedId };
  }
  return { current, diff, context, bedId };
};

beforeEach(() => vi.clearAllMocks());

describe('sync discharge persistence', () => {
  for (const scenario of ['simple', 'mother and newborn', 'same-day bed move', 'passport']) {
    it(`${scenario}: saves the same document the repair used to produce`, () => {
      const { current, diff, context } = fixture(scenario);
      const applied = applyCensusImportDiff(current, diff, context);
      expect(applied.applied.discharges).toBe(1);
      const saved = prepareDailyRecordForPersistence(applied.record, current.date, current);
      // Before this fix the plan dropped every vacated catalog bed and the save repaired it.
      // Dropping all canonical empty beds and repairing reproduces that document exactly.
      const legacy = structuredClone(applied.record);
      for (const bed of BEDS) {
        if (JSON.stringify(legacy.beds[bed.id]) === JSON.stringify(createEmptyPatient(bed.id)))
          delete legacy.beds[bed.id];
      }
      expect(Object.keys(legacy.beds).length).toBeLessThan(BEDS.length);
      expect(prepareDailyRecordForPersistence(legacy, current.date, current)).toEqual(saved);
      expect(logError).toHaveBeenCalledWith(
        'Invariant repair applied on save',
        undefined,
        expect.anything()
      );
    });
    it(`${scenario}: needs no repair when saving the applied plan`, () => {
      const { current, diff, context } = fixture(scenario);
      const applied = applyCensusImportDiff(current, diff, context);
      prepareDailyRecordForPersistence(applied.record, current.date, current);
      expect(logError).not.toHaveBeenCalled();
    });
  }
  it('still reports a genuinely missing bed (producer mutation)', () => {
    const { current, diff, context, bedId } = fixture('simple');
    const applied = applyCensusImportDiff(current, diff, context);
    delete applied.record.beds[bedId];
    prepareDailyRecordForPersistence(applied.record, current.date, current);
    expect(logError).toHaveBeenCalledWith(
      'Invariant repair applied on save',
      undefined,
      expect.objectContaining({ repairPaths: [`beds.${bedId}`] })
    );
  });
});
