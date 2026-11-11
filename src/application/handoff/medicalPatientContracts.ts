import type { MedicalHandoffAudit, MedicalHandoffEntry, PatientData } from '@/types/domain/patient';

import type { Specialty } from '@/types/domain/patientClassification';

export interface MedicalPatientHandoffContract {
  bedId: string;
  isBlocked: boolean;
  bedMode: PatientData['bedMode'];
  hasCompanionCrib: boolean;
  specialty?: Specialty | string;
  secondarySpecialty?: Specialty | string;
  medicalHandoffEntries?: MedicalHandoffEntry[];
  medicalHandoffNote?: string;
  medicalHandoffAudit?: MedicalHandoffAudit;
}

export type MedicalPatientMutationFields = Pick<
  MedicalPatientHandoffContract,
  'medicalHandoffEntries' | 'medicalHandoffNote' | 'medicalHandoffAudit'
>;
