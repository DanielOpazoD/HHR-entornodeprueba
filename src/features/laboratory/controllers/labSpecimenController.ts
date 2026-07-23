import type { LabResultRow } from '@/types/domain/labExamTypes';

export type LabSpecimen = 'blood' | 'urine' | 'other-fluid' | 'unknown';

const normalizeClinicalToken = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[°º]/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();

const URINE_MARKERS = [
  'ORINA',
  'URINARIO',
  'URINARIA',
  'SEDIMENTO',
  'ALBUMINURIA',
  'MICROALBUMINURIA',
  'CREATININURIA',
  'CREATINURIA',
  'PROTEINURIA',
];

const OTHER_FLUID_MARKERS = [
  'LIQUIDO',
  'LIQUIDO CEFALORRAQUIDEO',
  'LCR',
  'LIQUIDO PLEURAL',
  'LIQUIDO ASCITICO',
  'LIQUIDO ARTICULAR',
  'LIQUIDO PERITONEAL',
];

const BLOOD_MARKERS = [
  'SANGRE',
  'SUERO',
  'PLASMA',
  'HEMOGRAMA',
  'PERFIL HEPATICO',
  'BIOQUIMICA',
  'FORMULA LEUCOCITARIA',
];

const containsAny = (value: string, markers: string[]): boolean =>
  markers.some(marker => value.includes(marker));

/** Identifies the specimen from the PDF section, analyte and unit without guessing from its value. */
export const classifyLabSpecimen = (finding: LabResultRow): LabSpecimen => {
  const signature = normalizeClinicalToken(
    `${finding.section || ''} ${finding.analysis || ''} ${finding.unit || ''}`
  );

  if (containsAny(signature, URINE_MARKERS)) return 'urine';
  if (containsAny(signature, OTHER_FLUID_MARKERS)) return 'other-fluid';
  if (containsAny(signature, BLOOD_MARKERS)) return 'blood';
  return 'unknown';
};

const isRatio = (analysis: string): boolean => analysis === 'RPC' || analysis === 'RAC';

const isUrineMetadataOrAnalyte = (finding: LabResultRow): boolean => {
  const analysis = normalizeClinicalToken(finding.analysis);
  const result = normalizeClinicalToken(finding.result);
  const urineAnalytes = [
    'ORINA FISICO QUIMICO',
    'SEDIMENTO URINARIO',
    'CUERPOS CETON',
    'NITRIT',
    'SANGRE',
    'UROBILIN',
    'GLUCOSA',
    'BILIRRUBINA',
    'DENSIDAD',
    'ASPECTO',
    'COLOR',
    'PROTEINURIA',
    'CREATININURIA',
    'MICROALBUMINURIA',
    'BACTERIAS',
    'CILINDROS',
    'PLACAS DE PUS',
    'ERITROCITOS',
  ];
  const isQualitativeLeukocyte =
    analysis.includes('LEUCOCITOS') &&
    /NEGATIVO|NO SE OBSERVA|ESCASA|MODERADA|ABUNDANTE|X CAMPO/.test(result);
  const isMetadata =
    analysis.includes('MIDAS') ||
    result.includes('MIDAS') ||
    analysis.includes('FECHA Y HORA INGRESO SOLICITUD') ||
    analysis.includes('FECHA Y HORA VALIDACION') ||
    analysis.includes('DIRECTOR TECNICO') ||
    analysis.includes('RESULTADO VIA WEB');

  return (
    urineAnalytes.some(token => analysis.includes(token)) ||
    analysis === 'PROTEINAS' ||
    isQualitativeLeukocyte ||
    isMetadata
  );
};

/** Comparison keeps systemic results and the two clinically useful urine ratios only. */
export const isLabComparisonEligible = (finding: LabResultRow): boolean => {
  if (isRatio(finding.analysis)) return true;
  const specimen = classifyLabSpecimen(finding);
  if (specimen === 'urine' || specimen === 'other-fluid') return false;
  return !isUrineMetadataOrAnalyte(finding);
};

/** Systemic trends never combine blood results with urine or another body fluid. */
export const isLabTrendSpecimenEligible = (finding: LabResultRow): boolean => {
  if (isRatio(finding.analysis)) return true;
  const specimen = classifyLabSpecimen(finding);
  return specimen !== 'urine' && specimen !== 'other-fluid';
};
