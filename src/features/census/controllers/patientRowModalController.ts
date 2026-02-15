import type { PatientData } from '@/types';

interface ResolvePatientRowDemographicsBindingParams {
    bedId: string;
    isSubRow: boolean;
    onSaveDemographics: (fields: Partial<PatientData>) => void;
    onSaveCribDemographics: (fields: Partial<PatientData>) => void;
}

export interface PatientRowDemographicsBinding {
    targetBedId: string;
    onSave: (fields: Partial<PatientData>) => void;
}

export const resolvePatientRowDemographicsBinding = ({
    bedId,
    isSubRow,
    onSaveDemographics,
    onSaveCribDemographics
}: ResolvePatientRowDemographicsBindingParams): PatientRowDemographicsBinding => ({
    targetBedId: isSubRow ? `${bedId}-cuna` : bedId,
    onSave: isSubRow ? onSaveCribDemographics : onSaveDemographics
});
