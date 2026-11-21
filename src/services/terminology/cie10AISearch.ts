/**
 * AI-Enhanced CIE-10 Search Service
 *
 * Security model:
 * - Production: browser calls only serverless endpoint
 * - Local development: optional direct Gemini fallback using local-only env var
 */

import { CIE10Entry } from './cie10SpanishDatabase';
import { aiRequestManager } from '../ai/aiRequestManager';
import { callLocalAI, getLocalDevProviderConfig } from '../ai/aiProviderConfig';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import {
  Cie10SearchRequestSchema,
  Cie10SearchResponseSchema,
  type Cie10SearchRequest,
} from '@/shared/contracts/serverless';

let aiIsAvailable = false;
let availabilityExpiresAt = 0;
let availabilityVersion = 0;
let availabilityCheck: Promise<boolean> | null = null;
const AVAILABLE_CACHE_MS = 60_000;
const UNAVAILABLE_CACHE_MS = 30_000;
const AVAILABILITY_TIMEOUT_MS = 10_000;

function rememberAvailability(available: boolean): boolean {
  aiIsAvailable = available;
  availabilityExpiresAt = Date.now() + (available ? AVAILABLE_CACHE_MS : UNAVAILABLE_CACHE_MS);
  availabilityVersion += 1;
  return available;
}

const parseAIResults = (rawText: string): CIE10Entry[] => {
  const text = rawText.trim();
  if (!text) return [];

  let jsonText = text;
  if (text.startsWith('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    jsonText = match ? match[1].trim() : text;
  }

  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter(
      item =>
        item &&
        typeof item.code === 'string' &&
        typeof item.description === 'string' &&
        item.code.trim().length > 0 &&
        item.description.trim().length > 0
    )
    .map(item => ({
      code: item.code,
      description: item.description,
      category: typeof item.category === 'string' ? item.category : 'IA',
    }));
};

async function searchWithServerlessFunction(
  query: string,
  signal?: AbortSignal
): Promise<{ available: boolean; results: CIE10Entry[] }> {
  try {
    const authHeaders = await resolveCurrentUserAuthHeaders();
    signal?.throwIfAborted();
    const requestBody: Cie10SearchRequest = Cie10SearchRequestSchema.parse({ query });
    const response = await fetch('/.netlify/functions/cie10-ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      return { available: false, results: [] };
    }

    const data = Cie10SearchResponseSchema.parse(await response.json());
    return {
      available: data.available === true,
      results: data.results || [],
    };
  } catch {
    signal?.throwIfAborted();
    return { available: false, results: [] };
  }
}

const buildLocalPrompt = (query: string): string => `
Eres un codificador experto de CIE-10 (Clasificación Internacional de Enfermedades, 10a edición) en español, trabajando para el Hospital Hanga Roa en Rapa Nui (Isla de Pascua).

TU TAREA: Dada la consulta del usuario: "${query}", devuelve hasta 8 códigos CIE-10 que mejor representen el diagnóstico clínico.

CONSIDERACIONES CRÍTICAS:
1. ABREVIACIONES MÉDICAS CHILENAS: Interpretación obligatoria:
   - IAM: Infarto agudo del miocardio (I21.9)
   - ACV / AVE: Accidente cerebrovascular (I63.9 o I64)
   - NAC: Neumonía adquirida en la comunidad (J18.9)
   - TVP: Trombosis venosa profunda (I82.4)
   - ITU: Infección del tracto urinario (N39.0)
   - HTA: Hipertensión arterial (I10)
   - DM / DM2: Diabetes mellitus (E11.9)
   - EPOC: Enfermedad pulmonar obstructiva crónica (J44.9)
   - AKI / IRA: Lesión renal aguda (N17.9)
   - TEP: Tromboembolismo pulmonar (I26.9)
   - GEA: Gastroenteritis aguda (A09.9)
   - TEC: Traumatismo encéfalo craneano (S06.9)
   - UPC: Unidad de Paciente Crítico (contexto grave)

2. CONTEXTO RAPA NUI:
   - "Dengue": A90
   - "Zika": A92.8
   - "Mordedura de perro": W54.0

3. CALIDAD DE RESPUESTA:
   - Responde ÚNICAMENTE con un array JSON válido.
   - Cada objeto debe tener: "code", "description" (en español formal), "category" (agregación médica).
   - No incluyas markdown, bloques de código \`\`\`json, ni texto explicativo.

Ejemplo:
[
  {"code": "I21.9", "description": "Infarto agudo del miocardio, sin otra especificación", "category": "Cardiovasculares"},
  {"code": "I10", "description": "Hipertensión esencial (primaria)", "category": "Cardiovasculares"}
]
`;

const reportLocalFallbackFailure = (error: unknown): void => {
  recordOperationalErrorTelemetry('integration', 'cie10_ai_local_fallback', error, {
    code: 'cie10_ai_local_fallback_failed',
    message: 'Fallo el fallback local de IA para CIE-10.',
    severity: 'warning',
    userSafeMessage: 'La busqueda IA local no esta disponible en este momento.',
    context: { devMode: import.meta.env.DEV },
  });
};

async function searchWithLocalDevAPI(query: string, signal?: AbortSignal): Promise<CIE10Entry[]> {
  if (!import.meta.env.DEV) return [];
  signal?.throwIfAborted();
  const rawText = await callLocalAI(buildLocalPrompt(query), {
    signal,
    systemPrompt: 'Eres un codificador experto CIE-10. Responde solo con JSON válido.',
    onError: reportLocalFallbackFailure,
  });
  signal?.throwIfAborted();
  if (!rawText) return [];
  try {
    return parseAIResults(rawText);
  } catch (error) {
    reportLocalFallbackFailure(error);
    return [];
  }
}

export async function searchCIE10WithAI(
  query: string,
  signal?: AbortSignal
): Promise<CIE10Entry[]> {
  if (!query || query.length < 2) return [];

  return aiRequestManager.enqueue(
    `cie10-${query}`,
    async innerSignal => {
      const joinedSignal = innerSignal || signal;
      const serverlessResult = await searchWithServerlessFunction(query, joinedSignal);
      joinedSignal?.throwIfAborted();

      if (serverlessResult.available) {
        rememberAvailability(true);
        return serverlessResult.results;
      }

      const localResults = await searchWithLocalDevAPI(query, joinedSignal);
      joinedSignal?.throwIfAborted();
      if (localResults.length > 0) {
        rememberAvailability(true);
        return localResults;
      }

      rememberAvailability(false);
      return [];
    },
    signal
  );
}

export async function checkAIAvailability(): Promise<boolean> {
  if (Date.now() < availabilityExpiresAt) return aiIsAvailable;
  if (availabilityCheck) return availabilityCheck;

  const version = availabilityVersion;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ available: boolean }>(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ available: false });
    }, AVAILABILITY_TIMEOUT_MS);
  });

  availabilityCheck = (async () => {
    let available = false;
    try {
      const result = await Promise.race([
        searchWithServerlessFunction('', controller.signal),
        deadline,
      ]);
      available = result.available;
    } catch {
      // A deadline or unavailable endpoint must not disable AI for the whole session.
    } finally {
      clearTimeout(timer);
    }

    // A completed search is newer evidence than this probe.
    if (version !== availabilityVersion) return aiIsAvailable;
    return rememberAvailability(available || Boolean(getLocalDevProviderConfig()));
  })().finally(() => {
    availabilityCheck = null;
  });

  return availabilityCheck;
}
