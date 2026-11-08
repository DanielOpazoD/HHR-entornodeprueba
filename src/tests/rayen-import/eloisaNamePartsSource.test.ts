import { describe, expect, it, vi } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { historicalEncounterFromLocal } from '@/features/rayen-import/domain/historicalEncounterFromLocal';
import { presentPatientUpdates } from '@/features/rayen-import/components/rayenImportUpdatePresentation';
import { harmonizeEpisodeDemographicsHistory } from '@/features/census/controllers/patientDemographicsEpisodeSyncController';
import { bedManagementReducer } from '@/hooks/useBedManagementReducer';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { applyPatches } from '@/utils/patchUtils';
import { formatPatientDisplayName } from '@/utils/patientNameDisplayUtils';

const REFERENCE = new Date(2026, 10, 8);
const FULL_NAME = 'Ana María Josefa Luisa Rosa Elena Pérez Soto';
const SHORT_NAME = 'Ana María Josefa Pérez Soto';

// Synthetic patient: six given names and two single-word surnames, the owner's example shape.
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E-900',
  run: '111111111',
  firstGivenName: 'Ana',
  nextGivenNames: 'María Josefa Luisa Rosa Elena',
  firstFamilyName: 'Pérez',
  secondFamilyName: 'Soto',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-11-07T10:00:00-05:00',
  diagnosis: 'Neumonía',
  ...overrides,
});

const snapshotOf = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-11-08T20:00:00-05:00',
  facilityId: 1342,
  encounters,
  isComplete: false,
});

const recordWith = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-11-08',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

/** The same patient as stored before this change: a real split saved without its source. */
const legacySyncedPatient = (): { bedId: string; patient: PatientData } => {
  const mapped = rayenToPatientData(encounter(), REFERENCE);
  const { namePartsSource: _source, ...patient } = mapped.patient;
  return { bedId: mapped.bedId ?? '', patient };
};

describe('Eloísa name parts source', () => {
  it('marks a synced patient and shows only its first three given names', () => {
    const { patient } = rayenToPatientData(encounter(), REFERENCE);

    expect(patient.patientName).toBe(FULL_NAME);
    expect(patient.namePartsSource).toBe('eloisa');
    expect(formatPatientDisplayName(patient)).toBe(SHORT_NAME);
    // The marker survives the record schema used by Firestore reads and the local cache.
    expect(PatientDataSchema.parse(patient).namePartsSource).toBe('eloisa');
    expect(PatientDataSchema.parse({ ...patient, namePartsSource: null }).namePartsSource).toBe(
      undefined
    );
  });

  it('keeps the whole name for a legacy patient without the marker', () => {
    expect(formatPatientDisplayName(legacySyncedPatient().patient)).toBe(FULL_NAME);
  });

  it('does not credit Eloísa with a split it did not provide', () => {
    // The extension falls back to the whole name as given names when the header is missing.
    const fallback = rayenToPatientData(
      encounter({
        firstGivenName: FULL_NAME,
        nextGivenNames: '',
        firstFamilyName: '',
        secondFamilyName: '',
      }),
      REFERENCE
    ).patient;
    expect(fallback.namePartsSource).toBeUndefined();

    // An encounter rebuilt from an HHR record keeps that record's source.
    const legacy = legacySyncedPatient().patient;
    expect(
      rayenToPatientData(historicalEncounterFromLocal(legacy), REFERENCE).patient.namePartsSource
    ).toBeUndefined();
    expect(
      rayenToPatientData(
        historicalEncounterFromLocal({ ...legacy, namePartsSource: 'eloisa' }),
        REFERENCE
      ).patient.namePartsSource
    ).toBe('eloisa');
  });

  it('adds the marker to an existing patient on re-sync as a silent update only', () => {
    const { bedId, patient } = legacySyncedPatient();
    const existing: PatientData = {
      ...patient,
      status: 'Grave' as PatientData['status'],
      pathology: 'Diagnóstico manual',
      diagnosisManualOverride: true,
      handoffNote: 'Nota de enfermería',
      cudyr: {
        ...DataFactory.createMockPatient(bedId).cudyr,
        dependency: 3,
      } as PatientData['cudyr'],
    };
    const current = recordWith({ [bedId]: existing });

    const diff = reconcileCensus(current, snapshotOf([encounter()]), { reference: REFERENCE });

    expect(diff.admissions).toHaveLength(0);
    expect(diff.moves).toHaveLength(0);
    expect(diff.discharges).toHaveLength(0);
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.updates).toHaveLength(1);
    expect(diff.updates[0].changes).toEqual([
      { field: 'namePartsSource', from: undefined, to: 'eloisa' },
    ]);
    expect(presentPatientUpdates(diff.updates)).toEqual([]);

    let n = 0;
    const result = applyCensusImportDiff(current, diff, {
      idFactory: () => `id-${++n}`,
      now: REFERENCE,
      actor: 'Enfermera de prueba',
      syncRunId: 'run-1',
    });
    expect(result.applied).toEqual({ admissions: 0, updates: 1, moves: 0, discharges: 0 });
    expect(result.record.beds[bedId]).toEqual({ ...existing, namePartsSource: 'eloisa' });
    expect(formatPatientDisplayName(result.record.beds[bedId])).toBe(SHORT_NAME);

    // Once marked, the next sync finds nothing to update.
    const next = reconcileCensus(result.record, snapshotOf([encounter()]), {
      reference: REFERENCE,
    });
    expect(next.updates).toHaveLength(0);
  });

  it('clears the marker when a person edits the name in HHR', () => {
    const { patient } = rayenToPatientData(encounter(), REFERENCE);
    const record = DataFactory.createMockDailyRecord('2026-11-08', {
      beds: {
        R1: { ...patient, bedId: 'R1' },
        R2: {
          ...DataFactory.createMockPatient('R2'),
          clinicalCrib: { ...patient, bedId: 'R2', bedMode: 'Cuna' },
        },
      },
    });

    const edited = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: { firstName: 'Ana María', patientName: 'Ana María Pérez Soto' },
    });
    expect(edited).toHaveProperty(['beds.R1.namePartsSource'], undefined);
    expect(applyPatches(record, edited!).beds.R1.namePartsSource).toBeUndefined();

    const cribEdited = bedManagementReducer(record, {
      type: 'UPDATE_CLINICAL_CRIB',
      bedId: 'R2',
      field: 'lastName',
      value: 'Tuki',
    });
    expect(cribEdited).toHaveProperty(['beds.R2.clinicalCrib.namePartsSource'], undefined);

    const cribModal = bedManagementReducer(record, {
      type: 'UPDATE_CLINICAL_CRIB_MULTIPLE',
      bedId: 'R2',
      fields: { secondLastName: 'Hey' },
    });
    expect(cribModal).toHaveProperty(['beds.R2.clinicalCrib.namePartsSource'], undefined);

    // The demographics form resends unchanged names: that is not a name edit.
    const resaved = bedManagementReducer(record, {
      type: 'UPDATE_PATIENT_MULTIPLE',
      bedId: 'R1',
      fields: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        secondLastName: patient.secondLastName,
        patientName: patient.patientName,
        rut: '22.222.222-2',
      },
    });
    expect(resaved).not.toHaveProperty(['beds.R1.namePartsSource']);
  });

  it('clears the marker on earlier episode days that receive the edited name', async () => {
    const { patient } = rayenToPatientData(encounter(), REFERENCE);
    const sourcePatient = { ...patient, bedId: 'R1', firstSeenDate: '2026-11-07' };
    const updatePartial = vi.fn().mockResolvedValue(undefined);

    await harmonizeEpisodeDemographicsHistory({
      currentDate: '2026-11-08',
      sourcePatient,
      updatedFields: { firstName: 'Ana María', patientName: 'Ana María Pérez Soto' },
      dailyRecordReadRepository: {
        getAvailableDates: vi.fn().mockResolvedValue([]),
        getForDate: vi
          .fn()
          .mockResolvedValue(
            DataFactory.createMockDailyRecord('2026-11-07', { beds: { R1: sourcePatient } })
          ),
      },
      dailyRecordWriteRepository: { updatePartial },
    });

    expect(updatePartial).toHaveBeenCalledTimes(1);
    const [date, patch] = updatePartial.mock.calls[0];
    expect(date).toBe('2026-11-07');
    expect(Object.keys(patch).sort()).toEqual([
      'beds.R1.firstName',
      'beds.R1.namePartsSource',
      'beds.R1.patientName',
    ]);
    expect(patch['beds.R1.namePartsSource']).toBeUndefined();
  });
});
