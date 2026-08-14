import React, { Suspense, type CSSProperties, useState } from 'react';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { Statistics } from '@/types/domain/statistics';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { CensusActionsProvider } from './CensusActionsContext';
import { CensusPrintHeader } from './CensusPrintHeader';
import { CensusStaffHeader } from './CensusStaffHeader';
import { CensusRegisterMainContent } from './CensusRegisterMainContent';
import { CensusOperationalStateBanner } from './CensusOperationalStateBanner';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { useDeferredCensusEnhancement } from '@/features/census/hooks/useDeferredCensusEnhancement';
import { useDailyRecordStatus } from '@/context/DailyRecordContext';
import { resolveCensusOperationalState } from '@/features/census/controllers/censusOperationalStateController';
import type { CensusAttentionFilter } from '@/features/census/controllers/rowAcuityController';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';

const LazyCensusRegisterSections = lazyWithRetry(() =>
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
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
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
  renderMedicalHandoffAction,
  accessProfile = 'default',
}) => {
  const shouldRenderSections = !isSpecialistCensusAccessProfile(accessProfile);
  const shouldRenderDeferredSections = useDeferredCensusEnhancement(shouldRenderSections);
  const [attentionFilter, setAttentionFilter] = useState<CensusAttentionFilter>('all');
  const dailyRecordStatus = useDailyRecordStatus();
  const operationalState = resolveCensusOperationalState({
    branch: 'register',
    bootstrapPhase: dailyRecordStatus.bootstrapPhase,
    syncStatus: dailyRecordStatus.syncStatus,
    hasRecord: Boolean(beds),
    isAuthenticated: true,
  });

  return (
    <CensusActionsProvider>
      <CensusPrintHeader currentDateString={currentDateString} />

      <div className="space-y-4" style={marginStyle}>
        <CensusOperationalStateBanner state={operationalState} />

        <CensusStaffHeader
          selectedDate={currentDateString}
          readOnly={readOnly}
          stats={stats}
          accessProfile={accessProfile}
          attentionFilter={attentionFilter}
          onAttentionFilterChange={setAttentionFilter}
          visibleBeds={visibleBeds}
          renderMedicalHandoffAction={renderMedicalHandoffAction}
        />

        <CensusRegisterMainContent
          currentDateString={currentDateString}
          readOnly={readOnly}
          visibleBeds={visibleBeds}
          beds={beds}
          accessProfile={accessProfile}
          attentionFilter={attentionFilter}
          onClearAttentionFilter={() => setAttentionFilter('all')}
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
