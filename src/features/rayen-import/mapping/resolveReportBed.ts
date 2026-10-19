/**
 * Resolves the report's free-text bed label to a canonical HHR bed id, so a discharge logged
 * from the report carries the right bed name + type. The Jasper report prints beds like "Neo2"
 * or "R2"; HHR ids are "NEO2" / "R2". Matching is case- and separator-insensitive; an unknown
 * label is returned unchanged (best-effort display).
 */

import { CLINICAL_CRIB_PARENT_BEDS, mapRayenBed } from './bedMapping';

export const resolveReportCribParentBedId = (bedLabel: string): string | null => {
  const normalized = (bedLabel ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  const parent = normalized.replace(/^(?:CUNA|C)(?=H[1-6]C[12]$|R[1-4]$|NEO[12]$)/, '');
  return parent !== normalized && CLINICAL_CRIB_PARENT_BEDS.has(parent) ? parent : null;
};

export const resolveReportBedId = (bedLabel: string): string =>
  resolveReportCribParentBedId(bedLabel) ?? mapRayenBed({ bed: bedLabel }).bedId ?? bedLabel;
