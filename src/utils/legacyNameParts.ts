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
  const normalizedName = patientName.trim().replace(/\s+/g, ' ');
  if (!normalizedName) {
    return { firstName: '', lastName: '', secondLastName: '' };
  }

  const segments = normalizedName.split(' ');
  if (segments.length === 1) {
    return { firstName: segments[0], lastName: '', secondLastName: '' };
  }
  if (segments.length === 2) {
    return { firstName: segments[0], lastName: segments[1], secondLastName: '' };
  }

  return {
    firstName: segments.slice(0, -2).join(' '),
    lastName: segments[segments.length - 2],
    secondLastName: segments[segments.length - 1],
  };
};
