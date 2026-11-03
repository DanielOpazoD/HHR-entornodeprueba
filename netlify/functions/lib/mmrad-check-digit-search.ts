import { isSameRutWithOtherVerifier, otherRutVerifierVariants } from '../../../src/utils/rutUtils';
import { removeAccents } from '../../../src/utils/stringUtils';

export interface RisExamRow<T> {
  exam: T;
  /** «Id Paciente» and «Nombre» exactly as the RIS row shows them. */
  patientId: string;
  patientName: string;
}

// Particles join surnames; they never identify a person on their own.
const NAME_PARTICLES = new Set([
  'DA',
  'DAS',
  'DE',
  'DEL',
  'DO',
  'DOS',
  'LA',
  'LAS',
  'LOS',
  'VAN',
  'VON',
  'Y',
]);

const nameTokens = (value: string): Set<string> =>
  new Set(
    removeAccents(value)
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter(token => token.length >= 2 && !NAME_PARTICLES.has(token))
  );

/**
 * Every word of the shorter name, which needs at least two besides particles, appears in the
 * longer one. The viewer also shows MMRAD's name so a person confirms it.
 */
export const samePersonName = (a: string, b: string): boolean => {
  const [shorter, longer] = [nameTokens(a), nameTokens(b)].sort((x, y) => x.size - y.size);
  return shorter.size >= 2 && [...shorter].every(token => longer.has(token));
};

/**
 * MMRAD sometimes registers a patient's exams under the same RUT number with a mistyped check
 * digit (two validated CTs, 2026-11-03), and the RIS only matches an ID exactly. Each other check
 * digit is searched; a row is kept only when its ID is that very number and its name matches the
 * census name. A failed variant leaves the result incomplete, which the caller reports.
 */
export const searchMistypedCheckDigitExams = async <T>({
  rut,
  patientName,
  search,
  key,
  concurrency = 5,
}: {
  rut: string;
  patientName: string;
  search: (patientId: string) => Promise<RisExamRow<T>[]>;
  key: (exam: T) => string;
  concurrency?: number;
}): Promise<{
  exams: Array<T & { registered_patient_id: string; registered_patient_name: string }>;
  complete: boolean;
}> => {
  const variants = patientName.trim() ? otherRutVerifierVariants(rut) : [];
  const found: Array<RisExamRow<T>[]> = [];
  let complete = true;
  let next = 0;
  const worker = async () => {
    while (next < variants.length) {
      const index = next++;
      try {
        found[index] = await search(variants[index]);
      } catch {
        complete = false;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, variants.length) }, worker));
  const seen = new Set<string>();
  const exams = found
    .flat()
    .filter(
      row =>
        row &&
        isSameRutWithOtherVerifier(rut, row.patientId) &&
        samePersonName(patientName, row.patientName)
    )
    .flatMap(row => {
      const id = key(row.exam);
      if (seen.has(id)) return [];
      seen.add(id);
      return [
        {
          ...row.exam,
          registered_patient_id: row.patientId.trim(),
          registered_patient_name: row.patientName.trim(),
        },
      ];
    });
  return { exams, complete };
};
