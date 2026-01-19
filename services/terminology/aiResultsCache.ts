/**
 * AI Results Cache - Local Storage for CIE-10 AI Search Results
 * 
 * Caches AI-generated diagnosis suggestions to avoid redundant API calls
 * and save tokens. Results are stored in localStorage with TTL.
 */

import { CIE10Entry } from './cie10SpanishDatabase';

// Cache configuration
const CACHE_KEY = 'cie10_ai_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 50;

interface CacheEntry {
    query: string;
    results: CIE10Entry[];
    timestamp: number;
}

interface CacheData {
    entries: CacheEntry[];
    version: number;
}

const CACHE_VERSION = 1;

/**
 * Get the current cache data from localStorage
 */
function getCache(): CacheData {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) {
            return { entries: [], version: CACHE_VERSION };
        }

        const data = JSON.parse(raw) as CacheData;

        // Version check for future migrations
        if (data.version !== CACHE_VERSION) {
            return { entries: [], version: CACHE_VERSION };
        }

        return data;
    } catch {
        return { entries: [], version: CACHE_VERSION };
    }
}

/**
 * Save cache data to localStorage
 */
function saveCache(data: CacheData): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (error) {
        console.warn('Failed to save AI results cache:', error);
    }
}

/**
 * Normalize query for cache key matching
 */
function normalizeQuery(query: string): string {
    return query.toLowerCase().trim();
}

/**
 * Check if a cache entry is still valid (not expired)
 */
function isValidEntry(entry: CacheEntry): boolean {
    const now = Date.now();
    return (now - entry.timestamp) < CACHE_TTL_MS;
}

/**
 * Get cached AI results for a query
 * Returns null if no valid cache exists
 */
export function getCachedAIResults(query: string): CIE10Entry[] | null {
    const normalized = normalizeQuery(query);
    const cache = getCache();

    // console.debug(`🔍 Looking for cache: "${query}" (normalized: "${normalized}")`);
    // console.debug(`📋 Cache has ${cache.entries.length} entries:`, cache.entries.map(e => e.query));

    const entry = cache.entries.find(e =>
        normalizeQuery(e.query) === normalized && isValidEntry(e)
    );

    if (entry) {
        // console.debug(`✅ Cache HIT for "${query}" (${entry.results.length} results)`);
        return entry.results;
    }

    // console.debug(`❌ Cache MISS for "${query}"`);
    return null;
}

/**
 * Cache AI results for a query
 */
export function cacheAIResults(query: string, results: CIE10Entry[]): void {
    if (!query || results.length === 0) {
        console.warn('⚠️ cacheAIResults: skipping - no query or no results');
        return;
    }

    const normalized = normalizeQuery(query);
    const cache = getCache();

    // console.debug(`💾 Caching ${results.length} results for "${query}" (normalized: "${normalized}")`);

    // Remove existing entry for same query (update)
    const prevCount = cache.entries.length;
    cache.entries = cache.entries.filter(e =>
        normalizeQuery(e.query) !== normalized
    );
    if (cache.entries.length < prevCount) {
        // console.debug(`🔄 Replaced existing cache entry for "${normalized}"`);
    }

    // Add new entry
    cache.entries.push({
        query: normalized,
        results,
        timestamp: Date.now()
    });

    // Remove expired entries
    cache.entries = cache.entries.filter(isValidEntry);

    // Limit cache size (remove oldest entries)
    if (cache.entries.length > MAX_CACHE_ENTRIES) {
        cache.entries.sort((a, b) => b.timestamp - a.timestamp);
        cache.entries = cache.entries.slice(0, MAX_CACHE_ENTRIES);
    }

    saveCache(cache);
    // console.debug(`✅ Cache saved! Now has ${cache.entries.length} entries:`, cache.entries.map(e => e.query));
}

/**
 * Get all cached queries (for debugging/display)
 */
export function getCachedQueries(): string[] {
    const cache = getCache();
    return cache.entries
        .filter(isValidEntry)
        .map(e => e.query);
}

/**
 * Clear all cached AI results
 */
export function clearAICache(): void {
    localStorage.removeItem(CACHE_KEY);
    // console.info('🗑️ AI results cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { entries: number; oldestAge: number } {
    const cache = getCache();
    const validEntries = cache.entries.filter(isValidEntry);

    if (validEntries.length === 0) {
        return { entries: 0, oldestAge: 0 };
    }

    const oldest = Math.min(...validEntries.map(e => e.timestamp));
    const oldestAge = Date.now() - oldest;

    return {
        entries: validEntries.length,
        oldestAge: Math.round(oldestAge / 1000 / 60) // minutes
    };
}
