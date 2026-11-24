const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const {
  requireMatchingSubmissionPayload,
  resolveCleanupNotBefore,
} = require('./documentScannerMediaAndStorage');

const MAX_ACTIVE_DOCUMENTS = 100;
const MAX_SUBMISSIONS_PER_HOUR = 30;
const UPLOAD_LEASE_MS = 5 * 60 * 1000;
const COMPLETION_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

const getHospitalRef = firestore => firestore.collection('hospitals').doc(HOSPITAL_ID);
const getQueueRef = firestore => getHospitalRef(firestore).collection('scannedDocumentQueue');
const getQuotaRef = firestore => getQueueRef(firestore).doc('__quota__');

const reserveDocumentUpload = async ({ firestore, ref, baseRecord, id }) => {
  const nowMs = Date.now();
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() || {} : null;
    if (existing) {
      requireMatchingSubmissionPayload(existing, baseRecord.submissionPayloadHash);
    }
    if (
      existing?.state === 'pending_eloisa' ||
      existing?.state === 'purge_pending' ||
      existing?.state === 'completed'
    ) {
      return { deduplicated: true, record: existing };
    }
    if (existing?.state === 'cleanup_pending') {
      return { cleanupRequired: true, record: existing };
    }
    if (
      existing?.state === 'uploading' &&
      new Date(existing.uploadLeaseExpiresAt || 0).getTime() > nowMs
    ) {
      throw new HttpsError(
        'aborted',
        'Este documento todavía se está subiendo. Espera un momento antes de reintentar.'
      );
    }

    if (existing?.state === 'uploading') {
      const cleanupRecord = {
        id,
        state: 'cleanup_pending',
        storagePath: existing.storagePath || null,
        uploadStartedAt: existing.uploadStartedAt || existing.createdAt || null,
        submissionKeyHash: existing.submissionKeyHash,
        submissionPayloadHash: existing.submissionPayloadHash,
        cleanupRequestedAt: new Date(nowMs).toISOString(),
        cleanupNotBefore: resolveCleanupNotBefore(existing, nowMs),
        quotaSlotHeld: existing.quotaSlotHeld === true,
      };
      transaction.set(ref, cleanupRecord);
      return { cleanupRequired: true, record: cleanupRecord };
    }

    const quotaRef = getQuotaRef(firestore);
    const quotaSnapshot = await transaction.get(quotaRef);
    const quota = quotaSnapshot.exists ? quotaSnapshot.data() || {} : {};
    const windowStartedAtMs = new Date(quota.windowStartedAt || 0).getTime();
    const sameWindow = nowMs - windowStartedAtMs >= 0 && nowMs - windowStartedAtMs < 60 * 60 * 1000;
    const windowSubmissionCount = sameWindow ? Number(quota.windowSubmissionCount || 0) : 0;
    const activeCount = Number(quota.activeCount || 0);
    if (windowSubmissionCount >= MAX_SUBMISSIONS_PER_HOUR) {
      throw new HttpsError(
        'resource-exhausted',
        'Se alcanzó el límite temporal de escaneos. Intenta nuevamente más tarde.'
      );
    }
    if (activeCount >= MAX_ACTIVE_DOCUMENTS) {
      throw new HttpsError(
        'resource-exhausted',
        'La bandeja temporal está llena. Un usuario de HHR debe revisar los documentos pendientes.'
      );
    }

    const uploadLeaseToken = crypto.randomBytes(16).toString('hex');
    const storagePath = `scanned-documents/${HOSPITAL_ID}/${id}/${uploadLeaseToken}.pdf`;
    const record = {
      ...baseRecord,
      storagePath,
      state: 'uploading',
      uploadLeaseToken,
      uploadStartedAt: new Date(nowMs).toISOString(),
      uploadLeaseExpiresAt: new Date(nowMs + UPLOAD_LEASE_MS).toISOString(),
      quotaSlotHeld: true,
    };
    transaction.set(quotaRef, {
      activeCount: activeCount + 1,
      windowStartedAt: sameWindow ? quota.windowStartedAt : new Date(nowMs).toISOString(),
      windowSubmissionCount: windowSubmissionCount + 1,
      updatedAt: new Date(nowMs).toISOString(),
    });
    transaction.set(ref, record);
    return {
      deduplicated: false,
      record,
    };
  });
};

const markOwnedReservationForCleanup = async ({ firestore, ref, uploadLeaseToken }) =>
  firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const record = snapshot.exists ? snapshot.data() || {} : null;
    if (!record || record.uploadLeaseToken !== uploadLeaseToken) return null;
    const cleanupRecord = {
      id: record.id,
      state: 'cleanup_pending',
      storagePath: record.storagePath || null,
      uploadStartedAt: record.uploadStartedAt || record.createdAt || null,
      submissionKeyHash: record.submissionKeyHash,
      submissionPayloadHash: record.submissionPayloadHash,
      cleanupRequestedAt: new Date().toISOString(),
      // file.save() has already settled in this path, so no late writer remains.
      cleanupNotBefore: new Date().toISOString(),
      quotaSlotHeld: record.quotaSlotHeld === true,
    };
    transaction.set(ref, cleanupRecord);
    return cleanupRecord;
  });

const finalizeOwnedReservation = async ({ firestore, ref, uploadLeaseToken, byteSize }) =>
  firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const record = snapshot.exists ? snapshot.data() || {} : null;
    if (!record || record.uploadLeaseToken !== uploadLeaseToken) {
      throw new HttpsError(
        'aborted',
        'La reserva del documento cambió durante la carga. Reintenta.'
      );
    }
    const finalized = {
      ...record,
      state: 'pending_eloisa',
      byteSize,
      uploadLeaseToken: null,
      uploadLeaseExpiresAt: null,
    };
    transaction.set(ref, finalized);
    return finalized;
  });

const markExpiredReservationForCleanup = async ({ firestore, ref }) =>
  firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const record = snapshot.exists ? snapshot.data() || {} : null;
    if (
      !record ||
      record.state !== 'uploading' ||
      new Date(record.uploadLeaseExpiresAt || 0).getTime() > Date.now()
    ) {
      return record?.state === 'cleanup_pending' ? record : null;
    }
    const cleanupRecord = {
      id: record.id,
      state: 'cleanup_pending',
      storagePath: record.storagePath || null,
      uploadStartedAt: record.uploadStartedAt || record.createdAt || null,
      submissionKeyHash: record.submissionKeyHash,
      submissionPayloadHash: record.submissionPayloadHash,
      cleanupRequestedAt: new Date().toISOString(),
      cleanupNotBefore: resolveCleanupNotBefore(record),
      quotaSlotHeld: record.quotaSlotHeld === true,
    };
    transaction.set(ref, cleanupRecord);
    return cleanupRecord;
  });

const purgeCleanupRecord = async ({ firestore, storage, ref, record }) => {
  if (new Date(record.cleanupNotBefore || 0).getTime() > Date.now()) return false;
  if (record.storagePath) {
    try {
      await storage.bucket().file(record.storagePath).delete({ ignoreNotFound: true });
    } catch (_error) {
      return false;
    }
  }
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : null;
    if (
      !current ||
      current.state !== 'cleanup_pending' ||
      current.storagePath !== record.storagePath
    ) {
      return false;
    }
    const quotaRef = getQuotaRef(firestore);
    const quotaSnapshot = current.quotaSlotHeld ? await transaction.get(quotaRef) : null;
    transaction.delete(ref);
    if (current.quotaSlotHeld) {
      const quota = quotaSnapshot?.exists ? quotaSnapshot.data() || {} : {};
      transaction.set(quotaRef, {
        ...quota,
        activeCount: Math.max(0, Number(quota.activeCount || 0) - 1),
        updatedAt: new Date().toISOString(),
      });
    }
    return true;
  });
};

const markDocumentForConfirmedPurge = async ({ firestore, ref, actor }) =>
  firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const record = snapshot.exists ? snapshot.data() || {} : null;
    if (!record) {
      throw new HttpsError('not-found', 'El documento ya no está en la bandeja.');
    }
    if (record.state === 'completed') return { completed: true, record };
    if (record.state === 'purge_pending' && record.storagePath) {
      return { completed: false, record };
    }
    if (record.state !== 'pending_eloisa' || !record.storagePath) {
      throw new HttpsError('failed-precondition', 'El documento no puede purgarse.');
    }
    const purgeRecord = {
      id: record.id,
      state: 'purge_pending',
      storagePath: record.storagePath,
      submissionKeyHash: record.submissionKeyHash,
      submissionPayloadHash: record.submissionPayloadHash,
      quotaSlotHeld: record.quotaSlotHeld === true,
      confirmedAt: new Date().toISOString(),
      confirmedBy: actor.email,
    };
    transaction.set(ref, purgeRecord);
    return { completed: false, record: purgeRecord };
  });

const completeConfirmedPurge = async ({ firestore, storage, ref, record }) => {
  try {
    await storage.bucket().file(record.storagePath).delete({ ignoreNotFound: true });
  } catch (_error) {
    return false;
  }
  return firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? snapshot.data() || {} : null;
    if (current?.state === 'completed') return true;
    if (
      !current ||
      current.state !== 'purge_pending' ||
      current.storagePath !== record.storagePath
    ) {
      return false;
    }
    const quotaRef = getQuotaRef(firestore);
    const quotaSnapshot = current.quotaSlotHeld ? await transaction.get(quotaRef) : null;
    const completedAt = new Date();
    transaction.set(ref, {
      id: current.id,
      state: 'completed',
      submissionKeyHash: current.submissionKeyHash,
      submissionPayloadHash: current.submissionPayloadHash,
      completedAt: completedAt.toISOString(),
      tombstoneExpiresAt: new Date(completedAt.getTime() + COMPLETION_TOMBSTONE_MS).toISOString(),
    });
    if (current.quotaSlotHeld) {
      const quota = quotaSnapshot?.exists ? quotaSnapshot.data() || {} : {};
      transaction.set(quotaRef, {
        ...quota,
        activeCount: Math.max(0, Number(quota.activeCount || 0) - 1),
        updatedAt: completedAt.toISOString(),
      });
    }
    return true;
  });
};

module.exports = {
  completeConfirmedPurge,
  finalizeOwnedReservation,
  getQueueRef,
  markDocumentForConfirmedPurge,
  markExpiredReservationForCleanup,
  markOwnedReservationForCleanup,
  purgeCleanupRecord,
  reserveDocumentUpload,
};
