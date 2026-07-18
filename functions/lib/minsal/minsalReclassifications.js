const functions = require('firebase-functions/v1');
const { assertSupportedHospitalId } = require('../runtime/hospitalPolicy');
const { normalizeSpecialty } = require('./minsalSpecialty');
const { normalizeMovementReportingSnapshot } = require('./sharedMovementCompatibility');

const MOVEMENT_COLLECTION_BY_KIND = {
  discharge: 'discharges',
  transfer: 'transfers',
  cma: 'cma',
};

const MOVEMENT_KINDS = new Set(Object.keys(MOVEMENT_COLLECTION_BY_KIND));

const isIsoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const buildReclassificationId = ({ date, movementKind, movementId }) =>
  `${date}_${movementKind}_${String(movementId).replace(/[/#?[\]]/g, '_')}`;

const getHospitalCollection = (firestore, hospitalId, collectionName) =>
  firestore.collection('hospitals').doc(hospitalId).collection(collectionName);

const getHeader = (rawRequest, headerName) => {
  if (!rawRequest) return null;
  if (typeof rawRequest.get === 'function') {
    return rawRequest.get(headerName) || null;
  }
  const headers = rawRequest.headers || {};
  return headers[headerName.toLowerCase()] || headers[headerName] || null;
};

const extractClientIp = context => {
  const request = context && context.rawRequest;
  const forwardedFor = getHeader(request, 'x-forwarded-for');
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim() || null;
  }
  return (request && request.ip) || null;
};

const getActor = context => {
  const token = (context && context.auth && context.auth.token) || {};
  return {
    uid: (context && context.auth && context.auth.uid) || '',
    email: typeof token.email === 'string' ? token.email : '',
    name:
      (typeof token.name === 'string' && token.name) ||
      (typeof token.displayName === 'string' && token.displayName) ||
      '',
    tokenRole: typeof token.role === 'string' ? token.role : '',
  };
};

const assertAdminRole = async (context, resolveRoleForEmail) => {
  const actor = getActor(context);
  const role =
    typeof resolveRoleForEmail === 'function'
      ? await resolveRoleForEmail(actor.email)
      : actor.tokenRole;

  if (role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can reclassify statistical specialties.'
    );
  }

  return actor;
};

const parseReclassificationRequest = data => {
  const hospitalId = typeof data?.hospitalId === 'string' ? data.hospitalId.trim() : '';
  const date = typeof data?.date === 'string' ? data.date.trim() : '';
  const movementKind = typeof data?.movementKind === 'string' ? data.movementKind.trim() : '';
  const movementId = typeof data?.movementId === 'string' ? data.movementId.trim() : '';
  const reportingSpecialty =
    typeof data?.reportingSpecialty === 'string' ? data.reportingSpecialty.trim() : '';

  if (!hospitalId || !date || !movementKind || !movementId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required parameters: hospitalId, date, movementKind, movementId.'
    );
  }

  try {
    assertSupportedHospitalId(hospitalId);
  } catch (error) {
    throw new functions.https.HttpsError('permission-denied', error.message);
  }

  if (!isIsoDate(date)) {
    throw new functions.https.HttpsError('invalid-argument', 'date must use YYYY-MM-DD format.');
  }

  if (!MOVEMENT_KINDS.has(movementKind)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported movementKind.');
  }

  return { hospitalId, date, movementKind, movementId, reportingSpecialty };
};

const getActiveMovements = movements =>
  Array.isArray(movements) ? movements.filter(movement => !movement?.deletedAt) : [];

const resolveMovementSpecialty = (movementKind, movement) => {
  if (movementKind === 'cma') {
    return normalizeSpecialty(movement && movement.specialty);
  }
  const normalizedMovement = normalizeMovementReportingSnapshot(movement);
  return normalizeSpecialty(normalizedMovement && normalizedMovement.specialty);
};

const loadMovementForReclassification = async ({
  firestore,
  hospitalId,
  date,
  movementKind,
  movementId,
}) => {
  const recordDoc = await getHospitalCollection(firestore, hospitalId, 'dailyRecords').doc(date).get();
  if (!recordDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Daily census record was not found.');
  }

  const record = recordDoc.data() || {};
  const collectionName = MOVEMENT_COLLECTION_BY_KIND[movementKind];
  const movement = getActiveMovements(record[collectionName]).find(item => item.id === movementId);
  if (!movement) {
    throw new functions.https.HttpsError('not-found', 'Movement was not found for this date.');
  }

  return {
    movement,
    originalSpecialty: resolveMovementSpecialty(movementKind, movement),
  };
};

const buildAuditEntry = ({
  id,
  timestamp,
  actor,
  request,
  originalSpecialty,
  active,
  clientIp,
  userAgent,
}) => ({
  id: `audit_${id}_${Date.now()}`,
  timestamp,
  userId: actor.email || actor.uid || 'unknown',
  userUid: actor.uid || undefined,
  userDisplayName: actor.name || actor.email || undefined,
  ipAddress: clientIp || undefined,
  action: 'STATISTICAL_SPECIALTY_RECLASSIFIED',
  entityType: 'statistics',
  entityId: id,
  recordDate: request.date,
  summary: active
    ? `Reclasificación estadística: ${originalSpecialty} a ${request.reportingSpecialty}`
    : `Reclasificación estadística desactivada: ${originalSpecialty}`,
  details: {
    hospitalId: request.hospitalId,
    date: request.date,
    movementKind: request.movementKind,
    movementId: request.movementId,
    originalSpecialty,
    reportingSpecialty: request.reportingSpecialty || null,
    active,
    clientIp: clientIp || null,
    userAgent: userAgent || null,
  },
});

const persistMinsalSpecialtyReclassification = async ({
  firestore,
  data,
  context,
  resolveRoleForEmail,
}) => {
  const request = parseReclassificationRequest(data);
  const actor = await assertAdminRole(context, resolveRoleForEmail);
  const { originalSpecialty } = await loadMovementForReclassification({ firestore, ...request });
  const id = buildReclassificationId(request);
  const timestamp = new Date().toISOString();
  const active = Boolean(request.reportingSpecialty);
  const clientIp = extractClientIp(context);
  const userAgent = getHeader(context && context.rawRequest, 'user-agent');
  const record = {
    date: request.date,
    movementKind: request.movementKind,
    movementId: request.movementId,
    originalSpecialty,
    reportingSpecialty: active ? normalizeSpecialty(request.reportingSpecialty) : null,
    active,
    updatedAt: timestamp,
    updatedByUid: actor.uid || null,
    updatedByEmail: actor.email || null,
    updatedByName: actor.name || null,
    clientIp,
    userAgent,
  };

  await getHospitalCollection(firestore, request.hospitalId, 'analyticsSpecialtyReclassifications')
    .doc(id)
    .set(record);
  await getHospitalCollection(firestore, request.hospitalId, 'auditLogs')
    .doc()
    .set(
      buildAuditEntry({
        id,
        timestamp,
        actor,
        request: { ...request, reportingSpecialty: record.reportingSpecialty },
        originalSpecialty,
        active,
        clientIp,
        userAgent,
      })
    );

  return { ok: true, active };
};

const loadActiveMinsalSpecialtyReclassifications = async (
  firestore,
  hospitalId,
  startDate,
  endDate
) => {
  const snapshot = await getHospitalCollection(
    firestore,
    hospitalId,
    'analyticsSpecialtyReclassifications'
  )
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();

  const reclassifications = [];
  snapshot.forEach(doc => {
    const data = doc.data() || {};
    if (!data.active || !data.reportingSpecialty) {
      return;
    }
    if (!MOVEMENT_KINDS.has(data.movementKind) || !data.movementId) {
      return;
    }
    reclassifications.push({
      date: data.date,
      movementKind: data.movementKind,
      movementId: data.movementId,
      specialty: data.reportingSpecialty,
      updatedAt: data.updatedAt,
      updatedBy: data.updatedByEmail || data.updatedByName || data.updatedByUid,
    });
  });

  return reclassifications;
};

const buildServerOwnedCalculationOptions = async ({
  firestore,
  hospitalId,
  startDate,
  endDate,
  clientOptions,
}) => ({
  specialtyGroupingMode:
    clientOptions && clientOptions.specialtyGroupingMode === 'group-other'
      ? 'group-other'
      : 'detailed',
  specialtyReclassifications: await loadActiveMinsalSpecialtyReclassifications(
    firestore,
    hospitalId,
    startDate,
    endDate
  ),
});

module.exports = {
  buildReclassificationId,
  buildServerOwnedCalculationOptions,
  loadActiveMinsalSpecialtyReclassifications,
  persistMinsalSpecialtyReclassification,
};
