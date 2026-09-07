/**
 * Entradas de la hoja rápida de medicamentos críticos (adultos). Transcripción de la
 * hoja institucional; las concentraciones están ancladas por tests.
 */

import type { CriticalMedication, CriticalMedicationPreparation } from './criticalMedicationTypes';

const prep = (
  text: string,
  concentration?: string,
  label?: string
): CriticalMedicationPreparation => ({
  text,
  ...(concentration ? { concentration } : {}),
  ...(label ? { label } : {}),
});

export const CRITICAL_MEDICATIONS: ReadonlyArray<CriticalMedication> = [
  {
    id: 'noradrenalina',
    name: 'Noradrenalina',
    group: 'vasoactivo',
    presentations: [
      {
        text: '4 mg/4 mL',
        preparations: [
          prep('2 amp (8 mg) hasta 250 mL', '32 mcg/mL', 'VVP'),
          prep('4 amp (16 mg) hasta 100 mL', '160 mcg/mL', 'CVC alta'),
        ],
      },
    ],
    vvp: 'cond',
    cvc: 'si',
    bolus: 'no',
    dose: 'Inicio 0,02 a 0,05; habitual 0,02 a 1 mcg/kg/min. Titular a PAM y perfusión.',
  },
  {
    id: 'adrenalina',
    name: 'Adrenalina',
    group: 'vasoactivo',
    presentations: [
      {
        text: '1 mg/1 mL',
        preparations: [
          prep('4 amp (4 mg) hasta 250 mL', '16 mcg/mL', 'VVP'),
          prep('10 amp (10 mg) hasta 100 mL', '100 mcg/mL', 'CVC alta'),
        ],
      },
    ],
    vvp: 'cond',
    cvc: 'si',
    bolus: 'cond',
    bolusText: 'PCR: 1 mg IV/IO cada 3 a 5 min',
    dose: 'BIC 0,02 a 1 mcg/kg/min; titular según respuesta.',
  },
  {
    id: 'efedrina',
    name: 'Efedrina',
    group: 'vasoactivo',
    presentations: [
      { text: '60 mg/1 mL', preparations: [prep('1 amp (60 mg) + SF hasta 10 mL', '6 mg/mL')] },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'si',
    bolusText: '6 a 12 mg = 1 a 2 mL',
    dose: 'Repetir según respuesta; máximo acumulado habitual 50 a 60 mg.',
  },
  {
    id: 'fenilefrina',
    name: 'Fenilefrina',
    group: 'vasoactivo',
    presentations: [
      {
        text: '10 mg/1 mL',
        preparations: [
          prep('10 mg + SF hasta 20 mL', '500 mcg/mL'),
          prep('Tomar 1 mL + 9 mL SF', '50 mcg/mL', 'Bolo'),
        ],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'si',
    bolusText: '50 a 100 mcg = 1 a 2 mL',
    dose: 'Repetir o titular a PA; vigilar bradicardia refleja.',
  },
  {
    id: 'nitroglicerina',
    name: 'Nitroglicerina',
    group: 'vasoactivo',
    presentations: [
      {
        text: '50 mg/10 mL',
        preparations: [
          prep('1 amp (50 mg) hasta 250 mL', '200 mcg/mL', 'Baja (< 50 mcg/min)'),
          prep('3 amp (150 mg) hasta 250 mL', '600 mcg/mL', 'Alta (≥ 50 mcg/min)'),
        ],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'no',
    dose: '5 a 200 mcg/min; iniciar en 5 y titular. Alta: 1 mL/h = 10 mcg/min.',
  },
  {
    id: 'dobutamina',
    name: 'Dobutamina',
    group: 'vasoactivo',
    presentations: [
      {
        variant: 'amp10',
        text: '200 mg/10 mL',
        preparations: [
          prep('1 amp (200 mg/10 mL) hasta 250 mL', '800 mcg/mL', 'VVP'),
          prep('2 amp (400 mg/20 mL) hasta 100 mL', '4.000 mcg/mL', 'CVC alta'),
        ],
      },
      {
        variant: 'amp5',
        text: '200 mg/5 mL',
        preparations: [
          prep('1 amp (200 mg/5 mL) hasta 250 mL', '800 mcg/mL', 'VVP'),
          prep('2 amp (400 mg/10 mL) hasta 100 mL', '4.000 mcg/mL', 'CVC alta'),
        ],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'no',
    dose: '2 a 20 mcg/kg/min; excepcionalmente hasta 40.',
  },
  {
    id: 'dopamina',
    name: 'Dopamina',
    group: 'vasoactivo',
    presentations: [
      {
        variant: 'amp10',
        text: '250 mg/10 mL',
        preparations: [
          prep('1 amp (250 mg/10 mL) hasta 250 mL', '1.000 mcg/mL', 'VVP'),
          prep('2 amp (500 mg/20 mL) hasta 100 mL', '5.000 mcg/mL', 'CVC alta local'),
        ],
      },
      {
        variant: 'amp5',
        text: '250 mg/5 mL',
        preparations: [
          prep('1 amp (250 mg/5 mL) hasta 250 mL', '1.000 mcg/mL', 'VVP'),
          prep('2 amp (500 mg/10 mL) hasta 100 mL', '5.000 mcg/mL', 'CVC alta local'),
        ],
      },
    ],
    vvp: 'cond',
    cvc: 'si',
    bolus: 'no',
    dose: 'Inicio 2 a 5; habitual 2 a 20; máximo 50 mcg/kg/min. Sin protección renal.',
  },
  {
    id: 'dexmedetomidina',
    name: 'Dexmedetomidina',
    group: 'sedoanalgesia',
    presentations: [
      {
        text: '200 mcg/2 mL',
        preparations: [prep('5 amp (1.000 mcg/10 mL) + SF hasta 250 mL', '4 mcg/mL')],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'no',
    dose: '0,2 a 0,7 mcg/kg/h; hasta 1,4 según protocolo. Evitar carga en inestable.',
  },
  {
    id: 'propofol',
    name: 'Propofol 1 %',
    group: 'sedoanalgesia',
    presentations: [
      {
        text: '10 mg/mL',
        preparations: [prep('Sin diluir. Administrar por bomba y línea exclusiva.', '10 mg/mL')],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'cond',
    bolusText: 'Inducción 0,5 a 1,5 mg/kg en inestable',
    dose: '0,3 a 3 mg/kg/h; evitar más de 4 mg/kg/h.',
  },
  {
    id: 'midazolam',
    name: 'Midazolam',
    group: 'sedoanalgesia',
    presentations: [
      {
        text: '50 mg/10 mL',
        preparations: [prep('2 amp (100 mg/20 mL) + SF hasta 100 mL', '1 mg/mL')],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'si',
    bolusText: '1 a 2 mg lento o 0,01 a 0,05 mg/kg',
    dose: 'BIC 0,02 a 0,1 mg/kg/h; titular a objetivo de sedación.',
  },
  {
    id: 'fentanilo',
    name: 'Fentanilo',
    group: 'sedoanalgesia',
    presentations: [
      {
        text: '500 mcg/10 mL',
        preparations: [prep('10 amp = 5.000 mcg/100 mL; sin diluir', '50 mcg/mL')],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'si',
    bolusText: '25 a 100 mcg lento',
    dose: '25 a 200 mcg/h; titular a analgesia y ventilación.',
  },
  {
    id: 'ketamina',
    name: 'Ketamina',
    group: 'sedoanalgesia',
    presentations: [
      {
        text: '500 mg/10 mL',
        preparations: [
          prep('1 amp + SF hasta 100 mL', '5 mg/mL'),
          prep('2 amp + SF hasta 100 mL', '10 mg/mL'),
        ],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'si',
    bolusText: '0,5 a 1 mg/kg; inducción 1 a 2 mg/kg',
    dose: 'Analgesia 0,05 a 0,5 mg/kg/h; sedación 0,5 a 2 mg/kg/h.',
  },
  {
    id: 'rocuronio',
    name: 'Rocuronio',
    group: 'sedoanalgesia',
    presentations: [
      {
        text: '50 mg/5 mL',
        preparations: [
          prep('Sin diluir', '10 mg/mL', 'Bolo'),
          prep('10 amp (500 mg/50 mL) + SF hasta 100 mL', '5 mg/mL', 'BIC'),
        ],
      },
    ],
    vvp: 'si',
    vvpNote: 'Bolo sí; BIC condicionada',
    cvc: 'si',
    bolus: 'si',
    bolusText: '0,6 mg/kg; secuencia rápida 1 a 1,2 mg/kg',
    dose: 'BIC 4 a 16 mcg/kg/min; titular a TOF.',
  },
  {
    id: 'nacl3',
    name: 'NaCl 3 %',
    group: 'electrolitos',
    presentations: [
      {
        text: 'NaCl 10 % + agua estéril',
        preparations: [prep('150 mL NaCl 10 % + 350 mL agua = 500 mL', 'Na 513 mEq/L')],
      },
    ],
    vvp: 'cond',
    cvc: 'si',
    bolus: 'si',
    bolusText: '100 a 150 mL en 10 a 20 min; nunca en push',
    dose: 'Repetir según clínica y natremia; meta inicial +4 a 6 mEq/L con control seriado.',
  },
  {
    id: 'bicarbonato-2-3m',
    name: 'Bicarbonato 2/3 M',
    group: 'electrolitos',
    presentations: [
      {
        text: '5,6 %; bolsa 250 mL',
        preparations: [prep('Solución lista para usar', '0,667 mEq/mL (667 mEq/L)')],
      },
    ],
    vvp: 'no',
    cvc: 'si',
    bolus: 'no',
    dose: 'Individualizar por indicación, déficit y gases; reevaluar.',
  },
  {
    id: 'bicarbonato-1m',
    name: 'Bicarbonato 1 M',
    group: 'electrolitos',
    presentations: [
      {
        text: '8,4 %; 10 mL = 10 mEq',
        preparations: [
          prep('Sin diluir; para infusión o repetición, diluir o usar CVC', '1 mEq/mL'),
        ],
      },
    ],
    vvp: 'cond',
    cvc: 'si',
    bolus: 'cond',
    bolusText: 'Dosis pequeñas, lentas y fraccionadas',
    dose: 'Según indicación y gasometría; administrar por fracciones y reevaluar.',
  },
  {
    id: 'bicarbonato-1-6m',
    name: 'Bicarbonato 1/6 M',
    group: 'electrolitos',
    presentations: [
      {
        text: '1,4 %; bolsa',
        preparations: [prep('Solución lista para usar', '0,167 mEq/mL (167 mEq/L)')],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'no',
    dose: 'Corrección controlada según déficit y gasometría.',
  },
  {
    id: 'kcl',
    name: 'KCl',
    group: 'electrolitos',
    presentations: [
      {
        text: 'KCl 10 %: 1 g/10 mL = 13,4 mEq',
        preparations: [prep('3 amp (3 g/30 mL) + SF hasta 100 mL', '40,2 mEq/100 mL')],
      },
    ],
    vvp: 'no',
    cvc: 'si',
    bolus: 'no',
    dose: 'En 4 h = 10 mEq/h; en 2 h = 20 mEq/h sólo con ECG continuo.',
  },
  {
    id: 'amiodarona',
    name: 'Amiodarona',
    group: 'otros',
    presentations: [
      {
        text: '150 mg/3 mL',
        preparations: [
          prep('1 amp hasta 100 mL SG5 % en ≥ 10 min', undefined, 'Carga'),
          prep('4 amp (600 mg) hasta 250 mL SG5 %; con filtro', '2,4 mg/mL', 'BIC'),
        ],
      },
    ],
    vvp: 'cond',
    vvpNote: 'Carga sí; BIC no',
    cvc: 'si',
    bolus: 'cond',
    bolusText: 'PCR FV/TV sin pulso: 300 mg, luego 150 mg',
    dose: 'TV con pulso: 150 mg en 10 min → 1 mg/min por 6 h → 0,5 mg/min por 18 h.',
  },
  {
    id: 'insulina',
    name: 'Insulina regular',
    group: 'otros',
    presentations: [
      {
        text: 'U-100: 100 UI/mL',
        preparations: [
          prep('1 mL (100 UI) + SF hasta 100 mL; mezclar y cebar la línea', '1 UI/mL'),
        ],
      },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'cond',
    bolusText: 'Hiperkalemia: 10 UI IV + 25 g glucosa; CAD: no de rutina',
    dose: 'CAD 0,1 UI/kg/h; EHH 0,05 UI/kg/h. Verificar K y aplicar protocolo.',
  },
  {
    id: 'heparina',
    name: 'Heparina no fraccionada',
    group: 'otros',
    presentations: [
      { text: '25.000 UI/5 mL', preparations: [prep('25.000 UI + SF hasta 250 mL', '100 UI/mL')] },
    ],
    vvp: 'si',
    cvc: 'si',
    bolus: 'cond',
    bolusText: 'TEV: 80 UI/kg según nomograma',
    dose: 'TEV: 18 UI/kg/h; ajustar por aPTT o anti-Xa y protocolo.',
  },
];
