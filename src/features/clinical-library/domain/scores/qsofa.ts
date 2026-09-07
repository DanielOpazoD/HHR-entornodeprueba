import type { ScoreDefinition } from '../scoreEngine';

export const QSOFA: ScoreDefinition = {
  id: 'qsofa',
  name: 'qSOFA (quick SOFA)',
  shortName: 'qSOFA',
  purpose:
    'Identifica fuera de la UCI a pacientes con sospecha de infección y mayor riesgo de mal pronóstico.',
  items: [
    { id: 'rr', kind: 'boolean', label: 'Frecuencia respiratoria ≥ 22/min', points: 1 },
    {
      id: 'mental',
      kind: 'boolean',
      label: 'Alteración del estado mental (Glasgow < 15)',
      points: 1,
    },
    { id: 'sbp', kind: 'boolean', label: 'Presión arterial sistólica ≤ 100 mmHg', points: 1 },
  ],
  bands: [
    {
      min: 0,
      max: 1,
      label: 'Bajo riesgo',
      tone: 'info',
      detail:
        'qSOFA < 2 no descarta sepsis: si la sospecha persiste, evaluar SOFA completo y lactato.',
    },
    {
      min: 2,
      max: 3,
      label: 'Alto riesgo',
      tone: 'danger',
      detail:
        'qSOFA ≥ 2 se asocia a mayor mortalidad y estadía prolongada en UCI: evaluar disfunción de órganos (SOFA) e iniciar manejo de sepsis.',
    },
  ],
  notes: [
    'La Surviving Sepsis Campaign 2021 desaconseja usar qSOFA como único tamizaje de sepsis frente a NEWS o SIRS.',
  ],
  reference: {
    citation:
      'Singer M, et al. The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3). JAMA. 2016;315(8):801-810.',
    url: 'https://doi.org/10.1001/jama.2016.0287',
  },
};
