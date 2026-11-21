/**
 * Temporary scanned-document intake.
 *
 * Mobile callers use the existing prescription QR PIN. Authenticated HHR
 * clinicians can list the queue and, only after visually confirming the file
 * exists in Eloisa, purge the temporary PDF and its identifying metadata.
 */

const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const {
  SUBMIT_TIMEOUT_SECONDS,
  buildImageOnlyPdf,
  createSubmissionPayloadHash,
  decodeJpegPages,
  requireMatchingSubmissionPayload,
  requireString,
  resolvePdfDownloadUrl,
  resolveSubmissionIdentity,
} = require('./documentScannerMediaAndStorage');
const {
  completeConfirmedPurge,
  finalizeOwnedReservation,
  getQueueRef,
  markDocumentForConfirmedPurge,
  markExpiredReservationForCleanup,
  markOwnedReservationForCleanup,
  purgeCleanupRecord,
  reserveDocumentUpload,
} = require('./documentScannerQueueStore');

const ALLOWED_ROLES = new Set(['admin', 'nurse_hospital', 'doctor_urgency', 'doctor_specialist']);

const requireAllowedClinician = async (context, resolveRoleForEmail) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión en HHR.');
  }
  const email = String(context.auth.token?.email || '')
    .toLowerCase()
    .trim();
  const role = email ? await resolveRoleForEmail(email, context) : 'unauthorized';
  if (!ALLOWED_ROLES.has(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'No tienes permiso para gestionar documentos escaneados.'
    );
  }
  return { uid: context.auth.uid, email, role };
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
