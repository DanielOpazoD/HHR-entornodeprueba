import type { PatientData } from '@/types/domain/patient';

interface ResolvePatientRowDemographicsBindingParams {
  bedId: string;
  isSubRow: boolean;
  data: PatientData;
  onSaveDemographics: (fields: Partial<PatientData>) => void;
  onSaveCribDemographics: (fields: Partial<PatientData>) => void;
}

export interface PatientRowDemographicsBinding {
  targetBedId: string;
  isRnIdentityContext: boolean;
  onSave: (fields: Partial<PatientData>) => void;
}

export const resolvePatientRowDemographicsBinding = ({
  bedId,
  isSubRow,
  data,
  onSaveDemographics,
  onSaveCribDemographics,
}: ResolvePatientRowDemographicsBindingParams): PatientRowDemographicsBinding => ({
  targetBedId: isSubRow ? `${bedId}-cuna` : bedId,
  isRnIdentityContext: isSubRow || data.bedMode === 'Cuna',
  onSave: isSubRow ? onSaveCribDemographics : onSaveDemographics,
});
