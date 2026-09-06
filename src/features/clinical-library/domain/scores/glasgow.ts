import type { ScoreDefinition } from '../scoreEngine';

export const GLASGOW: ScoreDefinition = {
  id: 'glasgow',
  name: 'Escala de coma de Glasgow',
  shortName: 'Glasgow',
  purpose: 'Gradúa el nivel de conciencia por respuesta ocular, verbal y motora (3 a 15 puntos).',
  items: [
    {
      id: 'eye',
      kind: 'choice',
      label: 'Apertura ocular',
      options: [
        { value: 'spontaneous', label: 'Espontánea', points: 4 },
        { value: 'voice', label: 'A la voz', points: 3 },
        { value: 'pain', label: 'Al dolor', points: 2 },
        { value: 'none', label: 'Ninguna', points: 1 },
      ],
    },
    {
      id: 'verbal',
      kind: 'choice',
      label: 'Respuesta verbal',
      options: [
        { value: 'oriented', label: 'Orientado', points: 5 },
        { value: 'confused', label: 'Confuso', points: 4 },
        { value: 'words', label: 'Palabras inapropiadas', points: 3 },
        { value: 'sounds', label: 'Sonidos incomprensibles', points: 2 },
        { value: 'none', label: 'Ninguna', points: 1 },
      ],
    },
    {
      id: 'motor',
      kind: 'choice',
      label: 'Respuesta motora',
      options: [
        { value: 'obeys', label: 'Obedece órdenes', points: 6 },
        { value: 'localizes', label: 'Localiza el dolor', points: 5 },
        { value: 'withdraws', label: 'Retira al dolor', points: 4 },
        { value: 'flexion', label: 'Flexión anormal (decorticación)', points: 3 },
        { value: 'extension', label: 'Extensión anormal (descerebración)', points: 2 },
        { value: 'none', label: 'Ninguna', points: 1 },
      ],
    },
  ],
  bands: [
    {
      min: 13,
      max: 15,
      label: 'Leve',
      tone: 'success',
      detail: 'Compromiso de conciencia leve (TEC leve: 13 a 15).',
    },
    {
      min: 9,
      max: 12,
      label: 'Moderado',
      tone: 'warning',
      detail: 'Compromiso de conciencia moderado (TEC moderado: 9 a 12).',
    },
    {
      min: 3,
      max: 8,
      label: 'Grave',
      tone: 'danger',
      detail: 'Compromiso grave (≤ 8): considerar protección de la vía aérea y evaluación urgente.',
    },
  ],
  notes: [
    'Registrar cada componente por separado (p. ej. O3 V4 M5) y anotar si un componente no es evaluable.',
  ],
  reference: {
    citation:
      'Teasdale G, Jennett B. Assessment of coma and impaired consciousness: a practical scale. Lancet. 1974;2(7872):81-84.',
    url: 'https://doi.org/10.1016/S0140-6736(74)91639-0',
  },
};
