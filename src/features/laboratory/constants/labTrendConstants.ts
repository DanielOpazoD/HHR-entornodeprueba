export const TREND_GROUPS: { label: string; patterns: string[] }[] = [
  {
    label: 'Electrolitos',
    patterns: ['Sodio', 'Potasio', 'Cloro'],
  },
  {
    label: 'Función Renal',
    patterns: ['Creatinina', 'Nitrogeno Ureico', 'Uremia'],
  },
  {
    label: 'Perfil Hepático',
    patterns: [
      'ASAT',
      'ALAT',
      'GGT',
      'Fosfatasa Alcalina',
      'Bilirrubina Total',
      'Bilirrubina Directa',
    ],
  },
  {
    label: 'Actividad Inflamatoria',
    patterns: ['Recuento Leucocitos', 'Segmentados', 'Proteina C Reactiva', 'VHS', 'LDH'],
  },
  {
    label: 'Hemograma',
    patterns: ['Hemoglobina', 'Hematocrito', 'Recuento de Plaquetas'],
  },
  {
    label: 'Glicemia',
    patterns: ['Glicemia', 'Hb glicosilada'],
  },
  {
    label: 'Gases',
    patterns: ['pH', 'pCO2', 'pO2', 'HCO3', 'Lactato'],
  },
  {
    label: 'Otros',
    patterns: ['Troponina', 'CK Total', 'Magnesio', 'Albumina'],
  },
  {
    label: 'RPC / RAC',
    patterns: ['RPC', 'RAC'],
  },
];
