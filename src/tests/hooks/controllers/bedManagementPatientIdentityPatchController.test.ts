// @vitest-environment node
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildUpdatePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { describe, expect, it } from 'vitest';
import {
  hasDisplayablePatientName,
  shouldAnchorFirstSeenDate,
} from '@/hooks/controllers/bedManagementPatientIdentityPatchController';
import { editsPatientDocumentIdentity } from '@/utils/patientDocumentIdentity';

describe('bedManagementPatientIdentityPatchController', () => {
  it.each([
    ['12345678-5', '12.345.678-5', 'RUT', 'RUT', false],
    ['12.345.678-5', '22.222.222-2', 'RUT', 'RUT', true],
    ['55.667.788-4', '55.667.788-4', 'RUT', 'Pasaporte', true],
    ['55.667.788-4', 'US556677884', 'RUT', 'Pasaporte', true],
    ['12-34', '1234', 'Pasaporte', 'Pasaporte', true],
  ] as const)(
    'preserves clinical data and episode ownership when manually correcting identity (%s -> %s, %s -> %s)',
    (currentRut, nextRut, currentDocumentType, nextDocumentType, marksManualDocument) => {
      const record = DataFactory.createMockDailyRecord('2026-02-20');
      record.beds.R1 = DataFactory.createMockPatient('R1', {
        patientName: 'Original Name',
        rut: currentRut,
        documentType: currentDocumentType,
        clinicalEpisodeId: 'existing-episode',
        firstSeenDate: '2026-02-19',
        pathology: 'Existing diagnosis',
        cie10Code: 'J18.9',
        cie10Description: 'Neumonía',
      });
      const patch = buildUpdatePatientPatches(record, 'R1', {
        patientName: 'Corrected Name',
        rut: nextRut,
        documentType: nextDocumentType,
      });

      if (nextRut !== currentRut) {
        expect(patch['beds.R1.rut']).toBe(nextRut);
      }
      if (nextDocumentType !== currentDocumentType) {
        expect(patch['beds.R1.documentType']).toBe(nextDocumentType);
      }
      if (marksManualDocument) {
        expect(patch['beds.R1.documentManualOverride']).toBe(true);
      } else {
        expect(patch).not.toHaveProperty('beds.R1.documentManualOverride');
      }

      for (const field of [
        'pathology',
        'cie10Code',
        'cie10Description',
        'diagnosisManualOverride',
        'specialty',
        'specialtyAssignment',
        'clinicalEpisodeId',
        'firstSeenDate',
        'devices',
        'cudyr',
      ]) {
        expect(Object.keys(patch)).not.toContain('beds.R1.' + field);
      }
      expect(patch).not.toHaveProperty('bedTypeOverrides.R1');
    }
  );

  it('does not mark documentManualOverride for empty-bed admissions or unchanged resends', () => {
    expect(
      editsPatientDocumentIdentity(
        { patientName: '', rut: '', documentType: 'RUT' },
        { patientName: 'Paciente Nuevo', rut: '12.345.678-5', documentType: 'RUT' }
      )
    ).toBe(false);
    expect(
      editsPatientDocumentIdentity(
        { patientName: 'Paciente', rut: '12.345.678-5', documentType: undefined },
        { patientName: 'Paciente', rut: '12.345.678-5', documentType: 'RUT', age: '45' }
      )
    ).toBe(false);
    expect(
      editsPatientDocumentIdentity(
        { patientName: 'Paciente', rut: '12345678-5', documentType: 'RUT' },
        { rut: '12.345.678-5', documentType: 'RUT' }
      )
    ).toBe(false);
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
