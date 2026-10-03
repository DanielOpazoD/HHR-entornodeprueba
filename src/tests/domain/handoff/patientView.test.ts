// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { MedicalHandoffEntry, PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import {
  resolveMedicalEntryMetadataViewModel,
  resolveMedicalHandoffValidityViewModel,
  resolveMedicalObservationEntries,
} from '@/domain/handoff/patientView';

const buildEntry = (overrides: Partial<MedicalHandoffEntry> = {}): MedicalHandoffEntry => ({
  id: 'entry-1',
  specialty: Specialty.MEDICINA,
  note: 'Paciente estable',
  ...overrides,
});

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

describe('handoff patient view domain', () => {
  it('builds simple metadata when the note author and current note event are the same', () => {
    const entry = buildEntry({
      originalNoteAt: '2026-03-03T20:33:00.000Z',
      originalNoteBy: {
        uid: 'doctor-1',
        displayName: 'Daniel Opazo Damiani',
        email: 'doctor@hospitalhangaroa.cl',
      },
      updatedAt: '2026-03-03T20:33:00.000Z',
      updatedBy: {
        uid: 'doctor-1',
        displayName: 'Daniel Opazo Damiani',
        email: 'doctor@hospitalhangaroa.cl',
      },
    });
    const metadata = resolveMedicalEntryMetadataViewModel(entry, '2026-03-03');

    expect(metadata.primaryLabel).toContain('Daniel Opazo');
    expect(metadata.primaryLabel).toContain('03-03-2026');
    expect(metadata.showInfoButton).toBe(false);
  });

  it('builds dual metadata when another user marks the note as current', () => {
    const entry = buildEntry({
      originalNoteAt: '2026-03-02T20:33:00.000Z',
      originalNoteBy: {
        uid: 'doctor-1',
        displayName: 'Daniel Opazo Damiani',
        email: 'doctor@hospitalhangaroa.cl',
      },
      updatedAt: '2026-03-03T10:00:00.000Z',
      updatedBy: {
        uid: 'admin-1',
        displayName: 'Admin Test',
        email: 'admin@hospitalhangaroa.cl',
      },
      currentStatus: 'updated_by_specialist',
      currentStatusDate: '2026-03-03',
      currentStatusAt: '2026-03-03T10:00:00.000Z',
      currentStatusBy: {
        uid: 'admin-1',
        displayName: 'Admin Test',
        email: 'admin@hospitalhangaroa.cl',
      },
    });
    const metadata = resolveMedicalEntryMetadataViewModel(entry, '2026-03-03');

    expect(metadata.primaryLabel).toContain('Nota base: Daniel Opazo');
    expect(metadata.printLabel).toContain('Vigente por: Admin Test');
    expect(metadata.showInfoButton).toBe(true);
    expect(metadata.detailLines).toEqual([
      expect.stringContaining('Nota original: Daniel Opazo'),
      expect.stringContaining('Marcada como actual por: Admin Test'),
    ]);
  });

  it('resolves inline note status using only same-day specialist updates', () => {
    const updatedToday = resolveMedicalHandoffValidityViewModel(
      buildEntry({
        updatedAt: '2026-03-03T10:00:00.000Z',
        updatedBy: {
          uid: 'doctor-1',
          displayName: 'Doctor Test',
          email: 'doctor@hospitalhangaroa.cl',
        },
      }),
      '2026-03-03'
    );

    expect(updatedToday.statusLabel).toBe('Nota vigente');
    expect(updatedToday.isActiveToday).toBe(true);

    const confirmedCurrent = resolveMedicalHandoffValidityViewModel(
      buildEntry({
        currentStatus: 'confirmed_current',
        currentStatusDate: '2026-03-03',
        currentStatusAt: '2026-03-03T11:00:00.000Z',
        currentStatusBy: {
          uid: 'admin-1',
          displayName: 'Admin Test',
          email: 'admin@hospitalhangaroa.cl',
        },
      }),
      '2026-03-03'
    );

    expect(confirmedCurrent.statusLabel).toBe('Nota vigente');
    expect(confirmedCurrent.isActiveToday).toBe(true);
    expect(confirmedCurrent.isMuted).toBe(false);
  });

  it('marks a carried entry as pending on the next day when it was not updated today', () => {
    const carriedEntry = resolveMedicalHandoffValidityViewModel(
      buildEntry({
        updatedAt: '2026-03-03T10:00:00.000Z',
        updatedBy: {
          uid: 'doctor-1',
          displayName: 'Doctor Test',
          email: 'doctor@hospitalhangaroa.cl',
        },
      }),
      '2026-03-04'
    );

    expect(carriedEntry.statusLabel).toBe('Nota: pendiente de actualizar');
    expect(carriedEntry.isActiveToday).toBe(false);
    expect(carriedEntry.isMuted).toBe(true);
  });

  it('prefers persisted observation entries and otherwise derives draft entries', () => {
    const persistedEntry = buildEntry();
    expect(
      resolveMedicalObservationEntries({
        patient: buildPatient({ medicalHandoffEntries: [persistedEntry] as never }),
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: false,
      })
    ).toEqual([persistedEntry]);

    expect(
      resolveMedicalObservationEntries({
        patient: buildPatient({ medicalHandoffNote: 'Nota legada' } as never),
        isFieldReadOnly: false,
        hasCreatePrimaryEntryAction: false,
      })
    ).toHaveLength(1);

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
});
