export interface CudyrScore {
  changeClothes: number;
  mobilization: number;
  feeding: number;
  elimination: number;
  psychosocial: number;
  surveillance: number;
  vitalSigns: number;
  fluidBalance: number;
  oxygenTherapy: number;
  airway: number;
  proInterventions: number;
  skinCare: number;
  pharmacology: number;
  invasiveElements: number;
}

export type CudyrScorePatch = Partial<Record<keyof CudyrScore, number>>;

export interface CudyrBatchUpdate {
  beds?: Record<string, CudyrScorePatch>;
  clinicalCribs?: Record<string, CudyrScorePatch>;
}
