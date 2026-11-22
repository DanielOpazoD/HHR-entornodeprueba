const { https, region } = require('firebase-functions/v1');
const { ACCESS, INDEX, digest, normalizeRut } = require('./accounts/accountPolicy');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { createHandler } = require('./nursingHandoffExtension');

const project = 'hhr-pruebas';
const audience = 'urn:hhr-pruebas:nursing-handoff';
const tokenType = 'hhr-nursing-handoff+jwt';
const maxAgeSeconds = 300;
const invalidAssertion = () =>
  new https.HttpsError('unauthenticated', 'No se pudo verificar la sesión de Eloísa.');
const denied = () =>
  new https.HttpsError('permission-denied', 'La cuenta HHR no tiene acceso a Entrega de turno.');

function createRayenAssertionVerifier({ issuer, facilityId, keys, now = Date.now }) {
  return async assertion => {
    if (typeof assertion !== 'string' || assertion.length > 4096) throw invalidAssertion();
    try {
      const { jwtVerify } = await import('jose');
      const { payload, protectedHeader } = await jwtVerify(assertion, keys, {
        algorithms: ['RS256'],
        issuer,
        audience,
        typ: tokenType,
        maxTokenAge: maxAgeSeconds,
        currentDate: new Date(now()),
        requiredClaims: ['sub', 'iat', 'exp', 'run', 'facilityId'],
      });
      if (
        !protectedHeader.kid?.trim() ||
        payload.aud !== audience ||
        !payload.sub?.trim() ||
        payload.facilityId !== facilityId ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp <= payload.iat ||
        payload.exp - payload.iat > maxAgeSeconds
      ) {
        throw invalidAssertion();
      }
      return { run: normalizeRut(payload.run), issuedAt: payload.iat * 1000 };
    } catch (error) {
      if (error instanceof https.HttpsError && error.code === 'unavailable') throw error;
      throw invalidAssertion();
    }
  };
}

function createRayenHandoffHandler({
  firestore,
  auth,
  Timestamp,
  FieldValue,
  verifyAssertion,
  now,
}) {
  const access = firestore.collection(ACCESS);
  async function loadAccount(uid, transaction) {
    const ref = access.doc(uid);
    const account = (await (transaction ? transaction.get(ref) : ref.get())).data();
    if (
      account?.status !== 'active' ||
      account.credentialOperation ||
      account.hospitalId !== HOSPITAL_ID ||
      account.role !== 'nurse_hospital' ||
      !Number.isSafeInteger(account.version)
    ) {
      throw denied();
    }
    return account;
  }

  async function authorize(data) {
    const { run, issuedAt } = await verifyAssertion(data?.assertion);
    const { uid } = (await firestore.collection(INDEX).doc(digest(run)).get()).data() ?? {};
    if (typeof uid !== 'string' || !uid.startsWith('hhrn_')) throw denied();
    const account = await loadAccount(uid);
    const user = await auth.getUser(uid).catch(error => {
      if (error.code === 'auth/user-not-found') throw denied();
      throw error;
    });
    if (user.disabled || !user.email || issuedAt < Date.parse(user.tokensValidAfterTime)) {
      throw denied();
    }
    return { auth: { uid, token: { email: user.email } }, accountVersion: account.version };
  }

  const edit = createHandler({
    firestore,
    Timestamp,
    FieldValue,
    authorize,
    async assertWriteAccess(actor, transaction) {
      const account = await loadAccount(actor.auth.uid, transaction);
      if (account.version !== actor.accountVersion) throw denied();
    },
    clinicalNow: () => new Date(now()),
    origin: 'eloisa_nursing_handoff_rayen',
    census: 'censo de HHR',
  });

  return async data => {
    if (data?.action !== 'status') return edit(data);
    await authorize(data);
    return { authorized: true };
  };
}

function configUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search) {
      return url;
    }
  } catch {
    // Configuration is optional until a trusted issuer is available.
  }
  return null;
}

function createRayenNursingHandoffFunctions(deps, env = process.env) {
  const issuer = env.HHR_RAYEN_HANDOFF_ISSUER;
  const jwksUrl = configUrl(env.HHR_RAYEN_HANDOFF_JWKS_URL);
  const facilityId = env.HHR_RAYEN_HANDOFF_FACILITY_ID;
  const sourceOrigin = env.HHR_RAYEN_HANDOFF_EXTENSION_ORIGIN;
  if (
    env.GCLOUD_PROJECT !== project ||
    deps.auth.app.options.projectId !== project ||
    env.FUNCTIONS_EMULATOR === 'true' ||
    !configUrl(issuer) ||
    !jwksUrl ||
    !/^[1-9]\d{0,15}$/.test(facilityId ?? '') ||
    !/^chrome-extension:\/\/[a-p]{32}$/.test(sourceOrigin ?? '')
  ) {
    return {};
  }

  let keySet;
  const keys = async (...args) => {
    const { createRemoteJWKSet } = await import('jose');
    keySet ??= createRemoteJWKSet(jwksUrl, { timeoutDuration: 3000 });
    try {
      return await keySet(...args);
    } catch (error) {
      if (
        error.code === 'ERR_JWKS_NO_MATCHING_KEY' ||
        error.code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS'
      ) {
        throw error;
      }
      throw new https.HttpsError('unavailable', 'No se pudo consultar el emisor de Eloísa.');
    }
  };
  const edit = createRayenHandoffHandler({
    ...deps,
    verifyAssertion: createRayenAssertionVerifier({ issuer, facilityId, keys }),
    now: Date.now,
  });
  return {
    nursingHandoffRayen: region('southamerica-east1').https.onRequest(async (req, res) => {
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
        res.json({ result: await edit(data) });
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

module.exports = {
  createRayenAssertionVerifier,
  createRayenHandoffHandler,
  createRayenNursingHandoffFunctions,
};
