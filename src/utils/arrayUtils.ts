/**
 * Array & Collection Utilities
 * Pure functions for array manipulation.
 */

/**
 * Get random item from array
 */
export const randomItem = <T>(arr: T[]): T => {
    return arr[Math.floor(Math.random() * arr.length)];
};

/**
 * Shuffle array (Fisher-Yates algorithm)
 */
export const shuffle = <T>(arr: T[]): T[] => {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
};

/**
 * Group array by key
 */
export const groupBy = <T, K extends string | number>(
    arr: T[],
    keyFn: (item: T) => K
): Record<K, T[]> => {
    return arr.reduce((acc, item) => {
        const key = keyFn(item);
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {} as Record<K, T[]>);
};

/**
 * Remove duplicates from array
 */
export const unique = <T>(arr: T[]): T[] => {
    return [...new Set(arr)];
};

/**
 * Remove duplicates by key
 */
export const uniqueBy = <T>(arr: T[], keyFn: (item: T) => unknown): T[] => {
    const seen = new Set();
    return arr.filter(item => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
