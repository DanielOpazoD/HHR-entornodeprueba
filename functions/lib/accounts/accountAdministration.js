const { accountProfile, manageAccountProfile, resumableStatus } = require('./accountManagement');
const { HOSPITAL_ID } = require('../runtime/runtimeConfig');
const { https } = require('firebase-functions/v1');
const {
  credentialLock,
  completeCredentialOperation,
  repairCredentialOperation,
} = require('./accountCredentialOperation');
const {
  ACCESS,
  PRIVATE,
  INDEX,
  INVITES,
  POLICY,
  PROTECTED,
  INVITE_MS,
  genericFailure,
  normalizeRut,
  newSecret,
  digest,
  randomUUID,
  audit,
} = require('./accountPolicy');

const createAccountAdministration = ({ auth, firestore, helpers, now = Date.now }) => {
  const assertAdmin = async context => {
    const email = context?.auth?.token?.email;
    if (!context?.auth || (await helpers.resolveRoleForEmail(email, context)) !== 'admin') {
      throw new https.HttpsError(
        'permission-denied',
        'Se requiere una sesión administradora vigente.'
      );
    }
    if (
      !Number.isFinite(context.auth.token.auth_time) ||
      now() / 1000 - context.auth.token.auth_time > 900
    ) {
      throw new https.HttpsError(
        'failed-precondition',
        'Vuelve a ingresar para administrar accesos.'
      );
    }
  };

  const issueInvitation = async (uid, context) => {
    if (typeof uid !== 'string' || !/^hhrn_[a-f0-9-]{36}$/.test(uid)) throw genericFailure();
    const id = randomUUID();
    const secret = newSecret();
    const at = now();
    const ref = firestore.collection(ACCESS).doc(uid);
    await firestore.runTransaction(async tx => {
      const account = (await tx.get(ref)).data();
      if (
        !account ||
        account.credentialOperation ||
        ['retired', 'setting_password'].includes(account.status)
      )
        throw genericFailure();
      const version = account.version + 1;
      tx.update(ref, {
        status: 'pending',
        initialPasswordEnabled: false,
        version,
        updatedAt: at,
        operationId: id,
        ...credentialLock(id, at),
      });
      tx.create(firestore.collection(INVITES).doc(id), {
        uid,
        secretHash: digest(secret),
        expiresAt: at + INVITE_MS,
        version,
        status: 'issued',
      });
      audit(firestore, tx, context.auth.uid, uid, 'invitation_issued', at);
    });
    // The version change denies already-issued HHR tokens even if Auth is unavailable.
    await auth.revokeRefreshTokens(uid);
    await auth.updateUser(uid, { disabled: true });
    const current = await completeCredentialOperation(firestore, uid, id);
    if (current.operationId !== id || current.status !== 'pending') throw genericFailure();
    return { activationToken: `${id}.${secret}`, expiresAt: at + INVITE_MS };
  };

  const createAccount = async (data, context) => {
    await assertAdmin(context);
    const rut = normalizeRut(data?.rut);
    const { name, role } = accountProfile(data);
    if (name.length < 3 || name.length > 120 || data?.identityVerified !== true) {
      throw new https.HttpsError(
        'invalid-argument',
        'Verifica el RUT y nombre con el funcionario antes de habilitarlo.'
      );
    }
    const uid = `hhrn_${randomUUID()}`;
    const index = firestore.collection(INDEX).doc(digest(rut));
    const at = now();
    const operationId = randomUUID();
    await firestore.runTransaction(async tx => {
      if ((await tx.get(index)).exists)
        throw new https.HttpsError(
          'already-exists',
          'El RUT ya tiene una cuenta; revisa su estado.'
        );
      tx.create(index, { uid });
      tx.create(firestore.collection(ACCESS).doc(uid), {
        name,
        role,
        hospitalId: HOSPITAL_ID,
        status: 'provisioning',
        operationId,
        ...credentialLock(operationId, at),
        version: 1,
        createdAt: at,
        updatedAt: at,
      });
      tx.create(firestore.collection(PRIVATE).doc(uid), {
        rut,
        verifiedBy: context.auth.uid,
        verifiedAt: at,
        sourceReference:
          typeof data.sourceReference === 'string' && data.sourceReference.trim()
            ? data.sourceReference.trim().slice(0, 120)
            : 'Verificación individual por administrador',
      });
      audit(firestore, tx, context.auth.uid, uid, 'account_created', at);
    });
    // Opaque internal email: no RUT or personal mailbox is exposed by Firebase tokens.
    await auth.createUser({
      uid,
      email: `${uid}@accounts.hhr.invalid`,
      displayName: name,
      password: newSecret(),
      disabled: true,
    });
    const provisioned = await firestore.runTransaction(async tx => {
      const ref = firestore.collection(ACCESS).doc(uid);
      const current = (await tx.get(ref)).data();
      if (current?.credentialOperation !== operationId) throw genericFailure();
      const valid =
        current.operationId === operationId &&
        current.status === 'provisioning' &&
        current.version === 1;
      // Suspension/retirement during Auth creation must survive its late completion.
      tx.update(ref, {
        ...(valid ? { status: 'pending', initialPasswordEnabled: true } : {}),
        credentialOperation: null,
        credentialStartedAt: null,
      });
      return valid;
    });
    if (!provisioned) throw genericFailure();
    return { uid, username: rut.replace('-', '').toLowerCase(), initialPasswordRequired: true };
  };

  const listAccounts = async (_data, context) => {
    await assertAdmin(context);
    const snapshot = await firestore.collection(ACCESS).limit(501).get();
    if (snapshot.size > 500)
      throw new https.HttpsError(
        'resource-exhausted',
        'El padrón requiere paginación antes de ampliarse.'
      );
    const accounts = await Promise.all(
      snapshot.docs.map(async doc => {
        const privateData = (await firestore.collection(PRIVATE).doc(doc.id).get()).data();
        const { name, status, role, createdAt, updatedAt, credentialOperation } = doc.data();
        let suspendedAuth = null;
        if (status === 'suspended' && !credentialOperation && !doc.data().suspendedFrom) {
          try {
            suspendedAuth = await auth.getUser(doc.id);
          } catch (error) {
            if (error.code !== 'auth/user-not-found') throw error;
          }
        }
        return {
          uid: doc.id,
          name,
          status,
          role,
          createdAt,
          updatedAt,
          rut: privateData?.rut || '',
          recoveryEmail: privateData?.recoveryEmail || '',
          canEnable:
            status === 'suspended' &&
            !credentialOperation &&
            Boolean(resumableStatus(doc.data(), suspendedAuth)),
          deletedAt: doc.data().deletedAt || null,
          recoveryRequired: Boolean(credentialOperation) || status === 'provisioning',
        };
      })
    );
    return {
      accounts,
      individualOnly: (await firestore.doc(POLICY).get()).data()?.enabled === true,
      recentAudit: (
        await firestore.collection('hhr_account_audit').orderBy('at', 'desc').limit(20).get()
      ).docs.map(doc => ({ id: doc.id, ...doc.data() })),
    };
  };

  const manageAccount = async (data, context) => {
    await assertAdmin(context);
    const { uid, action } = data || {};
    if (['reset', 'repair_reset', 'update', 'enable', 'delete'].includes(action))
      return manageAccountProfile({ auth, firestore, now }, data, context);
    if (action === 'invite') return issueInvitation(uid, context);
    if (action === 'recover') {
      if (typeof uid !== 'string' || !/^hhrn_[a-f0-9-]{36}$/.test(uid)) throw genericFailure();
      await repairCredentialOperation({ auth, firestore, now }, uid);
      return issueInvitation(uid, context);
    }
    if (
      !['suspend', 'retire', 'revoke'].includes(action) ||
      typeof uid !== 'string' ||
      !/^hhrn_[a-f0-9-]{36}$/.test(uid)
    )
      throw genericFailure();
    const ref = firestore.collection(ACCESS).doc(uid);
    const operationId = randomUUID();
    const transition = await firestore.runTransaction(async tx => {
      const account = (await tx.get(ref)).data();
      if (
        !account ||
        account.status === 'retired' ||
        (action === 'revoke' && account.credentialOperation)
      )
        throw genericFailure();
      tx.update(ref, {
        status:
          action === 'retire' ? 'retired' : action === 'suspend' ? 'suspended' : account.status,
        version: account.version + 1,
        ...(action === 'suspend' && account.status !== 'suspended'
          ? { suspendedFrom: account.status }
          : {}),
        updatedAt: now(),
        operationId,
        ...(!account.credentialOperation ? credentialLock(operationId, now()) : {}),
      });
      audit(firestore, tx, context.auth.uid, uid, action, now());
      return {
        ownsLock: !account.credentialOperation,
        version: account.version + 1,
        status: account.status,
        role: account.role,
      };
    });
    // An existing credential operation owns all provider writes. Version/state fences
    // revoke immediately; that worker observes the interruption before releasing its lock.
    if (!transition.ownsLock) return { success: true };
    await auth.revokeRefreshTokens(uid);
    if (action === 'revoke' && transition.status === 'active') {
      await auth.setCustomUserClaims(uid, {
        hhrAccountVersion: transition.version,
        role: transition.role,
      });
    }
    if (action !== 'revoke') await auth.updateUser(uid, { disabled: true });
    await completeCredentialOperation(firestore, uid, operationId);
    return { success: true };
  };

  const enableIndividualOnly = async (_data, context) => {
    await assertAdmin(context);
    const protectedGoogle = {};
    const protectedRoles = {};
    for (const email of Object.keys(PROTECTED)) {
      const user = await auth.getUserByEmail(email);
      if (
        user.disabled ||
        !user.emailVerified ||
        !user.providerData.some(provider => provider.providerId === 'google.com')
      ) {
        throw new https.HttpsError(
          'failed-precondition',
          'Verifica ambos accesos Google antes de retirar los accesos antiguos.'
        );
      }
      protectedGoogle[email] = user.uid;
      protectedRoles[user.uid] = PROTECTED[email];
    }
    // Keep a verified administrator at cutover; neither UI nor account endpoints can remove it.
    if (
      context.auth.uid !== protectedGoogle['daniel.opazo@hospitalhangaroa.cl'] ||
      context.auth.token.email_verified !== true ||
      context.auth.token.firebase?.sign_in_provider !== 'google.com'
    )
      throw genericFailure();
    await firestore.runTransaction(async tx => {
      tx.set(firestore.doc(POLICY), {
        enabled: true,
        protectedGoogle,
        protectedRoles,
        enabledAt: now(),
        enabledBy: context.auth.uid,
      });
      audit(firestore, tx, context.auth.uid, context.auth.uid, 'individual_access_enabled', now());
    });
    return { success: true };
  };
  return { createAccount, listAccounts, manageAccount, enableIndividualOnly };
};

module.exports = { createAccountAdministration };
