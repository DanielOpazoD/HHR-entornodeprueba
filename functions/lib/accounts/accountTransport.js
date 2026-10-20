const { https } = require('firebase-functions/v1');
const { digest, genericFailure } = require('./accountPolicy');

const consumeLimit = async (firestore, key, limit, now = Date.now()) => {
  const ref = firestore.collection('hhr_account_rate_limits').doc(digest(key));
  await firestore.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    const fresh = data && data.until > now;
    const count = fresh ? data.count : 0;
    if (count >= limit)
      throw new https.HttpsError(
        'resource-exhausted',
        'Espera unos minutos antes de volver a intentar.'
      );
    tx.set(ref, { count: count + 1, until: fresh ? data.until : now + 5 * 60000 });
  });
};

const rateLimit = async (firestore, context, key) => {
  // Express supplies the platform-normalized address; never trust a body/header address.
  const ip = context?.rawRequest?.ip || context?.rawRequest?.socket?.remoteAddress || 'unknown';
  await consumeLimit(firestore, `ip:${ip}`, 100);
  await consumeLimit(firestore, `account:${key}`, 10);
};

const verifyPassword = async ({ auth, email, password, apiKey, fetchImpl = fetch }) => {
  if (
    typeof password !== 'string' ||
    password.length > 128 ||
    typeof apiKey !== 'string' ||
    !/^[A-Za-z0-9_-]{10,100}$/.test(apiKey)
  )
    throw genericFailure();
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator && !/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw genericFailure();
  const base = emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
  let response;
  try {
    response = await fetchImpl(
      `${base}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) throw genericFailure();
    const result = await response.json();
    // A client API key is public, but never an authority for project/UID selection.
    const verified = await auth.verifyIdToken(result.idToken, true);
    if (verified.email !== email) throw genericFailure();
    return verified.uid;
  } catch {
    // Do not propagate SDK/fetch errors: they can contain credentials or tokens.
    throw genericFailure();
  }
};

module.exports = { consumeLimit, rateLimit, verifyPassword };
