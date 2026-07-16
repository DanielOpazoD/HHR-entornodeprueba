import type { ClinicalPanelCareDay } from './parseClinicalCarePlan';

export type ClinicalPanelEntryKind =
  | 'evolution'
  | 'shift-change'
  | 'pharma'
  | 'free-indication'
  | 'diet'
  | 'rest';

export type EvolutionProfession = 'medical' | 'nursing' | 'other';

export interface ClinicalPanelEntry {
  id: string;
  kind: ClinicalPanelEntryKind;
  title: string;
  text: string;
  author: string;
  role: string;
  profession?: EvolutionProfession;
  publishedAt: string;
  archived: boolean;
  suspended: boolean;
  finalized?: boolean;
  prescribedAt?: string;
  validitySource?: 'indication' | 'daily-validation';
  isNew: boolean;
  crossedOut: boolean;
}

export interface ClinicalPanelIndicationDay {
  day: string;
  label: string;
  active: ClinicalPanelEntry[];
  suspended: ClinicalPanelEntry[];
}

export interface ClinicalPanel {
  evolutions: ClinicalPanelEntry[];
  indicationDays: ClinicalPanelIndicationDay[];
  careDays: ClinicalPanelCareDay[];
}
