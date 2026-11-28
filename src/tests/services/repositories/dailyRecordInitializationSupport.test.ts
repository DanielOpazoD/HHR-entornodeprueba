// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  buildInitializedDayRecord,
  preparePatientForCarryover,
} from '@/services/repositories/dailyRecordInitializationSupport';

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente',
  rut: '11.111.111-1',
  age: '40a',
  pathology: 'Diagnostico',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-19',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const buildRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T08:00:00.000Z`,
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('dailyRecordInitializationSupport', () => {
  it('copies manual and legacy specialties with their patients into the next census', () => {
    const previous = buildRecord('2026-09-23');
    const assignment = {
      schemaVersion: 3 as const,
      episodeId: 'episode-r1',
      decisionId: 'decision-r1',
      recordDate: '2026-09-23',
      source: 'manual_ai' as const,
      actorUid: 'synthetic-user',
      decidedAt: '2026-09-23T14:00:00.000Z',
    };
    previous.beds.R1 = buildPatient('R1', {
      clinicalEpisodeId: 'episode-r1',
      specialty: 'Cirugía',
      specialtyAssignment: assignment,
    });
    previous.beds.R2 = buildPatient('R2', {
      patientName: 'Paciente legado',
      clinicalEpisodeId: undefined,
      specialty: 'Med Interna',
    });

    const copied = buildInitializedDayRecord('2026-09-24', previous);
    expect(copied.beds.R1.specialty).toBe('Cirugía');
    expect(copied.beds.R1.specialtyAssignment).toEqual(assignment);
    expect(copied.beds.R2.specialty).toBe('Med Interna');
    expect(copied.beds.R2.specialtyAssignment).toBeUndefined();
  });

  it('prepares carryover patient by clearing CUDYR and inheriting night notes', () => {
    const source = buildPatient('R1', {
      patientName: 'Madre',
      handoffNoteNightShift: 'Nota noche madre',
      medicalHandoffNote: 'Resumen medico madre',
      medicalHandoffEntries: [
        {
          id: 'medical-entry-1',
          specialty: Specialty.MEDICINA,
          note: 'Control por medicina interna',
          originalNoteAt: '2026-03-07T07:00:00.000Z',
          updatedAt: '2026-03-08T09:15:00.000Z',
          currentStatus: 'updated_by_specialist',
          currentStatusDate: '2026-03-08',
        },
      ],
      medicalHandoffAudit: {
        originalNoteAt: '2026-03-07T07:00:00.000Z',
        lastSpecialistUpdateAt: '2026-03-08T09:15:00.000Z',
        currentStatus: 'updated_by_specialist',
        currentStatusDate: '2026-03-08',
      },
      cudyr: {
        changeClothes: 1,
        mobilization: 0,
        feeding: 0,
        elimination: 0,
        psychosocial: 0,
        surveillance: 0,
        vitalSigns: 0,
        fluidBalance: 0,
        oxygenTherapy: 0,
        airway: 0,
        proInterventions: 0,
        skinCare: 0,
        pharmacology: 0,
        invasiveElements: 0,
      },
      clinicalCrib: buildPatient('C1', {
        patientName: 'RN',
        handoffNoteNightShift: 'Nota noche cuna',
        medicalHandoffNote: 'Resumen medico cuna',
      }),
    });

    const carried = preparePatientForCarryover(source);

    expect(carried.cudyr).toBeUndefined();
    expect(carried.handoffNoteDayShift).toBe('Nota noche madre');
    expect(carried.handoffNoteNightShift).toBe('Nota noche madre');
    expect(carried.medicalHandoffNote).toBe('Resumen medico madre');
    expect(carried.medicalHandoffEntries?.[0]?.note).toBe('Control por medicina interna');
    expect(carried.medicalHandoffEntries?.[0]?.originalNoteAt).toBe('2026-03-07T07:00:00.000Z');
    expect(carried.medicalHandoffEntries?.[0]?.updatedAt).toBe('2026-03-08T09:15:00.000Z');
    expect(carried.medicalHandoffEntries?.[0]?.currentStatus).toBeUndefined();
    expect(carried.medicalHandoffEntries?.[0]?.currentStatusDate).toBeUndefined();
    expect(carried.medicalHandoffAudit?.originalNoteAt).toBe('2026-03-07T07:00:00.000Z');
    expect(carried.medicalHandoffAudit?.lastSpecialistUpdateAt).toBe('2026-03-08T09:15:00.000Z');
    expect(carried.medicalHandoffAudit?.currentStatus).toBeUndefined();
    expect(carried.medicalHandoffAudit?.currentStatusDate).toBeUndefined();
    expect(carried.clinicalCrib?.handoffNoteDayShift).toBe('Nota noche cuna');
    expect(carried.clinicalCrib?.handoffNoteNightShift).toBe('Nota noche cuna');
    expect(carried.clinicalCrib?.medicalHandoffNote).toBe('Resumen medico cuna');
  });

  it('builds a new day with vacant nurses and TENS', () => {
    const previous = buildRecord('2026-02-18');
    previous.nursesNightShift = ['N1', 'N2'];
    previous.handoffNightReceives = ['R1', 'R2'];
    previous.tensNightShift = ['T1', 'T2', 'T3'];
    previous.handoffNovedadesNightShift = 'Novedades noche';

    const result = buildInitializedDayRecord('2026-02-19', previous);

    expect(result.dateTimestamp).toBe(Date.parse('2026-02-19T05:00:00Z'));
    expect(result.nursesDayShift).toEqual(['', '']);
    expect(result.tensDayShift).toEqual(['', '', '']);
    expect(result.handoffNovedadesDayShift).toBe('Novedades noche');
  });

  it('builds copied days without historical Rayen clinical values', () => {
    const previous = buildRecord('2026-02-18');
    previous.beds.R1 = buildPatient('R1', {
      devices: ['CVC'],
      deviceDetails: { CVC: { installationDate: '2026-02-17' } },
      evaluationScores: { braden: { total: 17 } } as never,
      vitalSigns: { recordedDate: '2026-02-18', systolic: 118 } as never,
      clinicalSyncCheckpoint: {
        version: 2,
        fingerprintVersion: 1,
        sources: {},
      },
    });

    const result = buildInitializedDayRecord('2026-02-19', previous);

    expect(result.beds.R1.devices).toEqual([]);
    expect(result.beds.R1.deviceDetails).toBeUndefined();
    expect(result.beds.R1.evaluationScores).toBeUndefined();
    expect(result.beds.R1.vitalSigns).toBeUndefined();
    expect(result.beds.R1.clinicalSyncCheckpoint).toBeUndefined();
    expect(result.beds.R1.patientName).toBe('Paciente');
    expect(result.beds.R1.admissionDate).toBe('2026-02-19');
  });

  it('carries occupied historical and operational locations and leaves retired empty beds behind', () => {
    const previous = buildRecord('2026-02-18');
    previous.activeExtraBeds = ['E1', 'E2', 'CMA_R1', 'BOX1', 'BOX2'];
    previous.beds.E1 = buildPatient('E1');
    previous.beds.CMA_R1 = buildPatient('CMA_R1');
    previous.beds.BOX1 = buildPatient('BOX1');

    const result = buildInitializedDayRecord('2026-02-19', previous);

    expect(result.activeExtraBeds.sort()).toEqual(['BOX1', 'CMA_R1', 'E1']);
    expect(result.beds.E1.patientName).toBe('Paciente');
    expect(previous.activeExtraBeds).toContain('E2');
    expect(result.beds.BOX1.patientName).toBe('Paciente');
    expect(result.beds.BOX2.patientName).toBe('');
  });

  // The source is the server's day as read (not prepared): a day still listing a patient beside
  // that same episode's discharge must not carry the discharged patient into the next census.
  it.each([
    ['the same episode', 'episode-r4', ''],
    ['another episode', 'episode-r4-previous', 'Paciente'],
  ])('copies a bed beside a discharge of %s accordingly', (_label, dischargedEpisode, kept) => {
    const previous = buildRecord('2026-09-23');
    previous.beds.R4 = buildPatient('R4', { clinicalEpisodeId: 'episode-r4' });
    previous.discharges = [
      {
        id: 'discharge-r4',
        bedId: 'R4',
        bedName: 'R4',
        bedType: 'Cama',
        patientName: 'Paciente',
        rut: '11.111.111-1',
        diagnosis: 'Diagnostico',
        time: '10:00',
        status: 'Vivo',
        clinicalEpisodeId: dischargedEpisode,
      },
    ];

    const copied = buildInitializedDayRecord('2026-09-24', previous);

    expect(copied.beds.R4.patientName).toBe(kept);
    expect(previous.beds.R4.patientName).toBe('Paciente');
  });
});
