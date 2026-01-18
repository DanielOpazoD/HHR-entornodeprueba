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

// Minimum results before triggering AI search
const MIN_LOCAL_RESULTS = 3;

/**
 * Searches for diagnoses in CIE-10 (Spanish)
 * Uses local database first, then cached AI results, then live AI as fallback.
 */
export async function searchDiagnoses(query: string): Promise<TerminologyConcept[]> {
    if (!query || query.length < 2) return [];

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

        // 3. Fallback: If we have enough local results and no cache, return them immediately
        if (localConcepts.length >= MIN_LOCAL_RESULTS) {
            return localConcepts;
        }

        // 4. No cache hit and few local results - call AI and cache the results
        try {
            const aiResults = await searchCIE10WithAI(query);

            if (aiResults.length > 0) {
                // Cache the AI results for future use
                cacheAIResults(query, aiResults);

                // Merge AI results, avoiding duplicates
                const aiCodes = new Set(aiResults.map(c => c.code));

                const aiConcepts = aiResults.map((entry: CIE10Entry) => ({
                    code: entry.code,
                    display: entry.description,
                    system: 'http://hl7.org/fhir/sid/icd-10',
                    category: (entry.category || '') + ' (IA)',
                    fromAI: true
                }));

                const filteredLocal = localConcepts.filter(c => !aiCodes.has(c.code));

                // Combine: AI first, then local
                return [...aiConcepts, ...filteredLocal].slice(0, 15);
            }
        } catch (aiError) {
            console.warn('AI search failed, using local results only:', aiError);
        }

        return localConcepts;

    } catch (error) {
        console.error('Error in searchDiagnoses:', error);
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
export async function forceAISearch(query: string): Promise<TerminologyConcept[]> {
    if (!query || query.length < 2) return [];

    try {
        console.log(`🔄 Forcing AI search for "${query}" (updating cache)`);

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
        const aiResults = await searchCIE10WithAI(query);

        if (aiResults.length > 0) {
            // Save fresh results to cache
            cacheAIResults(query, aiResults);
            console.log(`💾 Cached ${aiResults.length} fresh AI results for "${query}"`);

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
