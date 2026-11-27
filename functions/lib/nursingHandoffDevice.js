const { timingSafeEqual } = require('node:crypto');
const { region } = require('firebase-functions/v1');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  ACCESS,
  PRIVATE,
  POLICY,
  PROTECTED,
  protectedRole,
  digest,
  normalizeRut,
  hasCurrentAccountSession,
} = require('./accounts/accountPolicy');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { isAdminOrHospitalNurseRole, isAdminRole } = require('./auth/rolePredicates');
const { createHandler } = require('./nursingHandoffExtension');

const project = 'hhr-pruebas';
const collection = 'hhr_nursing_handoff_devices';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = /^[a-f0-9]{64}$/;
const denied = () =>
  new HttpsError('permission-denied', 'La cuenta HHR no tiene acceso a Entrega de turno.');
const disconnected = () =>
  new HttpsError('unauthenticated', 'Este equipo no tiene una llave vigente para ese RUN.');
const enrollmentError = () =>
  new HttpsError('failed-precondition', 'El registro de este equipo no está disponible.');

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

  const accountPolicy = firestore.doc(POLICY);
  const legacyRoles = firestore.collection('config').doc('roles');
  const administratorIdentity = firestore.collection(PRIVATE).doc('nursingHandoffAdministrator');
  const read = ref => ref.get();

  async function loadUser(uid) {
    const user = await auth.getUser(uid).catch(error => {
      if (error.code === 'auth/user-not-found') throw denied();
      throw error;
    });
    if (user.disabled || !user.email) throw denied();
    return user;
  }

  async function administratorRunHash(user, uid, get) {
    const email = user.email.toLowerCase();
    if (
      !isAdminRole(PROTECTED[email]) ||
      !user.emailVerified ||
      !user.providerData?.some(
        provider => provider.providerId === 'google.com' && provider.email?.toLowerCase() === email
      )
    ) {
      throw denied();
    }
    const [policySnapshot, identity] = await Promise.all([
      get(accountPolicy),
      get(administratorIdentity),
    ]);
    const policy = policySnapshot.data();
    const role = policy?.enabled
      ? protectedRole(policy, {
          auth: {
            uid,
            token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } },
          },
        })
      : (await get(legacyRoles)).data()?.[email];
    const runHash = identity.data()?.runHash;
    if (!isAdminRole(role) || typeof runHash !== 'string' || !hex.test(runHash)) throw denied();
    return runHash;
  }

  function assertManagedHandoffAccount(account, version) {
    if (
      account?.status !== 'active' ||
      account.credentialOperation ||
      !isAdminOrHospitalNurseRole(account.role) ||
      account.hospitalId !== HOSPITAL_ID
    )
      throw denied();
    if (account.version !== version) throw disconnected();
  }

  function validAuthorizationTime(authenticatedAt, user) {
    if (!Number.isFinite(authenticatedAt)) return false;
    const revokedAt = Date.parse(user.tokensValidAfterTime);
    return !Number.isFinite(revokedAt) || Math.floor(authenticatedAt / 1000) > revokedAt / 1000;
  }

  function isGrantCurrent(grant, user) {
    return validAuthorizationTime(grant.authenticatedAt, user);
  }

  async function assertGrantAccess(uid, user, grant, get) {
    if (isAdminRole(grant.role)) {
      const runHash = await administratorRunHash(user, uid, get);
      if (!compareHash(grant.runHash, runHash)) throw disconnected();
      return;
    }
    const account = (await get(accounts.doc(uid))).data();
    assertManagedHandoffAccount(account, grant.version);
  }

  async function register(data, context) {
    const { deviceId, challenge } = data ?? {};
    if (
      typeof deviceId !== 'string' ||
      !uuid.test(deviceId) ||
      typeof challenge !== 'string' ||
      !hex.test(challenge)
    ) {
      throw new HttpsError('invalid-argument', 'Registro de equipo inválido.');
    }
    const { uid, token } = context.auth ?? {};
    if (typeof uid !== 'string' || !Number.isSafeInteger(token?.auth_time) || token.auth_time <= 0)
      throw denied();
    const managed = uid.startsWith('hhrn_');
    const user = await loadUser(uid);
    const authTime = token.auth_time * 1000;
    if (
      authTime > now() + 60_000 ||
      !validAuthorizationTime(authTime, user) ||
      (!managed &&
        (token.firebase?.sign_in_provider !== 'google.com' ||
          token.email_verified !== true ||
          token.email?.toLowerCase() !== user.email.toLowerCase()))
    ) {
      throw denied();
    }
    return firestore.runTransaction(async tx => {
      const ref = devices.doc(deviceId);
      const registration = managed
        ? await managedRegistration(uid, context, tx)
        : await administratorRegistration(uid, user, tx);
      const grant = (await tx.get(ref)).data();
      if (grant) {
        if (
          grant.uid === uid &&
          isGrantCurrent(grant, user) &&
          grant.role === registration.role &&
          grant.version === registration.version &&
          compareHash(grant.runHash, registration.runHash) &&
          compareHash(grant.proofHash, challenge)
        )
          return { registered: true };
        throw enrollmentError();
      }
      tx.create(ref, {
        uid,
        ...registration,
        proofHash: challenge,
        authenticatedAt: authTime,
        issuedAt: now(),
      });
      return { registered: true };
    });
  }

  async function managedRegistration(uid, context, tx) {
    const [access, identity] = await Promise.all([
      tx.get(accounts.doc(uid)),
      tx.get(firestore.collection(PRIVATE).doc(uid)),
    ]);
    const account = access.data();
    if (!hasCurrentAccountSession(account, context, now())) throw denied();
    assertManagedHandoffAccount(account, account.version);
    return { version: account.version, runHash: normalizedRunHash(identity.data()?.rut) };
  }

  async function administratorRegistration(uid, user, tx) {
    const runHash = await administratorRunHash(user, uid, ref => tx.get(ref));
    return { role: 'admin', runHash };
  }

  async function loadGrantUser(grant) {
    const user = await loadUser(grant.uid);
    if (!isGrantCurrent(grant, user)) throw disconnected();
    return user;
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
    const { uid } = grant;
    const user = await loadGrantUser(grant);
    await assertGrantAccess(uid, user, grant, read);
    return {
      auth: { uid, token: { email: user.email } },
      deviceId,
      grant,
      proofHash: nowProofHash,
    };
  }

  const edit = createHandler({
    firestore,
    Timestamp,
    FieldValue,
    authorize,
    async assertWriteAccess(actor, tx) {
      const grant = (await tx.get(devices.doc(actor.deviceId))).data();
      if (
        !grant ||
        grant.uid !== actor.auth.uid ||
        grant.role !== actor.grant.role ||
        grant.version !== actor.grant.version ||
        !compareHash(grant.runHash, actor.grant.runHash) ||
        !compareHash(grant.proofHash, actor.proofHash)
      )
        throw disconnected();
      const user = await loadGrantUser(grant);
      await assertGrantAccess(actor.auth.uid, user, grant, ref => tx.get(ref));
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
          throw new HttpsError('invalid-argument', 'Se requiere una solicitud JSON válida.');
        }
        res.json({ result: await operate(data) });
      } catch (error) {
        const failure =
          error instanceof HttpsError
            ? error
            : new HttpsError('internal', 'HHR no pudo procesar la entrega de turno.');
        res.status(failure.httpErrorCode.status).json({ error: failure.toJSON() });
      }
    }),
  };
}

module.exports = { createDeviceHandoffHandlers, createNursingHandoffDeviceFunctions };
