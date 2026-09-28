// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { buildPatientActionMenuInteractionHandlers } from '@/features/census/controllers/patientActionMenuInteractionController';

describe('patientActionMenuInteractionController', () => {
  it('closes after action and after each clinical callback', () => {
    const close = vi.fn();
    const onAction = vi.fn();
    const onViewHistory = vi.fn();
    const onViewClinicalDocuments = vi.fn();
    const onViewExamRequest = vi.fn();
    const onViewImagingRequest = vi.fn();
    const onViewMedicalIndications = vi.fn();

    const handlers = buildPatientActionMenuInteractionHandlers({
      onAction,
      onViewHistory,
      onViewClinicalDocuments,
      onViewExamRequest,
      onViewImagingRequest,
      onViewMedicalIndications,
      close,
    });

    handlers.handleAction('clear');
    handlers.handleViewHistory();
    handlers.handleViewClinicalDocuments();
    handlers.handleViewExamRequest();
    handlers.handleViewImagingRequest();
    handlers.handleViewMedicalIndications();

    expect(onAction).toHaveBeenCalledWith('clear');
    expect(onViewHistory).toHaveBeenCalled();
    expect(onViewClinicalDocuments).toHaveBeenCalled();
    expect(onViewExamRequest).toHaveBeenCalled();
    expect(onViewImagingRequest).toHaveBeenCalled();
    expect(onViewMedicalIndications).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(6);
  });

  it('still closes when an optional callback is missing', () => {
    const close = vi.fn();
    const handlers = buildPatientActionMenuInteractionHandlers({
      onAction: vi.fn(),
      close,
    });

    handlers.handleViewHistory();
    handlers.handleViewClinicalDocuments();
    handlers.handleViewExamRequest();
    handlers.handleViewImagingRequest();
    handlers.handleViewMedicalIndications();

    expect(close).toHaveBeenCalledTimes(5);
  });
});
