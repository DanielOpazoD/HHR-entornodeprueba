import type { PatientData } from '@/types/domain/patient';

/**
 * Owner contract for the patient-row subfeature.
 *
 * Derived row shapes use the patient domain type from its canonical home.
 */

export type PatientRowPatientPatch = Partial<PatientData>;
export type PatientRowPatientField = keyof PatientData;
export type PatientRowPatientDocumentType = PatientData['documentType'];
export type PatientRowDeliveryPatch = Pick<
  PatientData,
  'deliveryRoute' | 'deliveryDate' | 'deliveryCesareanLabor'
>;
export type PatientRowStateContract = Pick<
  PatientData,
  'bedMode' | 'hasCompanionCrib' | 'clinicalCrib' | 'isBlocked' | 'patientName'
>;
