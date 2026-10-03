// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { MedicalHandoffAuditActor, PatientData } from '@/types/domain/patient';
import { Specialty } from '@/types/domain/patientClassification';
import {
  buildMedicalEntryAddFields,
  buildMedicalEntryContinuityFields,
  buildMedicalEntryDeleteFields,
  buildMedicalEntryNoteFields,
  buildMedicalEntryRefreshFields,
  buildMedicalEntrySpecialtyFields,
  buildMedicalPrimaryNoteFields,
} from '@/domain/handoff/patientEntryMutations';

const REPORT_DATE = '2026-03-03';
const NOW = '2026-03-03T20:33:00.000Z';

const ACTOR: MedicalHandoffAuditActor = {
  uid: 'admin-1',
  email: 'admin@hospitalhangaroa.cl',
  displayName: 'Daniel Opazo Damiani',
  role: 'admin',
};

const createPatient = (overrides: Partial<PatientData> = {}): PatientData =>
  ({
    bedId: '1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'Paciente Test',
    rut: '1-9',
    age: '40',
    pathology: 'Neumonia',
    specialty: Specialty.MEDICINA,
    status: 'Estable',
    admissionDate: '2026-03-01',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    ...overrides,
  }) as PatientData;

describe('medical patient handoff mutations domain', () => {
  it('builds legacy-compatible fields when updating the primary medical note', () => {
    const patient = createPatient();

    const result = buildMedicalPrimaryNoteFields(
      patient,
      'Paciente estable',
      ACTOR,
      REPORT_DATE,
      NOW
    );

    expect(result.fields.medicalHandoffEntries ?? []).toHaveLength(1);
    expect(result.fields.medicalHandoffNote).toBe('Paciente estable');
    expect(result.entry.currentStatus).toBe('updated_by_specialist');
    expect(result.fields.medicalHandoffAudit?.lastSpecialistUpdateBy?.displayName).toBe(
      ACTOR.displayName
    );
  });

  it('updates an existing entry note without losing the entry specialty', () => {
    const patient = createPatient({
      medicalHandoffEntries: [
        {
          id: 'entry-1',
          specialty: Specialty.CIRUGIA,
          note: 'Nota previa',
          originalNoteAt: '2026-03-01T09:00:00.000Z',
          originalNoteBy: {
            uid: 'doctor-base',
            email: 'base@hospitalhangaroa.cl',
            displayName: 'Dr. Base',
            role: 'doctor_urgency',
          },
        },
      ],
    });

    const result = buildMedicalEntryNoteFields(
      patient,
      'entry-1',
      'Nota actualizada',
      ACTOR,
      REPORT_DATE,
      NOW
    );

    expect(result.fields.medicalHandoffEntries?.[0]?.specialty).toBe(Specialty.CIRUGIA);
    expect(result.fields.medicalHandoffEntries?.[0]?.note).toBe('Nota actualizada');
    expect(result.fields.medicalHandoffEntries?.[0]?.originalNoteAt).toBe(NOW);
    expect(result.fields.medicalHandoffEntries?.[0]?.originalNoteBy?.displayName).toBe(
      ACTOR.displayName
    );
    expect(result.fields.medicalHandoffAudit?.currentStatus).toBe('updated_by_specialist');
  });

  it('refreshes a note as current without altering its original note metadata', () => {
    const patient = createPatient({
      medicalHandoffEntries: [
        {
          id: 'entry-1',
          specialty: Specialty.MEDICINA,
          note: 'Paciente estable',
          originalNoteAt: '2026-03-01T09:00:00.000Z',
          originalNoteBy: {
            uid: 'doctor-base',
            email: 'base@hospitalhangaroa.cl',
            displayName: 'Dr. Base',
            role: 'doctor_urgency',
          },
          updatedAt: '2026-03-01T09:00:00.000Z',
          updatedBy: {
            uid: 'doctor-base',
            email: 'base@hospitalhangaroa.cl',
            displayName: 'Dr. Base',
            role: 'doctor_urgency',
          },
        },
      ],
    });

    const result = buildMedicalEntryRefreshFields(patient, 'entry-1', ACTOR, REPORT_DATE, NOW);

    expect(result?.entry.originalNoteAt).toBe('2026-03-01T09:00:00.000Z');
    expect(result?.entry.originalNoteBy?.displayName).toBe('Dr. Base');
    expect(result?.entry.updatedAt).toBe(NOW);
    expect(result?.entry.updatedBy?.displayName).toBe(ACTOR.displayName);
    expect(result?.entry.currentStatus).toBe('updated_by_specialist');
  });

  it('adds a second specialty entry when a patient only had the default note', () => {
    const patient = createPatient();

    const fields = buildMedicalEntryAddFields(patient);

    expect(fields.medicalHandoffEntries).toHaveLength(2);
    expect(fields.medicalHandoffEntries?.[0]?.specialty).toBe(Specialty.MEDICINA);
    expect(fields.medicalHandoffEntries?.[1]?.specialty).not.toBe('');
  });

  it('updates specialty, confirms continuity, and deletes entries deterministically', () => {
    const patient = createPatient({
      medicalHandoffEntries: [
        {
          id: 'entry-1',
          specialty: Specialty.MEDICINA,
          note: 'Paciente estable',
        },
      ],
    });

    const specialtyResult = buildMedicalEntrySpecialtyFields(patient, 'entry-1', Specialty.CIRUGIA);
    expect(specialtyResult.fields.medicalHandoffEntries?.[0]?.specialty).toBe(Specialty.CIRUGIA);

    const continuityResult = buildMedicalEntryContinuityFields(
      specialtyResult.fields as PatientData,
      'entry-1',
      ACTOR,
      REPORT_DATE,
      NOW
    );
    expect(continuityResult?.entry.currentStatus).toBe('confirmed_current');
    expect(continuityResult?.fields.medicalHandoffAudit?.currentStatusBy?.displayName).toBe(
      ACTOR.displayName
    );

    const deleteResult = buildMedicalEntryDeleteFields(
      continuityResult?.fields as PatientData,
      'entry-1'
    );
    expect(deleteResult?.fields.medicalHandoffEntries).toEqual([]);
    expect(buildMedicalEntryDeleteFields(patient, 'missing')).toBeNull();
  });
});
