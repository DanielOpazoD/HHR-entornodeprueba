/**
 * CONTRATO ÚNICO de autoridad clínico/estructural del registro diario — lado
 * cliente.
 *
 * Cada bug de la semana del 31-08 (#282–#290) fue un desacuerdo entre capas
 * clasificando la misma ruta de forma distinta (lista del censo, splitter del
 * dispatch, clasificador de rutas, aplanador, functions, reglas). Este módulo
 * es la definición que consumen TODAS las capas del cliente.
 *
 * El servidor tiene su gemelo CJS en
 * `functions/lib/dailyRecordAuthorityContract.js` (las Cloud Functions se
 * despliegan solas con su carpeta y el bundler no procesa CJS de primera
 * parte fuera de src). El test
 * `dailyRecordAuthorityContractAlignment` compara AMBOS artefactos — listas y
 * matriz de predicados — y rompe CI ante cualquier divergencia: cambia uno,
 * cambia el otro.
 */

/**
 * Campos clínicos de cama editables en el censo (autoridad clínica): viajan
 * SIEMPRE por el canal clínico (callable) y nunca mezclados con estructura.
 */
export const CLINICAL_AUTHORITY_BED_FIELDS = [
  'pathology',
  'diagnosisComments',
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
] as const;

/**
 * Campos que el servidor acepta además de los clínicos del censo en el canal
 * clínico (poblados por flujos propios, no por la edición manual del censo).
 */
export const SERVER_ONLY_CLINICAL_PATCH_FIELDS = [
  'treatingPhysicianId',
  'treatingPhysicianName',
] as const;

/**
 * Campos que el lote clínico Rayen escribe. Los dispositivos son datos
 * operacionales que enfermería TAMBIÉN gestiona a mano entre corridas; las
 * mediciones y el checkpoint son exclusivos del lote (valla schema-v2).
 */
export const RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS = [
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
] as const;

export const RAYEN_BATCH_ONLY_CLINICAL_FIELDS = [
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
] as const;

export const RAYEN_CLINICAL_FIELDS = [
  ...RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  ...RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
] as const;

const CLINICAL_AUTHORITY_BED_FIELD_SET = new Set<string>(CLINICAL_AUTHORITY_BED_FIELDS);

const splitPatchPath = (path: string): string[] =>
  String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

/** `beds.<bedId>.<campo clínico>` — exactamente 3 segmentos, escalar de cama. */
export const isClinicalAuthorityBedScalarPath = (path: string): boolean => {
  const parts = splitPatchPath(path);
  return (
    parts.length === 3 &&
    parts[0] === 'beds' &&
    Boolean(parts[1]) &&
    CLINICAL_AUTHORITY_BED_FIELD_SET.has(parts[2])
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
