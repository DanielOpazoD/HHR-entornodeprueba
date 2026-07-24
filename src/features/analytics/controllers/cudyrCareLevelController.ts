export type CudyrCareLevel = 'CRITICAL' | 'MEDIUM' | 'BASIC';
export type CudyrCareBedGroupKey = 'basic' | 'adult_potential' | 'neonatal';

export interface CudyrCareLevelDistribution {
  eligibleObservations: number;
  categorizedObservations: number;
  missingCudyr: number;
  critical: number;
  medium: number;
  basic: number;
  criticalPercent: number;
  mediumPercent: number;
  basicPercent: number;
}

export interface CudyrCareLevelBedGroupDistribution extends CudyrCareLevelDistribution {
  key: CudyrCareBedGroupKey;
  label: string;
}

export const CUDYR_CARE_LEVEL_CATEGORIES: Record<CudyrCareLevel, readonly string[]> = {
  CRITICAL: ['A1', 'A2', 'A3', 'B1', 'B2'],
  MEDIUM: ['B3', 'C1', 'C2'],
  BASIC: ['C3', 'D1', 'D2', 'D3'],
};

const roundPercent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

export const createCareLevelDistribution = (): CudyrCareLevelDistribution => ({
  eligibleObservations: 0,
  categorizedObservations: 0,
  missingCudyr: 0,
  critical: 0,
  medium: 0,
  basic: 0,
  criticalPercent: 0,
  mediumPercent: 0,
  basicPercent: 0,
});

export const createCareLevelBedGroupDistributions = (): Record<
  CudyrCareBedGroupKey,
  CudyrCareLevelBedGroupDistribution
> => ({
  basic: { ...createCareLevelDistribution(), key: 'basic', label: 'H1C1–H6C2' },
  adult_potential: {
    ...createCareLevelDistribution(),
    key: 'adult_potential',
    label: 'R1–R4',
  },
  neonatal: {
    ...createCareLevelDistribution(),
    key: 'neonatal',
    label: 'NEO1–NEO2',
  },
});

export const resolveCudyrCareLevel = (cudyrCategory: string): CudyrCareLevel | null => {
  if (CUDYR_CARE_LEVEL_CATEGORIES.CRITICAL.includes(cudyrCategory)) return 'CRITICAL';
  if (CUDYR_CARE_LEVEL_CATEGORIES.MEDIUM.includes(cudyrCategory)) return 'MEDIUM';
  if (CUDYR_CARE_LEVEL_CATEGORIES.BASIC.includes(cudyrCategory)) return 'BASIC';
  return null;
};

export const resolveCareLevelBedGroup = (bedId: string): CudyrCareBedGroupKey => {
  if (['R1', 'R2', 'R3', 'R4'].includes(bedId)) return 'adult_potential';
  if (['NEO1', 'NEO2'].includes(bedId)) return 'neonatal';
  return 'basic';
};

export const addCareLevel = (
  distribution: CudyrCareLevelDistribution,
  careLevel: CudyrCareLevel | null
) => {
  if (!careLevel) return;
  distribution.categorizedObservations += 1;
  if (careLevel === 'CRITICAL') distribution.critical += 1;
  else if (careLevel === 'MEDIUM') distribution.medium += 1;
  else distribution.basic += 1;
};

export const finalizeCareLevelDistribution = <T extends CudyrCareLevelDistribution>(
  distribution: T
): T => ({
  ...distribution,
  missingCudyr: distribution.eligibleObservations - distribution.categorizedObservations,
  criticalPercent: roundPercent(distribution.critical, distribution.categorizedObservations),
  mediumPercent: roundPercent(distribution.medium, distribution.categorizedObservations),
  basicPercent: roundPercent(distribution.basic, distribution.categorizedObservations),
});
