const { ACCESS, genericFailure, randomUUID } = require('./accountPolicy');

// Longer than the callable's 60-second lifetime. Recovery never overlaps its prior worker.
const RECOVERY_DELAY_MS = 5 * 60 * 1000;
const credentialLock = (id, at) => ({ credentialOperation: id, credentialStartedAt: at });
const completeCredentialOperation = async (firestore, uid, operationId, changes = {}) =>
  firestore.runTransaction(async tx => {
    const ref = firestore.collection(ACCESS).doc(uid);
    const current = (await tx.get(ref)).data();
    if (current?.credentialOperation !== operationId) throw genericFailure();
    tx.update(ref, { ...changes, credentialOperation: null, credentialStartedAt: null });
    return current;
  });

const repairCredentialOperation = async ({ auth, firestore, now }, uid) => {
  const operationId = randomUUID();
  const ref = firestore.collection(ACCESS).doc(uid);
  const account = await firestore.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (
      !current ||
      current.status === 'retired' ||
      (current.credentialOperation &&
        (!Number.isFinite(current.credentialStartedAt) ||
          now() < current.credentialStartedAt + RECOVERY_DELAY_MS))
    )
      throw genericFailure();
    tx.update(ref, {
      status: 'suspended',
      version: current.version + 1,
      operationId,
      ...credentialLock(operationId, now()),
    });
    return current;
  });
  // A partially provisioned identity keeps its reserved UID/RUT; never create a duplicate.
  try {
    await auth.getUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    const { newSecret } = require('./accountPolicy');
    await auth.createUser({
      uid,
      email: `${uid}@accounts.hhr.invalid`,
      displayName: account.name,
      password: newSecret(),
      disabled: true,
    });
  }
  await auth.updateUser(uid, { disabled: true });
  await auth.revokeRefreshTokens(uid);
  await completeCredentialOperation(firestore, uid, operationId);
};

module.exports = {
  RECOVERY_DELAY_MS,
  credentialLock,
  completeCredentialOperation,
  repairCredentialOperation,
};
