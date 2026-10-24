import type { PatientData } from '@/types/domain/patient';
import { DataFactory } from './DataFactory';

/** A server-split episode keeps its latest reading, with both moved fields absent. */
export const splitEpisode = (overrides: Partial<PatientData> = {}): PatientData => {
  const patient = DataFactory.createMockPatient('R1', {
    patientName: 'Paciente Sintético',
    rut: '00000000-0',
    age: '40',
    clinicalEpisodeId: 'ep_synthetic',
    ...overrides,
  });
  delete patient.vitalSignsHistory;
  delete patient.clinicalSyncCheckpoint;
  return patient;
};
