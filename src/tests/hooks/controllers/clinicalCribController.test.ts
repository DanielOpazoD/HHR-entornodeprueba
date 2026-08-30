/* @flake-safe: Date.now is used only to derive a future date boundary for admission validation. */
import { describe, expect, it } from 'vitest';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { PatientData } from '@/types/domain/patient';
import {
  buildClinicalCribMultiplePatch,
  buildClinicalCribPatch,
  buildRemoveClinicalCribPatch,
  isClinicalCribFieldUpdateAllowed,
  resolveMotherLabel,
  sanitizeClinicalCribUpdates,
} from '@/hooks/controllers/clinicalCribController';

describe('clinicalCribController', () => {
  const mother = {
    bedId: 'R1',
    patientName: 'Madre Base',
    firstName: 'Ana',
    lastName: 'Perez',
    secondLastName: 'Diaz',
    rut: '1-9',
    age: '30',
    pathology: 'Dx',
    specialty: Specialty.GINECOBSTETRICIA,
    status: PatientStatus.ESTABLE,
    admissionDate: '2026-03-17',
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
  } as PatientData;

  it('resolves mother label from name parts and builds crib patch', () => {
    expect(resolveMotherLabel(mother)).toBe('Ana Perez Diaz');
    expect(buildClinicalCribPatch('R1', mother)).toEqual(
      expect.objectContaining({
        'beds.R1.clinicalCrib': expect.objectContaining({
          bedMode: 'Cuna',
          identityStatus: 'provisional',
          patientName: 'RN de Ana Perez Diaz',
          clinicalEpisodeId: expect.stringMatching(/^ep_/),
        }),
        'beds.R1.hasCompanionCrib': false,
      })
    );
  });

  it('builds remove patch and sanitizes future admission updates', () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect(buildRemoveClinicalCribPatch('R1')).toEqual({
      'beds.R1.clinicalCrib': null,
    });
    expect(isClinicalCribFieldUpdateAllowed('admissionDate', futureDate)).toBe(false);
    expect(sanitizeClinicalCribUpdates({ admissionDate: futureDate, age: '2' })).toEqual({
      age: '2',
    });
  });

  it('builds atomic multiple-field patch for the crib', () => {
    expect(buildClinicalCribMultiplePatch('R1', { patientName: 'RN', age: '1' })).toEqual({
      'beds.R1.clinicalCrib.patientName': 'RN',
      'beds.R1.clinicalCrib.age': '1',
    });
  });
});
