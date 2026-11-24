// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('builds remove patch and sanitizes future admission updates on the hospital clock', () => {
    vi.useFakeTimers();
    // Santiago 00:30 on Sept 10 is still Sept 9 22:30 in Rapa Nui.
    vi.setSystemTime(new Date('2026-09-10T03:30:00.000Z'));

    expect(buildRemoveClinicalCribPatch('R1')).toEqual({
      'beds.R1.clinicalCrib': null,
    });

    const previousTz = process.env.TZ;
    try {
      for (const zone of ['Pacific/Easter', 'America/Santiago', 'UTC', 'Europe/Madrid']) {
        process.env.TZ = zone;
        expect(isClinicalCribFieldUpdateAllowed('admissionDate', '2026-09-10'), zone).toBe(false);
        expect(isClinicalCribFieldUpdateAllowed('admissionDate', '2026-09-09'), zone).toBe(true);
        expect(
          sanitizeClinicalCribUpdates({ admissionDate: '2026-09-10', age: '2' }),
          zone
        ).toEqual({
          age: '2',
        });
        expect(
          sanitizeClinicalCribUpdates({ admissionDate: '2026-09-09', age: '2' }),
          zone
        ).toEqual({
          admissionDate: '2026-09-09',
          age: '2',
        });
      }
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it('builds atomic multiple-field patch for the crib', () => {
    expect(buildClinicalCribMultiplePatch('R1', { patientName: 'RN', age: '1' })).toEqual({
      'beds.R1.clinicalCrib.patientName': 'RN',
      'beds.R1.clinicalCrib.age': '1',
    });
  });
});
