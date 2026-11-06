import React, { Suspense, type CSSProperties, useMemo, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { Statistics } from '@/types/domain/statistics';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { CensusActionsProvider } from './CensusActionsContext';
import { CensusPrintHeader } from './CensusPrintHeader';
import { CensusAttentionBar } from './CensusAttentionBar';
import { CensusStaffHeader } from './CensusStaffHeader';
import { CensusRegisterMainContent } from './CensusRegisterMainContent';
import { CensusOperationalStateBanner } from './CensusOperationalStateBanner';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { useDeferredCensusEnhancement } from '@/features/census/hooks/useDeferredCensusEnhancement';
import { useDailyRecordStatus } from '@/context/DailyRecordContext';
import { useDailyRecordWriteStatus } from '@/hooks/useDailyRecordWriteStatus';
import { resolveCensusOperationalState } from '@/features/census/controllers/censusOperationalStateController';
import type { CensusAttentionFilter } from '@/features/census/controllers/rowAcuityController';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import '../styles/censusLayout.css';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';
import { listClinicalExplorerPatients } from '@/features/census/controllers/clinicalExplorerController';
import { ClinicalExplorerMenuEntry } from './clinical-explorer/ClinicalExplorerMenuEntry';
import { ClinicalExplorerBar } from './clinical-explorer/ClinicalExplorerBar';
import {
  openClinicalExplorer,
  useClinicalExplorerSelection,
} from './clinical-explorer/clinicalExplorerStore';
import { ClinicalExplorerLaunchContext } from './clinical-explorer/clinicalExplorerLaunch';

const LazyCensusRegisterSections = lazyWithRetry(() =>
  import('./CensusRegisterSections').then(module => ({
    default: module.CensusRegisterSections,
  }))
);

// Online-only consultation mode; it reads Eloísa, Syslab and MMRAD and never joins the precache.
const LazyClinicalExplorerView = lazyWithRetry(() =>
  import('./clinical-explorer/ClinicalExplorerView').then(module => ({
    default: module.ClinicalExplorerView,
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
  rayenBootstrapRequestId?: number;
  onRayenBootstrapHandled?: () => void;
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
  rayenBootstrapRequestId,
  onRayenBootstrapHandled,
}) => {
  const shouldRenderSections = !isSpecialistCensusAccessProfile(accessProfile);
  const shouldRenderDeferredSections = useDeferredCensusEnhancement(shouldRenderSections);
  const [attentionFilter, setAttentionFilter] = useState<CensusAttentionFilter>('all');
  const dailyRecordStatus = useDailyRecordStatus();
  const writeStatus = useDailyRecordWriteStatus(currentDateString);
  const editingReadOnly = readOnly || writeStatus.isSyncCommit;
  const explorer = useClinicalExplorerSelection(currentDateString);
  const explorerPatients = useMemo(
    () => listClinicalExplorerPatients({ visibleBeds, beds }),
    [visibleBeds, beds]
  );
  const firstExplorerBedId = explorerPatients[0]?.bedId;
  const launchExplorer = useMemo(
    () =>
      firstExplorerBedId
        ? () => openClinicalExplorer({ censusDate: currentDateString, bedId: firstExplorerBedId })
        : null,
    [currentDateString, firstExplorerBedId]
  );
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
      <ClinicalExplorerMenuEntry censusDate={currentDateString} patients={explorerPatients} />

      {/* The census stays mounted behind the explorer so returning keeps its state and edits. */}
      <ClinicalExplorerLaunchContext.Provider value={launchExplorer}>
        <div className="census-register space-y-4" style={marginStyle} hidden={explorer !== null}>
          <CensusOperationalStateBanner state={operationalState} />
          <CensusStaffHeader
            selectedDate={currentDateString}
            readOnly={readOnly}
            stats={stats}
            accessProfile={accessProfile}
            visibleBeds={visibleBeds}
            renderMedicalHandoffAction={renderMedicalHandoffAction}
            rayenBootstrapRequestId={rayenBootstrapRequestId}
            onRayenBootstrapHandled={onRayenBootstrapHandled}
          />

          <CensusRegisterMainContent
            currentDateString={currentDateString}
            readOnly={editingReadOnly}
            visibleBeds={visibleBeds}
            beds={beds}
            accessProfile={accessProfile}
            attentionFilter={attentionFilter}
            onClearAttentionFilter={() => setAttentionFilter('all')}
            scoresAction={
              <CensusAttentionBar
                compact
                beds={beds}
                censusIsoDay={currentDateString}
                activeFilter={attentionFilter}
                onFilterChange={setAttentionFilter}
              />
            }
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
      </ClinicalExplorerLaunchContext.Provider>
      {explorer ? (
        <section
          aria-label="Explorador clínico"
          className="flex flex-col gap-3"
          style={marginStyle}
        >
          {/* The way back never depends on the online-only chunk: it stays here while the body
              loads, if it cannot load, and once it is open. */}
          <ClinicalExplorerBar bedId={explorer.bedId} />
          <ErrorBoundary
            resetKeys={[explorer.bedId]}
            fallbackRender={() => (
              <p role="alert" className="text-[12px] text-slate-600">
                No se pudo abrir el explorador. Revisa la conexión y vuelve a intentarlo.
              </p>
            )}
          >
            <Suspense
              fallback={
                <div
                  className="h-40 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none"
                  data-testid="clinical-explorer-loading"
                />
              }
            >
              <LazyClinicalExplorerView
                censusDate={currentDateString}
                bedId={explorer.bedId}
                patients={explorerPatients}
              />
            </Suspense>
          </ErrorBoundary>
        </section>
      ) : null}
    </CensusActionsProvider>
  );
};
