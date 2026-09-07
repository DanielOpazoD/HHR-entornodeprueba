import type { ScoreDefinition } from '../scoreEngine';

export const CURB65: ScoreDefinition = {
  id: 'curb65',
  name: 'CURB-65',
  shortName: 'CURB-65',
  purpose:
    'Gravedad de la neumonía adquirida en la comunidad al ingreso y orientación del lugar de manejo.',
  items: [
    { id: 'confusion', kind: 'boolean', label: 'Confusión de reciente inicio', points: 1 },
    {
      id: 'urea',
      kind: 'boolean',
      label: 'Urea > 7 mmol/L (BUN > 19 mg/dL)',
      points: 1,
      help: 'Equivale a urea plasmática > 42 mg/dL.',
    },
    { id: 'rr', kind: 'boolean', label: 'Frecuencia respiratoria ≥ 30/min', points: 1 },
    {
      id: 'bp',
      kind: 'boolean',
      label: 'Presión arterial sistólica < 90 o diastólica ≤ 60 mmHg',
      points: 1,
    },
    { id: 'age', kind: 'boolean', label: 'Edad ≥ 65 años', points: 1 },
  ],
  bands: [
    {
      min: 0,
      max: 1,
      label: 'Bajo riesgo',
      tone: 'success',
      detail: 'Mortalidad a 30 días cercana al 1,5 %: considerar manejo ambulatorio.',
    },
    {
      min: 2,
      max: 2,
      label: 'Riesgo intermedio',
      tone: 'warning',
      detail:
        'Mortalidad cercana al 9 %: considerar hospitalización o manejo ambulatorio supervisado.',
    },
    {
      min: 3,
      max: 5,
      label: 'Alto riesgo',
      tone: 'danger',
      detail: 'Mortalidad cercana al 22 %: hospitalizar; con 4 o 5 puntos evaluar ingreso a UCI.',
    },
  ],
  reference: {
    citation:
      'Lim WS, et al. Defining community acquired pneumonia severity on presentation to hospital: an international derivation and validation study. Thorax. 2003;58(5):377-382.',
    url: 'https://doi.org/10.1136/thorax.58.5.377',
  },
};
