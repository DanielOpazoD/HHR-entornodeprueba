const { timingSafeEqual } = require('node:crypto');
const {
  ACCESS,
  PRIVATE,
  INDEX,
  INVITES,
  genericFailure,
  normalizeRut,
  assertPassword,
  hasCurrentAccountSession,
  digest,
  randomUUID,
  audit,
} = require('./accountPolicy');
const { rateLimit, verifyPassword } = require('./accountTransport');
const { credentialLock, completeCredentialOperation } = require('./accountCredentialOperation');

const createAccountCredentials = ({
  auth,
  firestore,
  now = Date.now,
  passwordVerifier = verifyPassword,
}) => {
  const publishVersion = (uid, version) =>
    auth.setCustomUserClaims(uid, { hhrAccountVersion: version, role: 'nurse_hospital' });
  const finalizePassword = async (uid, operationId, password, version) => {
    const ref = firestore.collection(ACCESS).doc(uid);
    // Serialize credential changes across activation/recovery. A suspension can revoke
    // immediately, but a new activation cannot race a still-running Auth write.
    try {
      await auth.updateUser(uid, { password, disabled: false });
      await auth.revokeRefreshTokens(uid);
      await publishVersion(uid, version);
    } catch {
      // An uncertain provider result keeps the credential lock and access closed.
      // Operational repair must confirm the Auth write before issuing a fresh invitation.
      throw genericFailure();
    }
    const activated = await firestore.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.credentialOperation !== operationId) throw genericFailure();
      const valid =
        current.operationId === operationId &&
        current.version === version &&
        current.status === 'setting_password';
      tx.update(ref, {
        status: valid
          ? 'active'
          : current.status === 'setting_password'
            ? 'suspended'
            : current.status,
        ...(valid ? { credentialOperation: null, credentialStartedAt: null } : {}),
        updatedAt: now(),
      });
      audit(
        firestore,
        tx,
        uid,
        uid,
        valid ? 'password_established' : 'password_operation_revoked',
        now()
      );
      return valid;
    });
    if (!activated) {
      // Keep the lock until the last provider mutation finishes, so a new activation cannot race it.
      await auth.updateUser(uid, { disabled: true });
      await completeCredentialOperation(firestore, uid, operationId);
      throw genericFailure();
    }
    return { credentialEmail: `${uid}@accounts.hhr.invalid` };
  };

  const activateAccount = async (data, context) => {
    const rawToken = typeof data?.activationToken === 'string' ? data.activationToken : '';
    const [id, secret] = rawToken.split('.');
    if (
      !/^[a-f0-9-]{36}$/.test(id || '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret || '') ||
      rawToken.length !== 80
    )
      throw genericFailure();
    await rateLimit(firestore, context, `invitation:${id}`);
    const inviteRef = firestore.collection(INVITES).doc(id);
    const operationId = randomUUID();
    const claimed = await firestore.runTransaction(async tx => {
      const invite = (await tx.get(inviteRef)).data();
      if (
        !invite ||
        invite.status !== 'issued' ||
        invite.expiresAt <= now() ||
        typeof invite.secretHash !== 'string' ||
        invite.secretHash.length !== 64 ||
        !timingSafeEqual(Buffer.from(digest(secret)), Buffer.from(invite.secretHash))
      )
        throw genericFailure();
      const accessRef = firestore.collection(ACCESS).doc(invite.uid);
      const account = (await tx.get(accessRef)).data();
      const privateData = (await tx.get(firestore.collection(PRIVATE).doc(invite.uid))).data();
      if (normalizeRut(data?.rut) !== privateData?.rut) throw genericFailure();
      assertPassword(data?.password, privateData?.rut);
      if (account?.status !== 'pending' || account.version !== invite.version)
        throw genericFailure();
      tx.update(inviteRef, { status: 'consumed', consumedAt: now() });
      tx.update(accessRef, {
        status: 'setting_password',
        operationId,
        ...credentialLock(operationId, now()),
      });
      return { uid: invite.uid, version: invite.version };
    });
    // Consumed before the external Auth write; crashes fail closed until an admin repairs the operation.
    return finalizePassword(claimed.uid, operationId, data.password, claimed.version);
  };

  const signInWithRut = async (data, context) => {
    const rut = normalizeRut(data?.rut);
    await rateLimit(firestore, context, digest(rut));
    const uid = (await firestore.collection(INDEX).doc(digest(rut)).get()).data()?.uid;
    // Unknown accounts take the same password-provider path and return the same public error.
    const email = `${uid || 'unknown-account'}@accounts.hhr.invalid`;
    const verifiedUid = await passwordVerifier({
      auth,
      email,
      password: data?.password,
      apiKey: data?.apiKey,
    });
    if (!uid || uid !== verifiedUid) throw genericFailure();
    const account = (await firestore.collection(ACCESS).doc(uid).get()).data();
    if (account?.status !== 'active' || account.credentialOperation) throw genericFailure();
    // Claims are published only by serialized credential/admin transitions.
    // A delayed login must not overwrite a newer password/revocation version.
    return { credentialEmail: email };
  };

  const changeAccountPassword = async (data, context) => {
    const uid = context?.auth?.uid;
    if (!uid) throw genericFailure();
    await rateLimit(firestore, context, `password:${uid}`);
    const ref = firestore.collection(ACCESS).doc(uid);
    const account = (await ref.get()).data();
    if (!hasCurrentAccountSession(account, context, now())) throw genericFailure();
    const privateData = (await firestore.collection(PRIVATE).doc(uid).get()).data();
    assertPassword(data?.password, privateData?.rut);
    const verifiedUid = await passwordVerifier({
      auth,
      email: `${uid}@accounts.hhr.invalid`,
      password: data?.currentPassword,
      apiKey: data?.apiKey,
    });
    if (verifiedUid !== uid) throw genericFailure();
    const operationId = randomUUID();
    const version = await firestore.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!hasCurrentAccountSession(current, context, now())) throw genericFailure();
      const nextVersion = current.version + 1;
      tx.update(ref, {
        version: nextVersion,
        status: 'setting_password',
        operationId,
        ...credentialLock(operationId, now()),
      });
      return nextVersion;
    });
    return finalizePassword(uid, operationId, data.password, version);
  };
  return { activateAccount, signInWithRut, changeAccountPassword };
};

module.exports = { createAccountCredentials };
