/** Display only: preserve the stored identity and the casing of the rest of the name. */
export const formatCensusPatientName = (name: string): string => name.replace(/\brn\b/gi, 'RN');
