import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';
import type { VerticalPlacement } from '@/shared/ui/anchoredOverlayTypes';

export type RowMenuAlign = VerticalPlacement;
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
}
