const { HttpsError } = require('firebase-functions/v2/https');
const {
  ALLOWED_FIELDS,
  CANONICAL_FIELD_CONTRACT_VERSION,
  CHECKPOINT_FIELD,
  MAX_BATCH_TARGETS,
  applyEstablishedPatchValue,
  assertPersistedDocumentSize,
  canonicalize,
  clonePlainValue,
  compareCodeUnits,
  digestValue,
  establishedPatchValueMatches,
  isPlainObject,
  parseClinicalEnrichmentPayload,
  targetKey,
} = require('./rayenClinicalEnrichmentPayloadParser');

const MAX_RECEIPTS = 16;

const MISMATCH_SECTION_BY_FIELD = Object.freeze({
  devices: 'devices',
  deviceDetails: 'devices',
  deviceInstanceHistory: 'devices',
  evaluationScores: 'scores',
  vitalSigns: 'vitals',
  vitalSignsHistory: 'vitals',
  clinicalSyncCheckpoint: 'checkpoints',
  clinicalCarryover: 'checkpoints',
});

const ADMIN_CUDYR_SOURCE = 'HHR · ajuste administrativo';

const resolveRecordRevision = record => {
  const revision = Number(record?.meta?.revision);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

const toMillis = value => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const assertRecordRevision = (record, payload) => {
  const currentRevision = resolveRecordRevision(record);
  if (payload.baseRevision !== undefined && currentRevision !== payload.baseRevision) {
    throw new HttpsError(
      'aborted',
      `revision_mismatch: expected ${payload.baseRevision}, received ${currentRevision}.`
    );
  }
  if (toMillis(record?.lastUpdated) !== toMillis(payload.expectedLastUpdated)) {
    throw new HttpsError(
      'aborted',
      'version_mismatch: the daily record changed before clinical enrichment.'
    );
  }
  return currentRevision;
};

const assertTargetMatchesEpisode = (record, target) => {
  const bed = record?.beds?.[target.bedId];
  const patient = target.clinicalCrib ? bed?.clinicalCrib : bed;
  if (!isPlainObject(patient) || patient.isBlocked === true) {
    throw new HttpsError('failed-precondition', 'Clinical enrichment target is no longer active.');
  }
  if (String(patient.clinicalEpisodeId || '').trim() !== target.clinicalEpisodeId) {
    throw new HttpsError(
      'failed-precondition',
      'Clinical enrichment target episode no longer matches the census.'
    );
  }
  return patient;
};

const assertHistoricalCudyrPayload = (record, payload) => {
  if (payload.date === payload.authorityDate) return;
  if (payload.checkpoints.length > 0 || payload.patches.length === 0) {
    throw new HttpsError(
      'invalid-argument',
      'Historical clinical enrichment accepts only CUDYR corrections.'
    );
  }
  payload.patches.forEach(target => {
    const patient = assertTargetMatchesEpisode(record, target);
    const fields = Object.keys(target.fields);
    const requestedScores = target.fields.evaluationScores;
    if (
      fields.length !== 1 ||
      fields[0] !== 'evaluationScores' ||
      !isPlainObject(requestedScores) ||
      !Object.prototype.hasOwnProperty.call(requestedScores, 'cudyr') ||
      !isPlainObject(requestedScores.cudyr)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Historical clinical enrichment accepts only canonical CUDYR score values.'
      );
    }
    // Rolling compatibility: the previous frontend echoed the complete score object. Accept that
    // form only when every adjacent score still matches the authoritative record; new clients send
    // the narrower `{ cudyr }` delta and avoid depending on normalized local projections.
    if (Object.keys(requestedScores).length > 1) {
      const currentScores = isPlainObject(patient.evaluationScores)
        ? clonePlainValue(patient.evaluationScores)
        : {};
      const requestedWithoutCudyr = clonePlainValue(requestedScores);
      delete currentScores.cudyr;
      delete requestedWithoutCudyr.cudyr;
      if (canonicalize(currentScores) !== canonicalize(requestedWithoutCudyr)) {
        throw new HttpsError(
          'invalid-argument',
          'Historical CUDYR enrichment cannot modify other evaluation scores.'
        );
      }
    }
  });
};

/**
 * A synchronization proposal cannot replace an administrator-owned CUDYR result. The client
 * normally removes these operations after its authoritative read; this backend fence covers stale
 * or older clients without exposing any patient or clinical value in the error.
 */
const assertAdministrativeCudyrAuthority = (record, payload) => {
  payload.patches.forEach(target => {
    if (!Object.prototype.hasOwnProperty.call(target.fields, 'evaluationScores')) return;
    const requestedScores = target.fields.evaluationScores;
    const patient = assertTargetMatchesEpisode(record, target);
    const currentCudyr = patient?.evaluationScores?.cudyr;
    if (!isPlainObject(currentCudyr) || currentCudyr.source !== ADMIN_CUDYR_SOURCE) return;
    const hasRequestedCudyr =
      isPlainObject(requestedScores) &&
      Object.prototype.hasOwnProperty.call(requestedScores, 'cudyr');
    const preservesAdministrativeCudyr =
      hasRequestedCudyr &&
      isPlainObject(requestedScores.cudyr) &&
      canonicalize(currentCudyr) === canonicalize(requestedScores.cudyr);
    const legacyPatchCannotRemoveCudyr =
      isPlainObject(requestedScores) &&
      Object.keys(requestedScores).length > 0 &&
      !hasRequestedCudyr &&
      payload.fieldContractVersion < CANONICAL_FIELD_CONTRACT_VERSION;
    if (preservesAdministrativeCudyr || legacyPatchCannotRemoveCudyr) return;
    throw new HttpsError(
      'failed-precondition',
      'An administrative CUDYR adjustment cannot be replaced by synchronization.'
    );
  });
};

const resolveHistoricalCudyrTargets = (record, payload) => {
  if (payload.date === payload.authorityDate) return payload.targets;
  return payload.targets.map(target => {
    const patient = assertTargetMatchesEpisode(record, target);
    const currentScores = isPlainObject(patient.evaluationScores)
      ? clonePlainValue(patient.evaluationScores)
      : {};
    return {
      ...target,
      fields: {
        evaluationScores: {
          ...currentScores,
          cudyr: clonePlainValue(target.fields.evaluationScores.cudyr),
        },
      },
    };
  });
};

const applyClinicalEnrichment = (record, patches, fieldContractVersion = 1) => {
  const next = clonePlainValue(record);
  patches.forEach(target => {
    assertTargetMatchesEpisode(next, target);
    const bed = next.beds[target.bedId];
    const patient = target.clinicalCrib ? bed.clinicalCrib : bed;
    Object.entries(target.fields).forEach(([field, value]) => {
      patient[field] = applyEstablishedPatchValue(patient[field], value, fieldContractVersion);
    });
  });
  return next;
};

const clinicalEnrichmentMatches = (record, targets, fieldContractVersion = 1) =>
  targets.every(target => {
    const patient = assertTargetMatchesEpisode(record, target);
    return Object.entries(target.fields).every(([field, value]) =>
      establishedPatchValueMatches(patient[field], value, fieldContractVersion)
    );
  });

const summarizeClinicalEnrichmentMismatches = (record, targets, fieldContractVersion = 1) => {
  const summary = {
    mismatchTargetCount: 0,
    mismatchFieldCount: 0,
    mismatchDeviceFieldCount: 0,
    mismatchScoreFieldCount: 0,
    mismatchVitalFieldCount: 0,
    mismatchCheckpointFieldCount: 0,
  };

  targets.forEach(target => {
    const patient = assertTargetMatchesEpisode(record, target);
    let targetMismatch = false;
    Object.entries(target.fields).forEach(([field, value]) => {
      if (establishedPatchValueMatches(patient[field], value, fieldContractVersion)) return;
      targetMismatch = true;
      summary.mismatchFieldCount += 1;
      const section = MISMATCH_SECTION_BY_FIELD[field];
      if (section === 'devices') summary.mismatchDeviceFieldCount += 1;
      if (section === 'scores') summary.mismatchScoreFieldCount += 1;
      if (section === 'vitals') summary.mismatchVitalFieldCount += 1;
      if (section === 'checkpoints') summary.mismatchCheckpointFieldCount += 1;
    });
    if (targetMismatch) summary.mismatchTargetCount += 1;
  });

  return summary;
};

const resolveReceipts = record =>
  Array.isArray(record?.meta?.clinicalEnrichmentReceipts)
    ? record.meta.clinicalEnrichmentReceipts.filter(isPlainObject)
    : [];

const assertLegacyReplayRevision = (record, payload, receipt) => {
  const currentRevision = resolveRecordRevision(record);
  const isUninterruptedLegacyWrite =
    receipt?.runId === payload.runId &&
    payload.baseRevision !== undefined &&
    currentRevision === payload.baseRevision + 1 &&
    record?.meta?.lastMutationId === receipt?.mutationId &&
    toMillis(record?.lastUpdated) > 0 &&
    toMillis(record?.lastUpdated) === toMillis(receipt?.appliedAt);
  return isUninterruptedLegacyWrite ? currentRevision : assertRecordRevision(record, payload);
};

const classifyIdempotency = (record, payload, batchDigest, compatibleDigests = []) => {
  const acceptedDigests = new Set([batchDigest, ...compatibleDigests]);
  const canonicalContract = payload.fieldContractVersion >= CANONICAL_FIELD_CONTRACT_VERSION;
  const receipts = resolveReceipts(record);
  const classifyReceipt = receipt => {
    if (
      canonicalContract &&
      receipt.fieldContractVersion === payload.fieldContractVersion &&
      receipt.canonicalDigest === batchDigest
    ) {
      return 'idempotent';
    }
    if (!canonicalContract && acceptedDigests.has(receipt.digest)) return 'idempotent';
    if (
      canonicalContract &&
      Number(receipt.fieldContractVersion || 1) < CANONICAL_FIELD_CONTRACT_VERSION &&
      acceptedDigests.has(receipt.digest)
    ) {
      // A rolling v1 instance may have applied the same request using recursive merge semantics.
      // Let the caller compare the canonical v2 value before deciding whether it must converge.
      return 'legacy-replay';
    }
    return 'mismatch';
  };
  const sameMutation = receipts.find(receipt => receipt.mutationId === payload.mutationId);
  if (sameMutation) {
    const classification = classifyReceipt(sameMutation);
    if (sameMutation.runId === payload.runId && classification !== 'mismatch') {
      return { status: classification, receipt: sameMutation };
    }
    throw new HttpsError(
      'failed-precondition',
      'mutationId was already used with a different clinical enrichment payload.'
    );
  }
  const compatibleSameRun = receipts
    .filter(receipt => receipt.runId === payload.runId)
    .map(receipt => ({ receipt, classification: classifyReceipt(receipt) }))
    .find(candidate => candidate.classification !== 'mismatch');
  if (compatibleSameRun) {
    return {
      status: compatibleSameRun.classification,
      receipt: compatibleSameRun.receipt,
    };
  }
  // One synchronization run may be split into several bounded mutations. The mutation identity
  // remains the strict idempotency boundary; a different digest under the same run is a new chunk.
  return { status: 'new', receipt: null };
};

const buildLegacyClinicalEnrichmentDigest = payload => {
  const checkpointsByTarget = new Map(
    payload.checkpoints.map(target => [targetKey(target), target])
  );
  const clinicalKeys = new Set(payload.patches.map(targetKey));
  const patches = payload.patches.map(target => {
    const checkpoint = checkpointsByTarget.get(targetKey(target));
    return checkpoint
      ? {
          ...target,
          fields: {
            ...target.fields,
            [CHECKPOINT_FIELD]: checkpoint.fields[CHECKPOINT_FIELD],
          },
        }
      : target;
  });
  payload.checkpoints.forEach(target => {
    if (!clinicalKeys.has(targetKey(target))) patches.push(target);
  });
  patches.sort(
    (left, right) =>
      compareCodeUnits(left.bedId, right.bedId) ||
      Number(left.clinicalCrib) - Number(right.clinicalCrib)
  );
  return digestValue({ date: payload.date, patches });
};

const buildClinicalEnrichmentMeta = ({ record, payload, batchDigest, canonicalDigest, now }) => {
  const receipts = resolveReceipts(record)
    .filter(receipt => receipt.mutationId !== payload.mutationId)
    .slice(-(MAX_RECEIPTS - 1));
  return {
    ...(isPlainObject(record?.meta) ? clonePlainValue(record.meta) : {}),
    revision: resolveRecordRevision(record) + 1,
    lastMutationId: payload.mutationId,
    lastChangedPaths: payload.targets.flatMap(target =>
      Object.keys(target.fields).map(
        field => `beds.${target.bedId}${target.clinicalCrib ? '.clinicalCrib' : ''}.${field}`
      )
    ),
    updatedAt: now,
    clinicalEnrichmentReceipts: [
      ...receipts,
      {
        runId: payload.runId,
        mutationId: payload.mutationId,
        digest: batchDigest,
        canonicalDigest,
        fieldContractVersion: payload.fieldContractVersion,
        clinicalTargetCount: payload.patches.length,
        checkpointTargetCount: payload.checkpoints.length,
        appliedAt: now,
      },
    ],
  };
};

const hasClinicalReceiptForRun = (record, runId) =>
  resolveReceipts(record).some(receipt => {
    if (receipt.runId !== runId) return false;
    // Receipts written before chunk metadata existed came from the original clinical batch and
    // must conservatively count as a prior clinical snapshot.
    return receipt.clinicalTargetCount === undefined || Number(receipt.clinicalTargetCount) > 0;
  });

const buildHistorySnapshotId = runId => `rayen-clinical-${digestValue(runId).slice(0, 24)}`;

module.exports = {
  ALLOWED_FIELDS,
  MAX_BATCH_TARGETS,
  applyClinicalEnrichment,
  assertAdministrativeCudyrAuthority,
  assertHistoricalCudyrPayload,
  clinicalEnrichmentMatches,
  assertLegacyReplayRevision,
  assertPersistedDocumentSize,
  assertRecordRevision,
  buildClinicalEnrichmentMeta,
  buildHistorySnapshotId,
  buildLegacyClinicalEnrichmentDigest,
  classifyIdempotency,
  digestValue,
  hasClinicalReceiptForRun,
  parseClinicalEnrichmentPayload,
  resolveHistoricalCudyrTargets,
  resolveRecordRevision,
  summarizeClinicalEnrichmentMismatches,
};
