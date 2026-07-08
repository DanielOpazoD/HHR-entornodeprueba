import { describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  buildEntryDeleteAuditPayload,
  buildEntryNoteChangeAuditPayload,
  buildEntryRefreshAuditPayload,
  buildPrimaryNoteChangeAuditPayload,
  createMedicalFieldsPersister,
  isSuccessfulMedicalHandoffOutcome,
  resolveMedicalHandoffMutationContext,
  resolveRefreshableMedicalEntry,
  shouldLogMedicalHandoffOutcome,
} from '@/hooks/controllers/medicalHandoffHandlersController';

const buildPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
  bedId: '101',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente Demo',
  rut: '1-9',
  age: '30',
  pathology: 'Observacion',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-29',
  hasWristband: true,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

describe('medicalHandoffHandlersController', () => {
  it('blocks mutations when the medical handoff is not editable', () => {
    expect(
      resolveMedicalHandoffMutationContext({
        bedId: '101',
        isNested: false,
        isMedical: true,
        canMutateCurrentMedicalRecord: false,
        record: {
          date: '2026-03-29',
          beds: {
            '101': buildPatient(),
          },
        },
      })
    ).toBeNull();
  });

  it('resolves the nested clinical crib patient when editing a provisional crib row', () => {
    const clinicalCrib = buildPatient({
      bedId: '101C',
      patientName: 'RN clínico',
      bedMode: 'Cuna',
    });

    expect(
      resolveMedicalHandoffMutationContext({
        bedId: '101',
        isNested: true,
        isMedical: true,
        canMutateCurrentMedicalRecord: true,
        record: {
          date: '2026-03-29',
          beds: {
            '101': buildPatient({
              clinicalCrib,
            }),
          },
        },
      })
    ).toEqual({
      bedId: '101',
      isNested: true,
      patient: clinicalCrib,
      recordDate: '2026-03-29',
    });
  });

  it('keeps silent domain failures out of the unexpected outcome logger', () => {
    expect(
      shouldLogMedicalHandoffOutcome({
        status: 'failed',
        data: null,
        reason: 'missing_patient',
        issues: [],
      })
    ).toBe(false);

    expect(
      shouldLogMedicalHandoffOutcome({
        status: 'failed',
        data: null,
        reason: 'write_failed',
        issues: [],
      })
    ).toBe(true);
  });

  it('returns only refreshable entries with a non-empty note', () => {
    const patient = buildPatient({
      medicalHandoffEntries: [
        {
          id: 'entry-empty',
          specialty: Specialty.MEDICINA,
          note: '   ',
        },
        {
          id: 'entry-valid',
          specialty: Specialty.MEDICINA,
          note: 'Paciente estable',
        },
      ],
    });

    expect(resolveRefreshableMedicalEntry(patient, 'entry-empty')).toBeNull();
    expect(resolveRefreshableMedicalEntry(patient, 'missing-entry')).toBeNull();
    expect(resolveRefreshableMedicalEntry(patient, 'entry-valid')).toEqual({
      id: 'entry-valid',
      specialty: Specialty.MEDICINA,
      note: 'Paciente estable',
    });
  });

  it('wraps the bed and nested scope in a reusable medical fields persister', async () => {
    const persistMedicalFields = vi.fn().mockResolvedValue(undefined);
    const persister = createMedicalFieldsPersister(persistMedicalFields, '101', true);

    await persister({ medicalHandoffNote: 'texto' });

    expect(persistMedicalFields).toHaveBeenCalledWith('101', { medicalHandoffNote: 'texto' }, true);
  });

  it('recognizes only success outcomes with concrete data as successful medical outcomes', () => {
    expect(
      isSuccessfulMedicalHandoffOutcome({
        status: 'success',
        data: { entry: { id: 'entry-1' } },
      } as never)
    ).toBe(true);

    expect(
      isSuccessfulMedicalHandoffOutcome({
        status: 'success',
        data: null,
      } as never)
    ).toBe(false);
  });
});

describe('audit payload builders for MEDICAL_HANDOFF_MODIFIED', () => {
  it('buildPrimaryNoteChangeAuditPayload uses Cuna fallback when nested and no patient name', () => {
    const payload = buildPrimaryNoteChangeAuditPayload({
      patient: undefined,
      isNested: true,
      value: 'nueva nota',
      previousNote: 'previa',
    });
    expect(payload.patientName).toBe('Cuna');
    expect(payload.note).toBe('nueva nota');
    expect(payload.changes).toEqual({
      medicalHandoffNote: { old: 'previa', new: 'nueva nota' },
    });
  });

  it('buildPrimaryNoteChangeAuditPayload uses ANONYMOUS fallback when not nested and no patient name', () => {
    const payload = buildPrimaryNoteChangeAuditPayload({
      patient: undefined,
      isNested: false,
      value: 'x',
      previousNote: '',
    });
    expect(payload.patientName).toBe('ANONYMOUS');
  });

  it('buildPrimaryNoteChangeAuditPayload prefers the real patient name when present', () => {
    const payload = buildPrimaryNoteChangeAuditPayload({
      patient: buildPatient({ patientName: 'Juana' }),
      isNested: false,
      value: 'x',
      previousNote: '',
    });
    expect(payload.patientName).toBe('Juana');
  });

  it('buildEntryNoteChangeAuditPayload includes specialty and the note delta', () => {
    const payload = buildEntryNoteChangeAuditPayload({
      patient: buildPatient({ patientName: 'Pedro' }),
      specialty: 'CARDIO',
      value: 'nueva',
      previousNote: 'vieja',
    });
    expect(payload).toEqual({
      patientName: 'Pedro',
      specialty: 'CARDIO',
      note: 'nueva',
      changes: { medicalHandoffNote: { old: 'vieja', new: 'nueva' } },
    });
  });

  it('buildEntryDeleteAuditPayload encodes the destructive operation flag and clears the note', () => {
    const payload = buildEntryDeleteAuditPayload({
      patient: buildPatient({ patientName: 'Ana' }),
      specialty: 'TRAUMA',
      previousNote: 'previa',
    });
    expect(payload.operation).toBe('delete_medical_handoff_entry');
    expect(payload.changes).toEqual({
      medicalHandoffNote: { old: 'previa', new: '' },
    });
  });

  it('buildEntryRefreshAuditPayload reports the timestamp delta and the refresh operation', () => {
    const payload = buildEntryRefreshAuditPayload({
      patient: buildPatient({ patientName: 'Luis' }),
      specialty: 'NEURO',
      previousUpdatedAt: '2026-03-29T10:00:00.000Z',
      newUpdatedAt: '2026-03-29T10:30:00.000Z',
    });
    expect(payload).toEqual({
      patientName: 'Luis',
      specialty: 'NEURO',
      operation: 'refresh_medical_entry_as_current',
      changes: {
        medicalHandoffNoteTimestamp: {
          old: '2026-03-29T10:00:00.000Z',
          new: '2026-03-29T10:30:00.000Z',
        },
      },
    });
  });

  it('builders accept null/undefined patient defensively', () => {
    expect(
      buildEntryNoteChangeAuditPayload({
        patient: null,
        specialty: undefined,
        value: '',
        previousNote: '',
      }).patientName
    ).toBe('');
    expect(
      buildEntryDeleteAuditPayload({
        patient: undefined,
        specialty: undefined,
        previousNote: '',
      }).patientName
    ).toBe('');
    expect(
      buildEntryRefreshAuditPayload({
        patient: null,
        specialty: undefined,
        previousUpdatedAt: '',
        newUpdatedAt: '',
      }).patientName
    ).toBe('');
  });
});
