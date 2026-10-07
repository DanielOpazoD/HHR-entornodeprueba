import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
/** Same-person candidates only. Never an episode link or a statistical day assignment. */
export const supplementDocumentKey = (value: string) => {
  const trimmed = value.trim().toUpperCase();
  const rut = trimmed.replace(/\./g, '');
  const match = rut.match(/^(\d{7,8})-?([\dK])$/);
  if (match) {
    let sum = 0;
    for (const [index, digit] of [...match[1]].reverse().entries())
      sum += Number(digit) * (2 + (index % 6));
    const remainder = 11 - (sum % 11);
    const verifier = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
    if (match[2] === verifier) return match[1] + verifier;
  }
  return ''; // Unknown/free-text document formats cannot establish identity here.
};
export const supplementCandidates = (reports: ArchivedCudyrSupplement[], document: string) => {
  const key = supplementDocumentKey(document);
  if (!key) return [];
  return reports.flatMap(archive =>
    archive.report.patients
      .filter(patient => supplementDocumentKey(patient.document) === key)
      .map(patient => ({ archive, patient }))
  );
};
