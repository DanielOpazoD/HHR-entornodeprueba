import type { PatientRowAction } from './patientActionMenuConfig';

export type RowMenuAlign = 'top' | 'bottom';
export type MaybePromiseVoid = void | Promise<void>;

export interface PatientActionMenuCallbacks {
    onAction: (action: PatientRowAction) => void;
    onViewDemographics: () => void;
    onViewExamRequest?: () => void;
    onViewHistory?: () => void;
}

export interface PatientBedConfigCallbacks {
    onToggleMode: () => MaybePromiseVoid;
    onToggleCompanion: () => MaybePromiseVoid;
    onToggleClinicalCrib: () => void;
    onUpdateClinicalCrib: (action: 'remove') => void;
    onShowCribDemographics: () => void;
}
