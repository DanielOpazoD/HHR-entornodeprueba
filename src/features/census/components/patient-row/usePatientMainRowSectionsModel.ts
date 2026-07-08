import { useMemo } from 'react';
import { buildPatientActionSectionBinding } from '../../controllers/patientRowActionSectionBindingsController';
import { buildPatientMainRowSections } from '../../controllers/patientMainRowSectionsController';
import type { PatientMainRowViewProps } from './patientRowContracts';

export const usePatientMainRowSectionsModel = (props: PatientMainRowViewProps) => {
  const actionSectionBinding = useMemo(
    () =>
      buildPatientActionSectionBinding({
        isBlocked: props.isBlocked,
        readOnly: props.readOnly,
        clinicalEditingDisabled: props.clinicalEditingDisabled,
        actionMenuAlign: props.actionMenuAlign,
        data: props.data,
        currentDateString: props.currentDateString,
        indicators: props.indicators,
        mainRowViewState: props.mainRowViewState,
        accessProfile: props.accessProfile,
        onAction: props.onAction,
        onOpenDemographics: props.onOpenDemographics,
        onOpenClinicalDocuments: props.onOpenClinicalDocuments,
        onOpenExamRequest: props.onOpenExamRequest,
        onOpenImagingRequest: props.onOpenImagingRequest,
        onOpenHistory: props.onOpenHistory,
        clinicalDocumentCount: props.clinicalDocumentCount,
      }),
    [
      props.accessProfile,
      props.actionMenuAlign,
      props.clinicalDocumentCount,
      props.currentDateString,
      props.data,
      props.indicators,
      props.isBlocked,
      props.mainRowViewState,
      props.clinicalEditingDisabled,
      props.onAction,
      props.onOpenClinicalDocuments,
      props.onOpenDemographics,
      props.onOpenExamRequest,
      props.onOpenHistory,
      props.onOpenImagingRequest,
      props.readOnly,
    ]
  );

  return buildPatientMainRowSections(props, actionSectionBinding);
};
