import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { generateClinicalAIText, resolveClinicalAIProviderConfig } from './lib/ai-provider';
import { loadClinicalAIRoutingConfigFromFirestore } from './lib/ai-provider-routing';
import { invokeWithTelemetry } from './lib/observability';
import {
  Cie10SearchRequestSchema,
  Cie10SearchResponseSchema,
} from '../../src/contracts/serverless';
import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';

interface CIE10Entry {
  code: string;
  description: string;
  category?: string;
}

const CIE10_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'viewer',
  'editor',
]);

const handler = async (event: NetlifyEventLike) => {
  const requestOrigin = getRequestOrigin(event);
  const corsHeaders = buildCorsHeaders(requestOrigin, {
    allowedHeaders: 'Content-Type, Authorization, Accept',
    allowedMethods: 'POST,OPTIONS',
  });

  if (!isOriginAllowed(requestOrigin)) {
    return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
  }

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Rate limit only the actual mutation/read request, not the CORS preflight.
  const clientIp = getClientIp(event);
  if (isRateLimited(clientIp, { maxPerWindow: 10, windowMs: 60_000 })) {
    return buildTooManyRequestsResponse(requestOrigin);
  }

  const baselineProviderConfig = resolveClinicalAIProviderConfig();

  if (!baselineProviderConfig) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        available: false,
        results: [],
        message: 'AI not configured',
      }),
    };
  }

  try {
    const { db } = getFirebaseServer();
    const authorizationHeader =
      typeof event.headers?.authorization === 'string'
        ? event.headers.authorization
        : typeof event.headers?.Authorization === 'string'
          ? event.headers.Authorization
          : undefined;

    const bearerToken = extractBearerToken(authorizationHeader);
    await authorizeRoleRequest(db, authorizationHeader, CIE10_ALLOWED_ROLES);
    const routingConfig = await loadClinicalAIRoutingConfigFromFirestore({ bearerToken });
    const providerConfig = resolveClinicalAIProviderConfig({
      action: 'cie10_search',
      routingConfig,
    });

    if (!providerConfig) {
      return buildJsonResponse(
        200,
        Cie10SearchResponseSchema.parse({
          available: false,
          results: [],
          message: 'AI not configured',
        }),
        { requestOrigin }
      );
    }

    const body = parseJsonBody<unknown>(event.body);
    if (!body.ok) {
      return buildJsonResponse(
        400,
        Cie10SearchResponseSchema.parse({ available: true, results: [], error: body.error }),
        { requestOrigin }
      );
    }

    const request = Cie10SearchRequestSchema.safeParse(body.value);
    if (!request.success) {
      return buildJsonResponse(
        400,
        Cie10SearchResponseSchema.parse({
          available: true,
          results: [],
          error: 'Payload inválido para búsqueda CIE-10.',
        }),
        { requestOrigin }
      );
    }

    const { query, prompt: customPrompt } = request.data;

    if (!query || query.length < 2) {
      return buildJsonResponse(
        200,
        Cie10SearchResponseSchema.parse({ available: true, results: [] }),
        { requestOrigin }
      );
    }

    // Use custom prompt when provided (e.g. FONASA search),
    // otherwise wrap query in the default CIE-10 template.
    const prompt =
      customPrompt ||
      `
Eres un experto en codificación CIE-10 (Clasificación Internacional de Enfermedades, 10a revisión) en español.

El usuario busca: "${query}"

Responde ÚNICAMENTE con un array JSON de hasta 8 códigos CIE-10 más relevantes para esta búsqueda.
Cada elemento debe tener: code (código CIE-10), description (descripción en español), category (categoría).

Ejemplo de formato de respuesta (solo el JSON, sin texto adicional):
[
  {"code": "J18.9", "description": "Neumonía, no especificada", "category": "Respiratorias"},
  {"code": "J15.9", "description": "Neumonía bacteriana, no especificada", "category": "Respiratorias"}
]

IMPORTANTE: Responde SOLO con el JSON, sin explicaciones ni markdown.
`;

    const text = await invokeWithTelemetry({
      service: 'clinical_ai',
      operation: 'cie10_search',
      timeoutMs: 30_000,
      maxAttempts: 2,
      db,
      hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
      context: {
        provider: providerConfig.provider,
        model: providerConfig.model,
        queryLength: query.length,
        hasCustomPrompt: Boolean(customPrompt),
      },
      fn: () =>
        generateClinicalAIText({
          config: providerConfig,
          systemPrompt:
            'Eres un experto en codificación CIE-10 en español. Debes responder solo con JSON válido.',
          userPrompt: prompt,
        }),
    });

    // Parse JSON from response
    let jsonText = text;
    if (text.startsWith('```')) {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      jsonText = match ? match[1].trim() : text;
    }

    const parsed = JSON.parse(jsonText);

    let results: CIE10Entry[] = [];
    if (Array.isArray(parsed)) {
      results = parsed
        .filter(
          item =>
            item.code &&
            item.description &&
            typeof item.code === 'string' &&
            typeof item.description === 'string'
        )
        .map(item => ({
          code: item.code,
          description: item.description,
          category: item.category || 'IA',
        }));
    }

    return buildJsonResponse(200, Cie10SearchResponseSchema.parse({ available: true, results }), {
      requestOrigin,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI search failed';
    const statusCode =
      message.includes('Access denied') || message.includes('no email claim')
        ? 403
        : message.includes('Authorization')
          ? 401
          : 200;

    if (statusCode !== 200) {
      return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
    }

    console.error('Error in AI CIE-10 search:', error);
    return buildJsonResponse(
      200,
      Cie10SearchResponseSchema.parse({
        available: true,
        results: [],
        error: 'AI search failed',
      }),
      { requestOrigin }
    );
  }
};

export { handler };
