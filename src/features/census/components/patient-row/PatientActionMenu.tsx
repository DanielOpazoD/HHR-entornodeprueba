import React, { Suspense, lazy } from 'react';
import { FileText, MoreHorizontal, User } from 'lucide-react';
import { MedicalButton } from '@/components/ui/base/MedicalButton';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { PatientRowOrbitalQuickActions } from '@/features/census/components/patient-row/PatientRowOrbitalQuickActions';
import { PatientRowMenuPortal } from '@/features/census/components/patient-row/PatientRowMenuPortal';
import type {
  PatientActionMenuActionFilter,
  PatientActionMenuCallbacks,
  PatientActionMenuIndicators,
} from './patientRowActionContracts';
import type { RowMenuAlign } from './patientRowUiContracts';
import { usePatientActionMenu } from './usePatientActionMenu';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { resolvePatientActionMenuDemographicsInteraction } from '@/features/census/controllers/patientActionMenuController';
import { resolvePatientClinicalTopics } from '@/features/census/controllers/patientClinicalTopicsController';
import { buildClinicalPanelKey } from '@/features/census/controllers/clinicalPanelNavigationController';
import { openClinicalExplorer } from '../clinical-explorer/clinicalExplorerStore';
import { openClinicalPanel } from './useActiveClinicalPanel';
import {
  PatientClinicalTopicSurfaces,
  usePatientClinicalTopicSurface,
} from './PatientClinicalTopicSurfaces';
import type { PatientData } from './patientRowContracts';

const LazyPatientActionMenuPanel = lazy(() =>
  import('@/features/census/components/patient-row/PatientActionMenuPanel').then(module => ({
    default: module.PatientActionMenuPanel,
  }))
);

const LazyMedicalIndicationsDialog = lazy(() =>
  import('@/components/layout/date-strip/MedicalIndicationsDialog').then(module => ({
    default: module.MedicalIndicationsDialog,
  }))
);

interface PatientActionMenuProps
  extends PatientActionMenuCallbacks, PatientActionMenuIndicators, PatientActionMenuActionFilter {
  isBlocked: boolean;
  readOnly?: boolean;
  clinicalEditingDisabled?: boolean;
  align?: RowMenuAlign;
  showCmaAction?: boolean;
  accessProfile?: CensusAccessProfile;
  hasPatientIdentity?: boolean;
  medicalIndicationsPatient?: MedicalIndicationsPatientOption;
  /** Number of active clinical documents for this patient episode. */
  clinicalDocumentCount?: number;
  /** Only an Eloísa episode can be marked «paciente no válido». */
  canMarkInvalid?: boolean;
  /** A main row's patient: the turtle opens its ficha, laboratory, imaging and integrated view. */
  clinicalPatient?: PatientData;
  censusDate?: string;
}

const PatientActionPrimaryIcon: React.FC<{
  indicators: Required<PatientActionMenuIndicators>;
}> = ({ indicators }) => (
  <span className="relative inline-flex items-center justify-center h-5 w-5">
    {indicators.hasClinicalDocument && (
      <FileText
        size={11}
        className="absolute -left-1 bottom-0 text-slate-400"
        strokeWidth={2.1}
        aria-hidden="true"
      />
    )}
    <User size={16} className="relative z-10" />
    {indicators.isNewAdmission && (
      <span
        className="absolute -top-0.5 -left-0.5 h-2 w-2 rounded-full bg-amber-400 border border-white shadow-sm"
        aria-hidden="true"
      />
    )}
  </span>
);

export const PatientActionMenu: React.FC<PatientActionMenuProps> = ({
  isBlocked,
  hasClinicalDocument = false,
  isNewAdmission = false,
  onAction,
  onViewDemographics,
  onViewClinicalDocuments,
  onViewExamRequest,
  onViewImagingRequest,
  onViewMedicalIndications,
  onViewHistory,
  readOnly = false,
  clinicalEditingDisabled = false,
  align = 'top',
  showCmaAction = true,
  accessProfile = 'default',
  hasPatientIdentity = true,
  medicalIndicationsPatient,
  clinicalDocumentCount,
  allowedActions,
  canMarkInvalid = false,
  clinicalPatient,
  censusDate,
}) => {
  const {
    isOpen,
    isMedicalIndicationsOpen,
    menuRef,
    binding,
    utilityActions,
    toggle,
    close,
    closeMedicalIndicationsDialog,
    handleAction,
    handleViewHistory,
    handleViewClinicalDocuments,
    handleViewExamRequest,
    handleViewImagingRequest,
  } = usePatientActionMenu({
    isBlocked,
    readOnly,
    clinicalEditingDisabled,
    accessProfile,
    hasPatientIdentity,
    align,
    showCmaAction,
    indicators: {
      hasClinicalDocument,
      isNewAdmission,
    },
    onAction,
    onViewHistory,
    onViewClinicalDocuments,
    onViewExamRequest,
    onViewImagingRequest,
    onViewMedicalIndications,
    allowedActions,
  });

  const topics = resolvePatientClinicalTopics(clinicalPatient);
  const topicSurface = usePatientClinicalTopicSurface(clinicalPatient);
  const canRequestExams = binding.availability.showExamRequestAction;
  const canRequestImaging = binding.availability.showImagingRequestAction;

  const handleViewDemographics = resolvePatientActionMenuDemographicsInteraction({
    accessProfile,
    onViewDemographics,
  });

  return (
    <div className="flex flex-col items-center gap-0.5 relative py-0.5" ref={menuRef}>
      {hasPatientIdentity ? (
        <PatientRowOrbitalQuickActions
          showClinicalPanelAction={topics.clinicalPanel}
          // Without an episode or a Chilean RUT there is nothing to read, but a request still fits.
          showLaboratoryAction={topics.laboratory || canRequestExams}
          showImagingAction={topics.imaging || canRequestImaging}
          showClinicalDocumentsAction={binding.availability.showClinicalDocumentsAction}
          showClinicalExplorerAction={topics.clinicalExplorer && Boolean(censusDate)}
          onViewClinicalPanel={() => {
            if (clinicalPatient?.clinicalEpisodeId) {
              openClinicalPanel(
                buildClinicalPanelKey(clinicalPatient.bedId, clinicalPatient.clinicalEpisodeId)
              );
            }
          }}
          onViewLaboratory={
            topics.laboratory ? () => topicSurface.open('laboratory') : handleViewExamRequest
          }
          onViewImaging={
            topics.imaging ? () => topicSurface.open('imaging') : handleViewImagingRequest
          }
          onViewClinicalDocuments={handleViewClinicalDocuments}
          onOpenClinicalExplorer={() => {
            if (clinicalPatient && censusDate) {
              openClinicalExplorer({ censusDate, bedId: clinicalPatient.bedId });
            }
          }}
          badges={
            clinicalDocumentCount && clinicalDocumentCount > 0
              ? { clinicalDocumentCount }
              : undefined
          }
          triggerTestId={
            clinicalPatient ? `clinical-topics-trigger-${clinicalPatient.bedId}` : undefined
          }
        />
      ) : null}
      {clinicalPatient ? (
        <PatientClinicalTopicSurfaces
          patient={clinicalPatient}
          censusDate={censusDate}
          surface={topicSurface.surface}
          onClose={topicSurface.close}
          onRequestExams={canRequestExams ? handleViewExamRequest : undefined}
          onRequestImaging={canRequestImaging ? handleViewImagingRequest : undefined}
        />
      ) : null}

      {binding.availability.showDemographicsAction && (
        <div className="flex items-center gap-0.5">
          <MedicalButton
            onClick={handleViewDemographics}
            variant="ghost"
            size="xs"
            className="!px-1.5 !py-0.5 rounded-md text-medical-500 hover:text-medical-700"
            title="Datos del Paciente"
            icon={<PatientActionPrimaryIcon indicators={binding.indicators} />}
          />
        </div>
      )}
      {binding.availability.showMenuTrigger && (
        <MedicalButton
          onClick={toggle}
          variant="secondary"
          size="xs"
          className="!px-1 !py-0.5 rounded-md text-slate-500"
          title="Acciones"
          icon={<MoreHorizontal size={12} />}
        />
      )}

      {isOpen ? (
        <Suspense
          fallback={
            <PatientRowMenuPortal anchorRef={menuRef} align={align} onClose={close}>
              <div
                className="w-60 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-xl"
                role="status"
              >
                Cargando acciones…
              </div>
            </PatientRowMenuPortal>
          }
        >
          <LazyPatientActionMenuPanel
            anchorRef={menuRef}
            isOpen={isOpen}
            binding={binding}
            utilityActions={utilityActions}
            allowedActions={allowedActions}
            canMarkInvalid={canMarkInvalid}
            onClose={close}
            onAction={handleAction}
            onViewHistory={handleViewHistory}
          />
        </Suspense>
      ) : null}
      {isMedicalIndicationsOpen ? (
        <Suspense fallback={null}>
          <LazyMedicalIndicationsDialog
            isOpen={isMedicalIndicationsOpen}
            onClose={closeMedicalIndicationsDialog}
            patients={medicalIndicationsPatient ? [medicalIndicationsPatient] : []}
          />
        </Suspense>
      ) : null}
    </div>
  );
};
