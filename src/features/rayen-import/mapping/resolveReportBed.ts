/**
 * Resolves the report's free-text bed label to a canonical HHR bed id, so a discharge logged
 * from the report carries the right bed name + type. The Jasper report prints beds like "Neo2"
 * or "R2"; HHR ids are "NEO2" / "R2". Matching is case- and separator-insensitive; an unknown
 * label is returned unchanged (best-effort display).
 */

import { mapRayenBed } from './bedMapping';

export const resolveReportBedId = (bedLabel: string): string =>
  mapRayenBed({ bed: bedLabel }).bedId ?? bedLabel;
