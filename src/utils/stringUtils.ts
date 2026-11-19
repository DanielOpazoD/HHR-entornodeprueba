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
 * Remove accents/diacritics from string (for search)
 */
export const removeAccents = (str: string): string => {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/** Search key: no accents, lower case, no outer spaces. «Ñuñoa » and «nunoa» match. */
export const foldSearchText = (value: string): string => removeAccents(value).toLowerCase().trim();
