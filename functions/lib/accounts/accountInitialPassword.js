const { timingSafeEqual } = require('node:crypto');
const {
  ACCESS,
  INVITES,
  digest,
  newSecret,
  randomUUID,
  genericFailure,
} = require('./accountPolicy');

// The initial RUT credential never creates an Auth session or grants clinical access.
const beginInitialPassword = async ({ firestore, uid, rut, password, now }) => {
  if (!uid) return null;
  const expected = rut.split('-')[0];
  if (
    typeof password !== 'string' ||
    password.length !== expected.length ||
    !/^[0-9]+$/.test(password)
  )
    return null;
  const ref = firestore.collection(ACCESS).doc(uid);
  const account = (await ref.get()).data();
  if (account?.status !== 'pending' || account.initialPasswordEnabled !== true) return null;
  if (!timingSafeEqual(Buffer.from(password), Buffer.from(expected))) throw genericFailure();
  const id = randomUUID();
  const secret = newSecret();
  await firestore.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (
      current?.status !== 'pending' ||
      !current.initialPasswordEnabled ||
      current.credentialOperation ||
      current.version !== account.version
    )
      throw genericFailure();
    tx.create(firestore.collection(INVITES).doc(id), {
      uid,
      version: current.version,
      status: 'issued',
      secretHash: digest(secret),
      expiresAt: now() + 10 * 60000,
    });
  });
  return { requiresSetup: true, activationToken: `${id}.${secret}` };
};
module.exports = { beginInitialPassword };
