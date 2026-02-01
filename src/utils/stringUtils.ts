/**
 * String Helper Utilities
 * Pure functions for string manipulation.
 */

/**
 * Capitalize first letter of each word
 * Example: "juan perez" -> "Juan Perez"
 */
export const capitalizeWords = (str: string): string => {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

/**
 * Normalize name: trim, capitalize, remove extra spaces
 */
export const normalizeName = (name: string): string => {
    if (!name) return '';
    return capitalizeWords(name.trim().replace(/\s+/g, ' '));
};

/**
 * Truncate string with ellipsis
 */
export const truncate = (str: string, maxLength: number): string => {
    if (!str || str.length <= maxLength) return str;
    return str.slice(0, maxLength - 3) + '...';
};

/**
 * Check if string is empty or only whitespace
 */
export const isEmpty = (str: string | null | undefined): boolean => {
    return !str || str.trim().length === 0;
};

/**
 * Remove accents/diacritics from string (for search)
 */
export const removeAccents = (str: string): string => {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/**
 * Case-insensitive search (accent-insensitive)
 */
export const searchMatch = (text: string, query: string): boolean => {
    const normalizedText = removeAccents(text.toLowerCase());
    const normalizedQuery = removeAccents(query.toLowerCase());
    return normalizedText.includes(normalizedQuery);
};
