const { timingSafeEqual } = require('node:crypto');
const functions = require('firebase-functions/v1');
const { digest, SESSION_SECONDS } = require('./accounts/accountPolicy');
const { isAdminOrHospitalNurseRole } = require('./auth/rolePredicates');
const { createHandler } = require('./nursingHandoffExtension');

const lifetime = 4 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const proofFormat = /^[a-f0-9]{64}$/;
const disconnected = () =>
  new functions.https.HttpsError('unauthenticated', 'Conecta tu sesión de HHR.');

function createHostedHandler({
  firestore,
  auth,
  Timestamp,
  FieldValue,
  resolveRoleForEmail,
  now = Date.now,
}) {
  const grants = firestore.collection('hhr_nursing_handoff_grants');
  const resolveRole = async (email, context) => {
    const role = await resolveRoleForEmail(email, context);
    if (!isAdminOrHospitalNurseRole(role)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Tu cuenta HHR no tiene acceso a Entrega de turno.'
      );
    }
    return role;
  };

  async function connect(deviceId, challenge, context) {
    const { uid, token } = context.auth ?? {};
    const authTime = token?.auth_time;
    if (!uid || !token?.email || !Number.isSafeInteger(authTime) || authTime <= 0)
      throw disconnected();
    await resolveRole(token.email, context);
    const issuedAt = now();
    const expiresAt = Math.min(issuedAt + lifetime, (authTime + SESSION_SECONDS) * 1000);
    if (issuedAt >= expiresAt) throw disconnected();
    if (typeof challenge !== 'string' || !proofFormat.test(challenge))
      throw new functions.https.HttpsError('invalid-argument', 'Solicitud de conexión no válida.');
    const actor = {
      uid,
      token: {
        email: token.email,
        email_verified: token.email_verified === true,
        auth_time: authTime,
        firebase: { sign_in_provider: token.firebase?.sign_in_provider ?? '' },
        ...(Number.isSafeInteger(token.hhrAccountVersion)
          ? { hhrAccountVersion: token.hhrAccountVersion }
          : {}),
      },
    };
    await grants.doc(deviceId).set({ proofHash: challenge, expiresAt, actor });
    return { expiresAt };
  }

  function holdsGrant(record, proof) {
    return (
      typeof record?.proofHash === 'string' &&
      proofFormat.test(record.proofHash) &&
      timingSafeEqual(Buffer.from(record.proofHash, 'hex'), Buffer.from(digest(proof), 'hex'))
    );
  }

  async function authorize({ deviceId, proof }) {
    const record = (await grants.doc(deviceId).get()).data();
    if (!holdsGrant(record, proof) || record.expiresAt <= now()) throw disconnected();
    const actor = record.actor;
    const user = await auth.getUser(actor.uid).catch(error => {
      if (error.code === 'auth/user-not-found') throw disconnected();
      throw error;
    });
    const revokedBefore = Date.parse(user.tokensValidAfterTime);
    if (
      user.disabled ||
      user.email !== actor.token.email ||
      (Number.isFinite(revokedBefore) && actor.token.auth_time * 1000 < revokedBefore)
    )
      throw disconnected();
    const context = { auth: actor };
    await resolveRole(actor.token.email, context);
    return context;
  }

  const edit = createHandler({
    firestore,
    Timestamp,
    FieldValue,
    authorize,
    resolveRoleForEmail: resolveRole,
    origin: 'eloisa_nursing_handoff_hosted',
    census: 'censo de HHR',
    clinicalNow: () => new Date(now()),
  });

  return async (data, context) => {
    const { action, deviceId, proof } = data ?? {};
    if (typeof deviceId !== 'string' || !uuid.test(deviceId)) {
      throw new functions.https.HttpsError('invalid-argument', 'Conexión de HHR no válida.');
    }
    if (action === 'connect') return connect(deviceId, data.challenge, context);
    if (typeof proof !== 'string' || !proofFormat.test(proof)) throw disconnected();
    if (action === 'disconnect') {
      const ref = grants.doc(deviceId);
      await firestore.runTransaction(async transaction => {
        const record = (await transaction.get(ref)).data();
        if (holdsGrant(record, proof)) transaction.delete(ref);
      });
      return { disconnected: true };
    }
    return edit(data);
  };
}

const createHostedNursingHandoff = dependencies =>
  functions.region('southamerica-east1').https.onCall(createHostedHandler(dependencies));

module.exports = { createHostedHandler, createHostedNursingHandoff };
