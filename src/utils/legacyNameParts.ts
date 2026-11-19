/** A patient name without outer spaces and with one space between words. */
export const normalizeNameSpacing = (value: string): string => value.trim().replace(/\s+/g, ' ');

/** Compare key for two spellings of one patient name: spacing and case do not count, accents do. */
export const comparableName = (value: string): string => normalizeNameSpacing(value).toLowerCase();

/**
 * Read-time guess for records stored without a given-name/surname split: the last two words are
 * taken as surnames. Records are re-saved after parsing, so a guessed split can end up stored.
 */
export const resolveLegacyNameParts = (
  patientName: string
): {
  firstName: string;
  lastName: string;
  secondLastName: string;
} => {
  const normalizedName = normalizeNameSpacing(patientName);
  if (!normalizedName) {
    return { firstName: '', lastName: '', secondLastName: '' };
  }

  const segments = normalizedName.split(' ');
  const [first = '', second = ''] = segments;
  if (segments.length === 1) {
    return { firstName: first, lastName: '', secondLastName: '' };
  }
  if (segments.length === 2) {
    return { firstName: first, lastName: second, secondLastName: '' };
  }

  return {
    firstName: segments.slice(0, -2).join(' '),
    lastName: segments.at(-2) ?? '',
    secondLastName: segments.at(-1) ?? '',
  };
};
