/**
 * Entry point for the census clinical explorer: the Syslab reports of one hospitalization.
 *
 * Kept apart from `public.ts` on purpose. The explorer loads on demand and stays out of the
 * install-time precache; importing the hook through the barrel would drag it into the precached
 * laboratory chunk instead (see laboratoryLoadingBoundary.test.ts).
 */
export { useSyslabHospitalizationReports } from './hooks/useSyslabHospitalizationReports';
export type {
  SyslabHospitalizationPhase,
  SyslabHospitalizationReports,
} from './hooks/useSyslabHospitalizationReports';

export {
  buildExamColumnKey,
  comparisonSortIndex,
} from './controllers/labAnalyticsVariableController';
export { buildComparisonGroups } from './controllers/labComparisonTableController';
