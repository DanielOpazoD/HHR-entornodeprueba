import React, { Suspense, lazy } from 'react';
import { FileText, MoreHorizontal, User } from 'lucide-react';
import { MedicalButton } from '@/components/ui/base/MedicalButton';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { PatientRowOrbitalQuickActions } from '@/features/census/components/patient-row/PatientRowOrbitalQuickActions';
import type {
  PatientActionMenuActionFilter,
  PatientActionMenuCallbacks,
  PatientActionMenuIndicators,
} from './patientRowActionContracts';
import type { RowMenuAlign } from './patientRowUiContracts';
import { usePatientActionMenu } from './usePatientActionMenu';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { resolvePatientActionMenuDemographicsInteraction } from '@/features/census/controllers/patientActionMenuController';

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
}) => {
  const {
    isOpen,
    isMedicalIndicationsOpen,
    menuRef,
    binding,
    utilityActions,
    toggle,
    close,
    openMedicalIndicationsDialog,
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

  const handleViewDemographics = resolvePatientActionMenuDemographicsInteraction({
    accessProfile,
    onViewDemographics,
  });

  return (
    <div className="flex flex-col items-center gap-0.5 relative py-0.5" ref={menuRef}>
      {hasPatientIdentity ? (
        <PatientRowOrbitalQuickActions
          showClinicalDocumentsAction={binding.availability.showClinicalDocumentsAction}
          showExamRequestAction={binding.availability.showExamRequestAction}
          showImagingRequestAction={binding.availability.showImagingRequestAction}
          showMedicalIndicationsAction={binding.availability.showMedicalIndicationsAction}
          onViewClinicalDocuments={handleViewClinicalDocuments}
          onViewExamRequest={handleViewExamRequest}
          onViewImagingRequest={handleViewImagingRequest}
          onViewMedicalIndications={openMedicalIndicationsDialog}
          badges={
            clinicalDocumentCount && clinicalDocumentCount > 0
              ? { clinicalDocumentCount }
              : undefined
          }
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
        <Suspense fallback={null}>
          <LazyPatientActionMenuPanel
            anchorRef={menuRef}
            isOpen={isOpen}
            binding={binding}
            utilityActions={utilityActions}
            allowedActions={allowedActions}
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
