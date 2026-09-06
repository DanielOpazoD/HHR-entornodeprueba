import type { ScoreDefinition } from '../scoreEngine';

export const CHA2DS2VASC: ScoreDefinition = {
  id: 'cha2ds2vasc',
  name: 'CHA₂DS₂-VASc',
  shortName: 'CHA₂DS₂-VASc',
  purpose:
    'Riesgo de accidente cerebrovascular en fibrilación auricular no valvular para decidir anticoagulación.',
  items: [
    {
      id: 'chf',
      kind: 'boolean',
      label: 'Insuficiencia cardíaca o disfunción ventricular izquierda',
      points: 1,
    },
    { id: 'htn', kind: 'boolean', label: 'Hipertensión arterial', points: 1 },
    {
      id: 'age',
      kind: 'choice',
      label: 'Edad',
      options: [
        { value: 'under65', label: 'Menor de 65 años', points: 0 },
        { value: '65to74', label: '65 a 74 años', points: 1 },
        { value: '75plus', label: '75 años o más', points: 2 },
      ],
    },
    { id: 'diabetes', kind: 'boolean', label: 'Diabetes mellitus', points: 1 },
    { id: 'stroke', kind: 'boolean', label: 'ACV, AIT o tromboembolismo previo', points: 2 },
    {
      id: 'vascular',
      kind: 'boolean',
      label: 'Enfermedad vascular (infarto previo, enfermedad arterial periférica o placa aórtica)',
      points: 1,
    },
    { id: 'female', kind: 'boolean', label: 'Sexo femenino', points: 1 },
  ],
  bandModifierItemId: 'female',
  bands: [
    {
      min: 0,
      max: 0,
      label: 'Riesgo bajo',
      tone: 'success',
      detail:
        'Sin factores de riesgo además del sexo (0 en hombres, 1 en mujeres): anticoagulación no recomendada.',
    },
    {
      min: 1,
      max: 1,
      label: 'Riesgo intermedio',
      tone: 'warning',
      detail:
        'Un factor de riesgo además del sexo (1 en hombres, 2 en mujeres): considerar anticoagulación oral según preferencias y riesgo de sangrado.',
    },
    {
      min: 2,
      max: 9,
      label: 'Riesgo alto',
      tone: 'danger',
      detail:
        'Dos o más factores además del sexo (≥ 2 en hombres, ≥ 3 en mujeres): anticoagulación oral recomendada salvo contraindicación.',
    },
  ],
  notes: [
    'El sexo femenino suma al total pero no define la banda: modifica el riesgo y no indica anticoagulación por sí solo.',
  ],
  reference: {
    citation:
      'Lip GY, et al. Refining clinical risk stratification for predicting stroke and thromboembolism in atrial fibrillation using a novel risk factor-based approach: the Euro Heart Survey on Atrial Fibrillation. Chest. 2010;137(2):263-272.',
    url: 'https://doi.org/10.1378/chest.09-1584',
  },
};
