import React, { Suspense } from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { CMASection } from '@/features/census/components/CMASection';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { TransfersSection } from '@/features/census/components/TransfersSection';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/shared/access/censusAccessProfile';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';

type CensusRegisterMovementSectionId = 'discharges' | 'transfers' | 'cma';

const DEFAULT_MOVEMENT_SECTION_ORDER: readonly CensusRegisterMovementSectionId[] = [
  'discharges',
  'transfers',
  'cma',
];

const resolveCensusRegisterMovementSectionOrder = (counts: {
  dischargesCount: number;
  transfersCount: number;
  cmaCount: number;
}): CensusRegisterMovementSectionId[] => {
  const hasMovementData = (sectionId: CensusRegisterMovementSectionId): boolean =>
    sectionId === 'discharges'
      ? counts.dischargesCount > 0
      : sectionId === 'transfers'
        ? counts.transfersCount > 0
        : counts.cmaCount > 0;
  return [
    ...DEFAULT_MOVEMENT_SECTION_ORDER.filter(hasMovementData),
    ...DEFAULT_MOVEMENT_SECTION_ORDER.filter(sectionId => !hasMovementData(sectionId)),
  ];
};

const LazyCensusModals = lazyWithRetry(() =>
  import('@/features/census/components/CensusModals').then(module => ({
    default: module.CensusModals,
  }))
);

interface CensusRegisterSectionsProps {
  readOnly: boolean;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  accessProfile: CensusAccessProfile;
}

const MovementSectionById: Record<CensusRegisterMovementSectionId, React.FC> = {
  discharges: DischargesSection,
  transfers: TransfersSection,
  cma: CMASection,
};

const MovementSectionBoundaryName: Record<CensusRegisterMovementSectionId, string> = {
  discharges: 'Altas del Día',
  transfers: 'Traslados del Día',
  cma: 'Cirugía Mayor Ambulatoria',
};

const CensusMovementRegisterSections: React.FC = () => {
  const { discharges, transfers, cma } = useCensusMovementData();
  const sectionOrder = resolveCensusRegisterMovementSectionOrder({
    dischargesCount: discharges?.length || 0,
    transfersCount: transfers?.length || 0,
    cmaCount: cma?.length || 0,
  });

  return (
    <>
      {sectionOrder.map(sectionId => {
        const Section = MovementSectionById[sectionId];

        return (
          <SectionErrorBoundary
            key={sectionId}
            sectionName={MovementSectionBoundaryName[sectionId]}
            fallbackHeight="100px"
          >
            <Section />
          </SectionErrorBoundary>
        );
      })}
    </>
  );
};

export const CensusRegisterSections = React.memo(function CensusRegisterSections({
  readOnly,
  showBedManagerModal,
  onCloseBedManagerModal,
  accessProfile,
}: CensusRegisterSectionsProps) {
  return (
    <>
      {!isSpecialistCensusAccessProfile(accessProfile) && <CensusMovementRegisterSections />}

      {!readOnly && !isSpecialistCensusAccessProfile(accessProfile) && (
        <Suspense fallback={null}>
          <LazyCensusModals
            showBedManagerModal={showBedManagerModal}
            onCloseBedManagerModal={onCloseBedManagerModal}
          />
        </Suspense>
      )}
    </>
  );
});
