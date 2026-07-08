import React, { Suspense, lazy } from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';
import { CMASection } from '@/features/census/components/CMASection';
import { DischargesSection } from '@/features/census/components/DischargesSection';
import { TransfersSection } from '@/features/census/components/TransfersSection';
import {
  resolveCensusRegisterMovementSectionOrder,
  type CensusRegisterMovementSectionId,
} from '@/features/census/controllers/censusRegisterSectionsOrderController';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

const LazyCensusModals = lazy(() =>
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

export const CensusRegisterSections: React.FC<CensusRegisterSectionsProps> = ({
  readOnly,
  showBedManagerModal,
  onCloseBedManagerModal,
  accessProfile,
}) => (
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
