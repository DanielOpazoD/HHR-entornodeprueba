/**
 * Catálogo versionado compartido de reglas de especialidad (incluye la
 * memoria diagnóstica como reglas `manual_memory`). Vive en un documento de
 * settings del hospital; cada publicación incrementa `revision` de forma
 * transaccional — concurrencia optimista, nunca fusión silenciosa.
 */
import type { SpecialtyRule } from './ruleContracts';
import { normalizeSpecialtyRule } from './ruleContracts';
import type { StructuredCondition, StructuredScope } from './ruleContracts';
import type { EpisodeContext } from './evidence';
import { normalizeCie10Code } from './cie10';

export const SPECIALTY_RULES_CATALOG_SCHEMA_VERSION = 1;

export interface SpecialtyRuleCatalog {
  schemaVersion: typeof SPECIALTY_RULES_CATALOG_SCHEMA_VERSION;
  /** Monótona; cada publicación confirmada la incrementa. */
  revision: number;
  rules: SpecialtyRule[];
  updatedAt?: string;
  updatedByUid?: string;
}

export const EMPTY_RULE_CATALOG: SpecialtyRuleCatalog = {
  schemaVersion: SPECIALTY_RULES_CATALOG_SCHEMA_VERSION,
  revision: 0,
  rules: [],
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Normaliza el documento remoto. Reglas inválidas se descartan una a una
 * (una entrada corrupta no debe tumbear el catálogo completo ni el resolver)
 * pero el conteo descartado se reporta para auditoría.
 */
export const normalizeRuleCatalog = (
  raw: unknown
): { catalog: SpecialtyRuleCatalog; droppedRules: number } => {
  if (!isPlainObject(raw)) return { catalog: EMPTY_RULE_CATALOG, droppedRules: 0 };
  if (raw.schemaVersion !== SPECIALTY_RULES_CATALOG_SCHEMA_VERSION) {
    return { catalog: EMPTY_RULE_CATALOG, droppedRules: 0 };
  }
  const revision =
    Number.isInteger(raw.revision) && (raw.revision as number) >= 0 ? (raw.revision as number) : 0;
  const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
  const rules: SpecialtyRule[] = [];
  let droppedRules = 0;
  for (const item of rawRules) {
    const rule = normalizeSpecialtyRule(item);
    if (rule) rules.push(rule);
    else droppedRules += 1;
  }
  return {
    catalog: {
      schemaVersion: SPECIALTY_RULES_CATALOG_SCHEMA_VERSION,
      revision,
      rules,
      ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
      ...(typeof raw.updatedByUid === 'string' ? { updatedByUid: raw.updatedByUid } : {}),
    },
    droppedRules,
  };
};

/** Reglas que participan en la resolución: activas, aprobadas y del establecimiento. */
export const activeRulesFor = (
  catalog: SpecialtyRuleCatalog,
  facilityId: string
): SpecialtyRule[] =>
  catalog.rules.filter(
    rule =>
      rule.status === 'active' &&
      rule.approvedBy &&
      rule.approvedAt &&
      rule.facilityId === facilityId
  );

// ---------------------------------------------------------------------------
// Evaluación de alcance y condiciones (datos estructurados, operadores cerrados)
// ---------------------------------------------------------------------------

const conditionValueFor = (
  context: EpisodeContext,
  field: StructuredCondition['field']
): string | number | boolean | undefined => {
  switch (field) {
    case 'ageYears':
      return context.ageYears;
    case 'sex':
      return context.sex;
    case 'isObstetric':
      return context.isObstetric;
    case 'bedType':
      return context.bedType;
    case 'admissionOrigin':
      return context.admissionOrigin;
  }
};

/**
 * Evalúa una condición sobre el contexto. Un dato de contexto DESCONOCIDO
 * nunca satisface una condición que lo requiere (un umbral etario sin edad
 * registrada no se inventa).
 */
export const evaluateStructuredCondition = (
  condition: StructuredCondition,
  context: EpisodeContext
): boolean => {
  const actual = conditionValueFor(context, condition.field);
  if (actual === undefined) return false;
  const expected = condition.value;
  const list = Array.isArray(expected) ? expected : null;

  switch (condition.op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return list !== null && list.some(item => item === actual);
    case 'not_in':
      return list !== null && !list.some(item => item === actual);
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
  }
};

/** AND de las condiciones del alcance; alcance vacío = aplica a todo contexto. */
export const scopeAllows = (scope: StructuredScope, context: EpisodeContext): boolean =>
  scope.conditions.every(condition => evaluateStructuredCondition(condition, context));

/** Una exclusión que coincide con el contexto inhabilita la regla para el caso. */
export const isExcludedBy = (exclusions: StructuredCondition[], context: EpisodeContext): boolean =>
  exclusions.some(condition => evaluateStructuredCondition(condition, context));

// ---------------------------------------------------------------------------
// Detección de conflictos entre reglas (antes de publicar)
// ---------------------------------------------------------------------------

export interface RuleConflict {
  ruleIds: [string, string];
  reason:
    | 'same_code_same_priority_different_result'
    | 'professional_same_priority_different_result';
}

const scopesMayOverlap = (
  a: { scope: StructuredScope; exclusions: StructuredCondition[] },
  b: { scope: StructuredScope; exclusions: StructuredCondition[] }
): boolean => {
  // Detección conservadora: solo se declaran disjuntas cuando ambas fijan el
  // mismo campo con valores `eq`/`in` demostrablemente sin intersección.
  const aConditions = [...a.scope.conditions];
  const bConditions = [...b.scope.conditions];
  for (const ca of aConditions) {
    for (const cb of bConditions) {
      if (ca.field !== cb.field) continue;
      const aValues = new Set(
        ca.op === 'eq' ? [ca.value] : ca.op === 'in' ? (ca.value as Array<string | number>) : null
      );
      const bValues = new Set(
        cb.op === 'eq' ? [cb.value] : cb.op === 'in' ? (cb.value as Array<string | number>) : null
      );
      if (!aValues || !bValues) continue;
      const intersection = [...aValues].filter(v => bValues.has(v));
      if (aValues.size > 0 && bValues.size > 0 && intersection.length === 0) return false;
    }
  }
  return true;
};

const diagnosisCodesIntersect = (a: string[], b: string[]): boolean => {
  const setB = new Set(b.map(code => normalizeCie10Code(code)).filter(Boolean));
  return a.some(code => {
    const normalized = normalizeCie10Code(code);
    return normalized !== undefined && setB.has(normalized);
  });
};

const ruleResult = (rule: SpecialtyRule): string =>
  rule.action === 'assign' ? `assign:${rule.specialty}` : 'require_manual';

const diagnosisMatchOf = (rule: SpecialtyRule) =>
  rule.match.kind === 'diagnosis'
    ? rule.match
    : rule.match.kind === 'combined'
      ? rule.match.diagnosis
      : null;

const professionalMatchOf = (rule: SpecialtyRule) =>
  rule.match.kind === 'professionals'
    ? rule.match
    : rule.match.kind === 'combined'
      ? rule.match.professionals
      : null;

const diagnosisScopeOf = (
  rule: SpecialtyRule
): { scope: StructuredScope; exclusions: StructuredCondition[] } => {
  const match = diagnosisMatchOf(rule);
  return { scope: match ? match.scope : { conditions: [] }, exclusions: rule.exclusions };
};

const professionalScopeOf = (
  rule: SpecialtyRule
): { scope: StructuredScope; exclusions: StructuredCondition[] } => {
  const match = professionalMatchOf(rule);
  return { scope: match ? match.scope : { conditions: [] }, exclusions: rule.exclusions };
};

/**
 * Encuentra pares de reglas activas que pueden coincidir sobre el mismo caso
 * con resultados distintos y la MISMA precedencia: eso es un conflicto de
 * configuración que debe resolverse antes de publicar, no un empate que el
 * resolver decida por orden de llegada.
 */
export const detectRuleConflicts = (rules: SpecialtyRule[]): RuleConflict[] => {
  const conflicts: RuleConflict[] = [];
  const active = rules.filter(rule => rule.status === 'active');

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      if (a.priority !== b.priority) continue;
      if (ruleResult(a) === ruleResult(b)) continue;
      if (a.facilityId !== b.facilityId) continue;

      const aDiagnosis = diagnosisMatchOf(a);
      const bDiagnosis = diagnosisMatchOf(b);
      const aProfessional = professionalMatchOf(a);
      const bProfessional = professionalMatchOf(b);

      // El conflicto solo existe dentro del mismo tipo de señal: una regla
      // diagnóstica y una profesional no colisionan porque la evidencia decide
      // cuál aplica.
      if (aDiagnosis && bDiagnosis) {
        if (
          diagnosisCodesIntersect(aDiagnosis.codes, bDiagnosis.codes) &&
          scopesMayOverlap(diagnosisScopeOf(a), diagnosisScopeOf(b))
        ) {
          conflicts.push({
            ruleIds: [a.id, b.id],
            reason: 'same_code_same_priority_different_result',
          });
        }
        continue;
      }

      if (
        aProfessional &&
        bProfessional &&
        !aDiagnosis &&
        !bDiagnosis &&
        scopesMayOverlap(professionalScopeOf(a), professionalScopeOf(b))
      ) {
        conflicts.push({
          ruleIds: [a.id, b.id],
          reason: 'professional_same_priority_different_result',
        });
      }
    }
  }

  return conflicts;
};
