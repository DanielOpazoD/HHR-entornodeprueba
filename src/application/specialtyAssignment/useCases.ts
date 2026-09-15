/**
 * Casos de uso de asignación de especialidad.
 *
 * Dos comandos separados comparten una sola política:
 * - `setSpecialtyManually`: la decisión humana siempre gana; registra actor,
 *   origen (direct | ai_recommendation) y operationId idempotente.
 * - `assignSpecialtyAutomatically`: corre el resolver dentro de la
 *   transacción y solo confirma si el episodio sigue pendiente.
 *
 * La memoria diagnóstica es una regla `manual_memory` del catálogo
 * versionado: se crea solo con confirmación explícita separada, código
 * CIE-10 validado contra el catálogo y permiso de publicación.
 */
import { Specialty } from '@/types/domain/patientClassification';
import type {
  AutomaticSpecialty,
  ManualSelectionOrigin,
  SpecialtyAssignment,
} from '@/domain/specialtyAssignment/contracts';
import {
  isAutomaticSpecialty,
  SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
} from '@/domain/specialtyAssignment/contracts';
import { normalizeCie10Code } from '@/domain/specialtyAssignment/cie10';
import type { EpisodeEvidence } from '@/domain/specialtyAssignment/evidence';
import { evidenceFingerprint } from '@/domain/specialtyAssignment/evidence';
import type { SpecialtyRule } from '@/domain/specialtyAssignment/ruleContracts';
import {
  activeRulesFor,
  detectRuleConflicts,
  type SpecialtyRuleCatalog,
} from '@/domain/specialtyAssignment/ruleCatalog';
import {
  resolveSpecialtyAssignment,
  type ResolverOutcome,
} from '@/domain/specialtyAssignment/resolver';
import {
  applyAutomaticResult,
  applyManualSelection,
} from '@/domain/specialtyAssignment/transitions';
import type {
  ClockPort,
  EpisodeEvidencePort,
  SpecialtyAssignmentStore,
  SpecialtyRecommendationBackendPort,
  SpecialtyRecommendationStore,
  SpecialtyRuleCatalogStore,
  StoredSpecialtyRecommendation,
} from './ports';

export type SpecialtyCommandOutcome =
  | { status: 'applied'; assignment: SpecialtyAssignment }
  | { status: 'idempotent'; assignment: SpecialtyAssignment }
  | { status: 'kept_locked'; assignment: SpecialtyAssignment }
  | { status: 'pending'; reason: string }
  | { status: 'conflict'; reason: string; remote?: SpecialtyAssignment }
  | { status: 'stale'; reason: string }
  | { status: 'rejected'; reason: string };

const PENDING_VIEW = (episodeId: string): SpecialtyAssignment => ({
  schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION,
  episodeId,
  revision: 0,
  state: 'pending',
  value: Specialty.EMPTY,
});

const episodeIdFromKey = (episodeKey: string): string =>
  episodeKey.startsWith('patient:') || episodeKey.startsWith('crib:')
    ? episodeKey.slice(episodeKey.indexOf(':') + 1)
    : episodeKey;

// ---------------------------------------------------------------------------
// setSpecialtyManually
// ---------------------------------------------------------------------------

export interface SetSpecialtyManuallyInput {
  episodeKey: string;
  /** Revisión del contenedor que el usuario vio al decidir (concurrencia). */
  expectedContainerRevision?: number;
  value: Specialty | string;
  actorUid: string;
  operationId: string;
  selectionOrigin: ManualSelectionOrigin;
  recommendationId?: string;
}

/**
 * Registra la selección manual. La autoridad del episodio decide:
 * - Mismo operationId ya aplicado → idempotente.
 * - El episodio ya tiene una decisión con revisión del contenedor más nueva
 *   que la que el usuario observó → conflicto (revalidar, no pisar).
 * - En cualquier otro caso la decisión manual se aplica, incluso sobre una
 *   automática o una legacy protegida: el humano es la autoridad final.
 */
export const setSpecialtyManually = async (
  input: SetSpecialtyManuallyInput,
  deps: { store: SpecialtyAssignmentStore; clock: ClockPort }
): Promise<SpecialtyCommandOutcome> => {
  if (!input.actorUid.trim()) return { status: 'rejected', reason: 'anonymous_actor' };
  if (!input.operationId.trim()) return { status: 'rejected', reason: 'missing_operation_id' };

  return deps.store.runTransaction(async txn => {
    const remote = await txn.read(input.episodeKey);
    const remoteAssignment = remote?.assignment;
    const remoteRevision = remote?.containerRevision ?? 0;

    if (
      remoteAssignment?.state === 'manual_locked' &&
      remoteAssignment.operationId === input.operationId
    ) {
      return { status: 'idempotent', assignment: remoteAssignment };
    }

    if (
      input.expectedContainerRevision !== undefined &&
      remote &&
      remoteRevision !== input.expectedContainerRevision
    ) {
      return {
        status: 'conflict',
        reason: 'stale_base_revision',
        remote: remoteAssignment,
      };
    }

    const base = remoteAssignment ?? PENDING_VIEW(episodeIdFromKey(input.episodeKey));
    const transition = applyManualSelection(base, {
      value: input.value,
      operationId: input.operationId,
      decidedAt: deps.clock.now().toISOString(),
      decidedByUserId: input.actorUid,
      selectionOrigin: input.selectionOrigin,
      recommendationId: input.recommendationId,
    });
    if (!transition.applied) {
      return { status: 'rejected', reason: transition.reason };
    }
    await txn.write({
      episodeKey: input.episodeKey,
      assignment: transition.assignment,
      containerRevision: remoteRevision + 1,
      expectedContainerRevision: remoteRevision,
    });
    return { status: 'applied', assignment: transition.assignment };
  });
};

// ---------------------------------------------------------------------------
// assignSpecialtyAutomatically
// ---------------------------------------------------------------------------

export interface AssignAutomaticallyInput {
  episodeKey: string;
  operationId: string;
  evidence: EpisodeEvidence;
  rules: SpecialtyRule[];
}

/**
 * Ejecuta el resolver dentro de la transacción sobre el estado FRESCO:
 * una selección manual confirmada mientras se preparaba la evidencia hace
 * que la automática se descarte (nunca pisa el bloqueo).
 */
export const assignSpecialtyAutomatically = async (
  input: AssignAutomaticallyInput,
  deps: { store: SpecialtyAssignmentStore; clock: ClockPort }
): Promise<SpecialtyCommandOutcome & { resolverOutcome?: ResolverOutcome }> => {
  if (!input.operationId.trim()) return { status: 'rejected', reason: 'missing_operation_id' };

  return deps.store.runTransaction(async txn => {
    const remote = await txn.read(input.episodeKey);
    const remoteAssignment = remote?.assignment ?? PENDING_VIEW(episodeIdFromKey(input.episodeKey));
    const remoteRevision = remote?.containerRevision ?? 0;

    const outcome = resolveSpecialtyAssignment({
      existing: remoteAssignment,
      evidence: input.evidence,
      rules: input.rules,
    });

    if (outcome.kind === 'keep_locked') {
      return { status: 'kept_locked', assignment: outcome.assignment, resolverOutcome: outcome };
    }
    if (outcome.kind === 'needs_review') {
      return { status: 'pending', reason: outcome.reason, resolverOutcome: outcome };
    }
    if (outcome.kind === 'insufficient_data') {
      return { status: 'pending', reason: outcome.reason, resolverOutcome: outcome };
    }
    if (outcome.kind === 'configuration_conflict') {
      return {
        status: 'conflict',
        reason: outcome.reason,
        remote: remoteAssignment,
        resolverOutcome: outcome,
      };
    }

    const transition = applyAutomaticResult(remoteAssignment, {
      specialty: outcome.specialty,
      operationId: input.operationId,
      decidedAt: deps.clock.now().toISOString(),
      reasonCode: outcome.reasonCode,
      ruleId: outcome.ruleId,
      ruleSetVersion: outcome.ruleSetVersion,
      professionalCatalogVersion: outcome.professionalCatalogVersion,
      evidenceFingerprint: outcome.evidenceFingerprint,
      evidenceRefs: outcome.evidenceRefs,
    });
    if (!transition.applied) {
      return {
        status: 'kept_locked',
        assignment: transition.assignment,
        resolverOutcome: outcome,
      };
    }
    await txn.write({
      episodeKey: input.episodeKey,
      assignment: transition.assignment,
      containerRevision: remoteRevision + 1,
      expectedContainerRevision: remoteRevision,
    });
    return { status: 'applied', assignment: transition.assignment, resolverOutcome: outcome };
  });
};

// ---------------------------------------------------------------------------
// Publicación de reglas y memoria diagnóstica
// ---------------------------------------------------------------------------

export type RulePublishOutcome =
  | { status: 'published'; catalog: SpecialtyRuleCatalog; rule: SpecialtyRule }
  | { status: 'conflict'; reason: string; conflicts?: ReturnType<typeof detectRuleConflicts> }
  | { status: 'rejected'; reason: string };

/** `Omit` distributivo: preserva la unión por `origin`/`action` de SpecialtyRule. */
type RuleDraft = SpecialtyRule extends infer T
  ? T extends SpecialtyRule
    ? Omit<T, 'revision' | 'approvedBy' | 'approvedAt'>
    : never
  : never;

export interface RuleDraftInput {
  rule: RuleDraft;
  /** La publicación exige aprobación explícita del actor. */
  approve: boolean;
}

/**
 * Publica (crea/actualiza) una regla en el catálogo con incremento
 * transaccional de revisión. Rechaza reglas `active` sin aprobación,
 * resultados no elegibles y conflictos de precedencia con las vigentes.
 */
export const publishSpecialtyRule = async (
  input: RuleDraftInput & { actorUid: string },
  deps: { catalogStore: SpecialtyRuleCatalogStore; clock: ClockPort }
): Promise<RulePublishOutcome> => {
  if (!input.actorUid.trim()) return { status: 'rejected', reason: 'anonymous_actor' };
  const draft = input.rule;
  if (draft.action === 'assign' && !isAutomaticSpecialty(draft.specialty)) {
    return { status: 'rejected', reason: 'invalid_action_specialty' };
  }
  if (input.approve && (!draft.createdBy.trim() || !draft.createdAt.trim())) {
    return { status: 'rejected', reason: 'missing_creator_metadata' };
  }

  const current = (await deps.catalogStore.read()) ?? {
    schemaVersion: 1,
    revision: 0,
    rules: [],
  };
  const now = deps.clock.now().toISOString();
  const existingIndex = current.rules.findIndex(rule => rule.id === draft.id);
  const previous = existingIndex >= 0 ? current.rules[existingIndex] : undefined;

  const nextRule = {
    ...draft,
    revision: (previous?.revision ?? 0) + 1,
    status: input.approve ? 'active' : draft.status === 'disabled' ? 'disabled' : 'draft',
    ...(input.approve ? { approvedBy: input.actorUid, approvedAt: now } : {}),
  } as SpecialtyRule;

  const nextRules = [...current.rules];
  if (existingIndex >= 0) nextRules[existingIndex] = nextRule;
  else nextRules.push(nextRule);

  const candidateCatalog: SpecialtyRuleCatalog = {
    ...current,
    revision: current.revision + 1,
    rules: nextRules,
    updatedAt: now,
  };

  if (nextRule.status === 'active') {
    const conflicts = detectRuleConflicts(nextRules);
    if (conflicts.length > 0) {
      return { status: 'conflict', reason: 'unresolved_rule_conflicts', conflicts };
    }
  }

  try {
    const published = await deps.catalogStore.publish(
      current.revision,
      () => candidateCatalog,
      input.actorUid
    );
    return { status: 'published', catalog: published, rule: nextRule };
  } catch (error) {
    return {
      status: 'conflict',
      reason: error instanceof Error ? error.message : 'catalog_conflict',
    };
  }
};

/** Desactiva una regla/memoria: solo futuras evaluaciones; nunca reescribe decisiones. */
export const disableSpecialtyRule = async (
  input: { ruleId: string; actorUid: string },
  deps: { catalogStore: SpecialtyRuleCatalogStore; clock: ClockPort }
): Promise<RulePublishOutcome> => {
  if (!input.actorUid.trim()) return { status: 'rejected', reason: 'anonymous_actor' };
  const current = await deps.catalogStore.read();
  const rule = current?.rules.find(item => item.id === input.ruleId);
  if (!current || !rule) return { status: 'rejected', reason: 'rule_not_found' };
  const now = deps.clock.now().toISOString();
  const nextRules = current.rules.map(item =>
    item.id === input.ruleId
      ? { ...item, status: 'disabled' as const, revision: item.revision + 1 }
      : item
  );
  try {
    const published = await deps.catalogStore.publish(
      current.revision,
      () => ({
        ...current,
        revision: current.revision + 1,
        rules: nextRules,
        updatedAt: now,
      }),
      input.actorUid
    );
    const updated = published.rules.find(item => item.id === input.ruleId);
    return { status: 'published', catalog: published, rule: updated as SpecialtyRule };
  } catch (error) {
    return {
      status: 'conflict',
      reason: error instanceof Error ? error.message : 'catalog_conflict',
    };
  }
};

// ---------------------------------------------------------------------------
// Memoria diagnóstica: "recordar esta asociación para futuros casos"
// ---------------------------------------------------------------------------

export type RememberAssociationOutcome =
  | { status: 'published'; catalog: SpecialtyRuleCatalog; rule: SpecialtyRule }
  | { status: 'conflict'; reason: string }
  | { status: 'rejected'; reason: string };

/**
 * Crea una regla `manual_memory` a partir de una decisión humana ya tomada.
 * Exige: (a) segunda confirmación explícita (`confirmed === true`), (b)
 * código CIE-10 bien formado y conocido por el catálogo, (c) especialidad
 * elegible (nunca `Otro`/vacío), (d) alcance explícito del establecimiento.
 */
export const rememberDiagnosisAssociation = async (
  input: {
    episodeKey: string;
    diagnosisCode: string;
    diagnosisDescription?: string;
    specialty: string;
    facilityId: string;
    actorUid: string;
    /** Segunda confirmación humana, separada de la selección del paciente. */
    confirmed: boolean;
    expectedCatalogRevision?: number;
  },
  deps: {
    catalogStore: SpecialtyRuleCatalogStore;
    cie10: { isKnownCode(code: string): Promise<boolean>; version(): Promise<string> };
    clock: ClockPort;
    newId: (prefix: string) => string;
  }
): Promise<RememberAssociationOutcome> => {
  if (!input.actorUid.trim()) return { status: 'rejected', reason: 'anonymous_actor' };
  if (!input.confirmed) return { status: 'rejected', reason: 'memory_not_confirmed' };
  if (!input.facilityId.trim()) return { status: 'rejected', reason: 'missing_scope' };

  const normalizedCode = normalizeCie10Code(input.diagnosisCode);
  if (!normalizedCode) return { status: 'rejected', reason: 'invalid_cie10_code' };
  if (!isAutomaticSpecialty(input.specialty)) {
    return { status: 'rejected', reason: 'ineligible_specialty' };
  }
  if (!(await deps.cie10.isKnownCode(normalizedCode))) {
    return { status: 'rejected', reason: 'unknown_cie10_code' };
  }

  const current = await deps.catalogStore.read();
  const baseRevision = current?.revision ?? 0;
  if (
    input.expectedCatalogRevision !== undefined &&
    input.expectedCatalogRevision !== baseRevision
  ) {
    return { status: 'conflict', reason: 'stale_catalog_revision' };
  }

  // Un solo código por memoria desde ficha; ampliar el conjunto requiere
  // otra regla aprobada. Reutiliza la regla existente del mismo código +
  // alcance si ya hay una (actualiza su resultado aprobado), nunca duplica.
  const existing = current?.rules.find(
    rule =>
      rule.origin === 'manual_memory' &&
      rule.facilityId === input.facilityId &&
      rule.match.codes.some(code => normalizeCie10Code(code) === normalizedCode)
  );

  const now = deps.clock.now().toISOString();
  const rule: SpecialtyRule = {
    id: existing?.id ?? deps.newId('mem'),
    facilityId: input.facilityId,
    revision: (existing?.revision ?? 0) + 1,
    status: 'active',
    name: existing?.name ?? `Memoria CIE-10 ${normalizedCode} → ${input.specialty}`,
    reason:
      existing?.reason ??
      `Asociación confirmada manualmente${input.diagnosisDescription ? `: ${input.diagnosisDescription}` : ''}`,
    origin: 'manual_memory',
    match: {
      kind: 'diagnosis',
      codeSystem: 'CIE-10',
      catalogVersion: await deps.cie10.version(),
      codes: [normalizedCode],
      diagnosisRole: 'primary',
      scope: { conditions: [] },
    },
    action: 'assign',
    specialty: input.specialty as AutomaticSpecialty,
    exclusions: existing?.exclusions ?? [],
    priority: existing?.priority ?? 100,
    lifetime: 'no_expiry',
    createdBy: existing?.createdBy ?? input.actorUid,
    createdAt: existing?.createdAt ?? now,
    approvedBy: input.actorUid,
    approvedAt: now,
  };

  const nextRules = existing
    ? (current?.rules ?? []).map(item => (item.id === rule.id ? rule : item))
    : [...(current?.rules ?? []), rule];

  try {
    const published = await deps.catalogStore.publish(
      baseRevision,
      () => ({
        schemaVersion: 1,
        revision: baseRevision + 1,
        rules: nextRules,
        updatedAt: now,
      }),
      input.actorUid
    );
    return { status: 'published', catalog: published, rule };
  } catch (error) {
    return {
      status: 'conflict',
      reason: error instanceof Error ? error.message : 'catalog_conflict',
    };
  }
};

// ---------------------------------------------------------------------------
// Recomendación de IA: solicitud, aceptación, descarte
// ---------------------------------------------------------------------------

export type RequestRecommendationOutcome =
  | { status: 'recommended'; recommendation: StoredSpecialtyRecommendation }
  | { status: 'deduplicated'; recommendation: StoredSpecialtyRecommendation }
  | {
      status:
        | 'disabled'
        | 'unauthorized'
        | 'not_pending'
        | 'insufficient_context'
        | 'budget_exhausted'
        | 'provider_error'
        | 'stale'
        | 'rejected';
      reason?: string;
    };

/**
 * Solicita una recomendación al backend autorizado. Jamás toca la
 * asignación: la IA solo propone y el episodio permanece pendiente.
 */
export const requestSpecialtyRecommendation = async (
  input: {
    episodeKey: string;
    recordDate: string;
    bedId: string;
    target?: 'bed' | 'clinicalCrib';
    clientRequestId: string;
    actorUid: string;
  },
  deps: {
    store: SpecialtyAssignmentStore;
    evidencePort: EpisodeEvidencePort;
    catalogStore: SpecialtyRuleCatalogStore;
    backend: SpecialtyRecommendationBackendPort;
    clock: ClockPort;
  }
): Promise<RequestRecommendationOutcome> => {
  if (!input.actorUid.trim()) return { status: 'rejected', reason: 'anonymous_actor' };

  const snapshot = await deps.store.read(input.episodeKey);
  const current = snapshot?.assignment ?? PENDING_VIEW(episodeIdFromKey(input.episodeKey));
  if (current.state !== 'pending') return { status: 'not_pending' };

  const evidence = await deps.evidencePort.capture(input.episodeKey);
  if (!evidence) return { status: 'insufficient_context', reason: 'evidence_unavailable' };

  const catalog = await deps.catalogStore.read();
  const ruleSetVersion = String(catalog?.revision ?? 0);
  const resolvedRules = catalog ? activeRulesFor(catalog, evidence.facilityId) : [];
  const resolverOutcome = resolveSpecialtyAssignment({
    existing: current,
    evidence,
    rules: resolvedRules,
  });
  // Una regla/memoria vigente ya resuelve: cero llamadas al proveedor.
  if (resolverOutcome.kind === 'assign_by_rule' || resolverOutcome.kind === 'keep_locked') {
    return { status: 'not_pending', reason: 'already_resolved' };
  }
  if (evidence.diagnosis.status === 'read_error') {
    return { status: 'insufficient_context', reason: 'diagnosis_read_error' };
  }

  const fingerprint = evidenceFingerprint(evidence);
  const response = await deps.backend.request({
    recordDate: input.recordDate,
    bedId: input.bedId,
    target: input.target,
    clientRequestId: input.clientRequestId,
    evidenceFingerprint: fingerprint,
    ruleSetVersion,
  });

  if (response.status !== 'ok') {
    return { status: response.status, reason: response.reason };
  }
  return { status: 'recommended', recommendation: response.recommendation };
};

/**
 * Acepta una alternativa de la recomendación: revalida vigencia (estado,
 * episodio, huella de evidencia, revisión de reglas, vencimiento) y registra
 * la decisión como `manual_locked` con `selectionOrigin: 'ai_recommendation'`.
 */
export const acceptSpecialtyRecommendation = async (
  input: {
    episodeKey: string;
    recommendationId: string;
    specialty: string;
    actorUid: string;
    operationId: string;
    expectedContainerRevision?: number;
  },
  deps: {
    store: SpecialtyAssignmentStore;
    recommendations: SpecialtyRecommendationStore;
    evidencePort: EpisodeEvidencePort;
    catalogStore: SpecialtyRuleCatalogStore;
    clock: ClockPort;
  }
): Promise<SpecialtyCommandOutcome> => {
  if (!input.actorUid.trim()) return { status: 'rejected', reason: 'anonymous_actor' };

  const recommendation = await deps.recommendations.get(input.recommendationId);
  if (!recommendation) return { status: 'rejected', reason: 'recommendation_not_found' };
  if (recommendation.episodeKey !== input.episodeKey) {
    return { status: 'rejected', reason: 'episode_mismatch' };
  }
  if (recommendation.status !== 'available') {
    return { status: 'rejected', reason: `recommendation_${recommendation.status}` };
  }
  const now = deps.clock.now();
  if (recommendation.expiresAt && new Date(recommendation.expiresAt).getTime() < now.getTime()) {
    await deps.recommendations
      .transition(
        input.recommendationId,
        ['available'],
        'obsolete',
        input.actorUid,
        now.toISOString()
      )
      .catch(() => undefined);
    return { status: 'rejected', reason: 'recommendation_expired' };
  }
  const candidate = recommendation.candidates.find(item => item.specialty === input.specialty);
  if (!candidate || !isAutomaticSpecialty(candidate.specialty)) {
    return { status: 'rejected', reason: 'candidate_not_in_recommendation' };
  }

  // Revalidar evidencia+reglas vigentes: una recomendación calculada sobre
  // otra huella o revisión es obsoleta y no puede aceptarse.
  const evidence = await deps.evidencePort.capture(input.episodeKey);
  const catalog = await deps.catalogStore.read();
  const currentRuleSetVersion = String(catalog?.revision ?? 0);
  const currentFingerprint = evidence ? evidenceFingerprint(evidence) : '';
  if (
    !evidence ||
    currentFingerprint !== recommendation.evidenceFingerprint ||
    currentRuleSetVersion !== recommendation.ruleSetVersion
  ) {
    await deps.recommendations
      .transition(
        input.recommendationId,
        ['available'],
        'obsolete',
        input.actorUid,
        now.toISOString()
      )
      .catch(() => undefined);
    return { status: 'stale', reason: 'evidence_or_rules_changed' };
  }

  const outcome = await setSpecialtyManually(
    {
      episodeKey: input.episodeKey,
      expectedContainerRevision: input.expectedContainerRevision,
      value: candidate.specialty,
      actorUid: input.actorUid,
      operationId: input.operationId,
      selectionOrigin: 'ai_recommendation',
      recommendationId: input.recommendationId,
    },
    { store: deps.store, clock: deps.clock }
  );
  if (outcome.status === 'applied' || outcome.status === 'idempotent') {
    await deps.recommendations
      .transition(
        input.recommendationId,
        ['available'],
        'accepted',
        input.actorUid,
        now.toISOString()
      )
      .catch(() => undefined);
  }
  return outcome;
};

/** Descarte explícito: la recomendación deja de ser aplicable. */
export const discardSpecialtyRecommendation = async (
  input: { recommendationId: string; actorUid: string },
  deps: { recommendations: SpecialtyRecommendationStore; clock: ClockPort }
): Promise<'discarded' | 'not_found' | 'already_resolved'> => {
  if (!input.actorUid.trim()) return 'not_found';
  try {
    await deps.recommendations.transition(
      input.recommendationId,
      ['available'],
      'discarded',
      input.actorUid,
      deps.clock.now().toISOString()
    );
    return 'discarded';
  } catch (error) {
    return error instanceof Error && error.message.includes('not found')
      ? 'not_found'
      : 'already_resolved';
  }
};
