/**
 * Terminology Service - CIE-10 en Español con IA
 * 
 * Búsqueda híbrida de diagnósticos CIE-10:
 * 1. Primero busca en base de datos local (rápido)
 * 2. Si hay pocos resultados, complementa con IA (Gemini)
 */

import { searchCIE10Spanish, CIE10Entry } from './cie10SpanishDatabase';
import { searchCIE10WithAI, isAIAvailable } from './cie10AISearch';

// Re-export AI availability check
export { isAIAvailable };

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
 * Uses local database first, then AI fallback if needed.
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

        // 2. If we have enough local results, return them immediately
        if (localConcepts.length >= MIN_LOCAL_RESULTS) {
            return localConcepts;
        }

        // 3. Otherwise, try AI search in parallel (don't block)
        // We still return local results immediately,
        // but AI can provide additional suggestions
        try {
            const aiResults = await searchCIE10WithAI(query);

            if (aiResults.length > 0) {
                // Merge AI results, avoiding duplicates
                const existingCodes = new Set(localConcepts.map(c => c.code));

                const aiConcepts = aiResults
                    .filter(entry => !existingCodes.has(entry.code))
                    .map((entry: CIE10Entry) => ({
                        code: entry.code,
                        display: entry.description,
                        system: 'http://hl7.org/fhir/sid/icd-10',
                        category: entry.category + ' (IA)',
                        fromAI: true
                    }));

                // Combine: local first, then AI
                return [...localConcepts, ...aiConcepts].slice(0, 15);
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
