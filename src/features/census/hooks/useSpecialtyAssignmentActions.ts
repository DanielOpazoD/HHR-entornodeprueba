/**
 * Hook de acciones de asignación de especialidad por episodio.
 *
 * Reúne los puertos reales (Firestore, dispatch clínico, backend Netlify)
 * para los casos de uso del dominio:
 * - Solicitud de recomendación IA (solo episodios pendientes, flag).
 * - Aceptación → decisión `manual_locked` con `selectionOrigin: 'ai_recommendation'`.
 * - Descarte explícito.
 * - "Recordar asociación" CIE-10→especialidad con doble confirmación de UI
 *   (el primer click arma la confirmación; el segundo publica la regla
 *   `manual_memory` ya aprobada — sin aprendizaje silencioso).
 *
 * La concurrencia real la ejerce el servidor: el store de cliente es una
 * vista honesta (lee el estado vigente y escribe por el canal clínico).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { isFeatureEnabled } from '@/services/utils/featureFlags';
import {
  acceptSpecialtyRecommendation,
  discardSpecialtyRecommendation,
  rememberDiagnosisAssociation,
  requestSpecialtyRecommendation,
  type RequestRecommendationOutcome,
} from '@/application/specialtyAssignment/useCases';
import type {
  Cie10CatalogPort,
  EpisodeAssignmentSnapshot,
  EpisodeEvidencePort,
  SpecialtyAssignmentStore,
} from '@/application/specialtyAssignment/ports';
import { createFirestoreRuleCatalogStore } from '@/services/specialty/specialtyRuleCatalogService';
import {
  createFirestoreRecommendationStore,
  createNetlifyRecommendationBackend,
} from '@/services/specialty/specialtyRecommendationService';
import { captureEpisodeEvidence } from '@/services/specialty/specialtyEvidenceFactory';
import { professionalCatalogVersionOf } from '@/services/specialty/professionalCatalogVersion';
import {
  assignmentProjectedSpecialty,
  deriveSpecialtyAssignment,
  episodeKeyFor,
  isPendingAssignment,
  type SpecialtyAssignment,
} from '@/domain/specialtyAssignment/contracts';
import { sameCie10Code } from '@/domain/specialtyAssignment/cie10';
import { loadCIE10Database } from '@/services/terminology/cie10SpanishDatabase';
import type { PatientData } from '@/types/domain/patient';
import type { StoredSpecialtyRecommendation } from '@/application/specialtyAssignment/ports';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import { useAuth } from '@/context/AuthContext';
import { useStaffContext } from '@/context/StaffContext';
import { useDailyRecordBedActions } from '@/context/DailyRecordContext';

export interface SpecialtyAssignmentActions {
  readonly enabled: boolean;
  readonly assignment: SpecialtyAssignment;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly recommendation: StoredSpecialtyRecommendation | null;
  readonly requestError: string | null;
  /** true después del primer click en "recordar": el segundo confirma. */
  readonly memoryConfirmArmed: boolean;
  requestAiRecommendation: () => Promise<RequestRecommendationOutcome['status'] | null>;
  acceptAiCandidate: (specialty: string) => Promise<boolean>;
  discardRecommendation: () => Promise<void>;
  rememberCurrentAssociation: () => Promise<'armed' | 'published' | 'rejected'>;
}

const clock = { now: () => new Date() };
const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const localCie10Port: Cie10CatalogPort = {
  isKnownCode: async code => {
    const db = await loadCIE10Database();
    return db.some(entry => sameCie10Code(entry.code, code));
  },
  version: async () => 'cie10-es-local',
};

export const useSpecialtyAssignmentActions = (
  data: PatientData,
  recordDate: string,
  isSubRow: boolean
): SpecialtyAssignmentActions => {
  const { currentUser } = useAuth();
  const { professionalsCatalog } = useStaffContext();
  const { updatePatientMultiple, updateClinicalCribMultiple } = useDailyRecordBedActions();
  const [busy, setBusy] = useState(false);
  const [recommendation, setRecommendation] = useState<StoredSpecialtyRecommendation | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [memoryConfirmArmed, setMemoryConfirmArmed] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  const hospitalId = getActiveHospitalId();
  const bedId = data.bedId;
  const target = isSubRow ? ('clinicalCrib' as const) : ('bed' as const);
  const episodeKey = episodeKeyFor(data, isSubRow);
  const assignment = useMemo(() => deriveSpecialtyAssignment(data), [data]);

  const buildDeps = useCallback(() => {
    const actorUid = currentUser?.uid ?? '';
    const catalogStore = createFirestoreRuleCatalogStore();
    const recommendations = createFirestoreRecommendationStore();
    const backend = createNetlifyRecommendationBackend();

    const snapshotFor = (key: string | null): EpisodeAssignmentSnapshot | null => {
      if (!key || key !== episodeKeyFor(dataRef.current, isSubRow)) return null;
      const current = deriveSpecialtyAssignment(dataRef.current);
      return { episodeKey: key, assignment: current, containerRevision: current.revision };
    };

    const store: SpecialtyAssignmentStore = {
      read: async key => snapshotFor(key),
      runTransaction: async work => {
        const key = episodeKeyFor(dataRef.current, isSubRow);
        const snapshot = snapshotFor(key);
        let writeError: Error | null = null;
        const result = await work({
          read: async () => snapshot,
          write: async next => {
            const fn = isSubRow ? updateClinicalCribMultiple : updatePatientMultiple;
            const ok = await fn(bedId, {
              specialty: assignmentProjectedSpecialty(next.assignment),
              specialtyAssignment: next.assignment,
            } as Partial<PatientData>);
            if (!ok) writeError = new Error('dispatch_rejected');
          },
        });
        if (writeError) throw writeError;
        return result;
      },
    };

    const evidencePort: EpisodeEvidencePort = {
      capture: async key => {
        if (key !== episodeKeyFor(dataRef.current, isSubRow)) return null;
        const catalog = await catalogStore.read();
        return captureEpisodeEvidence({
          patient: dataRef.current,
          facilityId: hospitalId,
          catalog: professionalsCatalog,
          ruleSetVersion: String(catalog?.revision ?? 0),
          professionalCatalogVersion: professionalCatalogVersionOf(professionalsCatalog),
          capturedAt: new Date().toISOString(),
        });
      },
    };

    return { actorUid, catalogStore, recommendations, backend, store, evidencePort, clock };
  }, [
    bedId,
    currentUser?.uid,
    hospitalId,
    isSubRow,
    professionalsCatalog,
    updateClinicalCribMultiple,
    updatePatientMultiple,
  ]);

  const requestAiRecommendation = useCallback(async () => {
    if (!isFeatureEnabled('SPECIALTY_AI_RECOMMENDATION') || !episodeKey || !currentUser?.uid)
      return null;
    setBusy(true);
    setRequestError(null);
    try {
      const deps = buildDeps();
      const result = await requestSpecialtyRecommendation(
        {
          episodeKey,
          recordDate,
          bedId,
          target,
          clientRequestId: `aireq-${crypto.randomUUID()}`,
          actorUid: currentUser.uid,
        },
        deps
      );
      if (result.status === 'recommended' || result.status === 'deduplicated') {
        setRecommendation(result.recommendation);
      } else {
        setRecommendation(null);
        setRequestError(result.reason ?? result.status);
      }
      return result.status;
    } catch {
      setRequestError('No fue posible obtener la recomendación.');
      return 'provider_error';
    } finally {
      setBusy(false);
    }
  }, [buildDeps, currentUser?.uid, episodeKey, recordDate, bedId, target]);

  const acceptAiCandidate = useCallback(
    async (specialty: string): Promise<boolean> => {
      if (!recommendation || !episodeKey || !currentUser?.uid) return false;
      setBusy(true);
      try {
        const deps = buildDeps();
        const outcome = await acceptSpecialtyRecommendation(
          {
            episodeKey,
            recommendationId: recommendation.recommendationId,
            specialty,
            actorUid: currentUser.uid,
            operationId: `aiacc-${crypto.randomUUID()}`,
          },
          deps
        );
        if (outcome.status === 'applied' || outcome.status === 'idempotent') {
          setRecommendation(prev => (prev ? { ...prev, status: 'accepted' } : prev));
          return true;
        }
        setRequestError(`La recomendación ya no es vigente (${outcome.status}).`);
        return false;
      } catch {
        setRequestError('No fue posible registrar la aceptación.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [buildDeps, currentUser?.uid, episodeKey, recommendation]
  );

  const discardRecommendation = useCallback(async () => {
    const rec = recommendation;
    setRecommendation(null);
    if (!rec || !currentUser?.uid) return;
    setBusy(true);
    try {
      const deps = buildDeps();
      await discardSpecialtyRecommendation(
        { recommendationId: rec.recommendationId, actorUid: currentUser.uid },
        deps
      );
    } finally {
      setBusy(false);
    }
  }, [buildDeps, currentUser?.uid, recommendation]);

  const rememberCurrentAssociation = useCallback(async (): Promise<
    'armed' | 'published' | 'rejected'
  > => {
    if (!isFeatureEnabled('SPECIALTY_RULES_MEMORY') || !episodeKey || !currentUser?.uid)
      return 'rejected';
    // Primera interacción: arma la confirmación explícita (sin escribir nada).
    if (!memoryConfirmArmed) {
      setMemoryConfirmArmed(true);
      return 'armed';
    }
    setBusy(true);
    try {
      const deps = buildDeps();
      const result = await rememberDiagnosisAssociation(
        {
          episodeKey,
          diagnosisCode: dataRef.current.cie10Code ?? '',
          diagnosisDescription:
            dataRef.current.cie10Description ?? dataRef.current.diagnosisComments ?? undefined,
          specialty: assignment.value,
          facilityId: hospitalId,
          actorUid: currentUser.uid,
          confirmed: true,
        },
        { catalogStore: deps.catalogStore, cie10: localCie10Port, clock, newId }
      );
      if (result.status === 'published') {
        setMemoryConfirmArmed(false);
        return 'published';
      }
      setRequestError(result.reason);
      return 'rejected';
    } catch {
      return 'rejected';
    } finally {
      setBusy(false);
    }
  }, [assignment.value, buildDeps, currentUser?.uid, episodeKey, hospitalId, memoryConfirmArmed]);

  return {
    enabled: isFeatureEnabled('SPECIALTY_EPISODE_ASSIGNMENT'),
    assignment,
    pending: isPendingAssignment(assignment),
    busy,
    recommendation,
    requestError,
    memoryConfirmArmed,
    requestAiRecommendation,
    acceptAiCandidate,
    discardRecommendation,
    rememberCurrentAssociation,
  };
};
