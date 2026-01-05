const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// 1. Inicializamos la app OFICIAL (el origen de los datos)
admin.initializeApp();

// 2. Inicializamos la app BETA (donde queremos copiar los datos)
// IMPORTANTE: Tienes que mover tu archivo .json a esta carpeta y renombrarlo a 'llave-beta.json'
let secondaryApp;
let serviceAccountCredentials = null;

try {
    serviceAccountCredentials = require('./llave-beta.json');
    secondaryApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountCredentials)
    }, 'secondary');
} catch (e) {
    console.error("No se encontró el archivo llave-beta.json. Asegúrate de moverlo a la carpeta 'functions'.");
}

const dbBeta = secondaryApp ? secondaryApp.firestore() : null;

/**
 * Función que detecta cambios en Daily Records y los copia al Beta
 * REGLA: Solo sincroniza días con menos de 48 horas de antigüedad
 * Días más antiguos quedan "congelados" en Beta como respaldo inmutable
 * 
 * PROTECCIÓN ANTI-LOOP:
 * - Añade un campo _syncedAt para evitar re-sincronizaciones redundantes
 * - Compara lastUpdated para detectar si realmente hubo cambios
 */
exports.mirrorDailyRecords = functions.firestore
    .document('hospitals/hanga_roa/dailyRecords/{docId}')
    .onWrite(async (change, context) => {
        const docId = context.params.docId; // Format: "2025-12-26"

        if (!dbBeta) {
            console.error("ERROR: dbBeta no está inicializada. Revisa llave-beta.json");
            return null;
        }

        // === REGLA DE 48 HORAS ===
        try {
            const docDate = new Date(docId + 'T00:00:00');
            const now = new Date();
            const hoursElapsed = (now - docDate) / (1000 * 60 * 60);

            if (hoursElapsed > 48) {
                console.log(`🔒 FROZEN: ${docId} tiene ${Math.round(hoursElapsed)}h de antigüedad (>48h). No se sincroniza.`);
                return null;
            }
        } catch (dateError) {
            console.warn(`⚠️ No se pudo parsear fecha de ${docId}:`, dateError.message);
        }

        const path = `hospitals/hanga_roa/dailyRecords/${docId}`;

        try {
            // Si se borra en el oficial, NO se borra en el beta (preservar respaldo)
            if (!change.after.exists) {
                console.log(`⚠️ Documento borrado en Oficial: ${path}. NO se borra en Beta.`);
                return null;
            }

            const sourceData = change.after.data();
            const sourceLastUpdated = sourceData.lastUpdated?.toMillis ? sourceData.lastUpdated.toMillis() : 0;

            // === PROTECCIÓN ANTI-LOOP ===
            // Verificar en Beta si ya sincronizamos recientemente
            const betaDoc = await dbBeta.doc(path).get();
            if (betaDoc.exists) {
                const betaData = betaDoc.data();
                const betaSyncedAt = betaData._syncedAt?.toMillis ? betaData._syncedAt.toMillis() : 0;
                const betaLastUpdated = betaData.lastUpdated?.toMillis ? betaData.lastUpdated.toMillis() : 0;

                // Si ya sincronizamos en los últimos 5 segundos, ignorar
                const now = Date.now();
                if (now - betaSyncedAt < 5000) {
                    console.log(`⏸️ DEBOUNCE: ${docId} sincronizado hace ${Math.round((now - betaSyncedAt) / 1000)}s. Ignorando.`);
                    return null;
                }

                // Si el lastUpdated no cambió, no hay nada que sincronizar
                if (sourceLastUpdated === betaLastUpdated) {
                    console.log(`🔄 SIN CAMBIOS: ${docId} ya tiene los mismos datos. Ignorando.`);
                    return null;
                }
            }

            // Añadir marca de tiempo de sincronización
            const dataToSync = {
                ...sourceData,
                _syncedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            console.log(`✅ Sincronizando ${docId} a Beta...`);
            return await dbBeta.doc(path).set(dataToSync, { merge: true });
        } catch (error) {
            console.error(`ERROR sincronizando ${docId}:`, error);
            return null;
        }
    });

/**
 * Función que detecta cambios en Audit Logs
 */
exports.mirrorAuditLogs = functions.firestore
    .document('hospitals/hanga_roa/auditLogs/{docId}')
    .onWrite(async (change, context) => {
        const docId = context.params.docId;

        if (!dbBeta) return null;

        const path = `hospitals/hanga_roa/auditLogs/${docId}`;

        try {
            if (!change.after.exists) {
                return await dbBeta.doc(path).delete();
            }

            const data = change.after.data();
            return await dbBeta.doc(path).set(data);
        } catch (error) {
            console.error(`ERROR sincronizando log ${docId}:`, error);
            return null;
        }
    });

/**
 * Función que detecta cambios en Settings (Catálogo de enfermeros, TENS, etc.)
 */
exports.mirrorSettings = functions.firestore
    .document('hospitals/hanga_roa/settings/{docId}')
    .onWrite(async (change, context) => {
        const docId = context.params.docId;

        if (!dbBeta) return null;

        const path = `hospitals/hanga_roa/settings/${docId}`;

        try {
            if (!change.after.exists) {
                console.log(`Borrando setting en Beta: ${path}`);
                return await dbBeta.doc(path).delete();
            }

            const data = change.after.data();
            console.log(`Sincronizando setting: ${docId}`);
            return await dbBeta.doc(path).set(data);
        } catch (error) {
            console.error(`ERROR sincronizando setting ${docId}:`, error);
            return null;
        }
    });

/**
 * Función que detecta cambios en Solicitudes de Traslado
 */
exports.mirrorTransferRequests = functions.firestore
    .document('hospitals/hanga_roa/transferRequests/{docId}')
    .onWrite(async (change, context) => {
        const docId = context.params.docId;

        if (!dbBeta) return null;

        const path = `hospitals/hanga_roa/transferRequests/${docId}`;

        try {
            if (!change.after.exists) {
                console.log(`Borrando transfer request en Beta: ${path}`);
                return await dbBeta.doc(path).delete();
            }

            const data = change.after.data();
            console.log(`Sincronizando transfer request: ${docId}`);
            return await dbBeta.doc(path).set(data);
        } catch (error) {
            console.error(`ERROR sincronizando transfer ${docId}:`, error);
            return null;
        }
    });

// =============================================================================
// FUNCIÓN DE GOOGLE DRIVE DESHABILITADA TEMPORALMENTE
// Será restaurada cuando se configuren las credenciales correctamente
// =============================================================================
