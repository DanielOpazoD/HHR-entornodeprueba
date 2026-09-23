/**
 * Adaptadores del puerto de recomendaciones de especialidad:
 *
 * - `createNetlifyRecommendationBackend`: llama a la función autorizada
 *   `/.netlify/functions/specialty-ai-recommendation` con el ID token del
 *   usuario. El proveedor (DeepSeek) nunca se contacta desde el navegador.
 * - `createFirestoreRecommendationStore`: almacén de recomendaciones sobre
 *   `hospitals/{h}/specialtyRecommendations` con deduplicación por id
 *   determinista y transiciones de estado transaccionales.
 */
import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { getSpecialtyRecommendationsPath } from '@/constants/firestorePaths';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { ensureFirestoreRuntimeReady } from '@/services/storage/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import {
  SpecialtyAiRecommendationRequestSchema,
  SpecialtyAiRecommendationResponseSchema,
  StoredSpecialtyRecommendationSchema,
} from '@/contracts/serverless';
import { AssignmentConflictError } from '@/application/specialtyAssignment/ports';
import type {
  SpecialtyRecommendationBackendPort,
  SpecialtyRecommendationStore,
  StoredSpecialtyRecommendation,
} from '@/application/specialtyAssignment/ports';
import type { RecommendationStatus } from '@/application/specialtyAssignment/ports';

const recommendationDocPath = (recommendationId: string, hospitalId?: string) =>
  `${getSpecialtyRecommendationsPath(hospitalId)}/${recommendationId}`;

const parseStoredRecommendation = (raw: unknown): StoredSpecialtyRecommendation | null => {
  const parsed = StoredSpecialtyRecommendationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const createNetlifyRecommendationBackend = (): SpecialtyRecommendationBackendPort => ({
  request: async input => {
    const authHeaders = await resolveCurrentUserAuthHeaders();
    if (!authHeaders.Authorization) return { status: 'unauthorized', reason: 'no_auth_token' };

    const body = SpecialtyAiRecommendationRequestSchema.parse({
      recordDate: input.recordDate,
      bedId: input.bedId,
      target: input.target ?? 'bed',
      clientRequestId: input.clientRequestId,
      evidenceFingerprint: input.evidenceFingerprint,
      ruleSetVersion: input.ruleSetVersion,
    });
    const response = await fetch('/.netlify/functions/specialty-ai-recommendation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body),
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const parsed = SpecialtyAiRecommendationResponseSchema.safeParse(payload);
    const reason =
      (parsed.success ? parsed.data.reason : undefined) ??
      (payload && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).error ?? '')
        : '');

    if (response.status === 409 || reason === 'stale') return { status: 'stale', reason };
    if (response.status === 401 || response.status === 403) {
      return { status: 'unauthorized', reason: reason || `http_${response.status}` };
    }
    if (!response.ok) {
      return { status: 'provider_error', reason: reason || `http_${response.status}` };
    }
    if (!parsed.success || !parsed.data.available || !parsed.data.recommendation) {
      const mapped =
        reason === 'disabled'
          ? 'disabled'
          : reason === 'not_pending'
            ? 'not_pending'
            : reason === 'budget_exhausted'
              ? 'budget_exhausted'
              : reason === 'insufficient_context'
                ? 'insufficient_context'
                : 'provider_error';
      return { status: mapped, reason };
    }
    return { status: 'ok', recommendation: parsed.data.recommendation };
  },
});

export const createFirestoreRecommendationStore = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): SpecialtyRecommendationStore => ({
  get: async recommendationId => {
    await ensureFirestoreRuntimeReady(runtime);
    const snapshot = await getDoc(doc(runtime.getDb(), recommendationDocPath(recommendationId)));
    return snapshot.exists() ? parseStoredRecommendation(snapshot.data()) : null;
  },

  createIfAbsent: async recommendation => {
    await ensureFirestoreRuntimeReady(runtime);
    return runTransaction(runtime.getDb(), async transaction => {
      const reference = doc(
        runtime.getDb(),
        recommendationDocPath(recommendation.recommendationId)
      );
      const snapshot = await transaction.get(reference);
      if (snapshot.exists()) return 'exists' as const;
      transaction.set(reference, { ...recommendation });
      return 'created' as const;
    });
  },

  transition: async (recommendationId, from, to, actorUid, at) => {
    await ensureFirestoreRuntimeReady(runtime);
    return runTransaction(runtime.getDb(), async transaction => {
      const reference = doc(runtime.getDb(), recommendationDocPath(recommendationId));
      const snapshot = await transaction.get(reference);
      const current = snapshot.exists() ? parseStoredRecommendation(snapshot.data()) : null;
      if (!current) {
        throw new AssignmentConflictError(`recommendation ${recommendationId} not found`);
      }
      if (!from.includes(current.status)) {
        throw new AssignmentConflictError(
          `recommendation ${recommendationId} is ${current.status}, expected ${from.join('|')}`
        );
      }
      const next: StoredSpecialtyRecommendation = {
        ...current,
        status: to,
        resolvedAt: at,
        resolvedByUid: actorUid,
      };
      transaction.update(reference, { status: to, resolvedAt: at, resolvedByUid: actorUid });
      return next;
    });
  },
});

/** Suscripción a una recomendación (para reflejar su estado en la ficha). */
export const subscribeToSpecialtyRecommendation = (
  recommendationId: string,
  callback: (recommendation: StoredSpecialtyRecommendation | null) => void,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): (() => void) => {
  let active = true;
  let unsubscribe = () => {};
  void ensureFirestoreRuntimeReady(runtime)
    .then(() => {
      if (!active) return;
      unsubscribe = onSnapshot(
        doc(runtime.getDb(), recommendationDocPath(recommendationId)),
        snapshot => callback(snapshot.exists() ? parseStoredRecommendation(snapshot.data()) : null),
        () => callback(null)
      );
    })
    .catch(() => callback(null));
  return () => {
    active = false;
    unsubscribe();
  };
};

/** Estados terminales: la recomendación ya no es aceptable. */
export const isRecommendationTerminal = (status: RecommendationStatus): boolean =>
  status === 'accepted' || status === 'discarded' || status === 'superseded';
