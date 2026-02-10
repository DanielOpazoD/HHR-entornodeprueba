/**
 * Terminology Service - CIE-10 en Español con IA
 * 
 * Búsqueda híbrida de diagnósticos CIE-10:
 * 1. Primero busca en base de datos local (rápido)
 * 2. Si hay pocos resultados, complementa con IA (Gemini)
 */

import { searchCIE10Spanish, CIE10Entry, CIE10_SPANISH_DATABASE } from './cie10SpanishDatabase';
import { searchCIE10WithAI } from './cie10AISearch';
import { getCachedAIResults, cacheAIResults } from './aiResultsCache';

export interface TerminologyConcept {
    code: string;        // CIE-10 code (e.g., E11.5)
    display: string;     // Diagnosis name in Spanish
    system: string;      // Always CIE-10 URI
    category?: string;   // Optional category
    fromAI?: boolean;    // True if suggested by AI
}

/**
 * Searches for diagnoses in CIE-10 (Spanish)
 * Uses local database first, then cached AI results.
 * Live AI search must be triggered manually via forceAISearch.
 */
export async function searchDiagnoses(query: string, signal?: AbortSignal): Promise<TerminologyConcept[]> {
    if (!query || query.length < 2 || signal?.aborted) return [];

    try {
        // 1. First, search local database (instant)
        const localResults = searchCIE10Spanish(query);

        const localConcepts = localResults.map((entry: CIE10Entry) => ({
            code: entry.code,
            display: entry.description,
            system: 'http://hl7.org/fhir/sid/icd-10',
            category: entry.category,
            fromAI: false
        }));

        // 2. Check if we have cached AI results for this query
        const cachedResults = getCachedAIResults(query);

        if (cachedResults && cachedResults.length > 0) {
            // Use cached AI results - PRIORITIZE them
            const aiCodes = new Set(cachedResults.map(c => c.code));

            const cachedConcepts = cachedResults.map((entry: CIE10Entry) => ({
                code: entry.code,
                display: entry.description,
                system: 'http://hl7.org/fhir/sid/icd-10',
                category: (entry.category || '') + ' (IA ⚡)',
                fromAI: true
            }));

            // Include local results that are NOT in AI results to avoid duplicates
            // but keep them after AI results
            const filteredLocal = localConcepts.filter(c => !aiCodes.has(c.code));

            return [...cachedConcepts, ...filteredLocal].slice(0, 15);
        }

        return localConcepts;

    } catch (error) {
        console.error('Error in searchDiagnoses:', error);
        return [];
    }
}

/**
 * Searches for diagnoses using AI (Gemini)
 * This function is intended to be called when AI results are specifically requested,
 * or when local results are insufficient.
 */
export async function searchDiagnosesAI(query: string, signal?: AbortSignal): Promise<TerminologyConcept[]> {
    try {
        // This function should ideally call a dedicated AI search function,
        // or forceAISearch if it's meant to update the cache.
        // Assuming 'forceAISearch' is the intended target for live AI search.
        const results = await forceAISearch(query, signal);
        return results;
    } catch (error) {
        console.error('Error in searchDiagnosesAI:', error);
        return [];
    }
}

/**
 * Looks up a CIE-10 description by code from the local database
 */
export function getCIE10Description(code: string): string | null {
    if (!code) return null;
    const entry = CIE10_SPANISH_DATABASE.find(e => e.code === code);
    return entry ? entry.description : null;
}

/**
 * Force a new AI search, bypassing cache
 * Used when user explicitly wants fresh AI results
 * Results are cached to ensure persistence.
 */
export async function forceAISearch(query: string, signal?: AbortSignal): Promise<TerminologyConcept[]> {
    if (!query || query.length < 2) return [];

    try {
        // console.debug(`🔄 Forcing AI search for "${query}" (updating cache)`);

        // Get local results first
        const localResults = searchCIE10Spanish(query);
        const localConcepts = localResults.map((entry: CIE10Entry) => ({
            code: entry.code,
            display: entry.description,
            system: 'http://hl7.org/fhir/sid/icd-10',
            category: entry.category,
            fromAI: false
        }));

        // Force AI call (bypass cache but save new results)
        const aiResults = await searchCIE10WithAI(query, signal);

        if (aiResults.length > 0) {
            // Save fresh results to cache
            cacheAIResults(query, aiResults);
            // console.debug(`💾 Cached ${aiResults.length} fresh AI results for "${query}"`);

            const aiCodes = new Set(aiResults.map(c => c.code));
            const aiConcepts = aiResults.map((entry: CIE10Entry) => ({
                code: entry.code,
                display: entry.description,
                system: 'http://hl7.org/fhir/sid/icd-10',
                category: (entry.category || '') + ' (IA 🔄)',
                fromAI: true
            }));

            const filteredLocal = localConcepts.filter(c => !aiCodes.has(c.code));
            return [...aiConcepts, ...filteredLocal].slice(0, 15);
        }

        return localConcepts;
    } catch (error) {
        console.error('Error in forceAISearch:', error);
        return [];
    }
}
