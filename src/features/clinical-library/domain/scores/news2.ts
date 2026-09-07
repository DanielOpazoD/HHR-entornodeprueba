import type { ScoreDefinition } from '../scoreEngine';

export const NEWS2: ScoreDefinition = {
  id: 'news2',
  name: 'NEWS2 (National Early Warning Score 2)',
  shortName: 'NEWS2',
  purpose:
    'Detección temprana de deterioro clínico en adultos hospitalizados a partir de signos vitales.',
  items: [
    {
      id: 'rr',
      kind: 'choice',
      label: 'Frecuencia respiratoria (rpm)',
      options: [
        { value: 'le8', label: '≤ 8', points: 3 },
        { value: '9to11', label: '9 a 11', points: 1 },
        { value: '12to20', label: '12 a 20', points: 0 },
        { value: '21to24', label: '21 a 24', points: 2 },
        { value: 'ge25', label: '≥ 25', points: 3 },
      ],
    },
    {
      id: 'spo2',
      kind: 'choice',
      label: 'Saturación de O₂ (escala 1)',
      help: 'En insuficiencia respiratoria hipercápnica con meta 88 a 92 % corresponde la escala 2, no incluida.',
      options: [
        { value: 'le91', label: '≤ 91 %', points: 3 },
        { value: '92to93', label: '92 a 93 %', points: 2 },
        { value: '94to95', label: '94 a 95 %', points: 1 },
        { value: 'ge96', label: '≥ 96 %', points: 0 },
      ],
    },
    {
      id: 'oxygen',
      kind: 'choice',
      label: 'Aporte de oxígeno',
      options: [
        { value: 'air', label: 'Aire ambiental', points: 0 },
        { value: 'supplemental', label: 'Oxígeno suplementario', points: 2 },
      ],
    },
    {
      id: 'sbp',
      kind: 'choice',
      label: 'Presión arterial sistólica (mmHg)',
      options: [
        { value: 'le90', label: '≤ 90', points: 3 },
        { value: '91to100', label: '91 a 100', points: 2 },
        { value: '101to110', label: '101 a 110', points: 1 },
        { value: '111to219', label: '111 a 219', points: 0 },
        { value: 'ge220', label: '≥ 220', points: 3 },
      ],
    },
    {
      id: 'hr',
      kind: 'choice',
      label: 'Frecuencia cardíaca (lpm)',
      options: [
        { value: 'le40', label: '≤ 40', points: 3 },
        { value: '41to50', label: '41 a 50', points: 1 },
        { value: '51to90', label: '51 a 90', points: 0 },
        { value: '91to110', label: '91 a 110', points: 1 },
        { value: '111to130', label: '111 a 130', points: 2 },
        { value: 'ge131', label: '≥ 131', points: 3 },
      ],
    },
    {
      id: 'consciousness',
      kind: 'choice',
      label: 'Conciencia',
      options: [
        { value: 'alert', label: 'Alerta', points: 0 },
        {
          value: 'cvpu',
          label: 'Confusión nueva, responde a voz o dolor, o no responde',
          points: 3,
        },
      ],
    },
    {
      id: 'temperature',
      kind: 'choice',
      label: 'Temperatura (°C)',
      options: [
        { value: 'le35', label: '≤ 35,0', points: 3 },
        { value: '35.1to36', label: '35,1 a 36,0', points: 1 },
        { value: '36.1to38', label: '36,1 a 38,0', points: 0 },
        { value: '38.1to39', label: '38,1 a 39,0', points: 1 },
        { value: 'ge39.1', label: '≥ 39,1', points: 2 },
      ],
    },
  ],
  bands: [
    {
      min: 0,
      max: 4,
      label: 'Riesgo bajo',
      tone: 'success',
      detail:
        'Control según rutina de la unidad; con 1 a 4 puntos, la enfermera decide la frecuencia de control.',
    },
    {
      min: 5,
      max: 6,
      label: 'Riesgo medio',
      tone: 'warning',
      detail: 'Respuesta urgente: evaluación médica inmediata y controles al menos cada hora.',
    },
    {
      min: 7,
      max: 20,
      label: 'Riesgo alto',
      tone: 'danger',
      detail:
        'Respuesta de emergencia: equipo con competencias en paciente crítico y evaluar traslado a UPC.',
    },
  ],
  singleItemAlert: {
    minPoints: 3,
    belowTotal: 5,
    band: {
      min: 1,
      max: 4,
      label: 'Riesgo bajo-medio',
      tone: 'warning',
      detail:
        'Un parámetro en 3 puntos: revisión urgente por médico o enfermera con competencias en paciente agudo.',
    },
  },
  notes: ['Registrar la escala de SpO₂ usada y el aporte de oxígeno junto al puntaje.'],
  reference: {
    citation:
      'Royal College of Physicians. National Early Warning Score (NEWS) 2: standardising the assessment of acute-illness severity in the NHS. Londres: RCP; 2017.',
    url: 'https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/',
  },
};
