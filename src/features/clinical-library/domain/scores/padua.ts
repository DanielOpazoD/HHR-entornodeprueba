import type { ScoreDefinition } from '../scoreEngine';

export const PADUA: ScoreDefinition = {
  id: 'padua',
  name: 'Padua (riesgo de tromboembolismo venoso)',
  shortName: 'Padua',
  purpose:
    'Riesgo de tromboembolismo venoso en pacientes médicos hospitalizados para decidir profilaxis.',
  items: [
    { id: 'cancer', kind: 'boolean', label: 'Cáncer activo', points: 3 },
    {
      id: 'vte',
      kind: 'boolean',
      label: 'Tromboembolismo venoso previo (excluye trombosis superficial)',
      points: 3,
    },
    {
      id: 'mobility',
      kind: 'boolean',
      label: 'Movilidad reducida (reposo en cama ≥ 3 días)',
      points: 3,
    },
    { id: 'thrombophilia', kind: 'boolean', label: 'Trombofilia conocida', points: 3 },
    { id: 'trauma', kind: 'boolean', label: 'Trauma o cirugía reciente (≤ 1 mes)', points: 2 },
    { id: 'age', kind: 'boolean', label: 'Edad ≥ 70 años', points: 1 },
    { id: 'failure', kind: 'boolean', label: 'Insuficiencia cardíaca o respiratoria', points: 1 },
    {
      id: 'ami-stroke',
      kind: 'boolean',
      label: 'Infarto agudo al miocardio o ACV isquémico',
      points: 1,
    },
    {
      id: 'infection',
      kind: 'boolean',
      label: 'Infección aguda o enfermedad reumatológica',
      points: 1,
    },
    { id: 'obesity', kind: 'boolean', label: 'Obesidad (IMC ≥ 30)', points: 1 },
    { id: 'hormonal', kind: 'boolean', label: 'Tratamiento hormonal en curso', points: 1 },
  ],
  bands: [
    {
      min: 0,
      max: 3,
      label: 'Bajo riesgo',
      tone: 'success',
      detail:
        'Riesgo bajo de TEV (≈ 0,3 % sin profilaxis): profilaxis farmacológica no indicada de rutina.',
    },
    {
      min: 4,
      max: 20,
      label: 'Alto riesgo',
      tone: 'danger',
      detail:
        'Riesgo alto de TEV (≈ 11 % sin profilaxis): indicar profilaxis farmacológica si no hay contraindicación, evaluando el riesgo de sangrado.',
    },
  ],
  reference: {
    citation:
      'Barbar S, et al. A risk assessment model for the identification of hospitalized medical patients at risk for venous thromboembolism: the Padua Prediction Score. J Thromb Haemost. 2010;8(11):2450-2457.',
    url: 'https://doi.org/10.1111/j.1538-7836.2010.04044.x',
  },
};
