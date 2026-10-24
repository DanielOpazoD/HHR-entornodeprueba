/**
 * Owner contract for the patient-row subfeature.
 *
 * Keep patient-row consumers importing from this module so the row layer can
 * evolve independently from the broader census patient contract.
 */

import type {
  CesareanLabor as RootCesareanLabor,
  DeliveryRoute as RootDeliveryRoute,
  GinecobstetriciaType as RootGinecobstetriciaType,
} from '@/features/census/contracts/censusObstetricContracts';
import type { PatientData as RootPatientData } from '@/features/census/contracts/censusPatientContracts';

export type PatientRowPatientContract = RootPatientData;
export type PatientData = PatientRowPatientContract;
export type DeliveryRoute = RootDeliveryRoute;
export type CesareanLabor = RootCesareanLabor;
export type GinecobstetriciaType = RootGinecobstetriciaType;
export type PatientRowPatientPatch = Partial<PatientRowPatientContract>;
export type PatientRowPatientField = keyof PatientRowPatientContract;
export type PatientRowPatientDocumentType = PatientRowPatientContract['documentType'];
export type PatientRowDeliveryPatch = Pick<
  PatientRowPatientContract,
  'deliveryRoute' | 'deliveryDate' | 'deliveryCesareanLabor'
>;
export type PatientRowStateContract = Pick<
  PatientRowPatientContract,
  'bedMode' | 'hasCompanionCrib' | 'clinicalCrib' | 'isBlocked' | 'patientName' | 'identityReview'
>;
