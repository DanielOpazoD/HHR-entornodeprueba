import type { CudyrScore } from '@/types/domain/cudyr';
export const CUDYR_REPORT_ITEM_LABELS: Record<keyof CudyrScore, string> = {
  changeClothes: 'Cambio de ropa',
  mobilization: 'Movilización',
  feeding: 'Alimentación',
  elimination: 'Eliminación',
  psychosocial: 'Apoyo psicosocial y emocional',
  surveillance: 'Vigilancia',
  vitalSigns: 'Medición de signos vitales',
  fluidBalance: 'Balance hídrico',
  oxygenTherapy: 'Oxigenoterapia',
  airway: 'Cuidados de vía aérea',
  proInterventions: 'Intervenciones profesionales',
  skinCare: 'Piel y curaciones',
  pharmacology: 'Tratamiento farmacológico',
  invasiveElements: 'Elementos invasivos',
};
