export type MinsalCudyrEquivalence = 'UCI' | 'UTI' | 'NON_UPC';
export type NonHhrUpcBedGroupKey = 'basic' | 'adult_potential' | 'neonatal';

export interface MinsalCudyrDistribution {
  eligibleObservations: number;
  categorizedObservations: number;
  missingCudyr: number;
  uciEquivalent: number;
  utiEquivalent: number;
  nonUpcEquivalent: number;
  uciPercent: number;
  utiPercent: number;
  nonUpcPercent: number;
}

export interface MinsalCudyrBedGroupDistribution extends MinsalCudyrDistribution {
  key: NonHhrUpcBedGroupKey;
  label: string;
}

const roundPercent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

export const createMinsalDistribution = (): MinsalCudyrDistribution => ({
  eligibleObservations: 0,
  categorizedObservations: 0,
  missingCudyr: 0,
  uciEquivalent: 0,
  utiEquivalent: 0,
  nonUpcEquivalent: 0,
  uciPercent: 0,
  utiPercent: 0,
  nonUpcPercent: 0,
});

export const createMinsalBedGroupDistributions = (): Record<
  NonHhrUpcBedGroupKey,
  MinsalCudyrBedGroupDistribution
> => ({
  basic: { ...createMinsalDistribution(), key: 'basic', label: 'H1C1–H6C2' },
  adult_potential: {
    ...createMinsalDistribution(),
    key: 'adult_potential',
    label: 'R1–R4',
  },
  neonatal: {
    ...createMinsalDistribution(),
    key: 'neonatal',
    label: 'NEO1–NEO2',
  },
});

export const resolveMinsalCudyrEquivalence = (cudyrCategory: string): MinsalCudyrEquivalence => {
  // MINSAL includes B1 in UCI and UTI. UCI precedence keeps this distribution
  // mutually exclusive and ensures the percentages sum to 100%.
  if (['A1', 'A2', 'B1'].includes(cudyrCategory)) return 'UCI';
  if (['A3', 'B2'].includes(cudyrCategory)) return 'UTI';
  return 'NON_UPC';
};

export const resolveNonHhrUpcBedGroup = (bedId: string): NonHhrUpcBedGroupKey => {
  if (['R1', 'R2', 'R3', 'R4'].includes(bedId)) return 'adult_potential';
  if (['NEO1', 'NEO2'].includes(bedId)) return 'neonatal';
  return 'basic';
};

export const addMinsalEquivalence = (
  distribution: MinsalCudyrDistribution,
  equivalence: MinsalCudyrEquivalence
) => {
  distribution.categorizedObservations += 1;
  if (equivalence === 'UCI') distribution.uciEquivalent += 1;
  else if (equivalence === 'UTI') distribution.utiEquivalent += 1;
  else distribution.nonUpcEquivalent += 1;
};

export const finalizeMinsalDistribution = <T extends MinsalCudyrDistribution>(
  distribution: T
): T => ({
  ...distribution,
  missingCudyr: distribution.eligibleObservations - distribution.categorizedObservations,
  uciPercent: roundPercent(distribution.uciEquivalent, distribution.categorizedObservations),
  utiPercent: roundPercent(distribution.utiEquivalent, distribution.categorizedObservations),
  nonUpcPercent: roundPercent(distribution.nonUpcEquivalent, distribution.categorizedObservations),
});
