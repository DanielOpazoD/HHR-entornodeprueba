import clsx from 'clsx';
import type { PatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';
interface ResolveBedTypeToggleVisibilityParams {
  bedId: string;
  readOnly: boolean;
  isEmpty: boolean;
}

export const shouldShowBedTypeToggle = ({
  bedId,
  readOnly,
  isEmpty,
}: ResolveBedTypeToggleVisibilityParams): boolean => !readOnly && !isEmpty && bedId.startsWith('R');

interface ResolvePatientMainRowClassNameParams {
  bedId: string;
  isBlocked: boolean;
  isUpc?: boolean;
  patientName?: string;
}

export const resolvePatientMainRowClassName = ({
  isBlocked,
  patientName,
}: ResolvePatientMainRowClassNameParams): string =>
  clsx(
    'group/row relative border-b border-slate-100/90 transition-colors duration-150',
    'hover:bg-slate-50/80',
    isBlocked ? 'bg-slate-50/50' : 'bg-white',
    'text-[12px] leading-tight',
    patientName?.trim() === '' && 'animate-slide-fade-in'
  );

export const resolvePatientMainRowActionsAvailability = (
  capabilities: PatientRowCapabilities
): PatientMainRowViewState['rowActionsAvailability'] => ({
  canOpenClinicalDocuments: capabilities.canOpenClinicalDocuments,
  canOpenExamRequest: capabilities.canOpenExamRequest,
  canOpenImagingRequest: capabilities.canOpenImagingRequest,
  canOpenHistory: capabilities.canOpenHistory,
  canShowClinicalDocumentIndicator: capabilities.canShowClinicalDocumentIndicator,
});

interface BuildPatientMainRowViewStateParams {
  bedId: string;
  readOnly: boolean;
  isEmpty: boolean;
  isBlocked: boolean;
  capabilities: PatientRowCapabilities;
  isUpc?: boolean;
  patientName?: string;
}

const buildPatientMainRowPresentation = ({
  bedId,
  readOnly,
  isEmpty,
  isBlocked,
  capabilities,
  patientName,
}: Pick<
  BuildPatientMainRowViewStateParams,
  'bedId' | 'readOnly' | 'isEmpty' | 'isBlocked' | 'capabilities' | 'patientName'
>) => ({
  canToggleBedType: shouldShowBedTypeToggle({ bedId, readOnly, isEmpty }),
  rowClassName: resolvePatientMainRowClassName({ bedId, isBlocked, patientName }),
  rowActionsAvailability: resolvePatientMainRowActionsAvailability(capabilities),
  showBlockedContent: isBlocked,
});

export interface PatientMainRowViewState {
  canToggleBedType: boolean;
  rowClassName: string;
  rowActionsAvailability: {
    canOpenClinicalDocuments: boolean;
    canOpenExamRequest: boolean;
    canOpenImagingRequest: boolean;
    canOpenHistory: boolean;
    canShowClinicalDocumentIndicator: boolean;
  };
  showBlockedContent: boolean;
}

export const buildPatientMainRowViewState = ({
  bedId,
  readOnly,
  isEmpty,
  isBlocked,
  capabilities,
  patientName,
}: BuildPatientMainRowViewStateParams): PatientMainRowViewState =>
  buildPatientMainRowPresentation({
    bedId,
    readOnly,
    isEmpty,
    isBlocked,
    capabilities,
    patientName,
  });
