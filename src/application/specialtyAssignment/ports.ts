/**
 * Puertos del dominio de asignación de especialidad. Los casos de uso no
 * conocen Firestore ni la red: reciben almacenes transaccionales y catálogos
 * inyectados, de modo que la política completa es verificable en memoria.
 */
import type { SpecialtyAssignment } from '@/domain/specialtyAssignment/contracts';
import type { EpisodeEvidence } from '@/domain/specialtyAssignment/evidence';
import type { SpecialtyRuleCatalog } from '@/domain/specialtyAssignment/ruleCatalog';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';

/** Decisión vigente de un episodio con la revisión del documento que la aloja. */
export interface EpisodeAssignmentSnapshot {
  episodeKey: string;
  assignment: SpecialtyAssignment;
  /** Revisión monótona del contenedor (documento), usada para concurrencia. */
  containerRevision: number;
}

export class AssignmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssignmentConflictError';
  }
}

/**
 * Unidad de trabajo atómica sobre la autoridad del episodio. Las
 * implementaciones reales delegan en la transacción del callable; el store en
 * memoria la emula para las pruebas.
 */
export interface SpecialtyAssignmentStore {
  read(episodeKey: string): Promise<EpisodeAssignmentSnapshot | null>;
  runTransaction<T>(
    work: (txn: {
      read: (episodeKey: string) => Promise<EpisodeAssignmentSnapshot | null>;
      write: (
        snapshot: EpisodeAssignmentSnapshot & { expectedContainerRevision: number }
      ) => Promise<void>;
    }) => Promise<T>
  ): Promise<T>;
}

export class CatalogConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogConflictError';
  }
}

export interface SpecialtyRuleCatalogStore {
  read(): Promise<SpecialtyRuleCatalog | null>;
  /**
   * Publica una nueva revisión del catálogo de forma atómica. Debe lanzar
   * CatalogConflictError si la revisión remota ya no es `expectedRevision`.
   */
  publish(
    expectedRevision: number,
    build: (current: SpecialtyRuleCatalog) => SpecialtyRuleCatalog,
    actorUid: string
  ): Promise<SpecialtyRuleCatalog>;
}

export type RecommendationStatus =
  | 'available'
  | 'accepted'
  | 'discarded'
  | 'obsolete'
  | 'superseded';

export interface StoredSpecialtyRecommendation {
  recommendationId: string;
  episodeKey: string;
  recordDate: string;
  observedRevision: number;
  evidenceFingerprint: string;
  ruleSetVersion: string;
  professionalCatalogVersion: string;
  promptVersion: string;
  modelRequested: string;
  modelReported?: string;
  status: RecommendationStatus;
  candidates: Array<{
    specialty: string;
    certainty: 'alta' | 'media' | 'baja';
    rationale: string;
    evidenceFor: string[];
    evidenceAgainst: string[];
  }>;
  missingData: string[];
  policyConflict: boolean;
  requesterUid: string;
  createdAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  resolvedByUid?: string;
}

export interface SpecialtyRecommendationStore {
  get(recommendationId: string): Promise<StoredSpecialtyRecommendation | null>;
  /** Crea solo si no existe (deduplicación por id determinista). */
  createIfAbsent(recommendation: StoredSpecialtyRecommendation): Promise<'created' | 'exists'>;
  /** Transición de estado atómica; lanza si el estado actual no lo permite. */
  transition(
    recommendationId: string,
    from: RecommendationStatus[],
    to: RecommendationStatus,
    actorUid: string,
    at: string
  ): Promise<StoredSpecialtyRecommendation>;
}

/** Catálogo profesional vigente + su versión para trazabilidad. */
export interface ProfessionalCatalogPort {
  list(): Promise<ProfessionalCatalogItem[]>;
  version(): Promise<string>;
}

/** Valida un código CIE-10 contra el catálogo terminológico vigente. */
export interface Cie10CatalogPort {
  isKnownCode(normalizedCode: string): Promise<boolean>;
  version(): Promise<string>;
}

/** Backend autorizado que produce recomendaciones (Netlify function). */
export interface SpecialtyRecommendationBackendPort {
  request(input: {
    recordDate: string;
    bedId: string;
    /** 'clinicalCrib' = episodio de la cuna clínica que comparte la cama. */
    target?: 'bed' | 'clinicalCrib';
    clientRequestId: string;
    evidenceFingerprint: string;
    ruleSetVersion: string;
  }): Promise<
    | { status: 'ok'; recommendation: StoredSpecialtyRecommendation }
    | {
        status:
          | 'disabled'
          | 'unauthorized'
          | 'not_pending'
          | 'insufficient_context'
          | 'budget_exhausted'
          | 'provider_error'
          | 'stale';
        reason?: string;
      }
  >;
}

export interface ClockPort {
  now(): Date;
}

export interface IdPort {
  newId(prefix: string): string;
}

export interface ActorPort {
  /** uid del usuario autenticado; '' = anónimo → se rechaza el comando. */
  uid(): string;
}

/** Construye la evidencia cerrada del episodio desde el registro vigente. */
export interface EpisodeEvidencePort {
  capture(episodeKey: string): Promise<EpisodeEvidence | null>;
}
