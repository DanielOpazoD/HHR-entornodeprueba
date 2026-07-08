export type CensusRegisterMovementSectionId = 'discharges' | 'transfers' | 'cma';

export interface CensusRegisterMovementSectionCounts {
  dischargesCount: number;
  transfersCount: number;
  cmaCount: number;
}

const DEFAULT_MOVEMENT_SECTION_ORDER: readonly CensusRegisterMovementSectionId[] = [
  'discharges',
  'transfers',
  'cma',
];

const hasMovementData = (
  sectionId: CensusRegisterMovementSectionId,
  counts: CensusRegisterMovementSectionCounts
): boolean => {
  switch (sectionId) {
    case 'discharges':
      return counts.dischargesCount > 0;
    case 'transfers':
      return counts.transfersCount > 0;
    case 'cma':
      return counts.cmaCount > 0;
  }
};

export const resolveCensusRegisterMovementSectionOrder = (
  counts: CensusRegisterMovementSectionCounts
): CensusRegisterMovementSectionId[] => [
  ...DEFAULT_MOVEMENT_SECTION_ORDER.filter(sectionId => hasMovementData(sectionId, counts)),
  ...DEFAULT_MOVEMENT_SECTION_ORDER.filter(sectionId => !hasMovementData(sectionId, counts)),
];
