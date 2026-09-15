/**
 * Decisión autoritativa de especialidad por episodio clínico.
 *
 * `PatientData.specialty` sigue siendo la proyección usada por la tabla,
 * exportaciones y estadísticas. `specialtyAssignment` acompaña esa proyección
 * con estado y trazabilidad: pending | automatic_locked | manual_locked |
 * legacy_protected. Un episodio admite una única asignación automática
 * exitosa; la selección manual siempre puede reemplazarla; un valor previo
 * sin metadatos queda protegido como legacy y nunca se sobrescribe solo.
 *
 * Módulo puro: sin React, red ni Firestore.
 */
import { Specialty } from '@/types/domain/patientClassification';

export const SPECIALTY_ASSIGNMENT_SCHEMA_VERSION = 2;

export type AutomaticSpecialty = Exclude<Specialty, Specialty.OTRO | Specialty.EMPTY>;

export const AUTOMATIC_SPECIALTIES: readonly AutomaticSpecialty[] = [
  Specialty.MEDICINA,
  Specialty.CIRUGIA,
  Specialty.TRAUMATOLOGIA,
  Specialty.GINECOBSTETRICIA,
  Specialty.PSIQUIATRIA,
  Specialty.PEDIATRIA,
  Specialty.ODONTOLOGIA,
] as const;

const AUTOMATIC_SPECIALTY_SET = new Set<string>(AUTOMATIC_SPECIALTIES);

/** Solo las 7 especialidades elegibles pueden producirse automáticamente. `Otro` y vacío jamás. */
export const isAutomaticSpecialty = (value: unknown): value is AutomaticSpecialty =>
  typeof value === 'string' && AUTOMATIC_SPECIALTY_SET.has(value);

export type AutomaticReasonCode =
  | 'professional'
  | 'diagnosis'
  | 'combined'
  | 'hhr_internal_medicine'
  | 'diagnosis_memory';

export type ManualSelectionOrigin = 'direct' | 'ai_recommendation';

export type SpecialtyAssignmentState =
  | 'pending'
  | 'automatic_locked'
  | 'manual_locked'
  | 'legacy_protected';

interface AssignmentBase {
  schemaVersion: typeof SPECIALTY_ASSIGNMENT_SCHEMA_VERSION;
  episodeId: string;
  /** Monótona; confirmada por la autoridad de persistencia. */
  revision: number;
}

export interface PendingAssignment extends AssignmentBase {
  state: 'pending';
  value: Specialty.EMPTY;
}

export interface AutomaticLockedAssignment extends AssignmentBase {
  state: 'automatic_locked';
  value: AutomaticSpecialty;
  operationId: string;
  decidedAt: string;
  reasonCode: AutomaticReasonCode;
  ruleId: string;
  ruleSetVersion: string;
  professionalCatalogVersion: string;
  evidenceFingerprint: string;
  evidenceRefs: string[];
}

export interface ManualLockedAssignment extends AssignmentBase {
  state: 'manual_locked';
  /** Incluye `Otro` y vacío cuando la UI permite el borrado manual. */
  value: Specialty | string;
  operationId: string;
  decidedAt: string;
  decidedByUserId: string;
  selectionOrigin: ManualSelectionOrigin;
  /** Obligatorio si selectionOrigin === 'ai_recommendation'. */
  recommendationId?: string;
}

export interface LegacyProtectedAssignment extends AssignmentBase {
  state: 'legacy_protected';
  /** Conserva también valores legacy aún no normalizados. */
  value: string;
  reasonCode: 'legacy_origin_unknown';
}

export type SpecialtyAssignment =
  | PendingAssignment
  | AutomaticLockedAssignment
  | ManualLockedAssignment
  | LegacyProtectedAssignment;

export const isLockedAssignment = (
  assignment: Pick<SpecialtyAssignment, 'state'> | null | undefined
): boolean =>
  assignment?.state === 'automatic_locked' ||
  assignment?.state === 'manual_locked' ||
  assignment?.state === 'legacy_protected';

export const isPendingAssignment = (
  assignment: Pick<SpecialtyAssignment, 'state'> | null | undefined
): boolean => !assignment || assignment.state === 'pending';

/**
 * Identidad de episodio compartida con el servidor: paciente de cama vs cuna
 * clínica comparten cama física pero son episodios independientes.
 */
export const episodeKeyFor = (
  patient: { clinicalEpisodeId?: string } | null | undefined,
  clinicalCrib = false
): string | null => {
  const episodeId = String(patient?.clinicalEpisodeId ?? '').trim();
  return episodeId ? `${clinicalCrib ? 'crib' : 'patient'}:${episodeId}` : null;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value.map(item => item.trim()).filter(Boolean)
    : undefined;

const asRevision = (value: unknown): number | undefined =>
  Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;

const AUTOMATIC_REASON_CODES = new Set<AutomaticReasonCode>([
  'professional',
  'diagnosis',
  'combined',
  'hhr_internal_medicine',
  'diagnosis_memory',
]);

const parseAssignmentBase = (
  raw: Record<string, unknown>
): { schemaVersion: 2; episodeId: string; revision: number } | null => {
  if (raw.schemaVersion !== SPECIALTY_ASSIGNMENT_SCHEMA_VERSION) return null;
  const episodeId = asString(raw.episodeId);
  const revision = asRevision(raw.revision);
  if (!episodeId || revision === undefined) return null;
  return { schemaVersion: SPECIALTY_ASSIGNMENT_SCHEMA_VERSION, episodeId, revision };
};

/**
 * Normaliza una asignación remota. Devuelve `undefined` ante cualquier forma
 * inválida: los metadatos corruptos no deben persistirse ni decidir nada.
 */
export const normalizeSpecialtyAssignment = (raw: unknown): SpecialtyAssignment | undefined => {
  if (!isPlainObject(raw)) return undefined;
  const base = parseAssignmentBase(raw);
  if (!base) return undefined;

  switch (raw.state) {
    case 'pending':
      return raw.value === '' || raw.value === undefined
        ? { ...base, state: 'pending', value: Specialty.EMPTY }
        : undefined;
    case 'automatic_locked': {
      const value = raw.value;
      const operationId = asString(raw.operationId);
      const decidedAt = asString(raw.decidedAt);
      const reasonCode = raw.reasonCode as AutomaticReasonCode;
      const ruleId = asString(raw.ruleId);
      const ruleSetVersion = asString(raw.ruleSetVersion);
      const professionalCatalogVersion = asString(raw.professionalCatalogVersion);
      const evidenceFingerprint = asString(raw.evidenceFingerprint);
      const evidenceRefs = asStringArray(raw.evidenceRefs);
      if (
        !isAutomaticSpecialty(value) ||
        !operationId ||
        !decidedAt ||
        !AUTOMATIC_REASON_CODES.has(reasonCode) ||
        !ruleId ||
        !ruleSetVersion ||
        !professionalCatalogVersion ||
        !evidenceFingerprint ||
        !evidenceRefs
      ) {
        return undefined;
      }
      return {
        ...base,
        state: 'automatic_locked',
        value,
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
    case 'manual_locked': {
      const value = typeof raw.value === 'string' ? raw.value : undefined;
      const operationId = asString(raw.operationId);
      const decidedAt = asString(raw.decidedAt);
      const decidedByUserId = asString(raw.decidedByUserId);
      const selectionOrigin = raw.selectionOrigin;
      const recommendationId = asString(raw.recommendationId);
      if (
        value === undefined ||
        !operationId ||
        !decidedAt ||
        !decidedByUserId ||
        (selectionOrigin !== 'direct' && selectionOrigin !== 'ai_recommendation') ||
        (selectionOrigin === 'ai_recommendation' && !recommendationId)
      ) {
        return undefined;
      }
      return {
        ...base,
        state: 'manual_locked',
        value,
        operationId,
        decidedAt,
        decidedByUserId,
        selectionOrigin,
        ...(recommendationId ? { recommendationId } : {}),
      };
    }
    case 'legacy_protected': {
      const value = typeof raw.value === 'string' && raw.value.trim() ? raw.value : undefined;
      if (!value || raw.reasonCode !== 'legacy_origin_unknown') return undefined;
      return { ...base, state: 'legacy_protected', value, reasonCode: 'legacy_origin_unknown' };
    }
    default:
      return undefined;
  }
};

/**
 * Vista derivada de la asignación vigente del episodio.
 *
 * - Metadatos válidos → la decisión almacenada.
 * - `specialty` sin metadatos → `legacy_protected` sintetizada (revision 0,
 *   sin fecha/autor inventados). Protege el valor previo de toda escritura
 *   automática sin reclasificarlo.
 * - Sin valor ni metadatos → `pending`.
 *
 * El `episodeId` requerido es el `clinicalEpisodeId` del paciente; una cama sin
 * episodio estable produce una vista pendiente efímera que nunca se persiste.
 */
export const deriveSpecialtyAssignment = (patient: {
  specialty?: string;
  specialtyAssignment?: unknown;
  clinicalEpisodeId?: string;
}): SpecialtyAssignment => {
  const stored = normalizeSpecialtyAssignment(patient.specialtyAssignment);
  const episodeId = String(patient.clinicalEpisodeId ?? '').trim();

  if (stored && stored.episodeId === episodeId && episodeId) {
    return stored;
  }

  const legacyValue = String(patient.specialty ?? '').trim();
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
    value: Specialty.EMPTY,
  };
};

/** La especialidad visible del episodio según la asignación vigente. */
export const assignmentProjectedSpecialty = (assignment: SpecialtyAssignment): Specialty | string =>
  assignment.value;
