import type { PatientData } from '@/types/domain/patient';

import { describe, expect, it } from 'vitest';

import { PatientStatus, Specialty } from '@/domain/handoff/patientContracts';
import { resolveMedicalObservationEntries } from '@/domain/handoff/patientView';
import {
  canToggleClinicalEvents,
  resolveClinicalEventsCellState,
  resolveHandoffStatusVariant,
  resolveMedicalObservationEmptyState,
  shouldShowMedicalPrimaryNoteFallback,
  shouldRenderClinicalEventsPanel,
} from '@/features/handoff/controllers/handoffRowCellsController';

const buildPatient = (overrides: Partial<PatientData> = {}): PatientData =>
  ({
    patientName: 'Paciente Test',
    rut: '11.111.111-1',
    pathology: 'Diagnóstico',
    status: PatientStatus.ESTABLE,
    specialty: Specialty.MEDICINA,
    devices: [],
    deviceDetails: {},
    clinicalEvents: [],
    medicalHandoffEntries: [],
    age: '40a',
    admissionDate: '2026-03-15',
    ...overrides,
  }) as PatientData;

describe('handoffRowCellsController', () => {
  it('maps patient status to badge variants', () => {
    expect(resolveHandoffStatusVariant(PatientStatus.GRAVE)).toBe('red');
    expect(resolveHandoffStatusVariant(PatientStatus.DE_CUIDADO)).toBe('orange');
    expect(resolveHandoffStatusVariant(PatientStatus.ESTABLE)).toBe('green');
    expect(resolveHandoffStatusVariant(undefined)).toBe('green');
  });

  it('enables event toggle only for top-level rows with edit access or existing events', () => {
    expect(
      canToggleClinicalEvents({ isSubRow: false, hasEvents: false, canEditEvents: true })
    ).toBe(true);
    expect(
      canToggleClinicalEvents({ isSubRow: false, hasEvents: true, canEditEvents: false })
    ).toBe(true);
    expect(canToggleClinicalEvents({ isSubRow: true, hasEvents: true, canEditEvents: true })).toBe(
      false
    );
  });

  it('requires full event actions to render the events panel', () => {
    expect(
      shouldRenderClinicalEventsPanel({
        showEvents: true,
        canAdd: true,
        canUpdate: true,
        canDelete: true,
      })
    ).toBe(true);
    expect(
      shouldRenderClinicalEventsPanel({
        showEvents: true,
        canAdd: true,
        canUpdate: false,
        canDelete: true,
      })
    ).toBe(false);
  });

  it('resolves the diagnosis/events cell state from row and permission context', () => {
    expect(
      resolveClinicalEventsCellState({
        patientStatus: PatientStatus.DE_CUIDADO,
        isSubRow: false,
        hasEvents: true,
        canAdd: true,
        canUpdate: true,
        canDelete: true,
        showEvents: false,
        isMedical: false,
      })
    ).toEqual({
      statusVariant: 'orange',
      canToggleEvents: true,
      shouldRenderEventsPanel: false,
      showStatusBadge: true,
    });

    expect(
      resolveClinicalEventsCellState({
        patientStatus: PatientStatus.ESTABLE,
        isSubRow: true,
        hasEvents: true,
        canAdd: true,
        canUpdate: true,
        canDelete: true,
        showEvents: true,
        isMedical: true,
      })
    ).toEqual({
      statusVariant: 'green',
      canToggleEvents: false,
      shouldRenderEventsPanel: true,
      showStatusBadge: false,
    });
  });

  it('prefers persisted medical observation entries and otherwise derives draft display entries', () => {
    const persistedEntry = {
      id: 'entry-1',
      specialty: Specialty.MEDICINA,
      note: 'Persistida',
    };
    expect(
      resolveMedicalObservationEntries({
        patient: buildPatient({ medicalHandoffEntries: [persistedEntry] as never }),
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: false,
      })
    ).toEqual([persistedEntry]);

    const derivedEntries = resolveMedicalObservationEntries({
      patient: buildPatient({ medicalHandoffNote: 'Nota legada' } as never),
      isFieldReadOnly: false,
      hasCreatePrimaryEntryAction: false,
    });
    expect(derivedEntries).toHaveLength(1);

    expect(
      resolveMedicalObservationEntries({
        patient: buildPatient({ medicalHandoffNote: 'Nota legada' } as never),
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: true,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          note: 'Nota legada',
        }),
      ])
    );
  });

  it('shows the primary note fallback only when there are no entries and no create action', () => {
    expect(
      shouldShowMedicalPrimaryNoteFallback({
        entriesCount: 0,
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: false,
      })
    ).toBe(true);
    expect(
      shouldShowMedicalPrimaryNoteFallback({
        entriesCount: 1,
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: false,
      })
    ).toBe(false);
  });

  it('resolves the empty medical observation state for create-entry and primary-note flows', () => {
    expect(
      resolveMedicalObservationEmptyState({
        displayEntriesCount: 0,
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: true,
      })
    ).toBe('create-entry');

    expect(
      resolveMedicalObservationEmptyState({
        displayEntriesCount: 0,
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: false,
      })
    ).toBe('primary-note');
  });

  it('keeps the empty state neutral when entries already exist or the field is read-only', () => {
    expect(
      resolveMedicalObservationEmptyState({
        displayEntriesCount: 1,
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: true,
      })
    ).toBe('empty');

    expect(
      resolveMedicalObservationEmptyState({
        displayEntriesCount: 0,
        isFieldReadOnly: true,
        hasCreatePrimaryEntryAction: false,
      })
    ).toBe('empty');
  });
});
