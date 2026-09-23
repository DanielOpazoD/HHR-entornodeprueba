/**
 * Recomendación consultiva de especialidad (DeepSeek-V4.1-Flash, backend-only).
 *
 * - La función es la ÚNICA vía hacia el proveedor: la API key vive en el
 *   entorno del servidor y nunca sale del backend.
 * - Solo opera sobre episodios `pending` no resueltos por reglas: un
 *   episodio con decisión vigente o resoluble por regla/memoria nunca llega
 *   al proveedor (cero llamadas innecesarias).
 * - El paquete enviado son datos mínimos autorizados: jamás nombres, RUT,
 *   cama, fechas, IDs de episodio ni texto clínico íntegro.
 * - La respuesta del modelo se valida con esquema estricto (JSON puro, 1–3
 *   candidatos del catálogo permitido, certeza alta|media|baja) y se guarda
 *   como recomendación separada: NUNCA escribe `specialty` ni la asignación.
 * - Aceptar una alternativa es una decisión manual del usuario hecha por el
 *   canal clínico habitual (specialty + specialtyAssignment), no por aquí.
 *
 * Modo: `SPECIALTY_AI_MODE` = off (default) | on_request | suggest_unresolved.
 * Presupuesto: `SPECIALTY_AI_MONTHLY_BUDGET` (default 200/mes/hospital).
 */
import { createHash } from 'node:crypto';

import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { createFirestoreRestClient, type FirestoreRestClient } from './lib/firestore-rest';
import { generateClinicalAICompletion } from './lib/ai-provider';
import { loadClinicalAIRoutingConfigFromFirestore } from './lib/ai-provider-routing';
import { invokeWithTelemetry } from './lib/observability';
import {
  ageBandOf,
  buildSpecialtyAiSystemPrompt,
  extractJsonPayload,
  serializeAiPackage,
  validateSpecialtyAiResponse,
  SPECIALTY_AI_DEFAULT_MODEL,
  SPECIALTY_AI_PROMPT_VERSION,
  type SpecialtyAiPackage,
} from './lib/specialty-ai-contract';
import { deriveSpecialtyAssignment } from '../../src/domain/specialtyAssignment/contracts';
import {
  eligibleProfessionalSpecialties,
  evidenceFingerprint,
} from '../../src/domain/specialtyAssignment/evidence';
import { resolveSpecialtyAssignment } from '../../src/domain/specialtyAssignment/resolver';
import {
  activeRulesFor,
  normalizeRuleCatalog,
} from '../../src/domain/specialtyAssignment/ruleCatalog';
import { captureEpisodeEvidence } from '../../src/services/specialty/specialtyEvidenceFactory';
import { professionalCatalogVersionOf } from '../../src/services/specialty/professionalCatalogVersion';
import { normalizeProfessionalCatalog } from '../../src/services/repositories/contracts/catalogContracts';
import {
  SpecialtyAiRecommendationRequestSchema,
  SpecialtyAiRecommendationResponseSchema,
  StoredSpecialtyRecommendationSchema,
} from '../../src/contracts/serverless';
import type { PatientData } from '../../src/types/domain/patient';
import {
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';

const SPECIALTY_AI_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

const DEFAULT_MONTHLY_BUDGET = 200;
const RECOMMENDATION_TTL_MS = 24 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_POLICY_NOTES = 5;
const MAX_NOTE_CHARS = 160;

type SpecialtyAiMode = 'off' | 'on_request' | 'suggest_unresolved';

const resolveSpecialtyAiMode = (env: NodeJS.ProcessEnv): SpecialtyAiMode => {
  const raw = (env.SPECIALTY_AI_MODE || 'off').trim().toLowerCase();
  return raw === 'on_request' || raw === 'suggest_unresolved' ? raw : 'off';
};

const resolveMonthlyBudget = (env: NodeJS.ProcessEnv): number => {
  const raw = Number(env.SPECIALTY_AI_MONTHLY_BUDGET);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_BUDGET;
};

const resolveDeepseekChatEndpoint = (env: NodeJS.ProcessEnv): string => {
  const normalized = (env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(
    /\/+$/,
    ''
  );
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
};

/** Deduplicación: misma evidencia + mismas reglas + mismo prompt ⇒ mismo id. */
const recommendationIdFor = (parts: {
  hospitalId: string;
  episodeKey: string;
  evidenceFingerprint: string;
  ruleSetVersion: string;
}): string => {
  const hash = createHash('sha256')
    .update(
      [
        parts.hospitalId,
        parts.episodeKey,
        parts.evidenceFingerprint,
        parts.ruleSetVersion,
        SPECIALTY_AI_PROMPT_VERSION,
      ].join('|')
    )
    .digest('hex');
  return `rec_${hash.slice(0, 32)}`;
};

const monthStartIso = (now: Date): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

const recordRevisionOf = (record: Record<string, unknown>): number =>
  Number.isInteger(record.version) ? (record.version as number) : 0;

const patientFromRecord = (
  record: Record<string, unknown>,
  bedId: string,
  target: 'bed' | 'clinicalCrib'
): PatientData | null => {
  const beds = record.beds as Record<string, unknown> | undefined;
  const bed = beds?.[bedId] as PatientData | undefined;
  if (!bed || typeof bed !== 'object') return null;
  if (target === 'clinicalCrib') {
    const crib = bed.clinicalCrib;
    return crib && typeof crib === 'object' ? crib : null;
  }
  return bed;
};

const policyNotesFrom = (rules: ReturnType<typeof activeRulesFor>): string[] =>
  rules
    .map(rule => `${rule.name}: ${rule.reason}`.trim())
    .filter(note => note.length > 1)
    .map(note => note.slice(0, MAX_NOTE_CHARS))
    .slice(0, MAX_POLICY_NOTES);

interface SpecialtyAiRecommendationDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
  loadRoutingConfig: typeof loadClinicalAIRoutingConfigFromFirestore;
  createRestClient: typeof createFirestoreRestClient;
  generateCompletion: typeof generateClinicalAICompletion;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

const unavailable = (reason: string, message: string, requestOrigin?: string) =>
  buildJsonResponse(
    200,
    SpecialtyAiRecommendationResponseSchema.parse({
      available: false,
      reason,
      message,
    }),
    { requestOrigin }
  );

export const createSpecialtyAiRecommendationHandler = (
  dependencies: SpecialtyAiRecommendationDependencies = {
    getFirebaseServer,
    authorizeRoleRequest,
    extractBearerToken,
    loadRoutingConfig: loadClinicalAIRoutingConfigFromFirestore,
    createRestClient: createFirestoreRestClient,
    generateCompletion: generateClinicalAICompletion,
    now: () => new Date(),
    env: process.env,
  }
) => {
  return async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const env = dependencies.env;

    if (!isOriginAllowed(requestOrigin)) {
      return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
    }
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          ...buildJsonResponse(200, {}, { requestOrigin }).headers,
          'Content-Length': '0',
        },
        body: '',
      };
    }
    if (event.httpMethod !== 'POST') {
      return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
    }
    if (isRateLimited(getClientIp(event), { maxPerWindow: 5, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    // Flag de despliegue: todo comportamiento de IA parte apagado.
    if (resolveSpecialtyAiMode(env) === 'off') {
      return unavailable(
        'disabled',
        'La recomendación de especialidad por IA está desactivada.',
        requestOrigin
      );
    }

    const authorizationHeader =
      typeof event.headers?.authorization === 'string'
        ? event.headers.authorization
        : typeof event.headers?.Authorization === 'string'
          ? event.headers.Authorization
          : undefined;

    let bearerToken: string;
    try {
      bearerToken = dependencies.extractBearerToken(authorizationHeader);
    } catch (error) {
      return buildJsonResponse(
        401,
        { error: error instanceof Error ? error.message : 'Authentication required.' },
        { requestOrigin }
      );
    }

    try {
      const { db } = dependencies.getFirebaseServer();
      const authorized = await dependencies.authorizeRoleRequest(
        db,
        authorizationHeader,
        SPECIALTY_AI_ALLOWED_ROLES
      );
      const requesterUid = String(authorized.token.sub || '');

      const body = parseJsonBody<unknown>(event.body);
      if (!body.ok) {
        return buildJsonResponse(400, { error: body.error }, { requestOrigin });
      }
      const request = SpecialtyAiRecommendationRequestSchema.safeParse(body.value);
      if (!request.success) {
        return buildJsonResponse(
          400,
          { error: 'recordDate, bedId, clientRequestId y evidenceFingerprint son requeridos.' },
          { requestOrigin }
        );
      }

      const hospitalId = env.ACTIVE_HOSPITAL_ID || 'hanga_roa';
      const rest: FirestoreRestClient = dependencies.createRestClient({
        bearerToken,
        env,
      });

      // Política de routing: la acción puede estar apagada a nivel hospital;
      // el proveedor queda fijado a DeepSeek — sin escalada silenciosa.
      const routingConfig = (await dependencies.loadRoutingConfig({ bearerToken })) ?? null;
      const actionRule = routingConfig?.actions?.specialty_recommendation;
      if (actionRule?.enabled === false) {
        return unavailable(
          'disabled',
          'La acción de recomendación está desactivada para este hospital.',
          requestOrigin
        );
      }
      if (actionRule?.provider && actionRule.provider !== 'deepseek') {
        return unavailable(
          'provider_error',
          'La recomendación de especialidad solo está autorizada con DeepSeek.',
          requestOrigin
        );
      }

      const apiKey = env.DEEPSEEK_API_KEY?.trim();
      if (!apiKey) {
        return unavailable(
          'provider_error',
          'DeepSeek no está configurado en el backend.',
          requestOrigin
        );
      }
      const model =
        actionRule?.model?.trim() ||
        env.DEEPSEEK_SPECIALTY_MODEL?.trim() ||
        SPECIALTY_AI_DEFAULT_MODEL;

      const record = await rest.getDocument(
        `hospitals/${hospitalId}/dailyRecords/${request.data.recordDate}`
      );
      if (!record) {
        return buildJsonResponse(
          404,
          { error: `Daily record '${request.data.recordDate}' not found.` },
          { requestOrigin }
        );
      }
      const patient = patientFromRecord(record, request.data.bedId, request.data.target);
      if (!patient || !String(patient.clinicalEpisodeId ?? '').trim()) {
        return buildJsonResponse(
          404,
          { error: 'Episodio no encontrado en la cama indicada.' },
          { requestOrigin }
        );
      }

      // Verificación autoritativa del estado: solo `pending` puede pedir IA.
      const assignment = deriveSpecialtyAssignment(patient);
      if (assignment.state !== 'pending') {
        return unavailable(
          'not_pending',
          'El episodio ya tiene una decisión de especialidad vigente.',
          requestOrigin
        );
      }

      const [catalogDoc, professionalsDoc] = await Promise.all([
        rest.getDocument(`hospitals/${hospitalId}/settings/specialtyRulesCatalog`),
        rest.getDocument(`hospitals/${hospitalId}/settings/professionals_catalog`),
      ]);
      const ruleCatalog = normalizeRuleCatalog(catalogDoc).catalog;
      const ruleSetVersion = String(ruleCatalog.revision ?? 0);
      const professionals = normalizeProfessionalCatalog(
        (professionalsDoc as { list?: unknown } | null)?.list
      );
      const professionalCatalogVersion = professionalCatalogVersionOf(professionals);

      const evidence = captureEpisodeEvidence({
        patient,
        facilityId: hospitalId,
        catalog: professionals,
        ruleSetVersion,
        professionalCatalogVersion,
        capturedAt: dependencies.now().toISOString(),
        bedType: (record.bedTypeOverrides as Record<string, string> | undefined)?.[
          request.data.bedId
        ],
      });
      if (!evidence) {
        return unavailable(
          'insufficient_context',
          'No hay evidencia de episodio evaluable.',
          requestOrigin
        );
      }

      // Revalidación de huella: si el paciente cambió desde que el usuario
      // pidió la recomendación, la solicitud quedó obsoleta.
      const fingerprint = evidenceFingerprint(evidence);
      if (fingerprint !== request.data.evidenceFingerprint) {
        return buildJsonResponse(
          409,
          {
            available: false,
            reason: 'stale',
            message: 'La evidencia del episodio cambió; vuelva a solicitar la recomendación.',
          },
          { requestOrigin }
        );
      }

      // Rechazo previo al proveedor: si las reglas vigentes ya resuelven el
      // episodio, no hay caso ambiguo que consultar.
      const rules = activeRulesFor(ruleCatalog, hospitalId);
      const resolverOutcome = resolveSpecialtyAssignment({
        existing: assignment,
        evidence,
        rules,
      });
      if (resolverOutcome.kind === 'assign_by_rule' || resolverOutcome.kind === 'keep_locked') {
        return unavailable(
          'not_pending',
          'Las reglas vigentes ya resuelven este episodio.',
          requestOrigin
        );
      }
      if (evidence.diagnosis.status === 'read_error') {
        return unavailable(
          'insufficient_context',
          'La evidencia diagnóstica no está cerrada.',
          requestOrigin
        );
      }

      // Presupuesto mensual por hospital.
      const used = await rest.countWhere(
        `hospitals/${hospitalId}/specialtyRecommendations`,
        [{ field: 'hospitalId', value: hospitalId }],
        { sinceField: 'createdAt', sinceValue: monthStartIso(dependencies.now()) }
      );
      if (used >= resolveMonthlyBudget(env)) {
        return unavailable(
          'budget_exhausted',
          'Presupuesto mensual de recomendaciones agotado.',
          requestOrigin
        );
      }

      const episodeKey = `${request.data.target === 'clinicalCrib' ? 'crib' : 'patient'}:${evidence.episodeId}`;
      const recommendationId = recommendationIdFor({
        hospitalId,
        episodeKey,
        evidenceFingerprint: fingerprint,
        ruleSetVersion,
      });
      const collectionPath = `hospitals/${hospitalId}/specialtyRecommendations`;

      // Deduplicación: misma evidencia+reglas+prompt → recomendación vigente.
      const existing = await rest.getDocument(`${collectionPath}/${recommendationId}`);
      if (existing) {
        const parsed = StoredSpecialtyRecommendationSchema.safeParse(existing);
        if (parsed.success && parsed.data.status === 'available') {
          return buildJsonResponse(
            200,
            SpecialtyAiRecommendationResponseSchema.parse({
              available: true,
              deduplicated: true,
              provider: 'deepseek',
              model,
              recommendation: parsed.data,
            }),
            { requestOrigin }
          );
        }
        if (parsed.success && parsed.data.status !== 'available') {
          return unavailable(
            'not_pending',
            'La recomendación equivalente ya fue resuelta.',
            requestOrigin
          );
        }
      }

      const aiPackage: SpecialtyAiPackage = {
        ...(evidence.diagnosis.status === 'present'
          ? {
              diagnosisCode: evidence.diagnosis.code,
              diagnosisDescription: evidence.diagnosis.description?.slice(0, 200),
            }
          : {}),
        ...(ageBandOf(evidence.context.ageYears)
          ? { ageBand: ageBandOf(evidence.context.ageYears) }
          : {}),
        ...(evidence.context.sex === 'M' || evidence.context.sex === 'F'
          ? { sex: evidence.context.sex }
          : {}),
        ...(evidence.context.isObstetric ? { isObstetric: true } : {}),
        professionalSpecialtySignals: eligibleProfessionalSpecialties(evidence),
        localPolicyNotes: policyNotesFrom(rules),
      };

      const completion = await invokeWithTelemetry({
        service: 'clinical_ai',
        operation: 'specialty_recommendation',
        timeoutMs: PROVIDER_TIMEOUT_MS + 10_000,
        maxAttempts: 1,
        db,
        hospitalId,
        context: {
          provider: 'deepseek',
          model,
          recordDate: request.data.recordDate,
          bedId: request.data.bedId,
        },
        fn: () =>
          dependencies.generateCompletion({
            config: {
              provider: 'deepseek',
              apiKey,
              model,
              endpoint: resolveDeepseekChatEndpoint(env),
            },
            systemPrompt: buildSpecialtyAiSystemPrompt(aiPackage.localPolicyNotes),
            userPrompt: `Paquete del caso (datos mínimos autorizados, JSON):\n${serializeAiPackage(aiPackage)}`,
            temperature: 0.1,
            maxTokens: 1000,
            responseFormat: 'json_object',
            disableThinking: true,
            timeoutMs: PROVIDER_TIMEOUT_MS,
          }),
      });

      if (completion.finishReason === 'length' || !completion.text.trim()) {
        return unavailable(
          'provider_error',
          'La respuesta del modelo fue vacía o truncada.',
          requestOrigin
        );
      }

      const parsedContent = validateSpecialtyAiResponse(extractJsonPayload(completion.text));
      if (!parsedContent.ok) {
        return unavailable(
          'provider_error',
          `Respuesta del modelo inválida (${parsedContent.reason}).`,
          requestOrigin
        );
      }
      if (parsedContent.content.status === 'insufficient_data') {
        // Respuesta legítima de abstención: no se persiste recomendación.
        return unavailable(
          'insufficient_context',
          'El modelo estimó datos insuficientes para sugerir una especialidad.',
          requestOrigin
        );
      }

      const nowIso = dependencies.now().toISOString();
      const recommendationDoc = {
        recommendationId,
        episodeKey,
        recordDate: request.data.recordDate,
        observedRevision: recordRevisionOf(record),
        evidenceFingerprint: fingerprint,
        ruleSetVersion,
        professionalCatalogVersion,
        promptVersion: SPECIALTY_AI_PROMPT_VERSION,
        modelRequested: model,
        ...(completion.model ? { modelReported: completion.model } : {}),
        status: 'available' as const,
        candidates: parsedContent.content.candidates,
        missingData: parsedContent.content.missingData,
        policyConflict: parsedContent.content.policyConflict,
        requesterUid,
        createdAt: nowIso,
        expiresAt: new Date(dependencies.now().getTime() + RECOMMENDATION_TTL_MS).toISOString(),
        hospitalId,
        bedTarget: request.data.target,
      };
      // El documento persistido incluye metadatos operativos (hospitalId,
      // bedTarget) que el DTO de respuesta omite deliberadamente.
      const recommendation = StoredSpecialtyRecommendationSchema.parse(recommendationDoc);

      const created = await rest.createDocument(collectionPath, recommendationId, {
        ...recommendationDoc,
      });
      if (created === 'exists') {
        const stored = await rest.getDocument(`${collectionPath}/${recommendationId}`);
        const parsed = StoredSpecialtyRecommendationSchema.safeParse(stored);
        if (parsed.success) {
          return buildJsonResponse(
            200,
            SpecialtyAiRecommendationResponseSchema.parse({
              available: true,
              deduplicated: true,
              provider: 'deepseek',
              model,
              recommendation: parsed.data,
            }),
            { requestOrigin }
          );
        }
      }

      return buildJsonResponse(
        200,
        SpecialtyAiRecommendationResponseSchema.parse({
          available: true,
          provider: 'deepseek',
          model,
          recommendation,
        }),
        { requestOrigin }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Specialty recommendation failed';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim')
          ? 403
          : message.includes('Authorization')
            ? 401
            : 500;
      return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
    }
  };
};

export const handler = createSpecialtyAiRecommendationHandler();
