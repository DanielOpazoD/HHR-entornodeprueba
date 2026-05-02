import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearOperationalTelemetryEvents,
  getOperationalTelemetryEvents,
} from '@/services/observability/operationalTelemetryService';
import { recordCriticalClinicalAction } from '@/services/observability/criticalClinicalActionRecorder';

describe('criticalClinicalActionRecorder', () => {
  beforeEach(() => {
    clearOperationalTelemetryEvents();
    vi.useRealTimers();
  });

  it('records successful critical actions even when success telemetry is normally ignored', () => {
    recordCriticalClinicalAction({
      category: 'daily_record',
      action: 'census_discharge_created',
      outcome: 'success',
      clinicalDate: '2026-05-02',
      bedId: 'R1',
      patientRut: '12.345.678-9',
      userRole: 'nurse_hospital',
    });

    expect(getOperationalTelemetryEvents()).toEqual([
      expect.objectContaining({
        category: 'daily_record',
        operation: 'census_discharge_created',
        status: 'success',
        date: '2026-05-02',
        context: expect.objectContaining({
          criticalClinicalAction: true,
          bedId: 'R1',
          patientRef: '12.345.***-*',
          userRole: 'nurse_hospital',
        }),
      }),
    ]);
  });

  it('records failed critical actions with safe issue text and action context', () => {
    recordCriticalClinicalAction({
      category: 'clinical_document',
      action: 'clinical_document_saved',
      outcome: 'failed',
      clinicalDate: '2026-05-02',
      documentId: 'DOC-1',
      documentType: 'epicrisis_traslado',
      issues: ['No se pudo guardar.'],
    });

    expect(getOperationalTelemetryEvents()).toEqual([
      expect.objectContaining({
        category: 'clinical_document',
        operation: 'clinical_document_saved',
        status: 'failed',
        issues: ['No se pudo guardar.'],
        context: expect.objectContaining({
          criticalClinicalAction: true,
          documentId: 'DOC-1',
          documentType: 'epicrisis_traslado',
        }),
      }),
    ]);
  });
});
