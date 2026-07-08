import { describe, expect, it } from 'vitest';
import {
  getClearClinicalDataPatches,
  hasDisplayablePatientName,
  shouldAnchorFirstSeenDate,
} from '@/hooks/controllers/bedManagementPatientIdentityPatchController';

describe('bedManagementPatientIdentityPatchController', () => {
  it('builds the clinical reset patch used when patient identity changes', () => {
    expect(getClearClinicalDataPatches('R1')).toEqual({
      'beds.R1.cie10Code': undefined,
      'beds.R1.cie10Description': undefined,
      'beds.R1.pathology': '',
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
