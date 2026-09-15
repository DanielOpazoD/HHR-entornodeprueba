/**
 * Transiciones de la asignación de especialidad.
 *
 * Tabla de prioridad:
 * - La selección MANUAL siempre gana: puede reemplazar una automática, otra
 *   manual o un valor legacy protegido (incluido elegir el mismo texto — el
 *   origen cambia a manual igualmente).
 * - La asignación AUTOMÁTICA es de un solo uso por episodio: solo confirma
 *   desde `pending`; nunca sobrescribe manual, automática previa ni legacy.
 * - `legacy_protected` es una vista derivada, no un comando escribible.
 * - `pending` nunca se escribe como decisión; describe ausencia de decisión.
 */
import { Specialty } from '@/types/domain/patientClassification';
import type {
  AutomaticReasonCode,
  AutomaticSpecialty,
  ManualSelectionOrigin,
  SpecialtyAssignment,
} from './contracts';
import { isAutomaticSpecialty, SPECIALTY_ASSIGNMENT_SCHEMA_VERSION } from './contracts';

export type TransitionResult =
  | { applied: true; assignment: SpecialtyAssignment }
  | {
      applied: false;
      reason:
        | 'already_locked'
        | 'invalid_specialty'
        | 'missing_episode'
        | 'missing_recommendation'
        | 'stale_revision';
      assignment: SpecialtyAssignment;
    };

const ok = (assignment: SpecialtyAssignment): TransitionResult => ({ applied: true, assignment });
const rejected = (
  reason: Extract<TransitionResult, { applied: false }>['reason'],
  assignment: SpecialtyAssignment
): TransitionResult => ({ applied: false, reason, assignment });

/**
 * Selección manual (directa o aceptando una recomendación de IA vigente).
 * Siempre aplica sobre cualquier estado: la decisión humana es la autoridad
 * final del episodio. `revision` avanza de forma monótona.
 */
export const applyManualSelection = (
  current: SpecialtyAssignment,
  input: {
    value: Specialty | string;
    operationId: string;
    decidedAt: string;
    decidedByUserId: string;
    selectionOrigin: ManualSelectionOrigin;
    recommendationId?: string;
  }
): TransitionResult => {
  if (!current.episodeId.trim()) return rejected('missing_episode', current);
  if (!input.operationId.trim() || !input.decidedByUserId.trim() || !input.decidedAt.trim()) {
    return rejected('invalid_specialty', current);
  }
  if (input.selectionOrigin === 'ai_recommendation' && !input.recommendationId?.trim()) {
    return rejected('missing_recommendation', current);
  }
  // El valor manual admite todo el catálogo, incluido `Otro` y vacío.
  return ok({
    schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
    episodeId: current.episodeId,
    revision: current.revision + 1,
    state: 'manual_locked',
    value: input.value,
    operationId: input.operationId.trim(),
    decidedAt: input.decidedAt,
    decidedByUserId: input.decidedByUserId.trim(),
    selectionOrigin: input.selectionOrigin,
    ...(input.recommendationId?.trim() ? { recommendationId: input.recommendationId.trim() } : {}),
  });
};

/**
 * Confirmación automática de un resultado del resolver. De un solo uso: solo
 * desde `pending`. Reintentar el mismo `operationId` sobre la asignación ya
 * confirmada es idempotente (mismo resultado, sin nueva escritura).
 */
export const applyAutomaticResult = (
  current: SpecialtyAssignment,
  input: {
    specialty: AutomaticSpecialty;
    operationId: string;
    decidedAt: string;
    reasonCode: AutomaticReasonCode;
    ruleId: string;
    ruleSetVersion: string;
    professionalCatalogVersion: string;
    evidenceFingerprint: string;
    evidenceRefs: string[];
  }
): TransitionResult => {
  if (!current.episodeId.trim()) return rejected('missing_episode', current);
  if (!isAutomaticSpecialty(input.specialty)) return rejected('invalid_specialty', current);
  if (!input.operationId.trim() || !input.decidedAt.trim() || !input.ruleId.trim()) {
    return rejected('invalid_specialty', current);
  }
  if (current.state !== 'pending') {
    // Idempotencia por operationId: mismo comando ⇒ mismo resultado sin
    // escribir. Cualquier otro origen confirmado bloquea la automática.
    if (
      current.state === 'automatic_locked' &&
      current.operationId === input.operationId &&
      current.value === input.specialty
    ) {
      return ok(current);
    }
    return rejected('already_locked', current);
  }
  return ok({
    schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
    episodeId: current.episodeId,
    revision: current.revision + 1,
    state: 'automatic_locked',
    value: input.specialty,
    operationId: input.operationId,
    decidedAt: input.decidedAt,
    reasonCode: input.reasonCode,
    ruleId: input.ruleId,
    ruleSetVersion: input.ruleSetVersion,
    professionalCatalogVersion: input.professionalCatalogVersion,
    evidenceFingerprint: input.evidenceFingerprint,
    evidenceRefs: input.evidenceRefs,
  });
};

/**
 * Reconciliación entre la copia entrante y la autoridad remota del mismo
 * episodio: gana la revisión mayor; a igualdad o ausencia remota gana la
 * entrante solo si es una decisión real (no una vista vacía).
 */
export const reconcileEpisodeAssignment = (
  remote: SpecialtyAssignment | undefined,
  incoming: SpecialtyAssignment | undefined
): SpecialtyAssignment | undefined => {
  if (!remote) return incoming;
  if (!incoming) return remote;
  if (remote.episodeId !== incoming.episodeId) return remote;
  if (incoming.revision > remote.revision) return incoming;
  return remote;
};

/** ¿La evidencia/versión bajo la que se calculó sigue siendo la vigente? */
export const isStaleAutomaticEvidence = (
  assignment: SpecialtyAssignment,
  currentFingerprint: string,
  currentRuleSetVersion: string
): boolean =>
  assignment.state === 'automatic_locked' &&
  (assignment.evidenceFingerprint !== currentFingerprint ||
    assignment.ruleSetVersion !== currentRuleSetVersion);
