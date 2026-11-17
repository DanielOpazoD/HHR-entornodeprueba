// The two daily-record authority callables and their deployment settings.
const functions = require('firebase-functions/v1');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWritePolicy');
const { createFullSaveHandler } = require('./dailyRecordFullSaveCallable');
const { createPatchHandler } = require('./dailyRecordPatchCallable');

const createDailyRecordWriteAuthorityFunctions = ({
  firestore,
  Timestamp,
  FieldValue,
  resolveRoleForEmail,
}) => ({
  saveDailyRecordWithClinicalAuthority: functions
    // Cerca de Firestore (Firestore: southamerica-west1; Gen1 no existe en esa
    // región, así que se usa southamerica-east1): la transacción y el historial
    // mueven el registro completo y us-central1 costaba un cruce de continente.
    // Debe coincidir con DAILY_RECORD_AUTHORITY_FUNCTIONS_REGION del cliente.
    // Región ÚNICA: el cliente dejó de llamar a us-central1 con la migración de
    // región (#257, 31-08); la copia que quedó allí duplicaba costo y confundía
    // el diagnóstico por logs. El workflow de deploy la retira y verifica que
    // ya no esté listada.
    .region('southamerica-east1')
    .runWith({ memory: '1GB' })
    .https.onCall(createFullSaveHandler({ firestore, Timestamp, resolveRoleForEmail })),

  patchDailyRecordWithClinicalAuthority: functions
    // Misma región única que saveDailyRecordWithClinicalAuthority (ver arriba).
    .region('southamerica-east1')
    .runWith({ memory: '1GB' })
    .https.onCall(createPatchHandler({ firestore, Timestamp, FieldValue, resolveRoleForEmail })),
});

module.exports = {
  assertAuthorizedDailyRecordWriter,
  createDailyRecordWriteAuthorityFunctions,
};
