const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');

const VALID_SCOPES = new Set(['all', 'upc', 'no-upc']);
const CLOSED_SCOPE_LABELS = {
  all: 'todos',
  upc: 'UPC',
  'no-upc': 'No UPC',
};

const isFirestoreTimestampLike = value =>
  value &&
  typeof value === 'object' &&
  typeof value.toDate === 'function' &&
  typeof value.toMillis === 'function';

const normalizeFirestoreValue = value => {
  if (isFirestoreTimestampLike(value)) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(normalizeFirestoreValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalizeFirestoreValue(nested)])
    );
  }

  return value;
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

const assertScope = rawScope => {
  const scope = assertStringField(rawScope, 'scope');
  if (!VALID_SCOPES.has(scope)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid medical handoff scope.');
  }
  return scope;
};

const getDailyRecordRef = firestore =>
  firestore.collection('hospitals').doc(HOSPITAL_ID).collection('dailyRecords');

const getAuditLogsRef = firestore =>
  firestore.collection('hospitals').doc(HOSPITAL_ID).collection('auditLogs');

const resolveSignatureToken = (record, scope) =>
  record?.medicalSignatureLinkTokenByScope?.[scope] || null;

const resolveScopedMedicalSignature = (record, scope) =>
  record?.medicalSignatureByScope?.[scope] ||
  (scope === 'all' ? record?.medicalSignature || null : null);

const assertSignatureToken = (record, scope, token) => {
  const expectedToken = resolveSignatureToken(record, scope);
  if (!expectedToken || expectedToken !== token) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Invalid or expired medical handoff signature link.'
    );
  }
};

const createAuditEntry = ({ action, entityId, details }) => ({
  id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
  timestamp: new Date().toISOString(),
  userId: 'public-signature-link',
  userDisplayName: 'Firma pública',
  userUid: null,
  ipAddress: null,
  action,
  entityType: 'dailyRecord',
  entityId,
  summary: `Firma médica pública (${CLOSED_SCOPE_LABELS[details.scope] || details.scope})`,
  details,
  recordDate: entityId,
});

const createHandoffSignatureFunctions = ({ firestore }) => ({
  getMedicalHandoffSignaturePayload: functions.https.onCall(async data => {
    const date = assertStringField(data?.date, 'date');
    const scope = assertScope(data?.scope);
    const token = assertStringField(data?.token, 'token');

    const docRef = getDailyRecordRef(firestore).doc(date);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Medical handoff record not found.');
    }

    const record = normalizeFirestoreValue(snapshot.data());
    assertSignatureToken(record, scope, token);

    return {
      record,
      scope,
      alreadySigned: Boolean(resolveScopedMedicalSignature(record, scope)),
    };
  }),

  submitMedicalHandoffSignature: functions.https.onCall(async data => {
    const date = assertStringField(data?.date, 'date');
    const scope = assertScope(data?.scope);
    const token = assertStringField(data?.token, 'token');
    const doctorName = assertStringField(data?.doctorName, 'doctorName');

    const docRef = getDailyRecordRef(firestore).doc(date);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Medical handoff record not found.');
    }

    const record = normalizeFirestoreValue(snapshot.data());
    assertSignatureToken(record, scope, token);

    const existingSignature = resolveScopedMedicalSignature(record, scope);
    if (existingSignature) {
      return {
        scope,
        signature: existingSignature,
        alreadySigned: true,
      };
    }

    const signedAt = new Date().toISOString();
    const signature = {
      doctorName,
      signedAt,
      userAgent: typeof data?.userAgent === 'string' ? data.userAgent.slice(0, 512) : undefined,
    };

    const updatePayload = {
      medicalSignatureByScope: {
        ...(record.medicalSignatureByScope || {}),
        [scope]: signature,
      },
      lastUpdated: signedAt,
    };

    if (scope === 'all') {
      updatePayload.medicalSignature = signature;
    }

    await docRef.set(updatePayload, { merge: true });

    const auditEntry = createAuditEntry({
      action: 'MEDICAL_HANDOFF_SIGNED',
      entityId: date,
      details: {
        doctorName,
        signedAt,
        scope,
        source: 'public_signature_link',
      },
    });
    await getAuditLogsRef(firestore).doc(auditEntry.id).set(auditEntry);

    return {
      scope,
      signature,
      alreadySigned: false,
    };
  }),
});

module.exports = {
  createHandoffSignatureFunctions,
};
