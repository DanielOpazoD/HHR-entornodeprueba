/**
 * CONTRATO ÚNICO de autoridad clínico/estructural del registro diario.
 *
 * Toda la semana del 31-08 fue una cadena de desacuerdos entre copias
 * implícitas de este contrato repartidas en siete capas (lista del cliente,
 * splitter del dispatch, clasificador de rutas, aplanador, lectura advisory,
 * functions y reglas): #282–#290 fueron, cada uno, dos capas clasificando la
 * misma ruta de forma distinta. Este módulo es la única fuente de verdad y lo
 * consumen `functions/` (require directo — se despliega junto a ellas) y
 * `src/` (wrapper tipado). El test de alineación
 * (dailyRecordAuthorityContractAlignment) verifica que ninguna capa vuelva a
 * divergir.
 *
 * CJS puro y sin dependencias: debe poder cargarse igual en el runtime de
 * Cloud Functions, en Vite y en Vitest.
 */
'use strict';

/**
 * Campos clínicos de cama editables en el censo (autoridad clínica): viajan
 * SIEMPRE por el canal clínico (callable) y nunca mezclados con estructura.
 * El servidor los acepta como `patientField`; el cliente los usa para el
 * split del dispatch, el enrutamiento y la coalescencia local.
 */
const CLINICAL_AUTHORITY_BED_FIELDS = Object.freeze([
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
]);

/**
 * Campos que el servidor acepta además de los clínicos del censo en el canal
 * clínico (poblados por flujos propios, no por la edición manual del censo).
 */
const SERVER_ONLY_CLINICAL_PATCH_FIELDS = Object.freeze([
  'treatingPhysicianId',
  'treatingPhysicianName',
]);

/**
 * Campos que el lote clínico Rayen escribe. Los dispositivos son datos
 * operacionales que enfermería TAMBIÉN gestiona a mano entre corridas; las
 * mediciones y el checkpoint son exclusivos del lote (valla schema-v2).
 */
const RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS = Object.freeze([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
]);

const RAYEN_BATCH_ONLY_CLINICAL_FIELDS = Object.freeze([
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
]);

const RAYEN_CLINICAL_FIELDS = Object.freeze([
  ...RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  ...RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
]);

const CLINICAL_AUTHORITY_BED_FIELD_SET = new Set(CLINICAL_AUTHORITY_BED_FIELDS);

const splitPatchPath = path =>
  String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

/** `beds.<bedId>.<campo clínico>` — exactamente 3 segmentos, escalar de cama. */
const isClinicalAuthorityBedScalarPath = path => {
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
const isBedTypeOverridePath = path => {
  const parts = splitPatchPath(path);
  return parts.length === 2 && parts[0] === 'bedTypeOverrides' && Boolean(parts[1]);
};

/**
 * Sobre clínico completo del canal callable: escalares clínicos de cama +
 * bedTypeOverrides. Es la definición que comparten el split del dispatch, el
 * enrutamiento del cliente y la atomicidad del aplanador.
 */
const isClinicalAuthorityCallablePatchPath = path =>
  isClinicalAuthorityBedScalarPath(path) || isBedTypeOverridePath(path);

module.exports = {
  CLINICAL_AUTHORITY_BED_FIELDS,
  SERVER_ONLY_CLINICAL_PATCH_FIELDS,
  RAYEN_MANUALLY_MANAGED_DEVICE_FIELDS,
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  RAYEN_CLINICAL_FIELDS,
  isClinicalAuthorityBedScalarPath,
  isBedTypeOverridePath,
  isClinicalAuthorityCallablePatchPath,
  splitPatchPath,
};
