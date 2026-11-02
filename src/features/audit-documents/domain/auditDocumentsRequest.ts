import { cleanRut, formatRut, isValidRut, normalizeRut } from '@/utils/rutUtils';

/**
 * The extension enforces the same limits. 20 RUTs and 100 documents keep one download within a
 * few minutes on the shared computer.
 */
export const AUDIT_DOCUMENTS_MAX_PATIENTS = 20;
export const AUDIT_DOCUMENTS_MAX_DOCUMENTS = 100;

export type AuditDocumentType = 'history' | 'pharmacological';

export const AUDIT_DOCUMENT_TYPE_LABELS: Record<AuditDocumentType, string> = {
  history: 'Historial de hospitalización (ficha)',
  pharmacological: 'Reporte de cuidados farmacológicos y otros',
};

export interface AuditDateRange {
  dateFrom: string;
  dateTo: string;
}

export interface ParsedRutList {
  /** Normalized RUNs in the order they were pasted, without repeats. */
  runs: string[];
  /** Values with digits that are not a valid RUT, shown back as typed. */
  invalid: string[];
  repeated: number;
}

/**
 * Accepts RUTs separated by lines, spaces, commas or semicolons, with or without dots and dash.
 * Words without digits (for example a name pasted next to the RUT) are ignored; anything else
 * that is not a valid RUT is reported, never converted into one.
 */
export const parseRutList = (text: string): ParsedRutList => {
  const runs: string[] = [];
  const invalid: string[] = [];
  let repeated = 0;
  text
    .split(/[\s,;]+/)
    .filter(token => /\d/.test(token))
    .forEach(token => {
      const run = normalizeRut(token);
      // Only dots and a dash may be dropped: a passport such as «P1234567» is not a RUT.
      // Eloísa identifies people by a RUN of 6 to 8 digits plus the verifier.
      if (run !== cleanRut(token) || run.length < 7 || !isValidRut(run)) {
        invalid.push(token);
        return;
      }
      if (runs.includes(run)) {
        repeated += 1;
        return;
      }
      runs.push(run);
    });
  return { runs, invalid, repeated };
};

export const displayRut = (run: string): string => formatRut(run);

export interface AuditPatientRequest {
  run: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Each RUT uses its own dates when given and the general ones otherwise. */
export const resolvePatientRanges = (
  runs: readonly string[],
  general: AuditDateRange,
  overrides: Readonly<Record<string, Partial<AuditDateRange>>>
): { patients: AuditPatientRequest[]; invertedRuns: string[] } => {
  const invertedRuns: string[] = [];
  const patients = runs.map(run => {
    const dateFrom = overrides[run]?.dateFrom || general.dateFrom;
    const dateTo = overrides[run]?.dateTo || general.dateTo;
    if (dateFrom && dateTo && dateFrom > dateTo) invertedRuns.push(run);
    return {
      run,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };
  });
  return { patients, invertedRuns };
};
