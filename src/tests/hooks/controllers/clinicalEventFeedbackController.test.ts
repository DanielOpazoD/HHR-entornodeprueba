// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildClinicalEventAuditPayload,
  buildClinicalEventSuccessFeedback,
} from '@/hooks/controllers/clinicalEventFeedbackController';

describe('clinicalEventFeedbackController', () => {
  it('builds a debounced audit payload for clinical event mutations', () => {
    expect(
      buildClinicalEventAuditPayload('CLINICAL_EVENT_ADDED', 'R1', 'Broncoscopía', '2026-03-17')
    ).toEqual({
      action: 'CLINICAL_EVENT_ADDED',
      entityType: 'patient',
      entityId: 'R1',
      details: { event: 'Broncoscopía' },
      patientRut: 'R1',
      recordDate: '2026-03-17',
      authors: undefined,
      waitMs: 10000,
    });
  });

  it('builds success feedback for added clinical events', () => {
    expect(buildClinicalEventSuccessFeedback('Cultivo')).toEqual({
      title: 'Evento agregado',
      description: 'Se ha registrado el evento: Cultivo',
    });
  });
});
