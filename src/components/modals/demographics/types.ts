import type { PatientData } from '@/types/domain/patient';
import { PatientIdentityStatus } from '@/types/domain/patientIdentity';

export type BiologicalSex = 'Masculino' | 'Femenino' | 'Indeterminado';
export type Insurance = 'Fonasa' | 'Isapre' | 'Particular';
export type AdmissionOrigin = 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
export type Origin = 'Residente' | 'Turista Nacional' | 'Turista Extranjero';
export type DocumentType = 'RUT' | 'Pasaporte';

export type DemographicSubset = Pick<
  PatientData,
  | 'patientName'
  | 'firstName'
  | 'lastName'
  | 'secondLastName'
  | 'identityStatus'
  | 'rut'
  | 'documentType'
  | 'age'
  | 'birthDate'
  | 'pathology'
  | 'insurance'
  | 'admissionOrigin'
  | 'admissionOriginDetails'
  | 'origin'
  | 'isRapanui'
  | 'biologicalSex'
  | 'admissionDate'
  | 'admissionTime'
>;

export interface DemographicsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel?: () => void;
  onEmptySave?: () => void;
  data: DemographicSubset;
  onSave: (updatedFields: Partial<PatientData>) => void;
  bedId: string;
  recordDate: string;
  isClinicalCribPatient?: boolean;
  requiresCompleteDemographics?: boolean;
  canUseArbitraryAdmissionDate?: boolean;
  onImportEloisaCode?: () => void;
}

export interface LocalDemographicsState {
  firstName: string;
  lastName: string;
  secondLastName: string;
  provisionalName: string;
  identityStatus: PatientIdentityStatus;
  rut: string;
  documentType: DocumentType;
  birthDate: string;
  insurance: Insurance;
  admissionOrigin: AdmissionOrigin | '';
  admissionOriginDetails: string;
  origin: Origin;
  isRapanui: boolean;
  biologicalSex: BiologicalSex;
  admissionDate: string;
  admissionTime: string;
  pathology: string;
}
