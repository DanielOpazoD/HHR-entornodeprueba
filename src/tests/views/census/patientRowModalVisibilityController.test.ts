// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { resolvePatientRowModalVisibilityState } from '@/features/census/controllers/patientRowModalVisibilityController';

describe('patientRowModalVisibilityController', () => {
  it('renders clinical documents modal only when requested and authorized', () => {
    expect(
      resolvePatientRowModalVisibilityState({
        showDemographics: true,
        showClinicalDocuments: true,
        canOpenClinicalDocuments: true,
        showExamRequest: true,
        canOpenExamRequest: true,
        showImagingRequest: true,
        canOpenImagingRequest: true,
        showHistory: true,
        canOpenHistory: true,
      })
    ).toEqual({
      shouldRenderDemographics: true,
      shouldRenderClinicalDocuments: true,
      shouldRenderExamRequest: true,
      shouldRenderImagingRequest: true,
      shouldRenderHistory: true,
    });

    expect(
      resolvePatientRowModalVisibilityState({
        showDemographics: true,
        showClinicalDocuments: true,
        canOpenClinicalDocuments: false,
        showExamRequest: true,
        canOpenExamRequest: false,
        showImagingRequest: true,
        canOpenImagingRequest: false,
        showHistory: true,
        canOpenHistory: false,
      })
    ).toEqual({
      shouldRenderDemographics: true,
      shouldRenderClinicalDocuments: false,
      shouldRenderExamRequest: false,
      shouldRenderImagingRequest: false,
      shouldRenderHistory: false,
    });

    expect(
      resolvePatientRowModalVisibilityState({
        showDemographics: false,
        showClinicalDocuments: false,
        canOpenClinicalDocuments: true,
        showExamRequest: false,
        canOpenExamRequest: true,
        showImagingRequest: false,
        canOpenImagingRequest: true,
        showHistory: false,
        canOpenHistory: true,
      })
    ).toEqual({
      shouldRenderDemographics: false,
      shouldRenderClinicalDocuments: false,
      shouldRenderExamRequest: false,
      shouldRenderImagingRequest: false,
      shouldRenderHistory: false,
    });
  });
});
