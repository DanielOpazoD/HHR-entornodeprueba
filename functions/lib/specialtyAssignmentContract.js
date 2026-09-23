/**
 * Contrato CJS de la decisión de especialidad por episodio — gemelo de
 * `src/domain/specialtyAssignment/contracts.ts` para las Cloud Functions
 * (el bundler no procesa TS fuera de src). Valida la forma del parche
 * `specialtyAssignment` y reconcilia la autoridad por episodio:
 *
 * - Solo se ESCRIBEN `manual_locked` y `automatic_locked` con trazabilidad
 *   completa. `pending` es ausencia de decisión y `legacy_protected` es una
 *   vista derivada: ninguno se acepta como valor de parche.
 * - `automatic_locked` exige especialidad elegible (nunca `Otro` ni vacío),
 *   ruleId, versiones de catálogo, huella de evidencia y operationId.
 * - `manual_locked` exige decidedByUserId + operationId + selectionOrigin;
 *   con `ai_recommendation` exige además recommendationId.
 * - La decisión manual gana siempre; la automática solo confirma desde
 *   `pending` o se idempotentiza por operationId.
 */

const SPECIALTY_ASSIGNMENT_SCHEMA_VERSION = 2;

const AUTOMATIC_SPECIALTIES = new Set([
  'Med Interna',
  'Cirugía',
  'Traumatología',
  'Ginecobstetricia',
  'Psiquiatría',
  'Pediatría',
  'Odontología',
]);

const AUTOMATIC_REASON_CODES = new Set([
  'professional',
  'diagnosis',
  'combined',
  'hhr_internal_medicine',
  'diagnosis_memory',
]);

const MANUAL_SELECTION_ORIGINS = new Set(['direct', 'ai_recommendation']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const asString = value => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

const asRevision = value => (Number.isInteger(value) && value >= 0 ? value : undefined);

const asStringArray = value =>
  Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim())
    ? value.map(item => item.trim())
    : undefined;

/**
 * Normaliza el valor de un parche `specialtyAssignment`. Devuelve la forma
 * canónica o `undefined` si el payload no es una decisión escribible válida.
 * Es deliberadamente estricto: un cliente no puede inyectar procedencia
 * (`automatic_locked` sin ruleId/huella, `manual_locked` sin actor, etc.).
 */
const normalizeWritableAssignment = raw => {
  if (!isPlainObject(raw)) return undefined;
  if (raw.schemaVersion !== SPECIALTY_ASSIGNMENT_SCHEMA_VERSION) return undefined;
  const episodeId = asString(raw.episodeId);
  const revision = asRevision(raw.revision);
  if (!episodeId || revision === undefined || revision < 1) return undefined;

  if (raw.state === 'manual_locked') {
    const operationId = asString(raw.operationId);
    const decidedAt = asString(raw.decidedAt);
    const decidedByUserId = asString(raw.decidedByUserId);
    const selectionOrigin = raw.selectionOrigin;
    const recommendationId = asString(raw.recommendationId);
    if (typeof raw.value !== 'string') return undefined;
    if (!operationId || !decidedAt || !decidedByUserId) return undefined;
    if (!MANUAL_SELECTION_ORIGINS.has(selectionOrigin)) return undefined;
    if (selectionOrigin === 'ai_recommendation' && !recommendationId) return undefined;
    return {
      schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
      episodeId,
      revision,
      state: 'manual_locked',
      value: raw.value,
      operationId,
      decidedAt,
      decidedByUserId,
      selectionOrigin,
      ...(recommendationId ? { recommendationId } : {}),
    };
  }

  if (raw.state === 'automatic_locked') {
    const operationId = asString(raw.operationId);
    const decidedAt = asString(raw.decidedAt);
    const reasonCode = raw.reasonCode;
    const ruleId = asString(raw.ruleId);
    const ruleSetVersion = asString(raw.ruleSetVersion);
    const professionalCatalogVersion = asString(raw.professionalCatalogVersion);
    const evidenceFingerprint = asString(raw.evidenceFingerprint);
    const evidenceRefs = asStringArray(raw.evidenceRefs);
    if (!AUTOMATIC_SPECIALTIES.has(raw.value)) return undefined;
    if (!operationId || !decidedAt || !ruleId || !ruleSetVersion) return undefined;
    if (!AUTOMATIC_REASON_CODES.has(reasonCode)) return undefined;
    if (!professionalCatalogVersion || !evidenceFingerprint || !evidenceRefs) return undefined;
    return {
      schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
      episodeId,
      revision,
      state: 'automatic_locked',
      value: raw.value,
      operationId,
      decidedAt,
      reasonCode,
      ruleId,
      ruleSetVersion,
      professionalCatalogVersion,
      evidenceFingerprint,
      evidenceRefs,
    };
  }

  return undefined;
};

/**
 * Normaliza una asignación leída de un documento remoto (incluye los estados
 * no escribibles `pending` y `legacy_protected` para reconciliar).
 */
const normalizeStoredAssignment = raw => {
  const writable = normalizeWritableAssignment(raw);
  if (writable) return writable;
  if (!isPlainObject(raw)) return undefined;
  if (raw.schemaVersion !== SPECIALTY_ASSIGNMENT_SCHEMA_VERSION) return undefined;
  const episodeId = asString(raw.episodeId);
  const revision = asRevision(raw.revision);
  if (!episodeId || revision === undefined) return undefined;

  if (raw.state === 'pending' && (raw.value === '' || raw.value === undefined)) {
    return {
      schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
      episodeId,
      revision,
      state: 'pending',
      value: '',
    };
  }
  if (raw.state === 'legacy_protected' && typeof raw.value === 'string' && raw.value.trim()) {
    if (raw.reasonCode !== 'legacy_origin_unknown') return undefined;
    return {
      schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
      episodeId,
      revision,
      state: 'legacy_protected',
      value: raw.value,
      reasonCode: 'legacy_origin_unknown',
    };
  }
  return undefined;
};

/**
 * Vista derivada de la asignación vigente de un paciente remoto:
 * metadatos válidos → la decisión; specialty sin metadatos → legacy sintética;
 * sin valor → pending.
 */
const deriveRemoteAssignment = patient => {
  const stored = normalizeStoredAssignment(patient?.specialtyAssignment);
  const episodeId = String(patient?.clinicalEpisodeId ?? '').trim();
  if (stored && stored.episodeId === episodeId && episodeId) return stored;
  const legacyValue = String(patient?.specialty ?? '').trim();
  if (legacyValue) {
    return {
      schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
      episodeId,
      revision: 0,
      state: 'legacy_protected',
      value: legacyValue,
      reasonCode: 'legacy_origin_unknown',
    };
  }
  return {
    schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
    episodeId,
    revision: 0,
    state: 'pending',
    value: '',
  };
};

/**
 * Decide si un parche `specialtyAssignment` puede confirmarse sobre el
 * paciente remoto del MISMO episodio. Devuelve:
 * - { ok: true, assignment }            → aceptar (revisión mayor o idempotente)
 * - { ok: true, assignment, idempotent }→ ya aplicado (mismo operationId)
 * - { ok: false, reason }               → rechazo autoritativo
 */
const resolveAssignmentPatchDecision = ({ incoming, remotePatient }) => {
  const remote = deriveRemoteAssignment(remotePatient);
  const remoteEpisodeId = String(remotePatient?.clinicalEpisodeId ?? '').trim();

  // La decisión pertenece al episodio: si la cama ya hospeda a otro episodio,
  // la asignación no se aplica al ocupante nuevo.
  if (incoming.episodeId !== remoteEpisodeId) {
    return { ok: false, reason: 'episode_mismatch' };
  }

  // Idempotencia por operationId sobre el mismo estado/valor.
  if (
    remote.state === incoming.state &&
    remote.operationId &&
    remote.operationId === incoming.operationId &&
    remote.value === incoming.value
  ) {
    return { ok: true, assignment: remote, idempotent: true };
  }

  if (incoming.state === 'automatic_locked') {
    // La automática es de un solo uso: solo confirma desde pending.
    if (remote.state !== 'pending') {
      return { ok: false, reason: 'already_locked' };
    }
    if (remotePatient && String(remotePatient.specialty ?? '').trim()) {
      // Valor previo sin metadatos = legacy protegido, no pisable por la vía
      // automática aunque la vista remota todavía diga pending.
      return { ok: false, reason: 'legacy_value_present' };
    }
    return { ok: true, assignment: incoming };
  }

  // manual_locked: la decisión humana siempre gana, pero la revisión debe ser
  // monótona — una copia atrasada no pisa una corrección más reciente.
  if (remote.revision > 0 && incoming.revision <= remote.revision) {
    return { ok: false, reason: 'stale_revision' };
  }
  return { ok: true, assignment: incoming };
};

/**
 * Reconciliación por episodio en guardados completos: gana la revisión mayor;
 * una copia entrante sin metadatos nunca borra la decisión remota.
 */
const reconcileEpisodeAssignment = (remotePatient, incomingPatient) => {
  const remote = deriveRemoteAssignment(remotePatient);
  const incoming = deriveRemoteAssignment(incomingPatient);
  if (remote.episodeId !== incoming.episodeId) return { assignment: remote, changed: false };
  if (incoming.revision > remote.revision) return { assignment: incoming, changed: true };
  return {
    assignment: remote,
    changed: remote.revision !== incoming.revision || remote.state !== incoming.state,
  };
};

module.exports = {
  SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
  AUTOMATIC_SPECIALTIES,
  deriveRemoteAssignment,
  normalizeWritableAssignment,
  normalizeStoredAssignment,
  reconcileEpisodeAssignment,
  resolveAssignmentPatchDecision,
};
