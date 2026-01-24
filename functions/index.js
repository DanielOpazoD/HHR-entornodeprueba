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
                console.info(`🔒 FROZEN: ${docId} tiene ${Math.round(hoursElapsed)}h de antigüedad (>48h). No se sincroniza.`);
                return null;
            }
        } catch (dateError) {
            console.warn(`⚠️ No se pudo parsear fecha de ${docId}:`, dateError.message);
        }

        const path = `hospitals/hanga_roa/dailyRecords/${docId}`;

        try {
            // Si se borra en el oficial, NO se borra en el beta (preservar respaldo)
            if (!change.after.exists) {
                console.warn(`⚠️ Documento borrado en Oficial: ${path}. NO se borra en Beta.`);
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
                    console.info(`⏸️ DEBOUNCE: ${docId} sincronizado hace ${Math.round((now - betaSyncedAt) / 1000)}s. Ignorando.`);
                    return null;
                }

                // Si el lastUpdated no cambió, no hay nada que sincronizar
                if (sourceLastUpdated === betaLastUpdated) {
                    console.debug(`🔄 SIN CAMBIOS: ${docId} ya tiene los mismos datos. Ignorando.`);
                    return null;
                }
            }

            // Añadir marca de tiempo de sincronización
            const dataToSync = {
                ...sourceData,
                _syncedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            console.info(`✅ Sincronizando ${docId} a Beta...`);
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
                console.info(`Borrando setting en Beta: ${path}`);
                return await dbBeta.doc(path).delete();
            }

            const data = change.after.data();
            console.info(`Sincronizando setting: ${docId}`);
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
                console.info(`Borrando transfer request en Beta: ${path}`);
                return await dbBeta.doc(path).delete();
            }

            const data = change.after.data();
            console.info(`Sincronizando transfer request: ${docId}`);
            return await dbBeta.doc(path).set(data);
        } catch (error) {
            console.error(`ERROR sincronizando transfer ${docId}:`, error);
            return null;
        }
    });

// =============================================================================
// MINSAL STATISTICS CALCULATION
// =============================================================================

/**
 * Calculates MINSAL statistics for a given hospital and date range.
 * This offloads heavy calculations from the frontend and reduces data transfer.
 */
exports.calculateMinsalStats = functions.https.onCall(async (data, context) => {
    // Check authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    const { hospitalId, startDate, endDate } = data;

    if (!hospitalId || !startDate || !endDate) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required parameters: hospitalId, startDate, endDate.');
    }

    const db = admin.firestore();
    const recordsRef = db.collection('hospitals').doc(hospitalId).collection('dailyRecords');

    try {
        // Query records within the date range
        const snapshot = await recordsRef
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .get();

        if (snapshot.empty) {
            return {
                totalDays: 0,
                egresosTotal: 0,
                tasaOcupacion: 0,
                porEspecialidad: [],
                message: 'No records found for the given range.'
            };
        }

        const filteredRecords = [];
        snapshot.forEach(doc => {
            filteredRecords.push(doc.data());
        });

        // ---------------------------------------------------------
        // Core Calculation Logic (Mirrored from minsalStatsCalculator.ts)
        // ---------------------------------------------------------

        // This is a simplified version of the logic to avoid complex dependencies in index.js
        // If the logic grows too much, it should be moved to a separate file in functions/

        let totalDiasCamaDisponibles = 0;
        let totalDiasCamaOcupados = 0;
        let totalEgresosVivos = 0;
        let totalEgresosFallecidos = 0;
        let totalEgresosTraslados = 0;
        const HOSPITAL_CAPACITY = 18; // Standard capacity

        const specialtyData = new Map();

        filteredRecords.forEach((record) => {
            const beds = record.beds || {};
            let ocupadas = 0;
            let bloqueadas = 0;

            // Normalize specialty helper
            const normalizeSpecialty = (s) => {
                if (!s) return 'Sin Especialidad';
                const n = s.trim();
                const gynObstetricNames = ['Obstetricia', 'Ginecología', 'Ginecologia', 'Obstetricia y Ginecología', 'Ginecología y Obstetricia'];
                if (gynObstetricNames.some(name => n.toLowerCase() === name.toLowerCase())) return 'Ginecobstetricia';
                return n || 'Sin Especialidad';
            };

            // Count occupied/blocked and aggregate by specialty
            Object.keys(beds).forEach(bedId => {
                const data = beds[bedId];
                if (data.isBlocked) {
                    bloqueadas++;
                } else if (data.patientName && data.patientName.trim()) {
                    ocupadas++;

                    // Aggregate main patient
                    const specialty = normalizeSpecialty(data.specialty);
                    const existing = specialtyData.get(specialty) || { pacientes: 0, egresos: 0, fallecidos: 0, traslados: 0, diasOcupados: 0 };
                    existing.diasOcupados++;
                    specialtyData.set(specialty, existing);

                    // Nested cribs
                    if (data.clinicalCrib && data.clinicalCrib.patientName && data.clinicalCrib.patientName.trim()) {
                        ocupadas++;
                        const cribSpecialty = normalizeSpecialty(data.clinicalCrib.specialty);
                        const cribExisting = specialtyData.get(cribSpecialty) || { pacientes: 0, egresos: 0, fallecidos: 0, traslados: 0, diasOcupados: 0 };
                        cribExisting.diasOcupados++;
                        specialtyData.set(cribSpecialty, cribExisting);
                    }
                }
            });

            const disponibles = HOSPITAL_CAPACITY - bloqueadas;
            totalDiasCamaDisponibles += disponibles;
            totalDiasCamaOcupados += ocupadas;

            // Discharges
            if (record.discharges) {
                record.discharges.forEach(d => {
                    const specialty = normalizeSpecialty(d.originalData?.specialty);
                    const existing = specialtyData.get(specialty) || { pacientes: 0, egresos: 0, fallecidos: 0, traslados: 0, diasOcupados: 0 };
                    existing.egresos++;
                    if (d.status === 'Fallecido') {
                        totalEgresosFallecidos++;
                        existing.fallecidos++;
                    } else {
                        totalEgresosVivos++;
                    }
                    specialtyData.set(specialty, existing);
                });
            }

            // Transfers
            if (record.transfers) {
                totalEgresosTraslados += record.transfers.length;
                record.transfers.forEach(t => {
                    const specialty = normalizeSpecialty(t.originalData?.specialty);
                    const existing = specialtyData.get(specialty) || { pacientes: 0, egresos: 0, fallecidos: 0, traslados: 0, diasOcupados: 0 };
                    existing.traslados++;
                    specialtyData.set(specialty, existing);
                });
            }
        });

        const egresosTotal = totalEgresosVivos + totalEgresosFallecidos + totalEgresosTraslados;
        const tasaOcupacion = totalDiasCamaDisponibles > 0 ? (totalDiasCamaOcupados / totalDiasCamaDisponibles) * 100 : 0;
        const promedioDiasEstada = egresosTotal > 0 ? totalDiasCamaOcupados / egresosTotal : 0;

        // Build specialty breakdown array
        const porEspecialidad = Array.from(specialtyData.entries()).map(([specialty, data]) => {
            const egresosEsp = data.egresos || 0;
            return {
                specialty,
                egresos: data.egresos,
                fallecidos: data.fallecidos,
                traslados: data.traslados,
                diasOcupados: data.diasOcupados,
                contribucionRelativa: totalDiasCamaOcupados > 0 ? (data.diasOcupados / totalDiasCamaOcupados) * 100 : 0,
                tasaMortalidad: egresosEsp > 0 ? (data.fallecidos / egresosEsp) * 100 : 0,
                promedioDiasEstada: egresosEsp > 0 ? data.diasOcupados / egresosEsp : 0
            };
        }).sort((a, b) => b.diasOcupados - a.diasOcupados);

        return {
            periodStart: startDate,
            periodEnd: endDate,
            totalDays: filteredRecords.length,
            diasCamaDisponibles: totalDiasCamaDisponibles,
            diasCamaOcupados: totalDiasCamaOcupados,
            egresosTotal,
            egresosVivos: totalEgresosVivos,
            egresosFallecidos: totalEgresosFallecidos,
            egresosTraslados: totalEgresosTraslados,
            tasaOcupacion: Math.round(tasaOcupacion * 10) / 10,
            promedioDiasEstada: Math.round(promedioDiasEstada * 10) / 10,
            mortalidadHospitalaria: egresosTotal > 0 ? Math.round((totalEgresosFallecidos / egresosTotal) * 1000) / 10 : 0,
            porEspecialidad
        };

    } catch (error) {
        console.error('Error calculating statistics:', error);
        throw new functions.https.HttpsError('internal', 'Error calculating statistics: ' + error.message);
    }
});

// =============================================================================
// AUTHENTICATION & CUSTOM CLAIMS
// =============================================================================

/**
 * Roles configuration
 * HARDCODED for now - in future could read from Firestore /config/roles
 */
const ADMIN_EMAILS = [
    'daniel.opazo@hospitalhangaroa.cl',
    'd.opazo.damiani@gmail.com',
    'd.opazo.damiani@hospitalhangaroa.cl',
    'danielopazodamiani@gmail.com'
];

const NURSE_EMAILS = [
    'hospitalizados@hospitalhangaroa.cl',
    'enfermeria.hospitalizados@hospitalhangaroa.cl'
];

const DOCTOR_EMAILS = [
    'medico.urgencia@hospitalhangaroa.cl'
];

const GUEST_EMAILS = [
    // Add specific guest emails here
];

/**
 * Assigns a role to a user based on their email
 */
async function assignRole(user) {
    const email = user.email ? user.email.toLowerCase() : '';
    const cleanEmail = email.trim();
    let role = 'unauthorized'; // STRICT DEFAULT

    try {
        // 1. DYNAMIC CHECK: Check Firestore config/roles
        const roleDoc = await admin.firestore().collection('config').doc('roles').get();
        if (roleDoc.exists) {
            const rolesMap = roleDoc.data();
            if (rolesMap && rolesMap[cleanEmail]) {
                role = rolesMap[cleanEmail];
                console.info(`⚡ Dynamic Role found for ${cleanEmail}: ${role}`);
            }
        }
    } catch (e) {
        console.warn(`⚠️ Failed to read dynamic roles: ${e.message}`);
    }

    // 2. STATIC FALLBACK: If dynamic check didn't assign a known role
    if (role === 'unauthorized') {
        if (ADMIN_EMAILS.includes(cleanEmail)) {
            role = 'admin';
        } else if (NURSE_EMAILS.includes(cleanEmail)) {
            role = 'nurse_hospital';
        } else if (DOCTOR_EMAILS.includes(cleanEmail)) {
            role = 'doctor_urgency';
        } else if (GUEST_EMAILS.includes(cleanEmail)) {
            role = 'viewer';
        }
    }

    try {
        await admin.auth().setCustomUserClaims(user.uid, { role });

        const statusIcon = role === 'unauthorized' ? '⛔' : '✅';
        console.info(`${statusIcon} Assigned role '${role}' to ${email}`);

        // Also update Firestore for visibility
        await admin.firestore().collection('allowedUsers').doc(user.uid).set({
            email: email,
            role: role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        return role;
    } catch (error) {
        console.error(`❌ Error assigning role to ${email}:`, error);
        throw error;
    }
}

/**
 * Trigger: On User Created
 * Automatically assigns role when a new user signs up in Firebase Auth
 */
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
    return assignRole(user);
});

/**
 * Callable: Manually set role (Admin only)
 * Useful for updating existing users without them re-signing up
 */
exports.setUserRole = functions.https.onCall(async (data, context) => {
    // 1. Verify caller is admin
    if (!context.auth || !context.auth.token.role === 'admin') {
        // Fallback for bootstrap: check against ADMIN_EMAILS list if no claim yet
        const callerEmail = context.auth?.token?.email;
        if (!callerEmail || !ADMIN_EMAILS.includes(callerEmail)) {
            throw new functions.https.HttpsError('permission-denied', 'Only admins can set roles');
        }
    }

    const { email, role } = data;
    if (!email || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'Email and role are required');
    }

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        await admin.auth().setCustomUserClaims(userRecord.uid, { role });

        // Update Firestore mirror
        await admin.firestore().collection('allowedUsers').doc(userRecord.uid).set({
            email: email,
            role: role,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.info(`✅ Manually assigned role '${role}' to ${email} (by ${context.auth.token.email})`);
        return { success: true, message: `Role ${role} assigned to ${email}` };
    } catch (error) {
        console.error(`Error setting role for ${email}:`, error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
