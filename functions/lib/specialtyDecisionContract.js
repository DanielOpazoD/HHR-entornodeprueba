// Clinical specialty is a scalar on the patient. This module protects its
// provenance inside the existing DailyRecord transaction; it is not a second
// patient store or a client-side rule engine.
const SPECIALTIES = new Set([
  '',
  'Med Interna',
  'Cirugía',
  'Traumatología',
  'Ginecobstetricia',
  'Psiquiatría',
  'Pediatría',
  'Odontología',
  'Otro',
]);
const TARGETS = ['bed', 'clinicalCrib'];
const text = value => (typeof value === 'string' ? value.trim() : '');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class SpecialtyDecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpecialtyDecisionError';
    this.code = code;
  }
}

const getPatient = (record, bedId, target) =>
  target === 'clinicalCrib' ? record?.beds?.[bedId]?.clinicalCrib : record?.beds?.[bedId];

const parseSpecialtyIntent = value => {
  if (value === undefined || value === null) return null;
  if (
    !object(value) ||
    !['manual', 'accept_ai'].includes(value.kind) ||
    !TARGETS.includes(value.target)
  ) {
    throw new SpecialtyDecisionError('invalid-argument', 'Invalid specialty intent.');
  }
  const bedId = text(value.bedId);
  const episodeId = text(value.episodeId);
  const specialty = value.value;
  if (
    !bedId ||
    bedId.includes('.') ||
    !episodeId ||
    episodeId.length > 160 ||
    !SPECIALTIES.has(specialty) ||
    !(
      value.expectedDecisionId === null ||
      (typeof value.expectedDecisionId === 'string' && value.expectedDecisionId.length <= 120)
    )
  ) {
    throw new SpecialtyDecisionError('invalid-argument', 'Invalid specialty intent fields.');
  }
  if (
    value.kind === 'accept_ai' &&
    (typeof value.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{12,100}$/.test(value.requestId) ||
      !specialty ||
      specialty === 'Otro')
  ) {
    throw new SpecialtyDecisionError('invalid-argument', 'Invalid Jev acceptance.');
  }
  return {
    kind: value.kind,
    bedId,
    target: value.target,
    episodeId,
    value: specialty,
    expectedDecisionId: value.expectedDecisionId,
    ...(value.kind === 'accept_ai' ? { requestId: value.requestId } : {}),
  };
};

const sameMeta = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const validExistingMeta = (meta, patient) =>
  object(meta) &&
  meta.schemaVersion === 3 &&
  text(meta.episodeId) === text(patient?.clinicalEpisodeId) &&
  Boolean(text(meta.decisionId)) &&
  /^\d{4}-\d{2}-\d{2}$/.test(text(meta.recordDate)) &&
  ['manual', 'rule', 'manual_ai'].includes(meta.source);

// An episode-less record can still be an occupied legacy patient. Preserve its
// scalar only when the occupant and admission anchor are unchanged; otherwise
// require a confirmed episode instead of carrying it to a replacement patient.
const sameLegacyOccupant = (remote, candidate) => {
  const name = text(remote?.patientName).toLowerCase();
  const candidateName = text(candidate?.patientName).toLowerCase();
  const document = text(remote?.rut)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const candidateDocument = text(candidate?.rut)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const admission = text(remote?.firstSeenDate || remote?.admissionDate);
  const candidateAdmission = text(candidate?.firstSeenDate || candidate?.admissionDate);
  return Boolean(
    admission &&
    admission === candidateAdmission &&
    text(remote?.admissionTime) === text(candidate?.admissionTime) &&
    (document || candidateDocument
      ? document && document === candidateDocument && (!name || name === candidateName)
      : name && name === candidateName)
  );
};

const eachTarget = (record, fn) => {
  for (const bedId of Object.keys(record?.beds || {})) {
    for (const target of TARGETS) {
      const patient = getPatient(record, bedId, target);
      if (object(patient)) fn({ bedId, target, patient });
    }
  }
};

/**
 * Mutates a fresh candidate built inside the authoritative transaction.
 * No metadata supplied by a client is promoted to trusted provenance.
 */
const protectSpecialtyDecisions = ({
  remoteRecord,
  priorRecord,
  candidate,
  intent,
  patch,
  actorUid,
  mutationId,
  now,
  aiDecision,
  guardScalarChanges = true,
}) => {
  const decisions = [];
  let intentApplied = false;
  if (intent) {
    const scalarPath =
      intent.target === 'clinicalCrib'
        ? `beds.${intent.bedId}.clinicalCrib.specialty`
        : `beds.${intent.bedId}.specialty`;
    if (
      !patch ||
      Object.keys(patch).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(patch, scalarPath)
    ) {
      throw new SpecialtyDecisionError(
        'invalid-argument',
        'A specialty decision must be the only change in its patch.'
      );
    }
  }
  eachTarget(candidate, ({ bedId, target, patient }) => {
    const remote = getPatient(remoteRecord, bedId, target);
    const episodeId = text(patient.clinicalEpisodeId);
    const remoteEpisodeId = text(remote?.clinicalEpisodeId);
    const sameEpisode = episodeId && episodeId === remoteEpisodeId;
    const isIntentTarget = Boolean(intent && intent.bedId === bedId && intent.target === target);
    const scalarPath =
      target === 'clinicalCrib'
        ? `beds.${bedId}.clinicalCrib.specialty`
        : `beds.${bedId}.specialty`;

    if (isIntentTarget) {
      if (!sameEpisode || !object(remote) || !episodeId || intent.episodeId !== episodeId) {
        throw new SpecialtyDecisionError('aborted', 'Specialty episode changed.');
      }
      if (
        !patch ||
        !Object.prototype.hasOwnProperty.call(patch, scalarPath) ||
        patch[scalarPath] !== intent.value ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(text(mutationId)) ||
        !text(actorUid)
      ) {
        throw new SpecialtyDecisionError(
          'invalid-argument',
          'Specialty intent does not match patch.'
        );
      }
      const currentMeta = validExistingMeta(remote.specialtyAssignment, remote)
        ? remote.specialtyAssignment
        : null;
      if ((currentMeta?.decisionId ?? null) !== intent.expectedDecisionId) {
        throw new SpecialtyDecisionError('aborted', 'Specialty decision changed.');
      }
      if (
        intent.kind === 'manual' &&
        currentMeta?.source === 'manual' &&
        text(remote.specialty) === intent.value
      ) {
        throw new SpecialtyDecisionError(
          'failed-precondition',
          'Specialty was already manually confirmed for this episode.'
        );
      }
      if (
        intent.kind === 'accept_ai' &&
        (!aiDecision ||
          aiDecision.requestId !== intent.requestId ||
          currentMeta ||
          text(remote.specialty))
      ) {
        throw new SpecialtyDecisionError('aborted', 'Jev suggestion is no longer acceptable.');
      }
      // Malformed metadata or a legacy scalar is protected but can be corrected
      // by an explicit human action from a fresh authoritative view.
      const nextMeta = {
        schemaVersion: 3,
        episodeId,
        decisionId: mutationId,
        recordDate: candidate.date,
        source: intent.kind === 'accept_ai' ? 'manual_ai' : 'manual',
        actorUid,
        decidedAt: now,
        ...(aiDecision ? { ai: aiDecision } : {}),
      };
      patient.specialty = intent.value;
      patient.specialtyAssignment = nextMeta;
      decisions.push({
        bedId,
        target,
        episodeId,
        decisionId: mutationId,
        recordDate: candidate.date,
        metadata: nextMeta,
        previousValue: text(remote.specialty),
        value: intent.value,
        source: nextMeta.source,
        actorUid,
        decidedAt: now,
        ...(aiDecision ? { ai: aiDecision } : {}),
      });
      intentApplied = true;
      return;
    }

    if (sameEpisode) {
      if (remote.specialtyAssignment !== undefined) {
        // Preserve trusted metadata even when an old client submits a full
        // snapshot that omitted it. Reject attempts to alter it.
        if (
          patient.specialtyAssignment !== undefined &&
          !sameMeta(patient.specialtyAssignment, remote.specialtyAssignment)
        ) {
          throw new SpecialtyDecisionError(
            'failed-precondition',
            'Specialty metadata is server-owned.'
          );
        }
        patient.specialtyAssignment = remote.specialtyAssignment;
      } else if (patient.specialtyAssignment !== undefined) {
        throw new SpecialtyDecisionError(
          'failed-precondition',
          'Specialty metadata is server-owned.'
        );
      }
      const scalarProtected = guardScalarChanges || remote.specialtyAssignment != null;
      if (scalarProtected && text(patient.specialty) !== text(remote.specialty)) {
        throw new SpecialtyDecisionError(
          'failed-precondition',
          'Specialty change requires explicit intent.'
        );
      }
      if (scalarProtected) patient.specialty = remote.specialty;
      return;
    }

    if (
      guardScalarChanges &&
      !remoteEpisodeId &&
      object(remote) &&
      (text(remote.specialty) || remote.specialtyAssignment != null)
    ) {
      const candidateOccupied = Boolean(text(patient.patientName) || text(patient.rut));
      if (candidateOccupied && sameLegacyOccupant(remote, patient)) {
        if (remote.specialtyAssignment != null || patient.specialtyAssignment != null) {
          throw new SpecialtyDecisionError(
            'failed-precondition',
            'Episode-less specialty provenance cannot be verified.'
          );
        }
        if (
          patch &&
          Object.prototype.hasOwnProperty.call(patch, scalarPath) &&
          text(patient.specialty) !== text(remote.specialty)
        ) {
          throw new SpecialtyDecisionError(
            'failed-precondition',
            'Specialty change requires explicit intent.'
          );
        }
        patient.specialty = remote.specialty;
        return;
      }
      if (candidateOccupied && !episodeId) {
        throw new SpecialtyDecisionError(
          'failed-precondition',
          'A protected legacy specialty requires a confirmed replacement episode.'
        );
      }
    }

    if (
      remoteEpisodeId &&
      !episodeId &&
      (text(patient.patientName) || text(patient.rut)) &&
      (remote.specialtyAssignment != null || text(remote.specialty))
    ) {
      throw new SpecialtyDecisionError(
        'failed-precondition',
        'A protected specialty requires a confirmed replacement episode.'
      );
    }

    // Movement or day-copy may carry an already confirmed decision. A truly
    // new episode starts pending; a client-supplied scalar is never authority.
    let prior = null;
    let priorFromPreviousDay = false;
    if (episodeId) {
      for (const sourceRecord of [remoteRecord, priorRecord]) {
        eachTarget(sourceRecord, ({ patient: previous }) => {
          if (!prior && text(previous.clinicalEpisodeId) === episodeId) {
            prior = previous;
            priorFromPreviousDay = sourceRecord === priorRecord;
          }
        });
      }
    }
    if (patient.specialtyAssignment != null) {
      if (
        !prior ||
        !validExistingMeta(prior.specialtyAssignment, prior) ||
        !sameMeta(patient.specialtyAssignment, prior.specialtyAssignment) ||
        (!priorFromPreviousDay && text(patient.specialty) !== text(prior.specialty))
      ) {
        throw new SpecialtyDecisionError(
          'failed-precondition',
          'Specialty metadata requires a confirmed episode.'
        );
      }
      if (priorFromPreviousDay) patient.specialty = prior.specialty;
      return;
    }
    if (prior?.specialtyAssignment != null) {
      if (
        !validExistingMeta(prior.specialtyAssignment, prior) ||
        (!priorFromPreviousDay && text(patient.specialty) !== text(prior.specialty))
      ) {
        throw new SpecialtyDecisionError('failed-precondition', 'Confirmed specialty changed.');
      }
      // Only the first import of a new day may replace Eloísa's suggestion with
      // yesterday's confirmed value for the exact same clinical episode.
      patient.specialty = prior.specialty;
      patient.specialtyAssignment = prior.specialtyAssignment;
    }
    if (guardScalarChanges) patient.specialty = prior ? text(prior.specialty) : '';
  });
  if (intent && !intentApplied) {
    throw new SpecialtyDecisionError('aborted', 'Specialty target is no longer present.');
  }
  return decisions;
};

module.exports = {
  SPECIALTIES,
  SpecialtyDecisionError,
  parseSpecialtyIntent,
  protectSpecialtyDecisions,
  getPatient,
  validExistingMeta,
};
