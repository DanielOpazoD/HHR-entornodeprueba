/**
 * Resolver determinista de especialidad. Mismas entradas + misma versión de
 * reglas → mismo resultado. Nunca produce `Otro` ni vacío; nunca reclasifica
 * una decisión confirmada; nunca inventa umbrales ni mapeos.
 *
 * Orden de evaluación (informe §8):
 *  1. Decisión vigente (manual/automática/legacy) → conservar y salir.
 *  2. Integridad de la evidencia: error de lectura ≠ diagnóstico ausente.
 *  3. Restricciones duras y exclusiones de alcance.
 *  4. Memoria exacta aprobada (reglas manual_memory), precedencia explícita.
 *  5. Reglas generales CIE-10 + autoría + require_manual por precedencia.
 *  6. Cobertura local de Med Interna SOLO vía regla aprobada explícita.
 *  7. Resultado inequívoco → propuesta de confirmación automática única.
 */
import type { AutomaticSpecialty, SpecialtyAssignment } from './contracts';
import { Specialty } from '@/types/domain/patientClassification';
import type { EpisodeEvidence } from './evidence';
import { eligibleProfessionalSpecialties, evidenceFingerprint } from './evidence';
import type { DiagnosisMatch, SpecialtyRule, StructuredScope } from './ruleContracts';
import { isExcludedBy, scopeAllows } from './ruleCatalog';
import { normalizeCie10Code } from './cie10';

export type ResolverOutcome =
  | { kind: 'keep_locked'; assignment: SpecialtyAssignment }
  | {
      kind: 'assign_by_rule';
      specialty: AutomaticSpecialty;
      ruleId: string;
      ruleSetVersion: string;
      professionalCatalogVersion: string;
      reasonCode:
        | 'professional'
        | 'diagnosis'
        | 'combined'
        | 'hhr_internal_medicine'
        | 'diagnosis_memory';
      evidenceFingerprint: string;
      evidenceRefs: string[];
    }
  | {
      kind: 'needs_review';
      reason:
        | 'require_manual_rule'
        | 'contradictory_evidence'
        | 'multiple_eligible_specialties'
        | 'diagnosis_read_error';
      ruleIds: string[];
    }
  | {
      kind: 'insufficient_data';
      reason: 'no_episode' | 'diagnosis_read_error' | 'no_matching_rule' | 'no_evidence';
      ruleIds: string[];
    }
  | {
      kind: 'configuration_conflict';
      reason: 'equal_priority_different_result';
      ruleIds: string[];
    };

const BUILTIN_PROFESSIONAL_RULE_ID = 'builtin:professional:single_eligible_specialty';

interface ResolverInput {
  /** Asignación vigente derivada (incluye la vista legacy_protected). */
  existing: SpecialtyAssignment;
  evidence: EpisodeEvidence;
  /** Reglas activas+aprobadas del establecimiento, prefiltradas. */
  rules: SpecialtyRule[];
}

interface MatchedRule {
  rule: SpecialtyRule;
  kind: 'diagnosis' | 'professionals' | 'combined' | 'memory';
}

const contextScopeOk = (scope: StructuredScope, evidence: EpisodeEvidence): boolean =>
  scopeAllows(scope, evidence.context);

const ruleNotExcluded = (rule: SpecialtyRule, evidence: EpisodeEvidence): boolean =>
  !isExcludedBy(rule.exclusions, evidence.context);

const diagnosisCodeMatches = (match: DiagnosisMatch, evidence: EpisodeEvidence): boolean => {
  if (evidence.diagnosis.status !== 'present') return false;
  const normalized = normalizeCie10Code(evidence.diagnosis.code);
  if (!normalized) return false;
  return match.codes.some(code => normalizeCie10Code(code) === normalized);
};

/**
 * El diagnóstico contradice un resultado cuando una regla diagnóstica activa
 * cubre el mismo código principal y apunta a OTRA especialidad.
 */
const diagnosisContradicts = (
  specialty: AutomaticSpecialty,
  evidence: EpisodeEvidence,
  rules: SpecialtyRule[]
): boolean =>
  rules.some(
    rule =>
      rule.action === 'assign' &&
      rule.specialty !== specialty &&
      diagnosisMatchOf(rule) &&
      diagnosisCodeMatches(diagnosisMatchOf(rule)!, evidence) &&
      contextScopeOk(diagnosisScopeOfMatch(rule), evidence) &&
      ruleNotExcluded(rule, evidence)
  );

const diagnosisMatchOf = (rule: SpecialtyRule): DiagnosisMatch | null =>
  rule.match.kind === 'diagnosis'
    ? rule.match
    : rule.match.kind === 'combined'
      ? rule.match.diagnosis
      : null;

const diagnosisScopeOfMatch = (rule: SpecialtyRule): StructuredScope =>
  diagnosisMatchOf(rule)?.scope ?? { conditions: [] };

const professionalSignalsMatch = (
  rule: SpecialtyRule,
  professionalMatch: {
    policy: string;
    requireCompatibleDiagnosis: boolean;
    scope: StructuredScope;
  },
  evidence: EpisodeEvidence,
  allRules: SpecialtyRule[]
): boolean => {
  const match = professionalMatch;
  if (match.policy !== 'single_eligible_specialty') return false;
  if (!contextScopeOk(match.scope, evidence)) return false;
  if (rule.action !== 'assign') {
    // require_manual profesional: coincide cuando hay alguna señal elegible.
    return eligibleProfessionalSpecialties(evidence).length > 0;
  }
  const specialties = eligibleProfessionalSpecialties(evidence);
  if (specialties.length !== 1 || specialties[0] !== rule.specialty) return false;
  if (match.requireCompatibleDiagnosis && evidence.diagnosis.status === 'contradictory') {
    return false;
  }
  if (
    match.requireCompatibleDiagnosis &&
    diagnosisContradicts(rule.specialty, evidence, allRules)
  ) {
    return false;
  }
  return true;
};

const ruleMatches = (
  rule: SpecialtyRule,
  evidence: EpisodeEvidence,
  allRules: SpecialtyRule[]
): MatchedRule | null => {
  if (!ruleNotExcluded(rule, evidence)) return null;
  if (rule.origin === 'manual_memory') {
    const match = rule.match as DiagnosisMatch;
    return diagnosisCodeMatches(match, evidence) && contextScopeOk(match.scope, evidence)
      ? { rule, kind: 'memory' }
      : null;
  }
  switch (rule.match.kind) {
    case 'diagnosis':
      return diagnosisCodeMatches(rule.match, evidence) &&
        contextScopeOk(rule.match.scope, evidence)
        ? { rule, kind: 'diagnosis' }
        : null;
    case 'professionals':
      return professionalSignalsMatch(rule, rule.match, evidence, allRules)
        ? { rule, kind: 'professionals' }
        : null;
    case 'combined': {
      const { diagnosis, professionals } = rule.match;
      if (
        !diagnosisCodeMatches(diagnosis, evidence) ||
        !contextScopeOk(diagnosis.scope, evidence)
      ) {
        return null;
      }
      return professionalSignalsMatch(rule, professionals, evidence, allRules)
        ? { rule, kind: 'combined' }
        : null;
    }
  }
};

const highestPriority = (matches: MatchedRule[]): number =>
  matches.reduce((max, item) => Math.max(max, item.rule.priority), Number.NEGATIVE_INFINITY);

const reasonCodeFor = (
  match: MatchedRule
): 'professional' | 'diagnosis' | 'combined' | 'hhr_internal_medicine' | 'diagnosis_memory' => {
  if (match.kind === 'memory') return 'diagnosis_memory';
  if (match.rule.internalMedicineCoverage && match.rule.action === 'assign') {
    return 'hhr_internal_medicine';
  }
  if (match.kind === 'combined') return 'combined';
  return match.kind === 'professionals' ? 'professional' : 'diagnosis';
};

/**
 * Decide el tier de mayor precedencia. Resultados distintos a igual prioridad
 * → conflicto de configuración; un require_manual en el tier dominante frena
 * la asignación automática.
 */
const decideAmongMatches = (
  matches: MatchedRule[],
  evidence: EpisodeEvidence
): ResolverOutcome | null => {
  if (matches.length === 0) return null;
  const topPriority = highestPriority(matches);
  const top = matches.filter(item => item.rule.priority === topPriority);

  const distinctResults = new Set(
    top.map(item =>
      item.rule.action === 'assign' ? `assign:${item.rule.specialty}` : 'require_manual'
    )
  );

  if (distinctResults.size > 1) {
    const requiresManual = top.some(item => item.rule.action === 'require_manual');
    const assignCount = top.filter(item => item.rule.action === 'assign').length;
    if (requiresManual && assignCount > 0) {
      return {
        kind: 'needs_review',
        reason: 'require_manual_rule',
        ruleIds: top.map(item => item.rule.id),
      };
    }
    return {
      kind: 'configuration_conflict',
      reason: 'equal_priority_different_result',
      ruleIds: top.map(item => item.rule.id),
    };
  }

  const winner = top[0];
  if (winner.rule.action === 'require_manual') {
    return {
      kind: 'needs_review',
      reason: 'require_manual_rule',
      ruleIds: top.map(item => item.rule.id),
    };
  }
  if (winner.rule.action !== 'assign') return null;

  return {
    kind: 'assign_by_rule',
    specialty: winner.rule.specialty,
    ruleId: winner.rule.id,
    ruleSetVersion: evidence.ruleSetVersion,
    professionalCatalogVersion: evidence.professionalCatalogVersion,
    reasonCode: reasonCodeFor(winner),
    evidenceFingerprint: evidenceFingerprint(evidence),
    evidenceRefs: [`episode:${evidence.episodeId}`],
  };
};

export const resolveSpecialtyAssignment = (input: ResolverInput): ResolverOutcome => {
  const { existing, evidence, rules } = input;

  // 0. Sin episodio estable no hay autoridad que confirmar.
  if (!evidence.episodeId.trim()) {
    return { kind: 'insufficient_data', reason: 'no_episode', ruleIds: [] };
  }

  // 1. Decisión vigente: manual, automática previa o legacy protegida.
  if (existing.state !== 'pending') {
    return { kind: 'keep_locked', assignment: existing };
  }

  // 2. Un error técnico de lectura no es una pregunta clínica: la evidencia
  //    no está cerrada y nada puede confirmarse.
  if (evidence.diagnosis.status === 'read_error') {
    return { kind: 'insufficient_data', reason: 'diagnosis_read_error', ruleIds: [] };
  }
  if (evidence.diagnosis.status === 'contradictory') {
    // Diagnóstico contradictorio: solo una regla resolutiva explícita puede
    // destrabar; se evalúa con las reglas igualmente (require_manual suele
    // ser el resultado esperado).
  }

  // 4. Memoria diagnóstica exacta (origen manual_memory) antes que el resto.
  const memoryMatches = rules
    .filter(rule => rule.origin === 'manual_memory')
    .map(rule => ruleMatches(rule, evidence, rules))
    .filter((match): match is MatchedRule => match !== null);
  const memoryOutcome = decideAmongMatches(memoryMatches, evidence);
  if (memoryOutcome) return memoryOutcome;

  // 5. Reglas generales (manual_base).
  const baseMatches = rules
    .filter(rule => rule.origin === 'manual_base')
    .map(rule => ruleMatches(rule, evidence, rules))
    .filter((match): match is MatchedRule => match !== null);
  const baseOutcome = decideAmongMatches(baseMatches, evidence);
  if (baseOutcome) return baseOutcome;

  // 6. Evidencia profesional sin regla: una única especialidad elegible y
  //    diagnóstico no contradictorio ⇒ asignación por señal profesional.
  const eligible = eligibleProfessionalSpecialties(evidence);
  if (eligible.length > 1) {
    return {
      kind: 'needs_review',
      reason: 'multiple_eligible_specialties',
      ruleIds: [],
    };
  }
  if (eligible.length === 1) {
    if (evidence.diagnosis.status === 'contradictory') {
      return { kind: 'needs_review', reason: 'contradictory_evidence', ruleIds: [] };
    }
    if (diagnosisContradicts(eligible[0], evidence, rules)) {
      return { kind: 'needs_review', reason: 'contradictory_evidence', ruleIds: [] };
    }
    return {
      kind: 'assign_by_rule',
      specialty: eligible[0],
      ruleId: BUILTIN_PROFESSIONAL_RULE_ID,
      ruleSetVersion: evidence.ruleSetVersion,
      professionalCatalogVersion: evidence.professionalCatalogVersion,
      reasonCode: 'professional',
      evidenceFingerprint: evidenceFingerprint(evidence),
      evidenceRefs: [`episode:${evidence.episodeId}`],
    };
  }

  return { kind: 'insufficient_data', reason: 'no_matching_rule', ruleIds: [] };
};

/** La especialidad `Med Interna` solo sale por regla aprobada o por profesional elegible — nunca por defecto. */
export const isInternalMedicineCoverageReason = (
  outcome: ResolverOutcome
): outcome is Extract<ResolverOutcome, { kind: 'assign_by_rule' }> =>
  outcome.kind === 'assign_by_rule' &&
  outcome.reasonCode === 'hhr_internal_medicine' &&
  outcome.specialty === Specialty.MEDICINA;
