/**
 * NLP Preprocessor for Diagnosis Search
 * 
 * Provides text normalization, synonym expansion, and fuzzy matching
 * to improve diagnosis search accuracy.
 */

import { expandSynonyms } from './diagnosisSynonyms';

/**
 * Normalize text for comparison
 * - Lowercase
 * - Remove accents
 * - Trim whitespace
 * - Collapse multiple spaces
 */
export function normalizeText(text: string): string {
    if (!text) return '';

    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/\s+/g, ' ') // Collapse spaces
        .trim();
}

/**
 * Tokenize text into words
 */
export function tokenize(text: string): string[] {
    return normalizeText(text)
        .split(/\s+/)
        .filter(token => token.length > 0);
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching
 */
export function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

/**
 * Calculate similarity score (0-1) between two strings
 * 1 = identical, 0 = completely different
 */
export function similarityScore(a: string, b: string): number {
    const normalizedA = normalizeText(a);
    const normalizedB = normalizeText(b);

    if (normalizedA === normalizedB) return 1;
    if (normalizedA.length === 0 || normalizedB.length === 0) return 0;

    const distance = levenshteinDistance(normalizedA, normalizedB);
    const maxLength = Math.max(normalizedA.length, normalizedB.length);

    return 1 - (distance / maxLength);
}

/**
 * Check if query fuzzy-matches target
 * Returns true if similarity is above threshold
 */
export function fuzzyMatch(query: string, target: string, threshold = 0.7): boolean {
    const normalizedQuery = normalizeText(query);
    const normalizedTarget = normalizeText(target);

    // Exact substring match
    if (normalizedTarget.includes(normalizedQuery)) {
        return true;
    }

    // Word-level matching
    const queryTokens = tokenize(query);
    const targetTokens = tokenize(target);

    // Check if any query token matches any target token with fuzzy matching
    for (const qToken of queryTokens) {
        for (const tToken of targetTokens) {
            if (similarityScore(qToken, tToken) >= threshold) {
                return true;
            }
        }
    }

    // Full string similarity for short queries
    if (query.length <= 8) {
        return similarityScore(query, target) >= threshold;
    }

    return false;
}

/**
 * Preprocess a search query
 * Returns expanded search terms and normalized query
 */
export interface PreprocessedQuery {
    original: string;
    normalized: string;
    tokens: string[];
    expansions: string[];
    hasSynonyms: boolean;
}

export function preprocessQuery(query: string): PreprocessedQuery {
    const normalized = normalizeText(query);
    const tokens = tokenize(query);
    const expansions = expandSynonyms(query);

    return {
        original: query,
        normalized,
        tokens,
        expansions,
        hasSynonyms: expansions.length > 0
    };
}

/**
 * Score a CIE-10 entry against a preprocessed query
 * Higher score = better match
 */
export function scoreMatch(
    description: string,
    code: string,
    query: PreprocessedQuery
): number {
    const normalizedDesc = normalizeText(description);
    const normalizedCode = normalizeText(code);
    let score = 0;

    // Exact match on code (highest priority)
    if (normalizedCode === query.normalized || normalizedCode.startsWith(query.normalized)) {
        score += 100;
    }

    // Exact substring match on description
    if (normalizedDesc.includes(query.normalized)) {
        score += 50;
        // Bonus for match at start
        if (normalizedDesc.startsWith(query.normalized)) {
            score += 20;
        }
    }

    // Token matching
    for (const token of query.tokens) {
        if (normalizedDesc.includes(token)) {
            score += 10;
        }
    }

    // Synonym expansion matches
    for (const expansion of query.expansions) {
        const normalizedExpansion = normalizeText(expansion);
        if (normalizedDesc.includes(normalizedExpansion)) {
            score += 40; // High value for synonym matches
        }
    }

    // Fuzzy matching (lower priority)
    if (score === 0 && fuzzyMatch(query.normalized, normalizedDesc, 0.75)) {
        score += 15;
    }

    return score;
}
