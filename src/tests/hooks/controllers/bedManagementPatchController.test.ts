import { describe, expect, it } from 'vitest';
import { buildUpdatePatientPatches } from '@/hooks/controllers/bedManagementPatchController';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

describe('bedManagementPatchController', () => {
  it('persists a custom free-text specialty in the daily census bed patch', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-11');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      devices: ['VVP#1'],
      deviceDetails: {
        'VVP#1': {
          installationDate: '2026-05-11',
          removalDate: undefined,
          note: 'Vía permeable',
        },
      },
      pathology: 'Neumonía mixta',
      specialty: Specialty.MEDICINA,
      secondarySpecialty: Specialty.CIRUGIA,
    });

    const patch = buildUpdatePatientPatches(record, 'R1', {
      specialty: 'ORL' as never,
      secondarySpecialty: undefined,
    });

    expect(patch).toMatchObject({
      'beds.R1.specialty': 'ORL',
      'beds.R1.secondarySpecialty': undefined,
    });
    expect(patch).not.toHaveProperty('beds.R1.devices');
    expect(patch).not.toHaveProperty('beds.R1.deviceDetails');
    expect(patch).not.toHaveProperty('beds.R1.pathology');
  });

  it('clears stale episode ownership when replacing the patient identity in an occupied bed', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-14');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Antiguo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-14',
      firstSeenDate: '2026-05-13',
      clinicalEpisodeId: 'ep_old_patient',
      pathology: 'Diagnóstico previo',
      clinicalEvents: [{ id: 'event-old', text: 'Evento previo' } as never],
    });

    const patch = buildUpdatePatientPatches(record, 'R1', {
      patientName: 'Paciente Nuevo',
      rut: '22.222.222-2',
    });

    expect(patch).toMatchObject({
      'beds.R1.patientName': 'Paciente Nuevo',
      'beds.R1.rut': '22.222.222-2',
      'beds.R1.clinicalEpisodeId': undefined,
      'beds.R1.firstSeenDate': '2026-05-14',
      'beds.R1.pathology': '',
      'beds.R1.clinicalEvents': [],
    });
  });
});
