/**
 * Definiciones de scores clínicos de uso frecuente en hospitalizados.
 * Cada definición cita su fuente original; los puntos de corte son los publicados.
 */

import type { ScoreDefinition } from './scoreEngine';

const QSOFA: ScoreDefinition = {
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

const GLASGOW: ScoreDefinition = {
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

const CURB65: ScoreDefinition = {
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

const WELLS_PE: ScoreDefinition = {
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

const PADUA: ScoreDefinition = {
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

const CHA2DS2VASC: ScoreDefinition = {
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

export const SCORE_DEFINITIONS: ReadonlyArray<ScoreDefinition> = [
  QSOFA,
  GLASGOW,
  CURB65,
  WELLS_PE,
  PADUA,
  CHA2DS2VASC,
];

export const findScoreDefinition = (id: string): ScoreDefinition | undefined =>
  SCORE_DEFINITIONS.find(definition => definition.id === id);
