/**
 * Temporary scanned-document intake.
 *
 * Mobile callers use the existing prescription QR PIN. Authenticated HHR
 * clinicians can list the queue and, only after visually confirming the file
 * exists in Eloisa, purge the temporary PDF and its identifying metadata.
 */

const crypto = require('crypto');
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');

const MAX_PDF_BYTES = 6 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 2200;
const MAX_TOTAL_IMAGE_PIXELS = 42 * 1024 * 1024;
const MAX_ACTIVE_DOCUMENTS = 100;
const MAX_SUBMISSIONS_PER_HOUR = 30;
const UPLOAD_LEASE_MS = 5 * 60 * 1000;
const SUBMIT_TIMEOUT_SECONDS = 120;
const CLEANUP_SAFETY_MS = 30 * 1000;
const COMPLETION_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_ROLES = new Set(['admin', 'nurse_hospital', 'doctor_urgency', 'doctor_specialist']);

const optionalString = (value, maxLength) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

const requireString = (value, fieldName, maxLength) => {
  const normalized = optionalString(value, maxLength);
  if (!normalized) {
    throw new functions.https.HttpsError('invalid-argument', `${fieldName} es obligatorio.`);
  }
  return normalized;
};

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const readJpegDimensions = buffer => {
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error('invalid JPEG marker');
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) throw new Error('truncated JPEG segment');
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      throw new Error('invalid JPEG segment');
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) throw new Error('invalid JPEG frame');
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    if (marker === 0xda) break;
    offset += segmentLength;
  }
  throw new Error('JPEG dimensions not found');
};

const decodeJpegPages = (values, expectedPageCount) => {
  if (!Array.isArray(values) || values.length !== expectedPageCount) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Las páginas procesadas no coinciden con la cantidad declarada.'
    );
  }
  let totalBytes = 0;
  let totalPixels = 0;
  const pages = values.map(value => {
    const encoded = typeof value === 'string' ? value.trim() : '';
    if (!encoded || encoded.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) {
      throw new functions.https.HttpsError('invalid-argument', 'Una página no es JPEG válida.');
    }
    const buffer = Buffer.from(encoded, 'base64');
    totalBytes += buffer.length;
    if (
      buffer.length < 4 ||
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff ||
      buffer[buffer.length - 1] !== 0xd9
    ) {
      throw new functions.https.HttpsError('invalid-argument', 'Una página no es JPEG válida.');
    }
    try {
      const { width, height } = readJpegDimensions(buffer);
      totalPixels += width * height;
      if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        throw new Error('JPEG dimensions exceed scanner limits');
      }
    } catch (_error) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Cada página JPEG debe medir como máximo ${MAX_IMAGE_DIMENSION} px por lado.`
      );
    }
    if (totalPixels > MAX_TOTAL_IMAGE_PIXELS) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'El documento supera el límite total de resolución permitido.'
      );
    }
    return buffer;
  });
  if (!totalBytes || totalBytes > MAX_SOURCE_IMAGE_BYTES) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Las páginas deben pesar como máximo ${MAX_SOURCE_IMAGE_BYTES / 1024 / 1024} MB.`
    );
  }
  return pages;
};

const buildImageOnlyPdf = async pageBuffers => {
  try {
    // Scanner PDF generation is optional. Keep pdf-lib out of the process
    // startup graph so unrelated callables do not pay its initialization cost.
    const { PDFDocument } = require('pdf-lib');
    const pdf = await PDFDocument.create();
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 17;
    for (const pageBuffer of pageBuffers) {
      const image = await pdf.embedJpg(pageBuffer.toString('base64'));
      const scale = Math.min(
        (pageWidth - margin * 2) / image.width,
        (pageHeight - margin * 2) / image.height
      );
      const width = image.width * scale;
      const height = image.height * scale;
      const page = pdf.addPage([pageWidth, pageHeight]);
      page.drawImage(image, {
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height,
      });
    }
    const result = Buffer.from(await pdf.save());
    if (!result.length || result.length > MAX_PDF_BYTES) {
      throw new Error('generated PDF exceeds the queue limit');
    }
    return result;
  } catch (_error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'No se pudo construir un PDF seguro con las páginas recibidas.'
    );
  }
};

const getHospitalRef = firestore => firestore.collection('hospitals').doc(HOSPITAL_ID);
const getQueueRef = firestore => getHospitalRef(firestore).collection('scannedDocumentQueue');
const getQuotaRef = firestore => getQueueRef(firestore).doc('__quota__');

const requireAllowedClinician = async (context, resolveRoleForEmail) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión en HHR.');
  }
  const email = String(context.auth.token?.email || '')
    .toLowerCase()
    .trim();
  const role = email ? await resolveRoleForEmail(email) : 'unauthorized';
  if (!ALLOWED_ROLES.has(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'No tienes permiso para gestionar documentos escaneados.'
    );
  }
  return { uid: context.auth.uid, email, role };
};

const resolveSubmissionIdentity = value => {
  const key = requireString(value, 'La clave de envío', 128);
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) {
    throw new functions.https.HttpsError('invalid-argument', 'La clave de envío no es válida.');
  }
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { id: `scan_${hash.slice(0, 32)}`, hash };
};

const resolveCleanupNotBefore = (record, nowMs = Date.now()) => {
  const uploadStartedAtMs = new Date(record.uploadStartedAt || record.createdAt || 0).getTime();
  if (!Number.isFinite(uploadStartedAtMs) || uploadStartedAtMs <= 0) {
    return new Date(nowMs + SUBMIT_TIMEOUT_SECONDS * 1000 + CLEANUP_SAFETY_MS).toISOString();
  }
  return new Date(
    uploadStartedAtMs + SUBMIT_TIMEOUT_SECONDS * 1000 + CLEANUP_SAFETY_MS
  ).toISOString();
};

const createSubmissionPayloadHash = ({
  requestDate,
  sourceDate,
  patientOptionKey,
  patientRut,
  pageCount,
  pageBuffers,
}) => {
  const digest = crypto.createHash('sha256').update(
    JSON.stringify({
      requestDate,
      sourceDate,
      patientOptionKey,
      patientRut,
      pageCount,
    })
  );
  for (const pageBuffer of pageBuffers) digest.update(pageBuffer);
  return digest.digest('hex');
};

const requireMatchingSubmissionPayload = (record, submissionPayloadHash) => {
  if (record?.submissionPayloadHash === submissionPayloadHash) return;
  throw new functions.https.HttpsError(
    'already-exists',
    'La clave de envío ya corresponde a otro documento o paciente. Inicia un nuevo escaneo.'
  );
};

const resolvePdfDownloadUrl = async (storage, storagePath) => {
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);
  const emulatorHost = optionalString(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 255);
  if (process.env.FUNCTIONS_EMULATOR === 'true' || emulatorHost) {
    const effectiveHost = emulatorHost || '127.0.0.1:9199';
    const normalizedHost = effectiveHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const [metadata = {}] = await file.getMetadata();
    let downloadCapability = optionalString(metadata.metadata?.firebaseStorageDownloadTokens, 128);
    if (!downloadCapability) {
      downloadCapability = crypto.randomUUID();
      await file.setMetadata({
        metadata: {
          ...(metadata.metadata || {}),
          firebaseStorageDownloadTokens: downloadCapability,
        },
      });
    }
    return `http://${normalizedHost}/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(
      storagePath
    )}?alt=media&token=${encodeURIComponent(downloadCapability)}`;
  }
  if (typeof file.getSignedUrl !== 'function') return null;
  try {
    const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 15 * 60 * 1000 });
    return url;
  } catch (_error) {
    console.warn('[document-scanner] failed to create temporary download URL');
    return null;
  }
};

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
      throw new functions.https.HttpsError(
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
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Se alcanzó el límite temporal de escaneos. Intenta nuevamente más tarde.'
      );
    }
    if (activeCount >= MAX_ACTIVE_DOCUMENTS) {
      throw new functions.https.HttpsError(
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
      throw new functions.https.HttpsError(
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

const createSubmitScannedDocumentHandler =
  ({ firestore, storage, validatePin, resolvePatientOption }) =>
  async data => {
    const payload = data || {};
    await validatePin(firestore, payload.pin);
    const { id, hash: submissionKeyHash } = resolveSubmissionIdentity(payload.submissionKey);
    const ref = getQueueRef(firestore).doc(id);
    const requestDate = requireString(
      payload.requestDate || payload.sourceDate,
      'La fecha solicitada',
      10
    );
    const sourceDateInput = requireString(payload.sourceDate, 'La fecha de origen', 10);
    const patientOptionKey = requireString(payload.patientOptionKey, 'La cama y paciente', 128);
    const expectedPatientRut = requireString(
      payload.expectedPatientRut,
      'El RUT esperado del paciente',
      32
    );
    const pageCount = Number(payload.pageCount);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 12) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'La cantidad de páginas es inválida.'
      );
    }
    const pageBuffers = decodeJpegPages(payload.pageImagesBase64, pageCount);
    const submissionPayloadHash = createSubmissionPayloadHash({
      requestDate,
      sourceDate: sourceDateInput,
      patientOptionKey,
      patientRut: expectedPatientRut,
      pageCount,
      pageBuffers,
    });
    const existing = await ref.get();
    if (
      existing.exists &&
      (existing.data()?.state === 'pending_eloisa' ||
        existing.data()?.state === 'purge_pending' ||
        existing.data()?.state === 'completed')
    ) {
      const record = existing.data() || {};
      requireMatchingSubmissionPayload(record, submissionPayloadHash);
      return {
        id,
        createdAt: record.createdAt || record.completedAt,
        deduplicated: true,
        completed: record.state === 'purge_pending' || record.state === 'completed',
      };
    }
    const { sourceDate, patient } = await resolvePatientOption(
      firestore,
      requestDate,
      sourceDateInput,
      patientOptionKey,
      expectedPatientRut
    );
    const createdAt = new Date().toISOString();
    const reservationInput = {
      firestore,
      ref,
      id,
      baseRecord: {
        id,
        hospitalId: HOSPITAL_ID,
        bedId: patient.bedId,
        patientName: patient.patientName,
        patientRut: patient.patientRut,
        patientOptionKey: patient.key,
        requestDate,
        sourceDate,
        pageCount,
        createdAt,
        submissionKeyHash,
        submissionPayloadHash,
        uploader: { source: 'qr_pin' },
      },
    };
    let reservation = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      reservation = await reserveDocumentUpload(reservationInput);
      if (reservation.deduplicated) {
        return {
          id,
          createdAt: reservation.record.createdAt || reservation.record.completedAt,
          deduplicated: true,
          completed:
            reservation.record.state === 'purge_pending' ||
            reservation.record.state === 'completed',
        };
      }
      if (!reservation.cleanupRequired) break;
      const cleaned = await purgeCleanupRecord({
        firestore,
        storage,
        ref,
        record: reservation.record,
      });
      if (!cleaned) {
        throw new functions.https.HttpsError(
          'unavailable',
          'Hay una carga anterior pendiente de limpieza. Reintenta más tarde.'
        );
      }
    }
    if (!reservation || reservation.cleanupRequired || reservation.deduplicated) {
      throw new functions.https.HttpsError(
        'unavailable',
        'No se pudo reservar la carga del documento. Reintenta más tarde.'
      );
    }
    const { storagePath, uploadLeaseToken } = reservation.record;
    const file = storage.bucket().file(storagePath);

    try {
      const pdfBuffer = await buildImageOnlyPdf(pageBuffers);
      await file.save(pdfBuffer, {
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'private, max-age=0, no-store',
        },
        resumable: false,
      });
      const finalized = await finalizeOwnedReservation({
        firestore,
        ref,
        uploadLeaseToken,
        byteSize: pdfBuffer.length,
      });
      return { id, createdAt: finalized.createdAt };
    } catch (error) {
      const cleanupRecord = await markOwnedReservationForCleanup({
        firestore,
        ref,
        uploadLeaseToken,
      }).catch(() => null);
      if (cleanupRecord) {
        await purgeCleanupRecord({
          firestore,
          storage,
          ref,
          record: cleanupRecord,
        }).catch(() => false);
      } else {
        // A newer retry may have replaced this expired lease while file.save()
        // was still in flight. Its storage path is lease-unique, so remove that
        // completed attempt even though the queue pointer now belongs elsewhere.
        await file.delete({ ignoreNotFound: true }).catch(() => undefined);
      }
      throw error;
    }
  };

const markDocumentForConfirmedPurge = async ({ firestore, ref, actor }) =>
  firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const record = snapshot.exists ? snapshot.data() || {} : null;
    if (!record) {
      throw new functions.https.HttpsError('not-found', 'El documento ya no está en la bandeja.');
    }
    if (record.state === 'completed') return { completed: true, record };
    if (record.state === 'purge_pending' && record.storagePath) {
      return { completed: false, record };
    }
    if (record.state !== 'pending_eloisa' || !record.storagePath) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'El documento no puede purgarse.'
      );
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
  await storage.bucket().file(record.storagePath).delete({ ignoreNotFound: true });
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

const createListScannedDocumentsHandler =
  ({ firestore, storage, resolveRoleForEmail }) =>
  async (_data, context) => {
    await requireAllowedClinician(context, resolveRoleForEmail);
    const snapshot = await getQueueRef(firestore).get();
    const records = [];
    const cleanupCandidates = [];
    const confirmedPurgeCandidates = [];
    const expiredTombstones = [];
    snapshot.forEach(doc => {
      const value = doc.data() || {};
      if (value.state === 'pending_eloisa') records.push(value);
      if (
        value.state === 'uploading' &&
        new Date(value.uploadLeaseExpiresAt || 0).getTime() <= Date.now()
      ) {
        cleanupCandidates.push(value);
      }
      if (value.state === 'cleanup_pending') cleanupCandidates.push(value);
      if (value.state === 'purge_pending' && value.storagePath) {
        confirmedPurgeCandidates.push(value);
      }
      if (
        value.state === 'completed' &&
        new Date(value.tombstoneExpiresAt || 0).getTime() <= Date.now()
      )
        expiredTombstones.push(value);
    });
    await Promise.all(
      cleanupCandidates.map(async record => {
        const ref = getQueueRef(firestore).doc(record.id);
        const cleanupRecord = await markExpiredReservationForCleanup({
          firestore,
          ref,
        });
        if (cleanupRecord)
          await purgeCleanupRecord({ firestore, storage, ref, record: cleanupRecord });
      })
    );
    await Promise.all(
      confirmedPurgeCandidates.map(record =>
        completeConfirmedPurge({
          firestore,
          storage,
          ref: getQueueRef(firestore).doc(record.id),
          record,
        }).catch(() => false)
      )
    );
    await Promise.all(
      expiredTombstones.map(record =>
        firestore.runTransaction(async transaction => {
          const ref = getQueueRef(firestore).doc(record.id);
          const current = await transaction.get(ref);
          const value = current.exists ? current.data() || {} : null;
          if (
            value?.state === 'completed' &&
            new Date(value.tombstoneExpiresAt || 0).getTime() <= Date.now()
          )
            transaction.delete(ref);
        })
      )
    );
    records.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const documents = await Promise.all(
      records.map(async record => ({
        id: record.id,
        bedId: record.bedId,
        patientName: record.patientName,
        patientRut: record.patientRut,
        pageCount: record.pageCount,
        byteSize: record.byteSize,
        createdAt: record.createdAt,
        state: record.state,
        downloadUrl: await resolvePdfDownloadUrl(storage, record.storagePath),
      }))
    );
    return { documents };
  };

const createConfirmScannedDocumentUploadedHandler =
  ({ firestore, storage, resolveRoleForEmail }) =>
  async (data, context) => {
    const actor = await requireAllowedClinician(context, resolveRoleForEmail);
    const id = requireString(data?.id, 'El identificador', 96);
    if (data?.confirmedInEloisa !== true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Debes confirmar que el documento aparece correctamente en Eloísa.'
      );
    }
    const ref = getQueueRef(firestore).doc(id);
    const marked = await markDocumentForConfirmedPurge({ firestore, ref, actor });
    if (marked.completed) return { ok: true, purged: true, deduplicated: true };
    const completed = await completeConfirmedPurge({
      firestore,
      storage,
      ref,
      record: marked.record,
    });
    if (!completed) {
      throw new functions.https.HttpsError(
        'unavailable',
        'La eliminación quedó pendiente y se reintentará de forma segura.'
      );
    }
    console.info('[document-scanner] temporary document purged after Eloisa confirmation', {
      documentId: id,
      confirmedBy: actor.uid,
    });
    return { ok: true, purged: true };
  };

const createDocumentScannerFunctions = ({
  firestore,
  storage,
  resolveRoleForEmail,
  validatePin,
  resolvePatientOption,
}) => ({
  submitScannedDocument: functions.runWith({ timeoutSeconds: SUBMIT_TIMEOUT_SECONDS }).https.onCall(
    createSubmitScannedDocumentHandler({
      firestore,
      storage,
      validatePin,
      resolvePatientOption,
    })
  ),
  listScannedDocuments: functions.https.onCall(
    createListScannedDocumentsHandler({ firestore, storage, resolveRoleForEmail })
  ),
  confirmScannedDocumentUploaded: functions.https.onCall(
    createConfirmScannedDocumentUploadedHandler({ firestore, storage, resolveRoleForEmail })
  ),
});

module.exports = {
  createDocumentScannerFunctions,
  createSubmitScannedDocumentHandler,
  createListScannedDocumentsHandler,
  createConfirmScannedDocumentUploadedHandler,
  decodeJpegPages,
  buildImageOnlyPdf,
  resolvePdfDownloadUrl,
};
