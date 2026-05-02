import React, { Suspense, lazy, type CSSProperties } from 'react';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { Statistics } from '@/types/domain/statistics';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { CensusActionsProvider } from './CensusActionsContext';
import { CensusPrintHeader } from './CensusPrintHeader';
import { CensusStaffHeader } from './CensusStaffHeader';
import { CensusRegisterMainContent } from './CensusRegisterMainContent';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { useDeferredCensusEnhancement } from '@/features/census/hooks/useDeferredCensusEnhancement';

const LazyCensusRegisterSections = lazy(() =>
  import('./CensusRegisterSections').then(module => ({
    default: module.CensusRegisterSections,
  }))
);

interface CensusRegisterContentProps {
  currentDateString: string;
  readOnly: boolean;
  beds: DailyRecord['beds'];
  visibleBeds: BedDefinition[];
  marginStyle: CSSProperties;
  stats: Statistics | null;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  accessProfile?: CensusAccessProfile;
}

export const CensusRegisterContent: React.FC<CensusRegisterContentProps> = ({
  currentDateString,
  readOnly,
  beds,
  visibleBeds,
  marginStyle,
  stats,
  showBedManagerModal,
  onCloseBedManagerModal,
  accessProfile = 'default',
}) => {
  const shouldRenderSections = !isSpecialistCensusAccessProfile(accessProfile);
  const shouldRenderDeferredSections = useDeferredCensusEnhancement(shouldRenderSections);

  return (
    <CensusActionsProvider>
      <CensusPrintHeader currentDateString={currentDateString} />

      <div className="space-y-6" style={marginStyle}>
        <CensusStaffHeader readOnly={readOnly} stats={stats} accessProfile={accessProfile} />

        <CensusRegisterMainContent
          currentDateString={currentDateString}
          readOnly={readOnly}
          visibleBeds={visibleBeds}
          beds={beds}
          accessProfile={accessProfile}
        />

        {shouldRenderDeferredSections ? (
          <Suspense
            fallback={
              <div
                className="h-20 animate-pulse rounded-xl bg-slate-100"
                data-testid="census-register-sections-loading"
              />
            }
          >
            <LazyCensusRegisterSections
              readOnly={readOnly}
              showBedManagerModal={showBedManagerModal}
              onCloseBedManagerModal={onCloseBedManagerModal}
              accessProfile={accessProfile}
            />
          </Suspense>
        ) : null}
      </div>
    </CensusActionsProvider>
  );
};
