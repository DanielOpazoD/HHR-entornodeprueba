const { randomInt, timingSafeEqual } = require('node:crypto');
const {
  ACCESS,
  PRIVATE,
  INDEX,
  normalizeRut,
  digest,
  randomUUID,
  genericFailure,
  assertPassword,
  audit,
} = require('./accountPolicy');
const { rateLimit } = require('./accountTransport');
const { credentialLock } = require('./accountCredentialOperation');
const { sendRecoveryMail } = require('./accountRecoveryMail');
const RECOVERY = 'hhr_account_recovery';

const createAccountRecovery = ({
  firestore,
  now = Date.now,
  sendMail = sendRecoveryMail,
  finalizePassword,
}) => {
  const requestRecovery = async (data, context) => {
    const rut = normalizeRut(data?.rut);
    await rateLimit(firestore, context, `recovery-request:${digest(rut)}`);
    const challengeId = randomUUID();
    // Every valid RUT takes the same public path; eligibility and email run in the trigger.
    await firestore.runTransaction(async tx => {
      tx.create(firestore.collection(RECOVERY).doc(challengeId), {
        rutHash: digest(rut),
        status: 'requested',
        attempts: 0,
        expiresAt: now() + 10 * 60000,
      });
    });
    return { challengeId };
  };

  const deliverRecovery = async challengeId => {
    const code = String(randomInt(0, 100000000)).padStart(8, '0');
    const challengeRef = firestore.collection(RECOVERY).doc(challengeId);
    const delivery = await firestore.runTransaction(async tx => {
      const challenge = (await tx.get(challengeRef)).data();
      if (challenge?.status !== 'requested') return null;
      if (challenge.expiresAt <= now()) {
        tx.update(challengeRef, { status: 'expired' });
        return null;
      }
      const uid = (await tx.get(firestore.collection(INDEX).doc(challenge.rutHash))).data()?.uid;
      const current = uid ? (await tx.get(firestore.collection(ACCESS).doc(uid))).data() : null;
      const privateData = uid
        ? (await tx.get(firestore.collection(PRIVATE).doc(uid))).data()
        : null;
      if (
        current?.status !== 'active' ||
        current.credentialOperation ||
        !privateData?.recoveryEmail
      ) {
        tx.update(challengeRef, { status: 'unavailable' });
        return null;
      }
      // Claim once before sending. Duplicate trigger deliveries never resend a code.
      tx.update(challengeRef, {
        uid,
        version: current.version,
        codeHash: digest(`${challengeId}:${code}`),
        status: 'issued',
      });
      audit(firestore, tx, 'unauthenticated-recovery', uid, 'password_recovery_requested', now());
      return { uid, email: privateData.recoveryEmail };
    });
    if (!delivery) return;
    try {
      await sendMail({ email: delivery.email, code });
    } catch {
      // An uncertain send cannot be represented as a delivered/usable challenge.
      await firestore.runTransaction(async tx => {
        const challenge = (await tx.get(challengeRef)).data();
        if (challenge?.status === 'issued') {
          tx.update(challengeRef, { status: 'delivery_failed' });
          audit(
            firestore,
            tx,
            'unauthenticated-recovery',
            delivery.uid,
            'password_recovery_delivery_failed',
            now()
          );
        }
      });
    }
  };

  const resetPassword = async (data, context) => {
    const rut = normalizeRut(data?.rut);
    await rateLimit(firestore, context, `recovery-reset:${digest(rut)}`);
    assertPassword(data?.password);
    const id = data?.challengeId;
    const code = data?.code;
    if (
      typeof id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      typeof code !== 'string' ||
      !/^\d{8}$/.test(code)
    )
      throw genericFailure();
    const challengeRef = firestore.collection(RECOVERY).doc(id);
    const operationId = randomUUID();
    const claimed = await firestore.runTransaction(async tx => {
      const challenge = (await tx.get(challengeRef)).data();
      if (
        !challenge ||
        challenge.status === 'consumed' ||
        challenge.expiresAt <= now() ||
        challenge.attempts >= 5
      )
        return null;
      // Unavailable requests perform the same reads and attempt writes as a wrong code.
      const uid = challenge.uid || `recovery-unavailable-${id}`;
      const ref = firestore.collection(ACCESS).doc(uid);
      const account = (await tx.get(ref)).data();
      const privateData = (await tx.get(firestore.collection(PRIVATE).doc(uid))).data();
      const expectedHash = /^[a-f0-9]{64}$/.test(challenge.codeHash || '')
        ? challenge.codeHash
        : digest(`${id}:unavailable`);
      const codeMatches = timingSafeEqual(
        Buffer.from(expectedHash),
        Buffer.from(digest(`${id}:${code}`))
      );
      const eligible =
        challenge.status === 'issued' &&
        account?.status === 'active' &&
        !account.credentialOperation &&
        account.version === challenge.version &&
        privateData?.rut === rut;
      // Commit failed attempts rather than throwing within the transaction and rolling them back.
      if (!eligible || !codeMatches) {
        tx.update(challengeRef, { attempts: challenge.attempts + 1 });
        return null;
      }
      tx.update(challengeRef, { status: 'consumed', consumedAt: now() });
      const version = account.version + 1;
      tx.update(ref, {
        status: 'setting_password',
        version,
        operationId,
        ...credentialLock(operationId, now()),
      });
      audit(firestore, tx, challenge.uid, challenge.uid, 'password_recovery_consumed', now());
      return { uid: challenge.uid, version };
    });
    if (!claimed) throw genericFailure();
    return finalizePassword(claimed.uid, operationId, data.password, claimed.version);
  };
  return { requestRecovery, deliverRecovery, resetPassword };
};
module.exports = { createAccountRecovery };
