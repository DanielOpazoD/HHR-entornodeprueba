import type { DailyRecord } from '../contracts/rayenDomainContracts';

type CensusRevision = Pick<DailyRecord, 'date' | 'lastUpdated'>;

export const isNursingStaffingCollectionContextCurrent = (
  source: CensusRevision,
  latest: CensusRevision | null | undefined,
  selectedDate: string | undefined
): boolean =>
  selectedDate === source.date &&
  latest?.date === source.date &&
  latest.lastUpdated === source.lastUpdated;
