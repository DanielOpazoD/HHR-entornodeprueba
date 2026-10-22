const { https } = require('firebase-functions/v1');
const { digest, genericFailure } = require('./accountPolicy');

const nextLimitCounter = (data, limit, now) => {
  const fresh = data && data.until > now;
  const count = fresh ? data.count : 0;
  return count >= limit ? null : { count: count + 1, until: fresh ? data.until : now + 5 * 60000 };
};

const limitFailure = () =>
  new https.HttpsError('resource-exhausted', 'Espera unos minutos antes de volver a intentar.');

const rateLimit = async (firestore, context, key, readRef) => {
  // Express supplies the platform-normalized address; never trust a body/header address.
  const ip = context?.rawRequest?.ip || context?.rawRequest?.socket?.remoteAddress || 'unknown';
  const limits = firestore.collection('hhr_account_rate_limits');
  const ipRef = limits.doc(digest(`ip:${ip}`));
  const accountRef = limits.doc(digest(`account:${key}`));
  const now = Date.now();
  const result = await firestore.runTransaction(async tx => {
    const [ipSnapshot, accountSnapshot, readSnapshot] = await tx.getAll(
      ipRef,
      accountRef,
      ...(readRef ? [readRef] : [])
    );
    const nextIp = nextLimitCounter(ipSnapshot.data(), 100, now);
    if (!nextIp) return { allowed: false };
    tx.set(ipRef, nextIp);
    const nextAccount = nextLimitCounter(accountSnapshot.data(), 10, now);
    // Account rejection still consumes the IP attempt; commit before throwing.
    if (!nextAccount) return { allowed: false };
    tx.set(accountRef, nextAccount);
    return { allowed: true, readSnapshot };
  });
  if (!result.allowed) throw limitFailure();
  // A retried transaction must expose only the snapshot whose writes committed.
  return result.readSnapshot;
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

module.exports = { rateLimit, verifyPassword };
