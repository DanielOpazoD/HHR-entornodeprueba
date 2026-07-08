import type { LabMicrobiologyCategory } from '@/types/domain/labAnalyticsTypes';

export type MicrobiologyCategoryRule = {
  exam: string[];
  findingStrong: string[];
  findingWeak: string[];
};

export const MICROBIOLOGY_CATEGORY_RULES: Record<
  LabMicrobiologyCategory,
  MicrobiologyCategoryRule
> = {
  clostridium_difficile: {
    exam: ['CLOSTRIDIUM DIFFICILE'],
    findingStrong: ['CLOSTRIDIUM', 'TOXINA', 'PRESENCIA DEL AG'],
    findingWeak: [],
  },
  coprocultivo: {
    exam: ['COPROCULTIVO'],
    findingStrong: ['COPROCULTIVO', 'SALMONELLA', 'SHIGELLA'],
    findingWeak: ['LEUCOCITOS FECALES'],
  },
  pcr_8_virus: {
    exam: ['PCR PANEL', 'PANEL RESPIRATORIO', 'PANEL VIRAL', 'SARS', 'COVID', 'COV-2'],
    findingStrong: [
      'INFLUENZA',
      'PARAINFLUENZA',
      'METAPNEUMOVIRUS',
      'RHINOVIRUS',
      'RINOVIRUS',
      'SINCICIAL',
      'ADENOVIRUS',
      'SARS',
      'CORONAVIRUS',
      'COVID',
      'PANEL RESPIRATORIO',
    ],
    findingWeak: [],
  },
  pcr_arbovirus: {
    exam: ['PCR ARBOVIROSIS'],
    findingStrong: ['ARBOVIROSIS', 'DENGUE', 'CHIKUNGUNYA', 'ZIKA'],
    findingWeak: [],
  },
  urocultivo: {
    exam: ['UROCULTIVO'],
    findingStrong: ['UROCULTIVO', 'ANTIBIOGRAMA', 'RECUENTO DE COLONIA', 'GENTAMICINA'],
    findingWeak: [
      'DESARROLLO',
      'SUSCEPTIBLE',
      'SUCEPTIBLE',
      'SENSIBLE',
      'INTERMEDIO',
      'RESISTENTE',
      'AISLADO',
    ],
  },
  hemocultivo: {
    exam: ['HEMOCULTIVO'],
    findingStrong: ['HEMOCULTIVO'],
    findingWeak: [
      'DESARROLLO',
      'SUSCEPTIBLE',
      'SUCEPTIBLE',
      'SENSIBLE',
      'INTERMEDIO',
      'RESISTENTE',
      'AISLADO',
    ],
  },
  otros_cultivos: {
    exam: ['CULTIVO CORRIENTE', 'ANTIBIOGRAMA', 'ATB ', 'BACILOS'],
    findingStrong: [
      'CULTIVO',
      'ANTIBIOGRAMA',
      'ATB',
      'BACILO',
      'RECUENTO DE COLONIA',
      'GENTAMICINA',
    ],
    findingWeak: [
      'DESARROLLO',
      'SUSCEPTIBLE',
      'SUCEPTIBLE',
      'SENSIBLE',
      'INTERMEDIO',
      'RESISTENTE',
      'AISLADO',
    ],
  },
};
