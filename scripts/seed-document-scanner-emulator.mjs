import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { hashPin } = require('../functions/lib/prescriptionAccessFunctions');

const projectId = process.env.FIREBASE_PROJECT_ID || 'hhr-local-scanner';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

const app =
  getApps()[0] ||
  initializeApp({
    projectId,
    storageBucket: `${projectId}.firebasestorage.app`,
  });
const firestore = getFirestore(app);
const auth = getAuth(app);
const now = new Date();
const sourceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
  now.getDate()
).padStart(2, '0')}`;
const pin = process.env.DOCUMENT_SCANNER_LOCAL_PIN;
const localQueueEmail = process.env.DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL;
const localQueuePassword = process.env.DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD;
if (!pin || !localQueueEmail || !localQueuePassword) {
  throw new Error(
    'Define DOCUMENT_SCANNER_LOCAL_PIN, DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL y DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD.'
  );
}
const salt = randomBytes(16).toString('hex');
const pinHashParams = { N: 16_384, r: 8, p: 1, keyLength: 32 };

await firestore
  .collection('hospitals')
  .doc('hanga_roa')
  .collection('config')
  .doc('prescriptionsAccess')
  .set({
    pinHash: await hashPin(pin, salt, pinHashParams),
    pinSalt: salt,
    pinHashAlgorithm: 'scrypt',
    pinHashParams,
    failedAttempts: 0,
    lockedUntil: null,
    pinUpdatedAt: now.toISOString(),
    pinUpdatedBy: 'local-emulator',
  });

await firestore
  .collection('hospitals')
  .doc('hanga_roa')
  .collection('dailyRecords')
  .doc(sourceDate)
  .set({
    date: sourceDate,
    beds: {
      H1C1: {
        patientName: 'Paciente Local Uno',
        rut: '11.111.111-1',
        isBlocked: false,
      },
      H1C2: {
        patientName: 'Paciente Local Dos',
        rut: '22.222.222-2',
        isBlocked: false,
      },
    },
  });

await firestore.collection('config').doc('roles').set(
  {
    [localQueueEmail]: 'admin',
  },
  { merge: true }
);

try {
  const user = await auth.getUserByEmail(localQueueEmail);
  await auth.updateUser(
    user.uid,
    Object.fromEntries([
      ['password', localQueuePassword],
      ['disabled', false],
    ])
  );
} catch (error) {
  if (error?.code !== 'auth/user-not-found') throw error;
  await auth.createUser(
    Object.fromEntries([
      ['email', localQueueEmail],
      ['password', localQueuePassword],
      ['displayName', 'Administrador local HHR'],
      ['emailVerified', true],
    ])
  );
}

console.log(
  `Emulador preparado para ${sourceDate}: camas H1C1/H1C2 y bandeja local autenticada.`
);
