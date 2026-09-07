import type { ScoreDefinition } from '../scoreEngine';

/** CAM-ICU: positivo si hay criterio 1 y criterio 2, más el 3 o el 4. No es una suma. */
export const CAM_ICU: ScoreDefinition = {
  id: 'cam-icu',
  name: 'CAM-ICU (delirium en UPC)',
  shortName: 'CAM-ICU',
  purpose: 'Detección de delirium en pacientes críticos evaluables (RASS ≥ −3).',
  hideTotal: true,
  items: [
    {
      id: 'acute',
      kind: 'boolean',
      label: 'Criterio 1: inicio agudo o curso fluctuante del estado mental',
      points: 1,
    },
    {
      id: 'inattention',
      kind: 'boolean',
      label: 'Criterio 2: inatención (más de 2 errores en la prueba de letras o figuras)',
      points: 1,
    },
    {
      id: 'consciousness',
      kind: 'boolean',
      label: 'Criterio 3: nivel de conciencia alterado (RASS distinto de 0)',
      points: 1,
    },
    {
      id: 'thinking',
      kind: 'boolean',
      label: 'Criterio 4: pensamiento desorganizado (más de 1 error en preguntas u órdenes)',
      points: 1,
    },
  ],
  bands: [
    {
      min: 0,
      max: 4,
      label: 'CAM-ICU negativo',
      tone: 'success',
      detail: 'Sin delirium en esta evaluación.',
    },
    {
      min: 0,
      max: 4,
      label: 'CAM-ICU positivo',
      tone: 'danger',
      detail:
        'Delirium: buscar causas reversibles, revisar fármacos y aplicar medidas no farmacológicas.',
    },
  ],
  resolveBand: answers => {
    const positive =
      answers.acute === true &&
      answers.inattention === true &&
      (answers.consciousness === true || answers.thinking === true);
    return positive
      ? {
          min: 0,
          max: 4,
          label: 'CAM-ICU positivo',
          tone: 'danger',
          detail:
            'Delirium: buscar causas reversibles, revisar fármacos y aplicar medidas no farmacológicas.',
        }
      : {
          min: 0,
          max: 4,
          label: 'CAM-ICU negativo',
          tone: 'success',
          detail: 'Sin delirium en esta evaluación.',
        };
  },
  notes: ['No evaluable con RASS −4 o −5: repetir cuando el paciente responda a la voz.'],
  reference: {
    citation:
      'Ely EW, et al. Delirium in mechanically ventilated patients: validity and reliability of the confusion assessment method for the intensive care unit (CAM-ICU). JAMA. 2001;286(21):2703-2710.',
    url: 'https://doi.org/10.1001/jama.286.21.2703',
  },
};
