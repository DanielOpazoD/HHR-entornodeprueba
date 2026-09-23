/**
 * Catálogo institucional de reglas de especialidad (HHR).
 *
 * Una regla la crea y la aprueba una persona autorizada; una memoria
 * diagnóstica ES una regla de origen `manual_memory` dentro del mismo
 * catálogo versionado — no una entidad de paciente ni un aprendizaje
 * silencioso. Nunca se almacena código ejecutable: las condiciones son datos
 * estructurados con operadores cerrados.
 */
import type { AutomaticSpecialty } from './contracts';
import { isAutomaticSpecialty } from './contracts';

export type RuleOrigin = 'manual_base' | 'manual_memory';
export type RuleStatus = 'draft' | 'active' | 'disabled';

/** Campos del contexto del episodio sobre los que una regla puede condicionar. */
export const STRUCTURED_CONDITION_FIELDS = [
  'ageYears',
  'sex',
  'isObstetric',
  'bedType',
  'admissionOrigin',
] as const;
export type StructuredConditionField = (typeof STRUCTURED_CONDITION_FIELDS)[number];

/** Operadores cerrados; ninguna condición evalúa texto libre ni código. */
export const STRUCTURED_CONDITION_OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'lt',
  'lte',
  'gt',
  'gte',
] as const;
export type StructuredConditionOperator = (typeof STRUCTURED_CONDITION_OPERATORS)[number];

export interface StructuredCondition {
  field: StructuredConditionField;
  op: StructuredConditionOperator;
  value: string | number | boolean | Array<string | number>;
}

/** Conjunto de condiciones AND. Lista vacía = sin restricción de contexto. */
export interface StructuredScope {
  conditions: StructuredCondition[];
}

export const EMPTY_SCOPE: StructuredScope = { conditions: [] };

export interface DiagnosisMatch {
  kind: 'diagnosis';
  codeSystem: 'CIE-10';
  /** Versión del catálogo CIE-10 contra la que se validaron los códigos. */
  catalogVersion: string;
  /** Conjunto explícito de códigos exactos normalizados (p. ej. "J18.9"). */
  codes: string[];
  diagnosisRole: 'primary';
  scope: StructuredScope;
}

export interface ProfessionalMatch {
  kind: 'professionals';
  policy: 'single_eligible_specialty';
  /** Exige que el diagnóstico principal no contradiga el resultado. */
  requireCompatibleDiagnosis: boolean;
  scope: StructuredScope;
}

export interface CombinedMatch {
  kind: 'combined';
  diagnosis: DiagnosisMatch;
  professionals: ProfessionalMatch;
}

export type SpecialtyRuleMatch = DiagnosisMatch | ProfessionalMatch | CombinedMatch;

export type SpecialtyRuleAction =
  | { action: 'assign'; specialty: AutomaticSpecialty }
  | { action: 'require_manual' };

interface SpecialtyRuleBase {
  id: string;
  /** Establecimiento al que pertenece la regla (alcance explícito). */
  facilityId: string;
  revision: number;
  status: RuleStatus;
  /** Nombre legible para auditoría/configuración. */
  name: string;
  /** Razón local documentada por quien la aprueba. */
  reason: string;
  exclusions: StructuredCondition[];
  /** Precedencia explícita; los conflictos de igual precedencia no se ocultan. */
  priority: number;
  lifetime: 'no_expiry';
  createdBy: string;
  createdAt: string;
  /** Obligatorios al publicar (status 'active'); validados en runtime. */
  approvedBy?: string;
  approvedAt?: string;
  /** Marca la regla residual aprobada de cobertura local de Med Interna. */
  internalMedicineCoverage?: boolean;
}

export type SpecialtyRule = SpecialtyRuleBase &
  (
    | { origin: 'manual_memory'; match: DiagnosisMatch }
    | { origin: 'manual_base'; match: SpecialtyRuleMatch }
  ) &
  SpecialtyRuleAction;

// ---------------------------------------------------------------------------
// Validación runtime de condiciones y reglas
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const CONDITION_FIELD_SET = new Set<string>(STRUCTURED_CONDITION_FIELDS);
const CONDITION_OPERATOR_SET = new Set<string>(STRUCTURED_CONDITION_OPERATORS);

export const normalizeStructuredCondition = (raw: unknown): StructuredCondition | undefined => {
  if (!isPlainObject(raw)) return undefined;
  const field = raw.field;
  const op = raw.op;
  const value = raw.value;
  if (typeof field !== 'string' || !CONDITION_FIELD_SET.has(field)) return undefined;
  if (typeof op !== 'string' || !CONDITION_OPERATOR_SET.has(op)) return undefined;
  const isScalar =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  const isList =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(item => typeof item === 'string' || typeof item === 'number');
  if (!isScalar && !isList) return undefined;
  if ((op === 'in' || op === 'not_in') && !isList) return undefined;
  if (op !== 'in' && op !== 'not_in' && isList) return undefined;
  return { field: field as StructuredConditionField, op: op as StructuredConditionOperator, value };
};

export const normalizeStructuredScope = (raw: unknown): StructuredScope | undefined => {
  if (raw === undefined || raw === null) return { conditions: [] };
  if (!isPlainObject(raw)) return undefined;
  const rawConditions = Array.isArray(raw.conditions) ? raw.conditions : null;
  if (!rawConditions) return undefined;
  const conditions: StructuredCondition[] = [];
  for (const item of rawConditions) {
    const condition = normalizeStructuredCondition(item);
    if (!condition) return undefined;
    conditions.push(condition);
  }
  return { conditions };
};

const normalizeDiagnosisMatch = (raw: unknown): DiagnosisMatch | undefined => {
  if (!isPlainObject(raw) || raw.kind !== 'diagnosis') return undefined;
  if (raw.codeSystem !== 'CIE-10') return undefined;
  if (typeof raw.catalogVersion !== 'string' || !raw.catalogVersion.trim()) return undefined;
  if (raw.diagnosisRole !== 'primary') return undefined;
  if (!Array.isArray(raw.codes) || raw.codes.length === 0) return undefined;
  const codes = raw.codes.map(code => (typeof code === 'string' ? code.trim() : ''));
  if (codes.some(code => !code)) return undefined;
  const scope = normalizeStructuredScope(raw.scope);
  if (!scope) return undefined;
  return {
    kind: 'diagnosis',
    codeSystem: 'CIE-10',
    catalogVersion: raw.catalogVersion.trim(),
    codes,
    diagnosisRole: 'primary',
    scope,
  };
};

const normalizeProfessionalMatch = (raw: unknown): ProfessionalMatch | undefined => {
  if (!isPlainObject(raw) || raw.kind !== 'professionals') return undefined;
  if (raw.policy !== 'single_eligible_specialty') return undefined;
  if (typeof raw.requireCompatibleDiagnosis !== 'boolean') return undefined;
  const scope = normalizeStructuredScope(raw.scope);
  if (!scope) return undefined;
  return {
    kind: 'professionals',
    policy: 'single_eligible_specialty',
    requireCompatibleDiagnosis: raw.requireCompatibleDiagnosis,
    scope,
  };
};

const normalizeMatch = (raw: unknown, origin: RuleOrigin): SpecialtyRuleMatch | undefined => {
  if (origin === 'manual_memory') return normalizeDiagnosisMatch(raw);
  if (!isPlainObject(raw)) return undefined;
  if (raw.kind === 'diagnosis') return normalizeDiagnosisMatch(raw);
  if (raw.kind === 'professionals') return normalizeProfessionalMatch(raw);
  if (raw.kind === 'combined') {
    const diagnosis = normalizeDiagnosisMatch(raw.diagnosis);
    const professionals = normalizeProfessionalMatch(raw.professionals);
    if (!diagnosis || !professionals) return undefined;
    return { kind: 'combined', diagnosis, professionals };
  }
  return undefined;
};

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asRevision = (value: unknown): number | undefined =>
  Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;

const asPriority = (value: unknown): number | undefined =>
  Number.isInteger(value) ? (value as number) : undefined;

/**
 * Normaliza una regla remota. Devuelve `undefined` si la forma es inválida o
 * viola invariantes duras (acción `assign` exige especialidad elegible; estado
 * `active` exige aprobación humana; memoria exige match diagnóstico).
 */
export const normalizeSpecialtyRule = (raw: unknown): SpecialtyRule | undefined => {
  if (!isPlainObject(raw)) return undefined;
  const id = asNonEmptyString(raw.id);
  const facilityId = asNonEmptyString(raw.facilityId);
  const revision = asRevision(raw.revision);
  const status = raw.status;
  const name = asNonEmptyString(raw.name) ?? '';
  const reason = asNonEmptyString(raw.reason) ?? '';
  const origin = raw.origin;
  const priority = asPriority(raw.priority);
  const createdBy = asNonEmptyString(raw.createdBy);
  const createdAt = asNonEmptyString(raw.createdAt);
  const approvedBy = asNonEmptyString(raw.approvedBy);
  const approvedAt = asNonEmptyString(raw.approvedAt);
  const internalMedicineCoverage = raw.internalMedicineCoverage === true;

  if (
    !id ||
    !facilityId ||
    revision === undefined ||
    (status !== 'draft' && status !== 'active' && status !== 'disabled') ||
    (origin !== 'manual_base' && origin !== 'manual_memory') ||
    priority === undefined ||
    raw.lifetime !== 'no_expiry' ||
    !createdBy ||
    !createdAt
  ) {
    return undefined;
  }
  // Una regla activa exige aprobación humana explícita.
  if (status === 'active' && (!approvedBy || !approvedAt)) return undefined;
  if ((approvedBy && !approvedAt) || (!approvedBy && approvedAt)) return undefined;

  const rawExclusions = Array.isArray(raw.exclusions) ? raw.exclusions : [];
  const exclusions: StructuredCondition[] = [];
  for (const item of rawExclusions) {
    const condition = normalizeStructuredCondition(item);
    if (!condition) return undefined;
    exclusions.push(condition);
  }

  const match = normalizeMatch(raw.match, origin);
  if (!match) return undefined;

  let action: SpecialtyRuleAction;
  if (raw.action === 'assign') {
    if (!isAutomaticSpecialty(raw.specialty)) return undefined;
    action = { action: 'assign', specialty: raw.specialty };
  } else if (raw.action === 'require_manual') {
    action = { action: 'require_manual' };
  } else {
    return undefined;
  }

  const base: SpecialtyRuleBase = {
    id,
    facilityId,
    revision,
    status,
    name,
    reason,
    exclusions,
    priority,
    lifetime: 'no_expiry',
    createdBy,
    createdAt,
    ...(approvedBy && approvedAt ? { approvedBy, approvedAt } : {}),
    ...(internalMedicineCoverage ? { internalMedicineCoverage: true } : {}),
  };

  if (origin === 'manual_memory') {
    return { ...base, origin, match: match as DiagnosisMatch, ...action } as SpecialtyRule;
  }
  return { ...base, origin, match, ...action } as SpecialtyRule;
};
