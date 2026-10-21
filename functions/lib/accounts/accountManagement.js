const { https } = require('firebase-functions/v1');
const { MANAGED_ASSIGNABLE_ROLES } = require('../auth/authConfig');
const { ACCESS, genericFailure, randomUUID, newSecret } = require('./accountPolicy');
const {
  credentialLock,
  completeCredentialOperation,
  repairCredentialOperation,
  RECOVERY_DELAY_MS,
} = require('./accountCredentialOperation');

const accountProfile = data => {
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  const role = data?.role ?? 'nurse_hospital';
  if (
    name.length < 3 ||
    name.length > 120 ||
    !MANAGED_ASSIGNABLE_ROLES.has(role) ||
    role === 'unauthorized'
  )
    throw new https.HttpsError('invalid-argument', 'Revisa el nombre y selecciona un rol válido.');
  return { name, role };
};

// Old suspensions did not retain their prior state. Only a matching previous Auth
// version proves that the last operation suspended an established password.
const resumableStatus = (account, user) => {
  if (['active', 'pending'].includes(account.suspendedFrom)) return account.suspendedFrom;
  return user?.disabled === true &&
    Number.isSafeInteger(user.customClaims?.hhrAccountVersion) &&
    user.customClaims.hhrAccountVersion === account.version - 1 &&
    user.customClaims.role === account.role
    ? 'active'
    : null;
};

// Called only after the administration endpoint has verified a recent administrator session.
const manageAccountProfile = async ({ auth, firestore, now }, data, context) => {
  const { uid, action } = data;
  if (typeof uid !== 'string' || !/^hhrn_[a-f0-9-]{36}$/.test(uid)) throw genericFailure();
  const profile = action === 'update' ? accountProfile(data) : null;
  const existingAuth = action === 'enable' ? await auth.getUser(uid) : null;
  if (action === 'repair_reset') await repairCredentialOperation({ auth, firestore, now }, uid);
  const operationId = randomUUID();
  const ref = firestore.collection(ACCESS).doc(uid);
  const at = now();
  const transition = await firestore.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    const retryDelete =
      action === 'delete' &&
      current?.status === 'retired' &&
      (!current.credentialOperation ||
        (Number.isFinite(current.credentialStartedAt) &&
          at >= current.credentialStartedAt + RECOVERY_DELAY_MS));
    if (
      !current ||
      (!retryDelete &&
        (current.credentialOperation ||
          current.status === 'retired' ||
          ['provisioning', 'setting_password'].includes(current.status)))
    )
      throw genericFailure();
    if (action === 'enable' && current.status !== 'suspended') throw genericFailure();
    const version = current.version + 1;
    const reset = action === 'reset' || action === 'repair_reset';
    const status =
      action === 'delete'
        ? 'retired'
        : reset
          ? 'pending'
          : action === 'enable'
            ? resumableStatus(current, existingAuth) === 'pending'
              ? 'pending'
              : 'active'
            : current.status;
    // An interrupted provisioning operation must be reset; enabling never invents a password.
    if (action === 'enable' && !resumableStatus(current, existingAuth)) throw genericFailure();
    tx.update(ref, {
      ...(profile || {}),
      status,
      version,
      updatedAt: at,
      operationId,
      ...(reset ? { initialPasswordEnabled: false } : {}),
      ...(action === 'delete' ? { deletedAt: at } : {}),
      ...credentialLock(operationId, at),
    });
    const auditRef = firestore.collection('hhr_account_audit').doc();
    tx.create(auditRef, {
      actorUid: context.auth.uid,
      targetUid: uid,
      action,
      at,
      ...(profile
        ? {
            previousName: current.name,
            previousRole: current.role,
            name: profile.name,
            role: profile.role,
          }
        : {}),
    });
    return { ...current, ...(profile || {}), status, version, reset };
  });
  // Any uncertain provider result leaves the account locked and inaccessible for repair.
  if (action === 'delete') {
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
    await completeCredentialOperation(firestore, uid, operationId);
    return { success: true };
  }
  await auth.revokeRefreshTokens(uid);
  await auth.updateUser(uid, {
    ...(profile ? { displayName: profile.name } : {}),
    ...(transition.reset ? { disabled: true, password: newSecret() } : {}),
    ...(action === 'enable' ? { disabled: transition.status !== 'active' } : {}),
  });
  await auth.setCustomUserClaims(uid, {
    hhrAccountVersion: transition.version,
    role: transition.role,
  });
  const valid = await firestore.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (current?.credentialOperation !== operationId) throw genericFailure();
    if (current.version !== transition.version || current.status !== transition.status)
      return false;
    tx.update(ref, {
      ...(transition.reset ? { initialPasswordEnabled: true } : {}),
      credentialOperation: null,
      credentialStartedAt: null,
    });
    return true;
  });
  if (!valid) {
    await auth.updateUser(uid, { disabled: true });
    await completeCredentialOperation(firestore, uid, operationId);
    throw genericFailure();
  }
  return { success: true };
};
module.exports = { accountProfile, manageAccountProfile, resumableStatus };
