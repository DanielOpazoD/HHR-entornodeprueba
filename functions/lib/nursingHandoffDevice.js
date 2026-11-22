const { timingSafeEqual } = require('node:crypto');
const { https, region } = require('firebase-functions/v1');
const {
  ACCESS,
  PRIVATE,
  digest,
  normalizeRut,
  hasCurrentAccountSession,
} = require('./accounts/accountPolicy');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { createHandler } = require('./nursingHandoffExtension');

const project = 'hhr-pruebas';
const collection = 'hhr_nursing_handoff_devices';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = /^[a-f0-9]{64}$/;
const denied = () =>
  new https.HttpsError('permission-denied', 'La cuenta HHR no tiene acceso a Entrega de turno.');
const disconnected = () =>
  new https.HttpsError('unauthenticated', 'Este equipo no tiene una llave vigente para ese RUN.');
const enrollmentError = () =>
  new https.HttpsError('failed-precondition', 'El registro de este equipo no está disponible.');

function compareHash(left, right) {
  return (
    typeof left === 'string' &&
    hex.test(left) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  );
}

function normalizedRunHash(value) {
  try {
    return digest(normalizeRut(value));
  } catch {
    throw disconnected();
  }
}

function createDeviceHandoffHandlers({ firestore, auth, Timestamp, FieldValue, now = Date.now }) {
  const devices = firestore.collection(collection);
  const accounts = firestore.collection(ACCESS);

  async function register({ deviceId, challenge }, context) {
    if (
      typeof deviceId !== 'string' ||
      !uuid.test(deviceId) ||
      typeof challenge !== 'string' ||
      !hex.test(challenge)
    ) {
      throw new https.HttpsError('invalid-argument', 'Registro de equipo inválido.');
    }
    const uid = context.auth?.uid;
    if (typeof uid !== 'string' || !uid.startsWith('hhrn_')) throw denied();
    const user = await auth.getUser(uid).catch(error => {
      if (error.code === 'auth/user-not-found') throw denied();
      throw error;
    });
    if (
      user.disabled ||
      context.auth.token?.auth_time * 1000 < Date.parse(user.tokensValidAfterTime)
    ) {
      throw denied();
    }
    return firestore.runTransaction(async tx => {
      const ref = devices.doc(deviceId);
      const [access, privateData, existing] = await Promise.all([
        tx.get(accounts.doc(uid)),
        tx.get(firestore.collection(PRIVATE).doc(uid)),
        tx.get(ref),
      ]);
      const account = access.data();
      if (
        !hasCurrentAccountSession(account, context, now()) ||
        account.role !== 'nurse_hospital' ||
        account.hospitalId !== HOSPITAL_ID
      )
        throw denied();
      const runHash = normalizedRunHash(privateData.data()?.rut);
      const grant = existing.data();
      if (grant) {
        if (
          grant.uid === uid &&
          grant.version === account.version &&
          compareHash(grant.proofHash, challenge)
        )
          return { registered: true };
        throw enrollmentError();
      }
      tx.create(ref, {
        uid,
        version: account.version,
        runHash,
        proofHash: challenge,
        issuedAt: now(),
      });
      return { registered: true };
    });
  }

  function assertAccount(account, version) {
    if (
      account?.status !== 'active' ||
      account.credentialOperation ||
      account.role !== 'nurse_hospital' ||
      account.hospitalId !== HOSPITAL_ID
    )
      throw denied();
    if (account.version !== version) throw disconnected();
  }

  async function authorize(data) {
    const { deviceId, proof, professionalRun } = data ?? {};
    if (
      typeof deviceId !== 'string' ||
      !uuid.test(deviceId) ||
      typeof proof !== 'string' ||
      !hex.test(proof)
    )
      throw disconnected();
    const runHash = normalizedRunHash(professionalRun);
    const ref = devices.doc(deviceId);
    const nowProofHash = digest(proof);
    const grant = (await ref.get()).data();
    if (
      !grant ||
      !compareHash(grant.proofHash, nowProofHash) ||
      !compareHash(grant.runHash, runHash)
    )
      throw disconnected();
    const { uid, version } = grant;
    const account = (await accounts.doc(uid).get()).data();
    assertAccount(account, version);
    const user = await auth.getUser(uid).catch(error => {
      if (error.code === 'auth/user-not-found') throw denied();
      throw error;
    });
    if (user.disabled || !user.email || grant.issuedAt < Date.parse(user.tokensValidAfterTime)) {
      throw denied();
    }
    return {
      auth: { uid, token: { email: user.email } },
      deviceId,
      version,
      proofHash: nowProofHash,
    };
  }

  const edit = createHandler({
    firestore,
    Timestamp,
    FieldValue,
    authorize,
    async assertWriteAccess(actor, tx) {
      const [access, key] = await Promise.all([
        tx.get(accounts.doc(actor.auth.uid)),
        tx.get(devices.doc(actor.deviceId)),
      ]);
      assertAccount(access.data(), actor.version);
      const grant = key.data();
      if (
        !grant ||
        grant.uid !== actor.auth.uid ||
        grant.version !== actor.version ||
        !compareHash(grant.proofHash, actor.proofHash)
      )
        throw disconnected();
    },
    clinicalNow: () => new Date(now()),
    origin: 'eloisa_nursing_handoff_device',
    census: 'censo de HHR',
  });
  return {
    register,
    async operate(data) {
      if (data?.action === 'status') {
        await authorize(data);
        return { authorized: true };
      }
      if (data?.action === 'disconnect') {
        const actor = await authorize(data);
        await devices.doc(actor.deviceId).delete();
        return { disconnected: true };
      }
      return edit(data);
    },
  };
}

function createNursingHandoffDeviceFunctions(deps, env = process.env) {
  const sourceOrigin = env.HHR_NURSING_HANDOFF_DEVICE_ORIGIN;
  if (
    env.GCLOUD_PROJECT !== project ||
    deps.auth.app.options.projectId !== project ||
    env.FUNCTIONS_EMULATOR === 'true' ||
    !/^chrome-extension:\/\/[a-p]{32}$/.test(sourceOrigin ?? '')
  )
    return {};
  const { operate, register } = createDeviceHandoffHandlers(deps);
  const zone = region('southamerica-east1');
  return {
    registerNursingHandoffDevice: zone.https.onCall(register),
    nursingHandoffDevice: zone.https.onRequest(async (req, res) => {
      res.set({ Vary: 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      try {
        if (req.get('origin') !== sourceOrigin) throw denied();
        res.set('Access-Control-Allow-Origin', sourceOrigin);
        if (req.method === 'OPTIONS') {
          res.set({
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.status(204).end();
          return;
        }
        if (req.method !== 'POST') {
          res
            .set('Allow', 'POST, OPTIONS')
            .status(405)
            .json({
              error: {
                status: 'METHOD_NOT_ALLOWED',
                message: 'Usa POST para consultar la entrega.',
              },
            });
          return;
        }
        const data = req.body?.data;
        if (
          !req.is('application/json') ||
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data)
        ) {
          throw new https.HttpsError('invalid-argument', 'Se requiere una solicitud JSON válida.');
        }
        res.json({ result: await operate(data) });
      } catch (error) {
        const failure =
          error instanceof https.HttpsError
            ? error
            : new https.HttpsError('internal', 'HHR no pudo procesar la entrega de turno.');
        res.status(failure.httpErrorCode.status).json({ error: failure.toJSON() });
      }
    }),
  };
}

module.exports = { createDeviceHandoffHandlers, createNursingHandoffDeviceFunctions };
