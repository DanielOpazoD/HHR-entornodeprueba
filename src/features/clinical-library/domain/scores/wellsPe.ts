import type { ScoreDefinition } from '../scoreEngine';

export const WELLS_PE: ScoreDefinition = {
  id: 'wells-pe',
  name: 'Wells para tromboembolismo pulmonar',
  shortName: 'Wells TEP',
  purpose: 'Probabilidad clínica pretest de tromboembolismo pulmonar.',
  items: [
    { id: 'dvt', kind: 'boolean', label: 'Signos y síntomas clínicos de TVP', points: 3 },
    {
      id: 'alternative',
      kind: 'boolean',
      label: 'TEP es el diagnóstico más probable que otras alternativas',
      points: 3,
    },
    { id: 'hr', kind: 'boolean', label: 'Frecuencia cardíaca > 100/min', points: 1.5 },
    {
      id: 'immobilization',
      kind: 'boolean',
      label: 'Inmovilización ≥ 3 días o cirugía en las últimas 4 semanas',
      points: 1.5,
    },
    { id: 'previous', kind: 'boolean', label: 'TVP o TEP previo', points: 1.5 },
    { id: 'hemoptysis', kind: 'boolean', label: 'Hemoptisis', points: 1 },
    {
      id: 'cancer',
      kind: 'boolean',
      label: 'Cáncer activo (en tratamiento, tratado en los últimos 6 meses o paliativo)',
      points: 1,
    },
  ],
  bands: [
    {
      min: 0,
      max: 1.5,
      label: 'Probabilidad baja',
      tone: 'success',
      detail:
        'Prevalencia de TEP cercana al 4 %: un dímero-D negativo permite descartar razonablemente.',
    },
    {
      min: 2,
      max: 6,
      label: 'Probabilidad intermedia',
      tone: 'warning',
      detail: 'Prevalencia cercana al 20 %: dímero-D y, si es positivo, angioTAC de tórax.',
    },
    {
      min: 6.5,
      max: 12.5,
      label: 'Probabilidad alta',
      tone: 'danger',
      detail: 'Prevalencia cercana al 67 %: imagen diagnóstica (angioTAC) sin esperar el dímero-D.',
    },
  ],
  notes: ['Versión dicotómica: ≤ 4 puntos TEP poco probable; > 4 puntos TEP probable.'],
  reference: {
    citation:
      'Wells PS, et al. Derivation of a simple clinical model to categorize patients probability of pulmonary embolism: increasing the models utility with the SimpliRED D-dimer. Thromb Haemost. 2000;83(3):416-420.',
    url: 'https://doi.org/10.1055/s-0037-1613830',
  },
};
