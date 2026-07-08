export const COMPARISON_DISPLAY_GROUPS = [
  {
    label: 'Hemograma',
    patterns: [
      'Recuento Leucocitos',
      'Hemoglobina',
      'Hematocrito',
      'VCM',
      'HCM',
      'Recuento de Plaquetas',
      'Segmentados',
      'Linfocitos',
      'Monocitos',
      'Eosinofilos',
    ],
  },
  {
    label: 'Inflamación',
    patterns: ['Proteina C Reactiva', 'VHS', 'V.H.S', 'V.H.S.', 'LDH'],
  },
  {
    label: 'Función renal / electrolitos',
    patterns: [
      'Creatinina',
      'Nitrogeno Ureico',
      'Uremia',
      'Sodio',
      'Potasio',
      'Cloro',
      'HCO3',
      'Calcio',
      'Fosforo',
      'RPC',
      'RAC',
    ],
  },
  {
    label: 'Coagulación',
    patterns: ['Protrombina', 'TTPK', 'INR', 'Dimero'],
  },
  {
    label: 'Perfil hepático',
    patterns: [
      'ASAT/GOT',
      'ALAT/GPT',
      'GGT',
      'Fosfatasa Alcalina',
      'Bilirrubinas',
      'Albumina',
      'Proteinas Totales',
    ],
  },
  {
    label: 'Metabólico',
    patterns: [
      'Hb glicosilada',
      'Acido Urico',
      'Glicemia',
      'TSH',
      'T4L',
      'T4 Libre',
      'Colesterol Total',
      'LDL',
      'HDL',
      'TG',
      'Trigliceridos',
    ],
  },
] as const;

export const COMPARISON_GROUP_ORDER = [
  'Hemograma',
  'Inflamación',
  'Función renal / electrolitos',
  'Coagulación',
  'Perfil hepático',
  'Metabólico',
  'Otros',
] as const;

export type ComparisonGroupLabel = (typeof COMPARISON_GROUP_ORDER)[number];
