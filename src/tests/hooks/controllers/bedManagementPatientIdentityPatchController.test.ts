// @vitest-environment node
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildUpdatePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { describe, expect, it } from 'vitest';
import {
  getClearClinicalDataPatches,
  isDifferentPatientIdentity,
  shouldResetClinicalEpisodeOwnership,
  hasDisplayablePatientName,
  shouldAnchorFirstSeenDate,
} from '@/hooks/controllers/bedManagementPatientIdentityPatchController';

describe('bedManagementPatientIdentityPatchController', () => {
  it.each([
    ['12345678-5', '12.345.678-5', 'RUT', false],
    ['12.345.678-5', '22.222.222-2', 'RUT', true],
    ['12-34', '1234', 'Pasaporte', true],
  ] as const)(
    'preserves the clinical-clear policy through the real patch builder (%s -> %s)',
    (currentRut, nextRut, documentType, replaced) => {
      const record = DataFactory.createMockDailyRecord('2026-02-20');
      record.beds.R1 = DataFactory.createMockPatient('R1', {
        patientName: 'Original Name',
        rut: currentRut,
        documentType,
        clinicalEpisodeId: 'existing-episode',
        pathology: 'Existing diagnosis',
      });
      const patch = buildUpdatePatientPatches(record, 'R1', {
        patientName: 'Corrected Name',
        rut: nextRut,
        documentType,
      });
      expect(patch['beds.R1.rut']).toBe(nextRut);
      if (replaced) {
        expect(patch['beds.R1.pathology']).toBe('');
        expect(Object.keys(patch)).toContain('beds.R1.clinicalEpisodeId');
      } else {
        for (const field of ['pathology', 'specialty', 'clinicalEpisodeId', 'devices', 'cudyr']) {
          expect(Object.keys(patch)).not.toContain('beds.R1.' + field);
        }
      }
    }
  );

  it.each([
    ['12345678-5', '12.345.678-5', false],
    ['12.345.678-5', '123456785', false],
    ['12345678-k', '12.345.678-K', false],
    ['12.345.678-5', '22.222.222-2', true],
    ['12.345.678-5', '', true],
    ['', '12.345.678-5', true],
    ['', '', true],
  ])(
    'compares RUT identity %s -> %s without treating formatting as replacement',
    (currentRut, nextRut, replaced) => {
      const input = {
        currentClinicalEpisodeId: 'existing-episode',
        currentPatientName: 'Original Name',
        nextPatientName: 'Corrected Name',
        currentRut,
        nextRut,
      };
      expect(isDifferentPatientIdentity(input)).toBe(replaced);
      expect(shouldResetClinicalEpisodeOwnership(input)).toBe(replaced);
    }
  );

  it.each([
    ['AB12CD', 'AB12EF'],
    ['12-34', '1234'],
  ])('does not collapse distinct passport identifiers %s and %s', (currentRut, nextRut) => {
    const input = {
      currentClinicalEpisodeId: 'passport-episode',
      currentPatientName: 'Same Name',
      nextPatientName: 'Same Name',
      currentRut,
      nextRut,
      currentDocumentType: 'Pasaporte' as const,
      nextDocumentType: 'Pasaporte' as const,
    };
    expect(isDifferentPatientIdentity(input)).toBe(true);
    expect(shouldResetClinicalEpisodeOwnership(input)).toBe(true);
  });

  it('builds the clinical reset patch used when patient identity changes', () => {
    expect(getClearClinicalDataPatches('R1')).toEqual({
      'beds.R1.specialty': '',
      'beds.R1.specialtyAssignment': undefined,
      'beds.R1.cie10Code': undefined,
      'beds.R1.cie10Description': undefined,
      'beds.R1.pathology': '',
      'beds.R1.treatingPhysicianId': undefined,
      'beds.R1.treatingPhysicianName': undefined,
      'beds.R1.dismissedTreatingPhysician': undefined,
      'beds.R1.clinicalEvents': [],
      'beds.R1.cudyr': undefined,
      'beds.R1.isUPC': false,
      'beds.R1.upcChecklist': undefined,
      'beds.R1.deviceDetails': {},
      'beds.R1.devices': [],
      'beds.R1.handoffNoteDayShift': '',
      'beds.R1.handoffNoteNightShift': '',
      'beds.R1.medicalHandoffNote': '',
      'beds.R1.medicalHandoffAudit': undefined,
      'beds.R1.medicalHandoffEntries': [],
      'beds.R1.ginecobstetriciaType': undefined,
      'beds.R1.deliveryRoute': undefined,
      'beds.R1.deliveryDate': undefined,
      'beds.R1.deliveryCesareanLabor': undefined,
      'bedTypeOverrides.R1': undefined,
    });
  });

  it('anchors firstSeenDate only when an empty identity becomes real', () => {
    expect(
      shouldAnchorFirstSeenDate({
        currentPatientName: '',
        currentRut: '',
        nextPatientName: 'Paciente Demo',
        nextRut: '',
        currentFirstSeenDate: '',
      })
    ).toBe(true);

    expect(
      shouldAnchorFirstSeenDate({
        currentPatientName: 'Paciente previo',
        currentRut: '',
        nextPatientName: 'Paciente Demo',
        nextRut: '',
        currentFirstSeenDate: '',
      })
    ).toBe(false);

    expect(
      shouldAnchorFirstSeenDate({
        currentPatientName: '',
        currentRut: '',
        nextPatientName: 'Paciente Demo',
        nextRut: '',
        currentFirstSeenDate: '2026-04-30',
      })
    ).toBe(true);
  });

  it('treats blank names as not displayable for CUDYR writes', () => {
    expect(hasDisplayablePatientName({ patientName: ' Paciente ' })).toBe(true);
    expect(hasDisplayablePatientName({ patientName: '   ' })).toBe(false);
    expect(hasDisplayablePatientName(null)).toBe(false);
  });
});
