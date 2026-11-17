/**
 * fonasaService
 *
 * Smart search service for FONASA billing codes (Arancel FONASA).
 *
 *  - **Anexo 9**: Intervenciones Quirúrgicas (~1113 entries)
 *  - **Anexo 14**: Procedimientos (~654 entries)
 *
 * Search strategy (layered):
 *  1. Code prefix match (e.g. "1103" → all 1103xxx codes)
 *  2. Multi-token + abbreviation expansion (e.g. "Qx vesícula" →
 *     expands "Qx" to "quirúrgica", matches entries containing those terms)
 *  3. AI-powered search via local AI provider (on-demand button, for
 *     concepts like "hueso roto" → finds "fractura" entries)
 *
 * Data sourced from Esquema_Registros_2026.xlsx (MINSAL).
 * The JSON database is lazy-loaded on first search.
 */

import { callLocalAI, isLocalAIAvailable } from '@/services/ai/aiProviderConfig';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { removeAccents } from '@/utils/stringUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FonasaEntry {
  /** FONASA billing code (e.g. "1103049"). */
  code: string;
  /** Spanish description of the intervention or procedure. */
  description: string;
  /** Whether this result came from AI search. */
  fromAI?: boolean;
}

export type FonasaCatalog = 'interventions' | 'procedures';

interface FonasaDatabase {
  interventions: FonasaEntry[];
  procedures: FonasaEntry[];
}

// ---------------------------------------------------------------------------
// Lazy-loaded database
// ---------------------------------------------------------------------------

let databasePromise: Promise<FonasaDatabase> | null = null;

const loadDatabase = (): Promise<FonasaDatabase> => {
  databasePromise ??= import('@/services/terminology/fonasaDatabase.json').then(
    m => m.default as FonasaDatabase
  );
  return databasePromise;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum results returned per search.
 * Capped at 15 to avoid overwhelming the dropdown UI.
 */
const MAX_RESULTS = 15;

// ---------------------------------------------------------------------------
// Medical abbreviation expansion map (Chilean clinical usage)
// ---------------------------------------------------------------------------

/**
 * Common medical abbreviations used by Chilean clinical staff.
 *
 * Keys are normalised (lowercase, no accents). Each key maps to an
 * array of expanded terms that will be searched in catalog descriptions.
 * This enables queries like "Qx vesícula" to find "Colecistectomía, trat. quir."
 *
 * Categories:
 *  - Surgical: Qx, quir, trat, repar, extirp, c/s, desc
 *  - Imaging: Dx, Rx, TAC, eco, RNM/RMN, lap
 *  - Anatomy shortcuts: vesícula→colecistectomía, apéndice→apendicectomía, etc.
 */
const ABBREVIATION_MAP: ReadonlyMap<string, readonly string[]> = new Map([
  // Surgical
  ['qx', ['quirurgica', 'quirurgico', 'cirugia']],
  ['quir', ['quirurgica', 'quirurgico']],
  ['trat', ['tratamiento']],
  ['repar', ['reparacion']],
  ['extirp', ['extirpacion']],
  ['c/s', ['con sin']],
  ['desc', ['descompresion', 'descompresiva']],
  // Imaging / procedures
  ['dx', ['diagnostico']],
  ['rx', ['radiografia']],
  ['tac', ['tomografia computarizada']],
  ['eco', ['ecografia', 'ecografica']],
  ['rnm', ['resonancia magnetica']],
  ['rmn', ['resonancia magnetica']],
  ['lap', ['laparoscopica', 'laparoscopia']],
  // Anatomy shortcuts
  ['vesicula', ['colecistectomia', 'vesicula', 'biliar']],
  ['apendice', ['apendicectomia', 'apendice', 'apendicular']],
  ['utero', ['histerectomia', 'uterina', 'utero']],
  ['riñon', ['nefrectomia', 'renal', 'rinon']],
  ['rinon', ['nefrectomia', 'renal', 'rinon']],
  ['pulmon', ['pulmonar', 'pulmon', 'lobectomia', 'neumonectomia']],
  ['mama', ['mastectomia', 'mamaria', 'mama']],
  ['tiroides', ['tiroidectomia', 'tiroides']],
  ['hernia', ['herniorrafia', 'hernioplastia', 'hernia']],
  ['hueso', ['osea', 'fractura', 'osteosintesis']],
  ['fractura', ['fractura', 'osteosintesis', 'reduccion']],
]);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Normalises a string for accent-insensitive, case-insensitive comparison.
 * Strips diacritics via NFD decomposition and converts to lowercase.
 */
const normalise = (str: string): string => removeAccents(str.toLowerCase());

// ---------------------------------------------------------------------------
// Token expansion
// ---------------------------------------------------------------------------

/**
 * Expands a query into groups of search tokens. Each group contains
 * the normalised original word plus any abbreviation expansions.
 *
 * @example
 * expandQueryTokens("Qx vesícula")
 * // → [["quirurgica","quirurgico","cirugia"], ["colecistectomia","vesicula","biliar"]]
 *
 * @param query - Raw user query string.
 * @returns Array of token groups (words shorter than 2 chars are filtered).
 */
export const expandQueryTokens = (query: string): string[][] => {
  const words = normalise(query)
    .split(/\s+/)
    .filter(w => w.length >= 2);

  return words.map(word => {
    const expansions = ABBREVIATION_MAP.get(word);
    return expansions ? [...expansions] : [word];
  });
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Scores a catalog entry against expanded token groups.
 *
 * Scoring rules:
 *  - Each token group that has at least one matching term adds 1 point.
 *  - When ALL groups match (AND condition), the score is doubled to
 *    prioritise entries where every search term is present.
 *
 * @param normDesc - Normalised description of the catalog entry.
 * @param tokenGroups - Expanded token groups from {@link expandQueryTokens}.
 * @returns 0 for no match, positive number for matches (higher = better).
 */
const scoreEntry = (normDesc: string, tokenGroups: string[][]): number => {
  if (tokenGroups.length === 0) return 0;

  let matchedGroups = 0;
  for (const group of tokenGroups) {
    if (group.some(token => normDesc.includes(token))) matchedGroups++;
  }

  if (matchedGroups === 0) return 0;
  return matchedGroups === tokenGroups.length ? matchedGroups * 2 : matchedGroups;
};

// ---------------------------------------------------------------------------
// Local search (smart)
// ---------------------------------------------------------------------------

/**
 * Searches a FONASA catalog using multi-token + abbreviation expansion.
 *
 * @param catalog - 'interventions' (Anexo 9) or 'procedures' (Anexo 14).
 * @param query   - Free-text query (min 2 chars). Supports abbreviations.
 * @returns Up to {@link MAX_RESULTS} entries sorted by relevance.
 */
export const searchFonasa = async (
  catalog: FonasaCatalog,
  query: string
): Promise<FonasaEntry[]> => {
  if (!query || query.length < 2) return [];

  const db = await loadDatabase();
  const entries = catalog === 'interventions' ? db.interventions : db.procedures;
  const trimmedQuery = query.trim();

  // 1. Code prefix match
  if (/^\d{2,}$/.test(trimmedQuery)) {
    return entries.filter(e => e.code.startsWith(trimmedQuery)).slice(0, MAX_RESULTS);
  }

  // 2. Multi-token + abbreviation search
  const tokenGroups = expandQueryTokens(trimmedQuery);
  if (tokenGroups.length === 0) return [];

  const scored: Array<{ entry: FonasaEntry; score: number }> = [];

  for (const entry of entries) {
    const normDesc = normalise(entry.description);
    const score = scoreEntry(normDesc, tokenGroups);
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort(
    (a, b) => b.score - a.score || a.entry.description.localeCompare(b.entry.description)
  );

  return scored.slice(0, MAX_RESULTS).map(s => s.entry);
};

// ---------------------------------------------------------------------------
// AI search (on-demand via shared AI provider infrastructure)
// ---------------------------------------------------------------------------

const buildFonasaAIPrompt = (catalog: FonasaCatalog, query: string): string => `
Eres un codificador experto de procedimientos médicos FONASA en Chile.

CATÁLOGO: ${catalog === 'interventions' ? 'Anexo 9 - Intervenciones Quirúrgicas' : 'Anexo 14 - Procedimientos'}

TAREA: Dada la consulta "${query}", devuelve hasta 8 códigos FONASA del ${catalog === 'interventions' ? 'Anexo 9' : 'Anexo 14'} que mejor representen lo solicitado.

IMPORTANTE:
- Interpreta abreviaturas médicas chilenas (Qx, trat., quir., etc.)
- Interpreta sinónimos y conceptos ("vesícula" → colecistectomía)
- Los códigos FONASA son de 7 dígitos
- Devuelve SOLO JSON válido, sin texto adicional ni bloques de código

Formato de respuesta (JSON array):
[{"code": "1234567", "description": "Descripción del procedimiento"}]
`;

/**
 * Whether AI search is available for FONASA catalogs.
 * Available when either a local AI provider is configured (dev)
 * or the serverless CIE-10 endpoint is reachable (production).
 * Returns true optimistically — the actual call may still fail.
 */
export const isFonasaAIAvailable = (): boolean => true;

/**
 * AI-powered FONASA search. Strategy:
 *  1. Try local AI provider (dev: Gemini/OpenAI/Anthropic)
 *  2. Fallback: serverless endpoint with FONASA-specific prompt
 *
 * @param catalog - Which catalog to search.
 * @param query   - Natural language query.
 * @returns Matched entries with `fromAI: true` flag.
 */
export const searchFonasaAI = async (
  catalog: FonasaCatalog,
  query: string
): Promise<FonasaEntry[]> => {
  if (!query || query.length < 2) return [];

  // 1. Try local AI provider (dev mode: Gemini/OpenAI/Anthropic)
  if (isLocalAIAvailable()) {
    try {
      const rawText = await callLocalAI(buildFonasaAIPrompt(catalog, query));
      if (rawText) return parseAIRawText(rawText);
    } catch {
      // Local AI failed — fall through to serverless
    }
  }

  // 2. Fallback: serverless endpoint (production only — not available on localhost)
  if (import.meta.env.DEV) return [];

  try {
    const authHeaders = await resolveCurrentUserAuthHeaders();
    const response = await fetch('/.netlify/functions/cie10-ai-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        query,
        prompt: buildFonasaAIPrompt(catalog, query),
      }),
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      available?: boolean;
      results?: Array<{ code?: string; description?: string }>;
    };
    if (!data.available || !data.results) return [];

    return data.results
      .filter(r => r.code && r.description)
      .map(r => ({ code: r.code!, description: r.description!, fromAI: true }))
      .slice(0, MAX_RESULTS);
  } catch {
    return [];
  }
};

/** Parses raw AI text response into FonasaEntry array. */
const parseAIRawText = (text: string): FonasaEntry[] => {
  if (!text) return [];

  let jsonText = text;
  if (text.startsWith('```')) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    jsonText = match ? match[1].trim() : text;
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item: Record<string, unknown>) =>
          typeof item?.code === 'string' &&
          typeof item?.description === 'string' &&
          (item.code as string).trim().length > 0
      )
      .map((item: Record<string, unknown>) => ({
        code: (item.code as string).trim(),
        description: (item.description as string).trim(),
        fromAI: true,
      }))
      .slice(0, MAX_RESULTS);
  } catch {
    return [];
  }
};
