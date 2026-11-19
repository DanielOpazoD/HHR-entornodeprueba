export const EXAM_FILTER_CATEGORIES: { label: string; patterns: string[] }[] = [
  { label: 'Hemograma', patterns: ['HEMOGRAMA'] },
  {
    label: 'Bioquímica',
    patterns: ['BIOQUIMIC', 'PERFIL BIOQUIM', 'ALBUMINA', 'PROTEINA', 'GLICEMIA'],
  },
  { label: 'Electrolitos', patterns: ['ELECTROLITOS'] },
  { label: 'P. hepático', patterns: ['PERFIL HEPAT', 'HEPAT'] },
  { label: 'P. lipídico', patterns: ['LIPID', 'COLESTEROL'] },
  { label: 'Coagulación', patterns: ['PROTROMBINA', 'TTPK', 'INR', 'COAGUL'] },
  { label: 'Función Renal', patterns: ['CREA', 'UREMIA', 'VFG', 'BUN'] },
  {
    label: 'Cultivos',
    patterns: [
      'CULTIVO',
      'COPROCULTIVO',
      'UROCULTIVO',
      'HEMOCULTIVO',
      'ANTIBIOGRAMA',
      'MICROBIOLOG',
    ],
  },
  {
    label: 'PCR Virales',
    patterns: ['PCR PANEL', 'PANEL RESPIRATORIO', 'PANEL VIRAL', 'ARBOVIROSIS'],
  },
  { label: 'Orina', patterns: ['ORINA', 'SEDIMENTO'] },
];
