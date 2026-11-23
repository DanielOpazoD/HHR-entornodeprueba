// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildPatientRowModalRenderModel,
  resolvePatientRowDemographicsBinding,
  resolvePatientRowModalMountState,
  resolvePatientRowModalVisibilityState,
} from '@/features/census/controllers/patientRowModalRenderController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientRowModalRenderController', () => {
  it('builds demographics and visibility state from modal props', () => {
    const onSaveDemographics = vi.fn();
    const onSaveCribDemographics = vi.fn();

    const result = buildPatientRowModalRenderModel({
      bedId: 'R1',
      data: DataFactory.createMockPatient('R1', {
        patientName: 'RN principal',
        rut: '',
        bedMode: 'Cuna',
      }),
      isSubRow: false,
      showDemographics: true,
      showClinicalDocuments: false,
      canOpenClinicalDocuments: false,
      showExamRequest: false,
      canOpenExamRequest: true,
      showImagingRequest: false,
      canOpenImagingRequest: true,
      showHistory: false,
      canOpenHistory: true,
      onSaveDemographics,
      onSaveCribDemographics,
    });

    expect(result.visibilityState.shouldRenderDemographics).toBe(true);
    expect(result.demographicsBinding.targetBedId).toBe('R1');
    expect(result.demographicsBinding.isRnIdentityContext).toBe(true);
    expect(result.historyPatientRut).toBe('');
    expect(result.historyPatientName).toBe('RN principal');
    expect(result.demographicsKey).toContain('demographics-R1-open');
    expect(result.shouldRenderAnyModal).toBe(true);
  });

  it('keeps the demographics modal key stable across transient identity changes in the same bed', () => {
    const onSaveDemographics = vi.fn();
    const onSaveCribDemographics = vi.fn();

    const baseInput = {
      bedId: 'R1',
      isSubRow: false,
      showDemographics: true,
      showClinicalDocuments: false,
      canOpenClinicalDocuments: false,
      showExamRequest: false,
      canOpenExamRequest: true,
      showImagingRequest: false,
      canOpenImagingRequest: true,
      showHistory: false,
      canOpenHistory: true,
      onSaveDemographics,
      onSaveCribDemographics,
    } as const;

    const first = buildPatientRowModalRenderModel({
      ...baseInput,
      data: DataFactory.createMockPatient('R1', {
        patientName: ' ',
        rut: '',
        identityStatus: 'official',
      }),
    });

    const second = buildPatientRowModalRenderModel({
      ...baseInput,
      data: DataFactory.createMockPatient('R1', {
        patientName: '',
        rut: '',
        identityStatus: 'official',
      }),
    });

    expect(first.demographicsKey).toBe(second.demographicsKey);
  });

  it('derives a mount state that stays false when every modal is unavailable', () => {
    const result = resolvePatientRowModalMountState({
      showDemographics: false,
      showClinicalDocuments: true,
      canOpenClinicalDocuments: false,
      showExamRequest: true,
      canOpenExamRequest: false,
      showImagingRequest: true,
      canOpenImagingRequest: false,
      showHistory: true,
      canOpenHistory: false,
    });

    expect(result.visibilityState).toEqual({
      shouldRenderDemographics: false,
      shouldRenderClinicalDocuments: false,
      shouldRenderExamRequest: false,
      shouldRenderImagingRequest: false,
      shouldRenderHistory: false,
    });
    expect(result.shouldRenderAnyModal).toBe(false);
  });

  it('targets main vs crib demographics bindings according to row context', () => {
    const onSaveDemographics = vi.fn();
    const onSaveCribDemographics = vi.fn();
    const patient = DataFactory.createMockPatient('R1', { bedMode: 'Cama' });

    const parent = resolvePatientRowDemographicsBinding({
      bedId: 'R1',
      isSubRow: false,
      data: patient,
      onSaveDemographics,
      onSaveCribDemographics,
    });
    expect(parent.targetBedId).toBe('R1');
    expect(parent.isRnIdentityContext).toBe(false);
    expect(parent.onSave).toBe(onSaveDemographics);

    const crib = resolvePatientRowDemographicsBinding({
      bedId: 'R1',
      isSubRow: true,
      data: patient,
      onSaveDemographics,
      onSaveCribDemographics,
    });
    expect(crib.targetBedId).toBe('R1-cuna');
    expect(crib.isRnIdentityContext).toBe(true);
    expect(crib.onSave).toBe(onSaveCribDemographics);
  });

  it('gates each clinical modal on both request flag and authorization capability', () => {
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
