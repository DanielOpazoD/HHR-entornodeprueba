const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// 1. Inicializamos la app OFICIAL (el origen de los datos)
admin.initializeApp();

// 2. Inicializamos la app BETA (donde queremos copiar los datos)
// IMPORTANTE: Tienes que mover tu archivo .json a esta carpeta y renombrarlo a 'llave-beta.json'
let secondaryApp;
try {
    const serviceAccountBeta = require('./llave-beta.json');
    secondaryApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountBeta)
    }, 'secondary');
} catch (e) {
    console.error("No se encontró el archivo llave-beta.json. Asegúrate de moverlo a la carpeta 'functions'.");
}

const dbBeta = secondaryApp ? secondaryApp.firestore() : null;

/**
 * Función que detecta cambios en Daily Records y los copia al Beta
 * REGLA: Solo sincroniza días con menos de 48 horas de antigüedad
 * Días más antiguos quedan "congelados" en Beta como respaldo inmutable
 */
exports.mirrorDailyRecords = functions.firestore
    .document('hospitals/hanga_roa/dailyRecords/{docId}')
    .onWrite(async (change, context) => {
        const docId = context.params.docId; // Format: "2025-12-26"
        console.log(`>>> Evento mirrorDailyRecords para: ${docId}`);

        if (!dbBeta) {
            console.error("ERROR: dbBeta no está inicializada. Revisa llave-beta.json");
            return null;
        }

        // === REGLA DE 48 HORAS ===
        // Verificar si el documento es demasiado antiguo para sincronizar
        try {
            const docDate = new Date(docId + 'T00:00:00'); // Parse YYYY-MM-DD
            const now = new Date();
            const hoursElapsed = (now - docDate) / (1000 * 60 * 60);

            if (hoursElapsed > 48) {
                console.log(`🔒 FROZEN: ${docId} tiene ${Math.round(hoursElapsed)}h de antigüedad (>48h). No se sincroniza.`);
                return null;
            }
            console.log(`✅ ${docId} tiene ${Math.round(hoursElapsed)}h de antigüedad (<48h). Sincronizando...`);
        } catch (dateError) {
            console.warn(`⚠️ No se pudo parsear fecha de ${docId}, sincronizando de todas formas:`, dateError.message);
        }

        const path = `hospitals/hanga_roa/dailyRecords/${docId}`;

        try {
            // Si se borra en el oficial, NO se borra en el beta (preservar respaldo)
            if (!change.after.exists) {
                console.log(`⚠️ Documento borrado en Oficial: ${path}. NO se borra en Beta (preservar respaldo)`);
                return null;
            }

            // Si se crea o edita, se copia/sobrescribe en el beta
            const data = change.after.data();
            console.log(`Copiando datos a Beta en: ${path} (LastUpdated: ${data.lastUpdated})`);

            // Usamos merge: true para no borrar subcolecciones si existieran
            return await dbBeta.doc(path).set(data, { merge: true });
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
        console.log(`>>> Evento mirrorAuditLogs para: ${docId}`);

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
        console.log(`>>> Evento mirrorSettings para: ${docId}`);

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
        console.log(`>>> Evento mirrorTransferRequests para: ${docId}`);

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
