/**
 * Resolves the report's free-text bed label to a canonical HHR bed id, so a discharge logged
 * from the report carries the right bed name + type. The Jasper report prints beds like "Neo2"
 * or "R2"; HHR ids are "NEO2" / "R2". Matching is case- and separator-insensitive; an unknown
 * label is returned unchanged (best-effort display).
 */

import { BEDS } from '@/constants/beds';

const canonical = (value: string): string => (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const BY_CANONICAL = new Map(BEDS.map(bed => [canonical(bed.id), bed.id]));
const URGENCY_BOX_BY_CANONICAL = new Map([
  ['B1UEA', 'BOX1'],
  ['BOX1UEA', 'BOX1'],
  ['B2UEA', 'BOX2'],
  ['BOX2UEA', 'BOX2'],
  ['B3UEA', 'BOX3'],
  ['BOX3UEA', 'BOX3'],
]);

export const resolveReportBedId = (bedLabel: string): string =>
  URGENCY_BOX_BY_CANONICAL.get(canonical(bedLabel)) ??
  BY_CANONICAL.get(canonical(bedLabel)) ??
  bedLabel;
