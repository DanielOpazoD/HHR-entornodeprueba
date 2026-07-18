const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');

const SESSION_SCOPE = 'wound_care_upload_only';
const MAX_BASE64_BYTES = 8 * 1024 * 1024;
// Backstop cap when a session predates the explicit `maxUploads`
// field. Matches the default the application layer now writes
// (see src/application/wound-care/woundCareMobileUploadSessionUseCases.ts).
const FALLBACK_MAX_UPLOADS_PER_SESSION = 50;
// App Check enforcement is gated behind an environment flag rather
// than always-on so the rollout can be staged: deploy the code first
// (with the flag OFF, current behaviour preserved) and flip the flag
// once App Check tokens are confirmed to be flowing from the mobile
// browser. Set `ENFORCE_WOUND_CARE_APP_CHECK=1` in the function's
// runtime config to require a valid App Check token on every call.
// The env var is read on every call (not cached at load time) so it
// can be flipped in production without redeploying and so tests can
// toggle it between cases.
const isAppCheckEnforced = () => process.env.ENFORCE_WOUND_CARE_APP_CHECK === '1';

const requireAppCheckToken = (context, operation) => {
  if (!isAppCheckEnforced()) return;
  if (!context || !context.app) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `App Check token required for ${operation}.`
    );
  }
};

const assertStringField = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }
  return value.trim();
};

const optionalStringField = (value, maxLength = 512) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const decodeBase64 = (value, fieldName) => {
  const base64 = assertStringField(value, fieldName);
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_BASE64_BYTES) {
    throw new functions.https.HttpsError('invalid-argument', `${fieldName} size is invalid.`);
  }
  return buffer;
};

const getHospitalRef = firestore => firestore.collection('hospitals').doc(HOSPITAL_ID);
const getSessionsRef = firestore =>
  getHospitalRef(firestore).collection('woundCareMobileUploadSessions');
const getPhotosRef = firestore => getHospitalRef(firestore).collection('woundCarePhotos');
const getAuditLogsRef = firestore => getHospitalRef(firestore).collection('auditLogs');

const generateId = prefix => `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

const buildStoragePath = ({ hospitalId, patientRut, episodeKey, photoId, suffix }) => {
  const date = new Date().toISOString().slice(0, 10);
  const fileName = suffix === 'thumbnails' ? `${photoId}_thumb.webp` : `${photoId}.webp`;
  return `wound-care/${suffix}/${hospitalId}/${patientRut}/${episodeKey}/${date}/${fileName}`;
};

const normalizeSession = snapshot => {
  if (!snapshot.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid or expired upload link.');
  }

  const session = snapshot.data();
  if (!session || session.scope !== SESSION_SCOPE || session.revokedAt) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid or expired upload link.');
  }

  if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
    throw new functions.https.HttpsError('permission-denied', 'Invalid or expired upload link.');
  }

  return session;
};

const loadValidSession = async (firestore, sessionId) => {
  const snapshot = await getSessionsRef(firestore).doc(sessionId).get();
  return normalizeSession(snapshot);
};

const saveBufferToStorage = async ({ storage, path, buffer, contentType, metadata }) => {
  const bucket = storage.bucket();
  const token = crypto.randomUUID();
  const file = bucket.file(path);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
        ...metadata,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
    bucket.name
  )}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
};

const createMobileActor = data => ({
  uid: 'mobile-qr-upload',
  email: 'mobile-qr-upload@hospitalhangaroa.cl',
  displayName: 'Carga móvil por QR',
  role: 'mobile_upload_session',
  userAgent: optionalStringField(data?.userAgent, 512),
});

const createAuditEntry = ({ session, photoId, requestData }) => ({
  id: generateId('audit'),
  timestamp: new Date().toISOString(),
  userId: 'mobile-qr-upload',
  userDisplayName: 'Carga móvil por QR',
  userUid: null,
  ipAddress: null,
  action: 'WOUND_CARE_PHOTO_UPLOADED',
  entityType: 'woundCarePhoto',
  entityId: photoId,
  summary: `Foto de curación subida por QR para ${session.patientName}`,
  details: {
    patientName: session.patientName,
    patientRut: session.patientRut,
    episodeKey: session.episodeKey,
    sessionId: session.sessionId,
    bodyLocation: optionalStringField(requestData.bodyLocation, 120),
    description: optionalStringField(requestData.description, 500),
    source: 'wound_care_mobile_qr',
    userAgent: optionalStringField(requestData.userAgent, 512),
  },
  recordDate: new Date().toISOString().slice(0, 10),
});

const createValidateSessionAuditEntry = ({ session, requestData, appCheckPresent }) => ({
  id: generateId('audit'),
  timestamp: new Date().toISOString(),
  userId: 'mobile-qr-upload',
  userDisplayName: 'Carga móvil por QR',
  userUid: null,
  ipAddress: null,
  action: 'WOUND_CARE_MOBILE_SESSION_VALIDATED',
  entityType: 'woundCareMobileUploadSession',
  entityId: session.sessionId,
  summary: `QR móvil validado para ${session.patientName}`,
  details: {
    patientName: session.patientName,
    patientRut: session.patientRut,
    episodeKey: session.episodeKey,
    sessionId: session.sessionId,
    source: 'wound_care_mobile_qr',
    userAgent: optionalStringField(requestData?.userAgent, 512),
    appCheckPresent,
    appCheckEnforced: isAppCheckEnforced(),
  },
  recordDate: new Date().toISOString().slice(0, 10),
});

const assertUploadCapacity = session => {
  const max =
    typeof session.maxUploads === 'number' && session.maxUploads > 0
      ? session.maxUploads
      : FALLBACK_MAX_UPLOADS_PER_SESSION;
  const used = typeof session.uploadCount === 'number' ? session.uploadCount : 0;
  if (used >= max) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      `Upload session has reached its limit (${used}/${max}).`
    );
  }
  return { max, used };
};

const createWoundCareMobileUploadFunctions = ({ firestore, storage, FieldValue }) => ({
  validateWoundCareMobileUploadSession: functions.https.onCall(async (data, context) => {
    requireAppCheckToken(context, 'validateWoundCareMobileUploadSession');
    const sessionId = assertStringField(data?.sessionId, 'sessionId');
    const session = await loadValidSession(firestore, sessionId);

    // Observability: every successful validate is auditable, not just
    // the upload itself. Lets ops detect QR scanning patterns or
    // brute-force probing without depending on storage writes.
    try {
      const auditEntry = createValidateSessionAuditEntry({
        session,
        requestData: data,
        appCheckPresent: Boolean(context && context.app),
      });
      await getAuditLogsRef(firestore).doc(auditEntry.id).set(auditEntry);
    } catch (auditError) {
      console.warn('[wound-care] validateSession audit emit failed', auditError);
    }

    return {
      sessionId: session.sessionId,
      episodeKey: session.episodeKey,
      patientRut: session.patientRut,
      patientName: session.patientName,
      expiresAt: session.expiresAt,
      maxUploads:
        typeof session.maxUploads === 'number' && session.maxUploads > 0
          ? session.maxUploads
          : FALLBACK_MAX_UPLOADS_PER_SESSION,
      uploadCount: typeof session.uploadCount === 'number' ? session.uploadCount : 0,
    };
  }),

  uploadWoundCareMobilePhoto: functions.https.onCall(async (data, context) => {
    requireAppCheckToken(context, 'uploadWoundCareMobilePhoto');
    const sessionId = assertStringField(data?.sessionId, 'sessionId');
    const session = await loadValidSession(firestore, sessionId);
    assertUploadCapacity(session);
    const imageBuffer = decodeBase64(data?.imageBase64, 'imageBase64');
    const thumbnailBuffer = decodeBase64(data?.thumbnailBase64, 'thumbnailBase64');

    const mimeType = optionalStringField(data?.mimeType, 80) || 'image/webp';
    if (!mimeType.startsWith('image/')) {
      throw new functions.https.HttpsError('invalid-argument', 'Only image uploads are accepted.');
    }

    const photoId = generateId('wound_photo');
    const uploadedAt = new Date().toISOString();
    const hospitalId = session.hospitalId || HOSPITAL_ID;
    const photoPath = buildStoragePath({
      hospitalId,
      patientRut: session.patientRut,
      episodeKey: session.episodeKey,
      photoId,
      suffix: 'photos',
    });
    const thumbPath = buildStoragePath({
      hospitalId,
      patientRut: session.patientRut,
      episodeKey: session.episodeKey,
      photoId,
      suffix: 'thumbnails',
    });

    const [downloadUrl, thumbnailDownloadUrl] = await Promise.all([
      saveBufferToStorage({
        storage,
        path: photoPath,
        buffer: imageBuffer,
        contentType: mimeType,
        metadata: {
          episodeKey: session.episodeKey,
          patientRut: session.patientRut,
          uploadedViaSessionId: sessionId,
        },
      }),
      saveBufferToStorage({
        storage,
        path: thumbPath,
        buffer: thumbnailBuffer,
        contentType: 'image/webp',
        metadata: {
          episodeKey: session.episodeKey,
          patientRut: session.patientRut,
          uploadedViaSessionId: sessionId,
        },
      }),
    ]);

    const photo = {
      id: photoId,
      patientRut: session.patientRut,
      patientName: session.patientName,
      episodeKey: session.episodeKey,
      storagePath: photoPath,
      thumbnailStoragePath: thumbPath,
      downloadUrl,
      thumbnailDownloadUrl,
      mimeType,
      originalFileSize: Number(data?.originalFileSize) || imageBuffer.length,
      compressedFileSize: Number(data?.compressedFileSize) || imageBuffer.length,
      width: Number(data?.width) || 0,
      height: Number(data?.height) || 0,
      description: optionalStringField(data?.description, 500),
      bodyLocation: optionalStringField(data?.bodyLocation, 120),
      takenAt: optionalStringField(data?.takenAt, 80) || uploadedAt,
      uploadedAt,
      uploadedBy: createMobileActor(data),
      uploadedViaSessionId: sessionId,
      isDeleted: false,
    };

    await getPhotosRef(firestore).doc(photoId).set(photo);
    const auditEntry = createAuditEntry({ session, photoId, requestData: data });
    await getAuditLogsRef(firestore).doc(auditEntry.id).set(auditEntry);

    // Increment the per-session upload counter so the next call hits
    // the cap. Best-effort: a failure to update the counter is logged
    // but does not roll back the photo write — losing one increment is
    // strictly safer than failing an already-persisted upload.
    try {
      const updatePayload = FieldValue && typeof FieldValue.increment === 'function'
        ? { uploadCount: FieldValue.increment(1) }
        : { uploadCount: (typeof session.uploadCount === 'number' ? session.uploadCount : 0) + 1 };
      await getSessionsRef(firestore).doc(sessionId).update(updatePayload);
    } catch (counterError) {
      console.warn('[wound-care] uploadCount increment failed', counterError);
    }

    return { photoId, uploadedAt };
  }),
});

module.exports = {
  createWoundCareMobileUploadFunctions,
};
