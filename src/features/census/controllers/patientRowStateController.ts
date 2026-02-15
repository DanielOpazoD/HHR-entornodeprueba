import type { PatientData } from '@/types';

export interface PatientRowDerivedState {
    isCunaMode: boolean;
    hasCompanion: boolean;
    hasClinicalCrib: boolean;
    isBlocked: boolean;
    isEmpty: boolean;
}

export const derivePatientRowState = (
    data: PatientData | null | undefined
): PatientRowDerivedState => ({
    isCunaMode: data?.bedMode === 'Cuna',
    hasCompanion: data?.hasCompanionCrib || false,
    hasClinicalCrib: !!(data?.clinicalCrib && data.clinicalCrib.bedMode),
    isBlocked: data?.isBlocked || false,
    isEmpty: !data?.patientName
});
