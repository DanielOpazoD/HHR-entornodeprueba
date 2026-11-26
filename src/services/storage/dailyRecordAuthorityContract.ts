/**
 * CONTRATO ÚNICO de autoridad clínico/estructural del registro diario.
 *
 * Cada bug de la semana del 31-08 (#282–#290) fue un desacuerdo entre capas
 * clasificando la misma ruta de forma distinta (lista del censo, splitter del
 * dispatch, clasificador de rutas, aplanador, functions, reglas). Este módulo
 * es la única fuente de verdad: el cliente lo importa directo y Cloud Functions
 * consume la compilación CJS generada por
 * `scripts/build-shared-functions-contracts.mjs` en
 * `functions/lib/generated/sharedDailyRecordContracts.cjs` (reexportada por
 * `functions/lib/dailyRecordAuthorityContract.js`).
 */

/**
 * Campos clínicos de cama editables en el censo (autoridad clínica): viajan
 * SIEMPRE por el canal clínico (callable) y nunca mezclados con estructura.
 */
export const CLINICAL_AUTHORITY_BED_FIELDS = Object.freeze([
  'pathology',
  'diagnosisComments',
  'diagnosisManualOverride',
  'diagnosisManualOverrideBase',
  'snomedCode',
  'cie10Code',
  'cie10Description',
  'specialty',
  'secondarySpecialty',
  'status',
  'ginecobstetriciaType',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
  'isUPC',
  'upcChecklist',
  'surgicalComplication',
] as const);

/**
 * Campos que el servidor acepta además de los clínicos del censo en el canal
 * clínico (poblados por flujos propios, no por la edición manual del censo).
 */
export const SERVER_ONLY_CLINICAL_PATCH_FIELDS = Object.freeze([
  'treatingPhysicianId',
  'treatingPhysicianName',
] as const);

/**
 * Campos que el lote clínico Rayen escribe. Los dispositivos son datos
 * operacionales que enfermería TAMBIÉN gestiona a mano entre corridas; las
 * mediciones y el checkpoint son exclusivos del lote (valla schema-v2).
 */
export const RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS = Object.freeze([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
] as const);

export const RAYEN_BATCH_ONLY_CLINICAL_FIELDS = Object.freeze([
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
  'clinicalCarryover',
  'clinicalAlerts',
  'fluidBalance',
] as const);

export const RAYEN_CLINICAL_FIELDS = Object.freeze([
  ...RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  ...RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
] as const);

const CLINICAL_AUTHORITY_BED_FIELD_SET = new Set<string>(CLINICAL_AUTHORITY_BED_FIELDS);

export const splitPatchPath = (path: string): string[] =>
  String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

/** Atomic clinical bed fields, including the two UPC fields of an attached crib. */
export const isClinicalAuthorityBedScalarPath = (path: string): boolean => {
  const parts = splitPatchPath(path);
  const [root, bedId, field, cribField] = parts;
  if (root !== 'beds' || !bedId || !field) return false;
  if (parts.length === 3) return CLINICAL_AUTHORITY_BED_FIELD_SET.has(field);
  return (
    parts.length === 4 &&
    field === 'clinicalCrib' &&
    (cribField === 'upcChecklist' || cribField === 'isUPC')
  );
};

/**
 * `bedTypeOverrides.<bedId>` — autoridad clínica: el servidor exige que viaje
 * en la MISMA escritura que un parche UPC de la cama (accompaniment).
 */
export const isBedTypeOverridePath = (path: string): boolean => {
  const parts = splitPatchPath(path);
  return parts.length === 2 && parts[0] === 'bedTypeOverrides' && Boolean(parts[1]);
};

/**
 * Sobre clínico completo del canal callable: escalares clínicos de cama +
 * bedTypeOverrides. Es la definición que comparten el split del dispatch, el
 * enrutamiento del cliente y la atomicidad del aplanador.
 */
export const isClinicalAuthorityCallablePatchPath = (path: string): boolean =>
  isClinicalAuthorityBedScalarPath(path) || isBedTypeOverridePath(path);
